import { request } from 'undici';
import type { AppConfig } from '../config/env.js';
import { logger, maskSecret } from '../utils/logger.js';
import { MulticaApiError } from '../utils/errors.js';
import {
  AgentSchema,
  SquadSchema,
  IssueSchema,
  CommentSchema,
  ChatSessionSchema,
  ChatMessageSchema,
  unwrapList,
  unwrapObject,
  type Agent,
  type Squad,
  type Issue,
  type Comment,
  type ChatSession,
  type ChatMessage,
  type CreateIssueInput,
} from './multica.types.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Client REST do Multica.
 *
 * Responsável por montar os headers padrão, chamar as APIs, tratar erros
 * HTTP e padronizar respostas. Nunca registra o token em log (apenas
 * mascarado) e isola as variações de rota do Multica em um único lugar.
 */
export class MulticaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly workspaceSlug: string;

  constructor(config: AppConfig) {
    this.baseUrl = config.MULTICA_API_BASE_URL.replace(/\/$/, '');
    this.token = config.MULTICA_API_TOKEN;
    this.workspaceSlug = config.MULTICA_WORKSPACE_SLUG;
  }

  /** Headers mínimos exigidos pelo Multica (planejamento 5.2). */
  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-Workspace-Slug': this.workspaceSlug,
      'X-Client-Platform': 'telegram-bridge',
    };
  }

  private async call<T = unknown>(
    method: HttpMethod,
    path: string,
    options: { body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, value);
      }
    }

    // Log seguro: jamais expõe o token (apenas a rota e o método).
    logger.debug({ method, path: url.pathname }, 'Chamada REST ao Multica');

    let response;
    try {
      response = await request(url, {
        method,
        headers: this.buildHeaders(),
        body: options.body ? JSON.stringify(options.body) : undefined,
        headersTimeout: 15_000,
        bodyTimeout: 15_000,
      });
    } catch (err) {
      logger.error(
        { method, path: url.pathname, err: (err as Error).message },
        'Falha de rede ao chamar o Multica',
      );
      throw new MulticaApiError(`Falha de rede ao chamar ${method} ${path}`);
    }

    const { statusCode } = response;
    const text = await response.body.text();

    if (statusCode >= 400) {
      // Não expomos o corpo bruto ao usuário; registramos apenas no log interno.
      logger.warn(
        { method, path: url.pathname, statusCode },
        'Resposta de erro do Multica',
      );
      if (statusCode === 401 || statusCode === 403) {
        throw new MulticaApiError(
          `Autenticação rejeitada (${statusCode}) em ${path}`,
          statusCode,
          '⚠️ O Multica recusou a autenticação do bridge. Verifique o token configurado.',
        );
      }
      throw new MulticaApiError(`Erro HTTP ${statusCode} em ${method} ${path}`, statusCode);
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MulticaApiError(`Resposta inválida (não-JSON) de ${path}`);
    }
  }

  // ----------------------------- Health -------------------------------

  /**
   * Health check do Multica. Tenta endpoints comuns e considera saudável
   * se qualquer um responder sem erro de autenticação.
   */
  async healthCheck(): Promise<boolean> {
    logger.info(
      { baseUrl: this.baseUrl, token: maskSecret(this.token) },
      'Executando health check no Multica',
    );
    // Usamos /api/agents como verificação real de autenticação + workspace.
    await this.call('GET', '/api/agents');
    return true;
  }

  // ----------------------------- Agentes ------------------------------

  async listAgents(): Promise<Agent[]> {
    const data = await this.call('GET', '/api/agents');
    return unwrapList(data)
      .map((item) => AgentSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => (r as { data: Agent }).data);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const data = await this.call('GET', `/api/agents/${encodeURIComponent(id)}`);
    const parsed = AgentSchema.safeParse(unwrapObject(data));
    return parsed.success ? parsed.data : null;
  }

  // ------------------------------ Squads ------------------------------

  async listSquads(): Promise<Squad[]> {
    const data = await this.call('GET', '/api/squads');
    return unwrapList(data)
      .map((item) => SquadSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => (r as { data: Squad }).data);
  }

  // ------------------------------ Issues ------------------------------

  async listIssues(status?: string): Promise<Issue[]> {
    const data = await this.call('GET', '/api/issues', {
      query: status ? { status } : undefined,
    });
    return unwrapList(data)
      .map((item) => IssueSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => (r as { data: Issue }).data);
  }

  async getIssue(id: string): Promise<Issue | null> {
    const data = await this.call('GET', `/api/issues/${encodeURIComponent(id)}`);
    const parsed = IssueSchema.safeParse(unwrapObject(data));
    return parsed.success ? parsed.data : null;
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const data = await this.call('POST', '/api/issues', { body: input });
    const parsed = IssueSchema.safeParse(unwrapObject(data));
    if (!parsed.success) {
      throw new MulticaApiError('Resposta inesperada ao criar issue');
    }
    return parsed.data;
  }

  async listIssueComments(id: string): Promise<Comment[]> {
    const data = await this.call('GET', `/api/issues/${encodeURIComponent(id)}/comments`);
    return unwrapList(data)
      .map((item) => CommentSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => (r as { data: Comment }).data);
  }

  async createIssueComment(id: string, body: string): Promise<void> {
    await this.call('POST', `/api/issues/${encodeURIComponent(id)}/comments`, {
      body: { body },
    });
  }

  // --------------------------- Chat sessions --------------------------

  async createChatSession(agentId: string, title?: string): Promise<ChatSession> {
    const data = await this.call('POST', '/api/chat/sessions', {
      body: { agent_id: agentId, title: title ?? 'Telegram Bridge' },
    });
    const parsed = ChatSessionSchema.safeParse(unwrapObject(data));
    if (!parsed.success) throw new MulticaApiError('Não foi possível criar a chat session');
    return parsed.data;
  }

  async sendChatMessage(sessionId: string, content: string): Promise<void> {
    await this.call('POST', `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
      body: { content },
    });
  }

  async listChatMessages(sessionId: string): Promise<ChatMessage[]> {
    const data = await this.call(
      'GET',
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    return unwrapList(data)
      .map((item) => ChatMessageSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => (r as { data: ChatMessage }).data);
  }
}
