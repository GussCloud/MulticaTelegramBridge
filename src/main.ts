import Fastify from 'fastify';
import { loadConfig } from './config/env.js';
import { logger, maskSecret } from './utils/logger.js';
import { ConfigError, MulticaApiError } from './utils/errors.js';
import { MulticaClient } from './multica/multica.client.js';
import { MulticaWebSocket, type MulticaEvent } from './multica/multica.websocket.js';
import { Repository } from './storage/repository.js';
import { AgentService } from './domain/agent.service.js';
import { SquadService } from './domain/squad.service.js';
import { MentionResolver } from './domain/mention-resolver.js';
import { IssueService } from './domain/issue.service.js';
import { ChatService } from './domain/chat.service.js';
import { NotificationService } from './domain/notification.service.js';
import { createBot } from './telegram/telegram.bot.js';
import type { CommandServices } from './telegram/telegram.commands.js';

async function main(): Promise<void> {
  // -------------------- 1. Configuração (.env) --------------------
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
    } else {
      logger.fatal({ err: (err as Error).message }, 'Falha ao carregar configuração');
    }
    process.exit(1);
  }

  logger.info(
    {
      mode: config.TELEGRAM_MODE,
      workspace: config.MULTICA_WORKSPACE_SLUG,
      multicaUrl: config.MULTICA_API_BASE_URL,
      botToken: maskSecret(config.TELEGRAM_BOT_TOKEN),
      websocket: config.BRIDGE_ENABLE_WEBSOCKET,
    },
    'Iniciando Multica Telegram Bridge',
  );

  // -------------------- 2. Dependências --------------------
  const repo = new Repository();
  const client = new MulticaClient(config);
  const agents = new AgentService(client, config.BRIDGE_CACHE_TTL_SECONDS);
  const squads = new SquadService(client, config.BRIDGE_CACHE_TTL_SECONDS);
  const mentions = new MentionResolver(agents, squads);
  const issues = new IssueService(client, mentions);
  const chat = new ChatService(client, mentions, repo);

  // -------------------- 3. Health check do Multica --------------------
  try {
    await client.healthCheck();
    logger.info('Health check do Multica: OK');
  } catch (err) {
    // CA-04: token inválido ou backend fora -> registra erro seguro e aborta.
    const message = err instanceof MulticaApiError ? err.message : (err as Error).message;
    logger.fatal({ reason: message }, 'Health check do Multica falhou — abortando inicialização');
    process.exit(1);
  }

  // Carrega o cache de menções no startup.
  try {
    await mentions.refresh(true);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Não foi possível pré-carregar o cache de menções');
  }

  // -------------------- 4. Telegram + WebSocket --------------------
  const commandServices: CommandServices = {
    config,
    client,
    agents,
    squads,
    mentions,
    issues,
    chat,
    // websocket é atribuído logo abaixo (referência circular resolvida na sequência)
    websocket: undefined as unknown as MulticaWebSocket,
  };

  const bot = createBot(config, repo, commandServices);
  const notifications = new NotificationService(bot, repo, config.BRIDGE_NOTIFICATION_CHAT_ID);

  const websocket = new MulticaWebSocket(config, (event: MulticaEvent) =>
    notifications.handleEvent(event),
  );
  commandServices.websocket = websocket;

  // -------------------- 5. Servidor HTTP (health + webhook) --------------------
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({
    status: 'ok',
    websocket: config.BRIDGE_ENABLE_WEBSOCKET
      ? websocket.isConnected()
        ? 'connected'
        : 'disconnected'
      : 'disabled',
    timestamp: new Date().toISOString(),
  }));

  // Webhook do Telegram (apenas no modo webhook).
  if (config.TELEGRAM_MODE === 'webhook') {
    const path = '/telegram/webhook';
    app.post(path, async (request, replyHttp) => {
      // Validação opcional do segredo do webhook.
      if (config.TELEGRAM_WEBHOOK_SECRET) {
        const header = request.headers['x-telegram-bot-api-secret-token'];
        if (header !== config.TELEGRAM_WEBHOOK_SECRET) {
          logger.warn('Webhook com segredo inválido — requisição rejeitada');
          return replyHttp.code(401).send({ error: 'unauthorized' });
        }
      }
      await bot.handleUpdate(request.body as never);
      return replyHttp.code(200).send({ ok: true });
    });
  }

  await app.listen({ host: '0.0.0.0', port: config.BRIDGE_PORT });
  logger.info({ port: config.BRIDGE_PORT }, 'Servidor HTTP do bridge ativo');

  // -------------------- 6. Inicia o bot Telegram --------------------
  if (config.TELEGRAM_MODE === 'webhook') {
    const webhookUrl = `${config.TELEGRAM_WEBHOOK_URL}`;
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET || undefined,
    });
    logger.info('Telegram configurado em modo webhook');
  } else {
    // Polling: garante que nenhum webhook esteja ativo e inicia o long polling.
    await bot.telegram.deleteWebhook().catch(() => undefined);
    void bot.launch(() => logger.info('Telegram configurado em modo polling'));
  }

  // Registra a lista de comandos na UI nativa do Telegram (menu "/").
  await bot.telegram
    .setMyCommands([
      { command: 'menu', description: 'Abrir o menu de botões' },
      { command: 'agentes', description: 'Listar agentes' },
      { command: 'squads', description: 'Listar squads' },
      { command: 'issues', description: 'Listar issues' },
      { command: 'status', description: 'Status do bridge' },
      { command: 'help', description: 'Ajuda' },
    ])
    .catch(() => undefined);

  // -------------------- 7. WebSocket + fallback por polling --------------------
  if (config.BRIDGE_ENABLE_WEBSOCKET) {
    websocket.connect();
  }
  if (config.BRIDGE_ENABLE_POLLING_FALLBACK) {
    startPollingFallback(config, websocket, issues, notifications);
  }

  logger.info('✅ Multica Telegram Bridge iniciado com sucesso');

  // -------------------- 8. Encerramento gracioso --------------------
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando o bridge...');
    websocket.close();
    bot.stop(signal);
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * Fallback por polling (planejamento, seção 14).
 *
 * Quando o WebSocket está desconectado, consulta periodicamente as issues
 * atualizadas recentemente para não perder visibilidade. Não substitui o
 * tempo real, mas evita silêncio total.
 */
function startPollingFallback(
  config: ReturnType<typeof loadConfig>,
  websocket: MulticaWebSocket,
  issues: IssueService,
  notifications: NotificationService,
): void {
  const intervalMs = config.BRIDGE_POLLING_INTERVAL_SECONDS * 1000;
  let warned = false;

  setInterval(() => {
    // Só atua quando o WebSocket está habilitado porém indisponível.
    if (!config.BRIDGE_ENABLE_WEBSOCKET || websocket.isConnected()) {
      warned = false;
      return;
    }
    if (!warned) {
      logger.warn('WebSocket indisponível — iniciando polling de fallback');
      warned = true;
    }
    void (async () => {
      try {
        const { issues: list } = await issues.listByStatus('andamento');
        for (const issue of list) {
          await notifications.handleEvent({
            type: 'issue.updated',
            id: undefined,
            payload: {
              id: issue.id,
              key: issue.key,
              title: issue.title,
              status: issue.status,
              updated_at: issue.updated_at,
            },
          });
        }
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'Erro no polling de fallback');
      }
    })();
  }, intervalMs).unref();
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'Falha fatal na inicialização');
  process.exit(1);
});
