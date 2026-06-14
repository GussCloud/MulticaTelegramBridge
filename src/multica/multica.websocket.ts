import { WebSocket } from 'ws';
import type { AppConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface MulticaEvent {
  id?: string;
  type?: string;
  workspace_id?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

type EventHandler = (event: MulticaEvent) => void | Promise<void>;

/**
 * Client WebSocket do Multica (planejamento 5.3 / seção 11).
 *
 * - conecta no endpoint `/ws` com autenticação por token;
 * - reconecta automaticamente com backoff exponencial;
 * - filtra eventos por workspace quando o ID está configurado;
 * - mantém a conexão viva com ping periódico.
 *
 * O fallback por polling (quando o WS permanece indisponível) é tratado
 * fora desta classe, no `main.ts`, observando `isConnected()`.
 */
export class MulticaWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxBackoffMs = 30_000;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closedByUser = false;
  private connected = false;

  /** Contador exposto para métricas (multica_ws_reconnects_total). */
  public reconnects = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly onEvent: EventHandler,
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (!this.config.BRIDGE_ENABLE_WEBSOCKET || !this.config.MULTICA_WS_URL) {
      logger.info('WebSocket desabilitado por configuração');
      return;
    }
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const url = this.buildUrl();
    logger.info({ url: this.maskUrl(url) }, 'Conectando ao WebSocket do Multica');

    // Autenticação via header Authorization (Bearer) + header de workspace.
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.config.MULTICA_API_TOKEN}`,
        'X-Workspace-Slug': this.config.MULTICA_WORKSPACE_SLUG,
        'X-Client-Platform': 'telegram-bridge',
      },
      handshakeTimeout: 15_000,
    });
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      logger.info('WebSocket conectado ao Multica');
      this.startPing();
    });

    ws.on('message', (data) => {
      void this.handleMessage(data.toString());
    });

    ws.on('close', (code) => {
      this.connected = false;
      this.stopPing();
      logger.warn({ code }, 'WebSocket desconectado');
      if (!this.closedByUser) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.error({ err: err.message }, 'Erro no WebSocket');
      // O evento 'close' cuidará do reconnect.
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    let event: MulticaEvent;
    try {
      event = JSON.parse(raw) as MulticaEvent;
    } catch {
      logger.debug('Mensagem WebSocket não-JSON ignorada');
      return;
    }

    // Filtra eventos de outros workspaces, se o ID estiver configurado.
    if (
      this.config.MULTICA_WORKSPACE_ID &&
      event.workspace_id &&
      event.workspace_id !== this.config.MULTICA_WORKSPACE_ID
    ) {
      return;
    }

    logger.debug({ type: event.type }, 'Evento recebido do Multica');
    try {
      await this.onEvent(event);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Erro ao processar evento do WebSocket');
    }
  }

  private scheduleReconnect(): void {
    this.reconnects += 1;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.maxBackoffMs);
    logger.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'Reagendando reconexão do WebSocket');
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private buildUrl(): string {
    // Permite passar o token na query como fallback, caso o backend não
    // aceite header no handshake (alguns proxies removem headers).
    const url = new URL(this.config.MULTICA_WS_URL);
    if (!url.searchParams.has('token')) {
      url.searchParams.set('token', this.config.MULTICA_API_TOKEN);
    }
    if (this.config.MULTICA_WORKSPACE_SLUG) {
      url.searchParams.set('workspace', this.config.MULTICA_WORKSPACE_SLUG);
    }
    return url.toString();
  }

  /** Remove o token da URL para registro seguro em log. */
  private maskUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.searchParams.has('token')) u.searchParams.set('token', '***');
      return u.toString();
    } catch {
      return '(url inválida)';
    }
  }

  close(): void {
    this.closedByUser = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.connected = false;
  }
}
