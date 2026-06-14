import { Telegraf } from 'telegraf';
import type { AppConfig } from '../config/env.js';
import type { Repository } from '../storage/repository.js';
import { TelegramAuth } from './telegram.auth.js';
import { registerCommands, type CommandServices } from './telegram.commands.js';
import { logger } from '../utils/logger.js';

/**
 * Cria e configura a instância do bot Telegram.
 *
 * Aplica o middleware de autorização ANTES de qualquer comando, garantindo
 * que usuários não autorizados nunca cheguem aos handlers (CA-05).
 */
export function createBot(
  config: AppConfig,
  repo: Repository,
  services: CommandServices,
): Telegraf {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  const auth = new TelegramAuth(config, repo);

  // ---- Middleware de autorização (barreira de segurança) ----
  bot.use(async (ctx, next) => {
    // Só processamos mensagens de texto/comandos.
    const result = auth.check(ctx);
    if (result.allowed) {
      return next();
    }

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    switch (result.reason) {
      case 'rate':
        await safeReply(ctx, '⏳ Você enviou comandos demais. Aguarde um instante e tente novamente.');
        return;
      case 'user':
        // Em grupos, ignoramos silenciosamente para não gerar ruído.
        if (!isGroup) await safeReply(ctx, '⛔ Você não está autorizado a usar este bot.');
        return;
      case 'chat':
        // Grupo não permitido: ignora silenciosamente.
        return;
      default:
        return;
    }
  });

  registerCommands(bot, services);

  // Tratamento global de erros do Telegraf (não vaza detalhes ao usuário).
  bot.catch((err, ctx) => {
    logger.error(
      { err: (err as Error).message, updateType: ctx.updateType },
      'Erro não tratado no Telegraf',
    );
  });

  return bot;
}

/** Resposta tolerante a falhas (evita derrubar o middleware). */
async function safeReply(ctx: { reply: (t: string) => Promise<unknown> }, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch {
    // ignora falhas de envio
  }
}
