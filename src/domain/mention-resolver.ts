import type { AgentService } from './agent.service.js';
import type { SquadService } from './squad.service.js';
import { generateAliases, normalizeName } from '../utils/normalize.js';
import { AmbiguousMentionError, MentionNotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface ResolvedMention {
  type: 'agent' | 'squad';
  id: string;
  name: string;
}

interface AliasEntry {
  type: 'agent' | 'squad';
  id: string;
  name: string;
}

/**
 * Resolve menções `@alias` para `{ type, id, name }`.
 *
 * Mantém um índice de aliases construído a partir dos agentes e squads do
 * Multica. Trata nomes não encontrados e ambíguos (planejamento 5.4 / CA-01).
 */
export class MentionResolver {
  /** alias normalizado -> lista de entradas (pode haver colisão = ambíguo). */
  private index = new Map<string, AliasEntry[]>();

  constructor(
    private readonly agents: AgentService,
    private readonly squads: SquadService,
  ) {}

  /** Reconstrói o índice de aliases a partir das fontes (startup / refresh). */
  async refresh(force = true): Promise<void> {
    const [agentList, squadList] = await Promise.all([
      this.agents.list(force),
      this.squads.list(force),
    ]);

    const index = new Map<string, AliasEntry[]>();
    const add = (alias: string, entry: AliasEntry) => {
      const key = normalizeName(alias);
      if (!key) return;
      const arr = index.get(key) ?? [];
      // Evita duplicar a mesma entidade no mesmo alias.
      if (!arr.some((e) => e.type === entry.type && e.id === entry.id)) {
        arr.push(entry);
      }
      index.set(key, arr);
    };

    for (const agent of agentList) {
      const entry: AliasEntry = { type: 'agent', id: agent.id, name: agent.name };
      for (const alias of generateAliases(agent.name, 'agent')) add(alias, entry);
    }
    for (const squad of squadList) {
      const entry: AliasEntry = { type: 'squad', id: squad.id, name: squad.name };
      for (const alias of generateAliases(squad.name, 'squad')) add(alias, entry);
    }

    this.index = index;
    logger.info({ aliases: index.size }, 'Cache de menções (aliases) atualizado');
  }

  /** Garante que o índice exista (carrega sob demanda). */
  private async ensureLoaded(): Promise<void> {
    if (this.index.size === 0) await this.refresh(false);
  }

  /**
   * Resolve uma menção. Lança MentionNotFoundError ou AmbiguousMentionError
   * quando aplicável.
   */
  async resolve(mention: string): Promise<ResolvedMention> {
    await this.ensureLoaded();
    const key = normalizeName(mention.replace(/^@/, ''));
    const matches = this.index.get(key);

    if (!matches || matches.length === 0) {
      throw new MentionNotFoundError(key);
    }
    if (matches.length > 1) {
      const options = matches.map(
        (m) => `${m.type === 'agent' ? 'Agente' : 'Squad'}: ${m.name}`,
      );
      throw new AmbiguousMentionError(key, options);
    }

    const match = matches[0]!;
    return { type: match.type, id: match.id, name: match.name };
  }
}
