/**
 * Hierarquia de erros do bridge.
 *
 * Princípio de segurança: erros expostos ao usuário do Telegram nunca
 * devem conter tokens, headers internos ou stacktraces. A propriedade
 * `userMessage` carrega o texto seguro para o usuário final.
 */

export class BridgeError extends Error {
  /** Mensagem amigável e segura para enviar ao usuário no Telegram. */
  public readonly userMessage: string;

  constructor(message: string, userMessage?: string) {
    super(message);
    this.name = new.target.name;
    this.userMessage = userMessage ?? '⚠️ Ocorreu um erro inesperado. Tente novamente em instantes.';
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Variáveis de ambiente ausentes ou inválidas. */
export class ConfigError extends BridgeError {}

/** Usuário/chat não autorizado a usar o bot. */
export class UnauthorizedError extends BridgeError {
  constructor(message = 'Usuário não autorizado') {
    super(message, '⛔ Você não está autorizado a usar este bot.');
  }
}

/** Falha de comunicação com a API REST do Multica. */
export class MulticaApiError extends BridgeError {
  public readonly status: number | undefined;

  constructor(message: string, status?: number, userMessage?: string) {
    super(
      message,
      userMessage ??
        '⚠️ Não consegui conectar ao Multica agora. Verifique o backend ou tente novamente em instantes.',
    );
    this.status = status;
  }
}

/** Menção `@nome` não encontrada no cache de agentes/squads. */
export class MentionNotFoundError extends BridgeError {
  constructor(mention: string) {
    super(
      `Menção não encontrada: ${mention}`,
      `❌ Não encontrei nenhum agente ou squad com a menção @${mention}.\n` +
        'Use /agentes ou /squads para consultar as opções disponíveis.',
    );
  }
}

/** Menção `@nome` resolvida para mais de uma entidade. */
export class AmbiguousMentionError extends BridgeError {
  constructor(mention: string, options: string[]) {
    const lista = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    super(
      `Menção ambígua: ${mention}`,
      `⚠️ Encontrei mais de uma opção para @${mention}:\n${lista}\n\n` +
        'Use uma menção mais específica (ex.: @agent-nome ou @squad-nome).',
    );
  }
}

/** Erro de validação de comando enviado pelo usuário. */
export class ValidationError extends BridgeError {
  constructor(userMessage: string) {
    super('Erro de validação de comando', userMessage);
  }
}

/**
 * Converte qualquer erro em uma mensagem segura para o usuário final,
 * garantindo que detalhes internos jamais vazem para o Telegram.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof BridgeError) {
    return error.userMessage;
  }
  return '⚠️ Ocorreu um erro inesperado. Tente novamente em instantes.';
}
