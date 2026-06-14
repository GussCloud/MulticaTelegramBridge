import type { Telegraf, Context } from 'telegraf';
import type { AppConfig } from '../config/env.js';
import type { AgentService } from '../domain/agent.service.js';
import type { SquadService } from '../domain/squad.service.js';
import type { MentionResolver } from '../domain/mention-resolver.js';
import type { IssueService } from '../domain/issue.service.js';
import type { ChatService } from '../domain/chat.service.js';
import type { MulticaClient } from '../multica/multica.client.js';
import type { MulticaWebSocket } from '../multica/multica.websocket.js';
import { toUserMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  HELP_TEXT,
  formatAgentList,
  formatSquadList,
  formatIssueCreated,
  formatIssueList,
  formatIssueDetail,
  splitMessage,
  statusLabel,
} from './telegram.formatter.js';

export interface CommandServices {
  config: AppConfig;
  client: MulticaClient;
  agents: AgentService;
  squads: SquadService;
  mentions: MentionResolver;
  issues: IssueService;
  chat: ChatService;
  websocket: MulticaWebSocket;
}

/** Envia uma resposta dividindo mensagens longas conforme o limite. */
async function reply(ctx: Context, text: string, maxLength: number): Promise<void> {
  for (const chunk of splitMessage(text, maxLength)) {
    await ctx.reply(chunk);
  }
}

/** Extrai os argumentos após o comando (ex.: "/issues in_progress" -> "in_progress"). */
function getArgs(ctx: Context): string {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const firstSpace = text.indexOf(' ');
  return firstSpace === -1 ? '' : text.slice(firstSpace + 1).trim();
}

/**
 * Wrapper que captura erros e responde de forma segura (sem vazar
 * token/stacktrace ao usuário — planejamento, seção 13).
 */
function handler(
  maxLength: number,
  fn: (ctx: Context) => Promise<void>,
): (ctx: Context) => Promise<void> {
  return async (ctx: Context) => {
    try {
      await fn(ctx);
    } catch (err) {
      logger.error(
        { err: (err as Error).message, command: getArgs(ctx) },
        'Erro ao processar comando',
      );
      await reply(ctx, toUserMessage(err), maxLength);
    }
  };
}

/** Registra todos os comandos no bot. */
export function registerCommands(bot: Telegraf, services: CommandServices): void {
  const max = services.config.BRIDGE_MAX_MESSAGE_LENGTH;

  // ----------------------------- Básicos ------------------------------
  // /start e /menu são tratados em registerMenu (exibem o menu de botões).

  bot.help(handler(max, async (ctx) => reply(ctx, HELP_TEXT, max)));

  bot.command('status', handler(max, async (ctx) => {
    let multicaOk = false;
    try {
      multicaOk = await services.client.healthCheck();
    } catch {
      multicaOk = false;
    }
    const wsOn = services.config.BRIDGE_ENABLE_WEBSOCKET;
    const wsConnected = services.websocket.isConnected();
    const text = [
      '📊 Status do Bridge',
      '',
      `Multica REST: ${multicaOk ? '✅ conectado' : '⚠️ indisponível'}`,
      `WebSocket: ${wsOn ? (wsConnected ? '✅ conectado' : '⚠️ desconectado') : '➖ desabilitado'}`,
      `Workspace: ${services.config.MULTICA_WORKSPACE_SLUG}`,
    ].join('\n');
    await reply(ctx, text, max);
  }));

  // ------------------------- Agentes / Squads -------------------------

  bot.command('agentes', handler(max, async (ctx) => {
    const agents = await services.agents.list();
    await reply(ctx, formatAgentList(agents), max);
  }));

  bot.command('squads', handler(max, async (ctx) => {
    const squads = await services.squads.list();
    await reply(ctx, formatSquadList(squads), max);
  }));

  bot.command('refresh', handler(max, async (ctx) => {
    services.agents.invalidate();
    services.squads.invalidate();
    await services.mentions.refresh(true);
    await reply(ctx, '🔄 Cache de agentes, squads e menções atualizado.', max);
  }));

  // ------------------------------ Issues ------------------------------

  bot.command('issues', handler(max, async (ctx) => {
    const statusArg = getArgs(ctx) || undefined;
    const { status, issues } = await services.issues.listByStatus(statusArg);
    await reply(ctx, formatIssueList(issues, status ? statusLabel(status) : undefined), max);
  }));

  bot.command('issue', handler(max, async (ctx) => {
    const id = getArgs(ctx);
    if (!id) {
      await reply(ctx, '❌ Informe o ID da issue. Ex.: /issue MUL-123', max);
      return;
    }
    const issue = await services.issues.getDetail(id);
    if (!issue) {
      await reply(ctx, `❌ Issue ${id} não encontrada.`, max);
      return;
    }
    await reply(ctx, formatIssueDetail(issue), max);
  }));

  // Aceita tanto /nova-issue quanto /nova_issue (Telegram normaliza hífens).
  const novaIssue = handler(max, async (ctx) => {
    const raw = getArgs(ctx);
    if (!raw) {
      await reply(
        ctx,
        '❌ Uso: /nova-issue @agente | Título | Descrição | prioridade',
        max,
      );
      return;
    }
    const { issue, assigneeName } = await services.issues.createFromCommand(raw);
    await reply(ctx, formatIssueCreated(issue, assigneeName), max);
  });
  bot.command('nova-issue', novaIssue);
  bot.command('nova_issue', novaIssue);
  bot.command('novaissue', novaIssue);

  bot.command('comentar', handler(max, async (ctx) => {
    const raw = getArgs(ctx);
    const firstSpace = raw.indexOf(' ');
    if (firstSpace === -1) {
      await reply(ctx, '❌ Uso: /comentar <id> <texto do comentário>', max);
      return;
    }
    const id = raw.slice(0, firstSpace).trim();
    const body = raw.slice(firstSpace + 1).trim();
    await services.issues.comment(id, body);
    await reply(ctx, `💬 Comentário adicionado à issue ${id}.`, max);
  }));

  // ------------------------------- Chat -------------------------------

  bot.command('chat', handler(max, async (ctx) => {
    const raw = getArgs(ctx);
    if (!raw) {
      await reply(ctx, '❌ Uso: /chat @agente <mensagem>', max);
      return;
    }
    const userId = ctx.from?.id ?? 0;
    const { agentName, messages } = await services.chat.send(userId, raw);
    const last = messages.filter((m) => m.role !== 'user').at(-1);
    const answer = last?.content
      ? `💬 ${agentName}:\n${last.content}`
      : `📨 Mensagem enviada para ${agentName}. A resposta chegará por aqui assim que o agente responder.`;
    await reply(ctx, answer, max);
  }));
}
