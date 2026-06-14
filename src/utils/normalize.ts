/**
 * Funções de normalização de nomes para geração de aliases de menções.
 *
 * Regras (conforme planejamento, seção 15):
 * - remover acentos;
 * - converter para minúsculo;
 * - trocar espaços por `-`;
 * - remover caracteres especiais;
 * - colapsar hífens repetidos.
 */

/** Remove acentos/diacríticos de uma string. */
export function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza um nome para um slug seguro usado como alias.
 * Ex.: "Squad Desenvolvimento" -> "squad-desenvolvimento"
 */
export function normalizeName(value: string): string {
  return removeAccents(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove caracteres especiais
    .replace(/[\s_]+/g, '-') // espaços/underscores -> hífen
    .replace(/-+/g, '-') // colapsa hífens
    .replace(/^-|-$/g, ''); // remove hífens nas bordas
}

/**
 * Gera uma lista de aliases candidatos para uma entidade (agente/squad).
 *
 * Exemplos:
 *   "Claude Code"          -> ["claude-code", "claude", "code"]
 *   "Squad Desenvolvimento" (squad) -> ["squad-desenvolvimento", "desenvolvimento", "squad-dev"]
 */
export function generateAliases(name: string, kind: 'agent' | 'squad'): string[] {
  const aliases = new Set<string>();
  const slug = normalizeName(name);
  if (slug) aliases.add(slug);

  const parts = slug.split('-').filter(Boolean);

  // Primeira palavra significativa como alias curto.
  if (parts.length > 0) {
    const [first] = parts;
    if (first && first.length >= 2) aliases.add(first);
  }

  // Última palavra significativa (ex.: "desenvolvimento" em "squad desenvolvimento").
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last && last.length >= 3) aliases.add(last);
  }

  // Aliases com prefixo explícito para desambiguar agent vs squad.
  aliases.add(`${kind}-${slug}`);

  // Atalho amigável "squad-dev" para nomes que começam com "squad".
  if (kind === 'squad' && parts.length > 1) {
    const semSquad = parts.filter((p) => p !== 'squad');
    if (semSquad.length > 0 && semSquad[0]) {
      aliases.add(`squad-${semSquad[0]}`);
    }
  }

  return Array.from(aliases).filter(Boolean);
}

/** Extrai todas as menções `@alias` de um texto. */
export function extractMentions(text: string): string[] {
  const matches = text.matchAll(/@([a-zA-Z0-9_-]+)/g);
  return Array.from(matches, (m) => normalizeName(m[1] ?? '')).filter(Boolean);
}
