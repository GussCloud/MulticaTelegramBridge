import { z } from 'zod';

/**
 * Tipos e schemas (Zod) para os recursos do Multica consumidos pelo bridge.
 *
 * Observação: como as rotas internas do Multica podem variar entre versões
 * (ver planejamento, seção 24), todos os schemas usam `.passthrough()` e
 * campos opcionais tolerantes para não quebrar diante de payloads ligeiramente
 * diferentes. O bridge isola essas variações neste módulo.
 */

export const StatusEnum = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
]);
export type IssueStatus = z.infer<typeof StatusEnum>;

export const PriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export type IssuePriority = z.infer<typeof PriorityEnum>;

export const AgentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type Agent = z.infer<typeof AgentSchema>;

export const SquadSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })
  .passthrough();
export type Squad = z.infer<typeof SquadSchema>;

export const IssueSchema = z
  .object({
    id: z.string(),
    // O Multica pode expor um identificador "humano" (ex.: MUL-123).
    key: z.string().optional(),
    reference: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    assignee_type: z.string().optional(),
    assignee_id: z.string().optional(),
    assignee_name: z.string().optional(),
    updated_at: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type Issue = z.infer<typeof IssueSchema>;

export const CommentSchema = z
  .object({
    id: z.string().optional(),
    body: z.string().optional(),
    author_name: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type Comment = z.infer<typeof CommentSchema>;

export const ChatSessionSchema = z
  .object({
    id: z.string(),
    agent_id: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const ChatMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.string().optional(),
    content: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Payload para criação de issue. */
export interface CreateIssueInput {
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assignee_type: 'agent' | 'squad';
  assignee_id: string;
}

/**
 * Extrai uma lista de itens de uma resposta da API que pode vir como
 * array puro ou encapsulada em `{ data: [...] }` / `{ items: [...] }`.
 */
export function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['data', 'items', 'results', 'agents', 'squads', 'issues']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

/** Extrai um objeto único de respostas que podem vir como `{ data: {...} }`. */
export function unwrapObject(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as Record<string, unknown>).data;
  }
  return payload;
}

/** Retorna o identificador "humano" da issue (key/reference) ou o id bruto. */
export function issueDisplayId(issue: Issue): string {
  return issue.key ?? issue.reference ?? issue.id;
}
