import type { Context } from 'telegraf';
import type { AppConfig } from '../config/env.js';
import type { Repository } from '../storage/repository.js';
import { logger } from '../utils/logger.js';

/**
 * Camada de autorização do Telegram (planejamento, seção 12 / CA-05).
 *
 * Regras:
 * 1. O bot só responde a usuários em TELEGRAM_ALLOWED_USER_IDS.
 * 2. Em grupos, só responde se grupos forem permitidos e (opcionalmente) o
 *    chat estiver na allowlist.
 * 3. Aplica rate limit simples por usuário.
 *
 * Nada de tokens ou dados sensíveis é registrado — apenas IDs.
 */
export class TelegramAuth {
  private readonly allowedUsers: Set<number>;
  private readonly allowedChats: Set<number>;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: Repository,
  ) {
    this.allowedUsers = new Set(config.TELEGRAM_ALLOWED_USER_IDS);
    this.allowedChats = new Set(config.TELEGRAM_ALLOWED_CHAT_IDS);
  }

  /** Resultado da verificação: ok, ou motivo da recusa. */
  check(ctx: Context): { allowed: boolean; reason?: 'user' | 'chat' | 'rate' } {
    const userId = ctx.from?.id;
    const chat = ctx.chat;

    if (!userId || !this.allowedUsers.has(userId)) {
      logger.warn({ userId, chatId: chat?.id }, 'Tentativa de acesso de usuário não autorizado');
      return { allowed: false, reason: 'user' };
    }

    const isGroup = chat?.type === 'group' || chat?.type === 'supergroup';
    if (isGroup) {
      if (!this.config.BRIDGE_ALLOW_GROUP_MESSAGES) {
        return { allowed: false, reason: 'chat' };
      }
      // Se houver allowlist de chats, o grupo precisa estar nela.
      if (this.allowedChats.size > 0 && !this.allowedChats.has(chat.id)) {
        logger.warn({ chatId: chat.id }, 'Grupo fora da allowlist de chats');
        return { allowed: false, reason: 'chat' };
      }
    }

    // Rate limit por usuário. Cliques em botões (callback_query) são leves e
    // ficam isentos para não atrapalhar a navegação nos menus.
    if (
      ctx.updateType !== 'callback_query' &&
      !this.repo.allowRequest(userId, this.config.BRIDGE_RATE_LIMIT_PER_MINUTE)
    ) {
      logger.warn({ userId }, 'Usuário atingiu o rate limit');
      return { allowed: false, reason: 'rate' };
    }

    return { allowed: true };
  }
}
