/**
 * Persistência leve do bridge (em memória para o MVP).
 *
 * Responsabilidades:
 * - idempotência de eventos do WebSocket (evitar notificações duplicadas);
 * - vínculo entre usuário do Telegram + agente -> chat session;
 * - rate limiting simples por usuário.
 *
 * Tudo é mantido em memória; para produção, trocar por Postgres/Redis
 * (planejamento 5.7) mantendo a mesma interface.
 */
export class Repository {
  /** Chaves de eventos já processados (idempotência). */
  private readonly processedEvents = new Set<string>();
  private readonly processedOrder: string[] = [];
  private readonly maxEvents = 5000;

  /** Mapeia `telegramUserId:agentId` -> sessionId. */
  private readonly chatSessions = new Map<string, string>();

  /** Janela de rate limit por usuário: userId -> timestamps (ms). */
  private readonly rateWindows = new Map<number, number[]>();

  // ------------------------- Idempotência -----------------------------

  /** Retorna true se o evento já foi processado anteriormente. */
  hasProcessedEvent(key: string): boolean {
    return this.processedEvents.has(key);
  }

  /** Marca um evento como processado, com limite de memória (FIFO). */
  markEventProcessed(key: string): void {
    if (this.processedEvents.has(key)) return;
    this.processedEvents.add(key);
    this.processedOrder.push(key);
    if (this.processedOrder.length > this.maxEvents) {
      const oldest = this.processedOrder.shift();
      if (oldest) this.processedEvents.delete(oldest);
    }
  }

  // ------------------------- Chat sessions ----------------------------

  getChatSession(telegramUserId: number, agentId: string): string | undefined {
    return this.chatSessions.get(`${telegramUserId}:${agentId}`);
  }

  setChatSession(telegramUserId: number, agentId: string, sessionId: string): void {
    this.chatSessions.set(`${telegramUserId}:${agentId}`, sessionId);
  }

  // -------------------------- Rate limiting ---------------------------

  /**
   * Verifica e contabiliza uma requisição do usuário dentro da janela de
   * 1 minuto. Retorna true se ainda está dentro do limite permitido.
   */
  allowRequest(userId: number, limitPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (this.rateWindows.get(userId) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= limitPerMinute) {
      this.rateWindows.set(userId, timestamps);
      return false;
    }
    timestamps.push(now);
    this.rateWindows.set(userId, timestamps);
    return true;
  }
}
