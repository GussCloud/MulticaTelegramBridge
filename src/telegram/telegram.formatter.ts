import type { Agent, Squad, Issue } from '../multica/multica.types.js';
import { issueDisplayId } from '../multica/multica.types.js';
import { generateAliases } from '../utils/normalize.js';

/**
 * Formatação das mensagens enviadas ao Telegram (planejamento, seção 16).
 *
 * Mantemos texto simples (sem Markdown/HTML) para evitar problemas de
 * escaping com nomes que contenham caracteres especiais. As mensagens longas
 * são divididas em pedaços respeitando o limite configurado.
 */

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'A fazer',
  in_progress: 'Em andamento',
  in_review: 'Em revisão',
  done: 'Concluída',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
};

export function statusLabel(status?: string): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? status;
}

/** Divide uma mensagem longa em múltiplos pedaços. */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > maxLength) {
      if (current) chunks.push(current);
      // Linha isolada maior que o limite: corta na força.
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        current = '';
      } else {
        current = line;
      }
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function formatAgentList(agents: Agent[]): string {
  if (agents.length === 0) return 'Nenhum agente encontrado no workspace.';
  const lines = agents.map((a) => {
    const primary = generateAliases(a.name, 'agent')[0] ?? a.id;
    return `• ${a.name} → @${primary}`;
  });
  return `🤖 Agentes disponíveis (${agents.length}):\n\n${lines.join('\n')}`;
}

export function formatSquadList(squads: Squad[]): string {
  if (squads.length === 0) return 'Nenhuma squad encontrada no workspace.';
  const lines = squads.map((s) => {
    const primary = generateAliases(s.name, 'squad')[0] ?? s.id;
    return `• ${s.name} → @${primary}`;
  });
  return `👥 Squads disponíveis (${squads.length}):\n\n${lines.join('\n')}`;
}

export function formatIssueCreated(issue: Issue, assigneeName: string): string {
  return [
    '✅ Issue criada com sucesso',
    '',
    `ID: ${issueDisplayId(issue)}`,
    `Título: ${issue.title}`,
    `Atribuído para: @${assigneeName}`,
    `Status: ${statusLabel(issue.status ?? 'todo')}`,
    `Prioridade: ${issue.priority ?? 'medium'}`,
  ].join('\n');
}

export function formatIssueList(issues: Issue[], statusLabelText?: string): string {
  const header = statusLabelText
    ? `📌 Issues (${statusLabelText})`
    : '📌 Issues';
  if (issues.length === 0) return `${header}\n\nNenhuma issue encontrada.`;
  const lines = issues.map((issue, i) => {
    const assignee = issue.assignee_name ? `@${issue.assignee_name}` : '—';
    return [
      `${i + 1}. ${issueDisplayId(issue)} — ${issue.title}`,
      `   Assignee: ${assignee}`,
      `   Status: ${statusLabel(issue.status)}`,
      `   Prioridade: ${issue.priority ?? '—'}`,
    ].join('\n');
  });
  return `${header} (${issues.length})\n\n${lines.join('\n\n')}`;
}

export function formatIssueDetail(issue: Issue): string {
  return [
    `📄 ${issueDisplayId(issue)} — ${issue.title}`,
    '',
    `Status: ${statusLabel(issue.status)}`,
    `Prioridade: ${issue.priority ?? '—'}`,
    `Assignee: ${issue.assignee_name ?? '—'}`,
    '',
    issue.description ? `Descrição:\n${issue.description}` : 'Sem descrição.',
  ].join('\n');
}

export const HELP_TEXT = [
  '🤖 Multica Telegram Bridge',
  '',
  '💡 Dica: use /menu para navegar por botões (sem decorar comandos).',
  '',
  'Comandos disponíveis:',
  '',
  '/start — inicia e mostra o menu',
  '/menu — abre o menu de botões',
  '/help — esta ajuda',
  '/status — status do bridge e conexão com o Multica',
  '',
  '/agentes — lista agentes disponíveis',
  '/squads — lista squads disponíveis',
  '/refresh — atualiza o cache de agentes/squads',
  '',
  '/issues [status] — lista issues (ex.: /issues in_progress)',
  '/issue <id> — detalhes de uma issue',
  '/nova-issue @agente | Título | Descrição | prioridade',
  '/comentar <id> <texto> — comenta em uma issue',
  '',
  '/chat @agente <mensagem> — conversa com um agente',
  '',
  'Status válidos: backlog, todo, in_progress, in_review, done, blocked, cancelled',
  'Aliases: abertas, andamento, revisao, bloqueadas, concluidas, canceladas',
].join('\n');
