import type { MulticaClient } from '../multica/multica.client.js';
import type { Issue, IssueStatus, IssuePriority } from '../multica/multica.types.js';
import { StatusEnum, PriorityEnum } from '../multica/multica.types.js';
import type { MentionResolver } from './mention-resolver.js';
import { ValidationError } from '../utils/errors.js';

/** Aliases amigáveis de status (planejamento, seção 10). */
const STATUS_ALIASES: Record<string, IssueStatus[]> = {
  abertas: ['todo', 'in_progress', 'in_review', 'blocked'],
  andamento: ['in_progress'],
  revisao: ['in_review'],
  bloqueadas: ['blocked'],
  concluidas: ['done'],
  canceladas: ['cancelled'],
};

export interface ParsedNewIssue {
  mention: string;
  title: string;
  description: string;
  priority: IssuePriority;
}

/** Serviço de issues: criação, listagem por status e comentários. */
export class IssueService {
  constructor(
    private readonly client: MulticaClient,
    private readonly mentions: MentionResolver,
  ) {}

  /**
   * Faz o parse do comando `/nova-issue`.
   *
   * Formatos suportados:
   *   /nova-issue @claude Corrigir erro na tela de login
   *   /nova-issue @claude | Título | Descrição | high
   */
  parseNewIssue(raw: string): ParsedNewIssue {
    const text = raw.trim();
    const mentionMatch = text.match(/@([a-zA-Z0-9_-]+)/);
    if (!mentionMatch) {
      throw new ValidationError(
        '❌ Informe um agente ou squad com @. Ex.: /nova-issue @claude | Título | Descrição | high',
      );
    }
    const mention = mentionMatch[1]!;

    // Remove a menção do texto e analisa o restante.
    const rest = text.replace(mentionMatch[0], '').trim();

    if (rest.includes('|')) {
      const parts = rest.split('|').map((p) => p.trim());
      const title = parts[0] ?? '';
      const description = parts[1] ?? '';
      const priorityRaw = (parts[2] ?? 'medium').toLowerCase();
      if (!title) {
        throw new ValidationError('❌ Título é obrigatório. Ex.: /nova-issue @claude | Título | Descrição | high');
      }
      const priority = PriorityEnum.safeParse(priorityRaw);
      return {
        mention,
        title,
        description,
        priority: priority.success ? priority.data : 'medium',
      };
    }

    // Formato simples: o restante vira o título.
    const title = rest.trim();
    if (!title) {
      throw new ValidationError(
        '❌ Descreva a issue. Ex.: /nova-issue @claude Corrigir erro na tela de login',
      );
    }
    return { mention, title, description: '', priority: 'medium' };
  }

  /** Cria uma issue atribuída a um agente ou squad resolvido por menção. */
  async createFromCommand(raw: string): Promise<{ issue: Issue; assigneeName: string }> {
    const parsed = this.parseNewIssue(raw);
    const resolved = await this.mentions.resolve(parsed.mention);

    const issue = await this.client.createIssue({
      title: parsed.title,
      description: parsed.description,
      status: 'todo',
      priority: parsed.priority,
      assignee_type: resolved.type,
      assignee_id: resolved.id,
    });

    return { issue, assigneeName: resolved.name };
  }

  /**
   * Lista issues por status. Aceita status canônico ou alias amigável.
   * Sem argumento, lista todas.
   */
  async listByStatus(statusArg?: string): Promise<{ status: string | undefined; issues: Issue[] }> {
    if (!statusArg) {
      return { status: undefined, issues: await this.client.listIssues() };
    }

    const normalized = statusArg.trim().toLowerCase();

    // Alias amigável que expande para múltiplos status.
    const aliased = STATUS_ALIASES[normalized];
    if (aliased) {
      const all = await this.client.listIssues();
      const set = new Set(aliased);
      return {
        status: normalized,
        issues: all.filter((i) => i.status && set.has(i.status as IssueStatus)),
      };
    }

    // Status canônico.
    const canonical = StatusEnum.safeParse(normalized);
    if (canonical.success) {
      return { status: canonical.data, issues: await this.client.listIssues(canonical.data) };
    }

    throw new ValidationError(
      `❌ Status inválido: "${statusArg}".\n` +
        'Use: backlog, todo, in_progress, in_review, done, blocked, cancelled\n' +
        'Ou aliases: abertas, andamento, revisao, bloqueadas, concluidas, canceladas',
    );
  }

  async getDetail(id: string): Promise<Issue | null> {
    return this.client.getIssue(id);
  }

  async comment(id: string, body: string): Promise<void> {
    if (!body.trim()) {
      throw new ValidationError('❌ O comentário não pode ser vazio.');
    }
    await this.client.createIssueComment(id, body.trim());
  }
}
