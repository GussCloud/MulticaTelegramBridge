import type { Telegraf } from 'telegraf';
import type { Repository } from '../storage/repository.js';
import type { MulticaEvent } from '../multica/multica.websocket.js';
import { logger } from '../utils/logger.js';
import { statusLabel } from '../telegram/telegram.formatter.js';

/**
 * Notification Service (planejamento 5.6).
 *
 * Decide quais eventos do WebSocket devem virar mensagens no Telegram,
 * formata o texto, aplica idempotência (evita spam/duplicidade) e envia
 * para o chat de notificações configurado.
 */
export class NotificationService {
  constructor(
    private readonly bot: Telegraf,
    private readonly repo: Repository,
    private readonly notificationChatId: string,
  ) {}

  /** Tipos de evento que geram notificação no Telegram. */
  private static readonly NOTIFIABLE = new Set([
    'issue.created',
    'issue.updated',
    'issue.status_changed',
    'issue.comment_created',
    'task.completed',
    'task.failed',
    'task.message',
    'chat.message',
  ]);

  /** Processa um evento recebido do WebSocket. */
  async handleEvent(event: MulticaEvent): Promise<void> {
    if (!this.notificationChatId) return;

    const type = event.type ?? 'unknown';
    if (!NotificationService.NOTIFIABLE.has(type)) {
      logger.debug({ type }, 'Evento ignorado (não notificável)');
      return;
    }

    // Idempotência: evita reenviar a mesma notificação.
    const key = this.idempotencyKey(event);
    if (this.repo.hasProcessedEvent(key)) {
      logger.debug({ key }, 'Evento duplicado ignorado');
      return;
    }
    this.repo.markEventProcessed(key);

    const message = this.format(event);
    if (!message) return;

    try {
      await this.bot.telegram.sendMessage(this.notificationChatId, message);
      logger.info({ type }, 'Notificação enviada ao Telegram');
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Falha ao enviar notificação');
    }
  }

  private idempotencyKey(event: MulticaEvent): string {
    if (event.id) return `evt:${event.id}`;
    const payload = event.payload ?? {};
    const resourceId =
      (payload.id as string) ?? (payload.issue_id as string) ?? (payload.resource_id as string) ?? '';
    return `${event.type}:${resourceId}:${(payload.updated_at as string) ?? ''}`;
  }

  private format(event: MulticaEvent): string | null {
    const p = event.payload ?? {};
    const issueRef = (p.key as string) ?? (p.reference as string) ?? (p.issue_id as string) ?? (p.id as string) ?? '';
    const title = (p.title as string) ?? '';
    const agent = (p.agent_name as string) ?? (p.author_name as string) ?? 'Agente';

    switch (event.type) {
      case 'issue.created':
        return `🆕 Issue criada\n\n${issueRef} — ${title}\nStatus: ${statusLabel(p.status as string)}`;
      case 'issue.updated':
      case 'issue.status_changed': {
        const from = p.from_status ? `${statusLabel(p.from_status as string)} → ` : '';
        return `🔄 Issue atualizada\n\n${issueRef} — ${title}\nStatus: ${from}${statusLabel(p.status as string)}`;
      }
      case 'issue.comment_created':
        return `💬 Novo comentário\n\n${issueRef} — ${title}\n${agent}:\n"${(p.body as string) ?? ''}"`;
      case 'task.completed':
        return `✅ Task concluída\n\n${issueRef} — ${title}\nAgente: ${agent}\nStatus: concluída`;
      case 'task.failed':
        return `❌ Task falhou\n\n${issueRef} — ${title}\nAgente: ${agent}\nMotivo: ${(p.reason as string) ?? 'não informado'}`;
      case 'task.message':
      case 'chat.message':
        return `💬 Mensagem do agente\n\n${agent}:\n"${(p.content as string) ?? (p.body as string) ?? ''}"`;
      default:
        return null;
    }
  }
}
