/**
 * Estado efêmero das jornadas interativas (menus por botões).
 *
 * Quando o usuário escolhe "Chat com @agente" ou "Nova issue para @agente",
 * o bridge guarda uma ação pendente; a PRÓXIMA mensagem de texto do usuário é
 * interpretada conforme essa ação (mensagem do chat ou campos da issue).
 *
 * Em memória, com TTL, chaveado por (chatId + userId). Para produção pode ser
 * trocado por Redis sem alterar os chamadores.
 */

export type PendingAction =
  | { kind: 'chat'; agentId: string; agentName: string }
  | {
      kind: 'new_issue';
      assigneeType: 'agent' | 'squad';
      assigneeId: string;
      assigneeName: string;
    };

interface StoredAction {
  action: PendingAction;
  expiresAt: number;
}

export class PendingActionStore {
  private readonly map = new Map<string, StoredAction>();

  constructor(private readonly ttlSeconds = 1800) {}

  /** Chave estável por chat + usuário. */
  static key(chatId: number | string, userId: number | string): string {
    return `${chatId}:${userId}`;
  }

  get(key: string): PendingAction | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.action;
  }

  set(key: string, action: PendingAction): void {
    this.map.set(key, { action, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  clear(key: string): void {
    this.map.delete(key);
  }
}
