import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface MulticaEvent {
  id?: string;
  type?: string;
  workspace_id?: string;
  actor_id?: string;
  actor_type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

type EventHandler = (event: MulticaEvent) => void | Promise<void>;

/**
 * Client WebSocket do Multica (endpoint `/ws`).
 *
 * Protocolo (modo token/PAT, conforme o backend multica-ai/multica):
 *  1. Conecta em `<MULTICA_WS_URL>?workspace_slug=<slug>&client_platform=<p>`
 *     — o token NUNCA vai na URL (seria registrado por proxies/CDNs).
 *  2. Envia o header `Origin` (o backend valida contra a allowlist
 *     CORS_ALLOWED_ORIGINS/FRONTEND_ORIGIN — caso contrário responde 403).
 *  3. Após `open`, envia o primeiro frame de autenticação:
 *       {"type":"auth","payload":{"token":"<PAT>"}}
 *  4. Aguarda o frame {"type":"auth_ack"} antes de processar eventos de negócio.
 *
 * Eventos de negócio chegam como { type, payload, actor_id, actor_type }.
 *
 * Recursos: reconexão automática com backoff exponencial, ping periódico,
 * timeout de autenticação e diagnóstico do handshake (loga status/corpo em
 * caso de resposta inesperada — ex.: 400 por workspace ausente, 403 por origin).
 */
export class MulticaWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxBackoffMs = 30_000;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private authTimer: NodeJS.Timeout | null = null;
  private closedByUser = false;
  private authenticated = false;

  /** Contador exposto para métricas (multica_ws_reconnects_total). */
  public reconnects = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly onEvent: EventHandler,
  ) {}

  /** Considera "conectado" apenas após o auth_ack (conexão útil de fato). */
  isConnected(): boolean {
    return this.authenticated;
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
    const origin = this.resolveOrigin();
    logger.info({ url, origin }, 'Conectando ao WebSocket do Multica');

    const ws = new WebSocket(url, {
      headers: {
        // Necessário para passar pela validação de Origin do backend.
        Origin: origin,
        'User-Agent': 'multica-telegram-bridge',
      },
      handshakeTimeout: 15_000,
    });
    this.ws = ws;

    ws.on('open', () => {
      logger.info('WebSocket aberto — enviando frame de autenticação (token)');
      this.sendAuthFrame();
      this.startAuthTimeout();
    });

    ws.on('message', (data) => {
      void this.handleMessage(data.toString());
    });

    // Diagnóstico: quando o servidor responde com um status HTTP em vez de
    // 101 (ex.: 400/401/403), o corpo costuma explicar o motivo.
    ws.on('unexpected-response', (_req, res: IncomingMessage) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        logger.error(
          { statusCode: res.statusCode, body: body.slice(0, 300) },
          'WebSocket: handshake recusado pelo Multica',
        );
      });
    });

    ws.on('close', (code) => {
      this.authenticated = false;
      this.stopPing();
      this.stopAuthTimeout();
      logger.warn({ code }, 'WebSocket desconectado');
      if (!this.closedByUser) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.error({ err: err.message }, 'Erro no WebSocket');
      // O evento 'close' cuidará do reconnect.
    });
  }

  /** Envia o primeiro frame de autenticação com o PAT. */
  private sendAuthFrame(): void {
    const frame = JSON.stringify({
      type: 'auth',
      payload: { token: this.config.MULTICA_API_TOKEN },
    });
    this.ws?.send(frame);
  }

  private async handleMessage(raw: string): Promise<void> {
    let event: MulticaEvent;
    try {
      event = JSON.parse(raw) as MulticaEvent;
    } catch {
      logger.debug('Mensagem WebSocket não-JSON ignorada');
      return;
    }

    // Fase de autenticação: só processamos eventos após o auth_ack.
    if (!this.authenticated) {
      if (event.type === 'auth_ack') {
        this.authenticated = true;
        this.reconnectAttempts = 0;
        this.stopAuthTimeout();
        this.startPing();
        logger.info('WebSocket autenticado (auth_ack) — recebendo eventos');
        return;
      }
      if (event.type === 'auth_error' || event.type === 'error') {
        logger.error(
          { reason: (event.payload as Record<string, unknown> | undefined)?.message },
          'WebSocket: autenticação recusada pelo Multica (verifique o token/PAT)',
        );
        this.ws?.close();
        return;
      }
      // Qualquer outro frame antes do ack é ignorado.
      return;
    }

    // Filtra eventos de outros workspaces, se o ID estiver configurado e o
    // evento carregar workspace_id explícito.
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
    logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Reagendando reconexão do WebSocket',
    );
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startAuthTimeout(): void {
    this.stopAuthTimeout();
    // Se o auth_ack não chegar a tempo, derruba para reconectar.
    this.authTimer = setTimeout(() => {
      if (!this.authenticated) {
        logger.warn('WebSocket: auth_ack não recebido a tempo — reconectando');
        this.ws?.close();
      }
    }, 10_000);
  }

  private stopAuthTimeout(): void {
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
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

  /**
   * Monta a URL de upgrade com os query params esperados pelo Multica:
   * `workspace_slug` (e `workspace_id`, se houver), `client_platform` e
   * `client_version`. O token NÃO é incluído na URL.
   */
  private buildUrl(): string {
    const url = new URL(this.config.MULTICA_WS_URL);
    url.searchParams.set('workspace_slug', this.config.MULTICA_WORKSPACE_SLUG);
    if (this.config.MULTICA_WORKSPACE_ID) {
      url.searchParams.set('workspace_id', this.config.MULTICA_WORKSPACE_ID);
    }
    url.searchParams.set('client_platform', this.config.MULTICA_WS_CLIENT_PLATFORM);
    url.searchParams.set('client_version', this.config.MULTICA_WS_CLIENT_VERSION);
    // Remove um eventual token legado deixado na URL por engano.
    url.searchParams.delete('token');
    url.searchParams.delete('workspace');
    return url.toString();
  }

  /**
   * Resolve o Origin a ser enviado no handshake. Usa MULTICA_WS_ORIGIN se
   * definido; caso contrário, deriva de MULTICA_WS_URL (ws->http, wss->https),
   * que normalmente coincide com a origem do frontend do Multica.
   */
  private resolveOrigin(): string {
    if (this.config.MULTICA_WS_ORIGIN) return this.config.MULTICA_WS_ORIGIN;
    try {
      const u = new URL(this.config.MULTICA_WS_URL);
      const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
      return `${scheme}//${u.host}`;
    } catch {
      return '';
    }
  }

  close(): void {
    this.closedByUser = true;
    this.stopPing();
    this.stopAuthTimeout();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.authenticated = false;
  }
}
