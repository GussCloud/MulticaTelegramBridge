import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { Agent, Squad } from '../multica/multica.types.js';

/**
 * Construção dos menus interativos (botões inline) e o esquema de
 * `callback_data` usado para navegar entre menus e sub-menus.
 *
 * O `callback_data` do Telegram é limitado a 64 bytes; por isso usamos
 * prefixos curtos. IDs de agentes/squads (UUIDs) cabem com folga.
 */

export const CB = {
  MAIN: 'm:main',
  CHAT: 'm:chat',
  ISSUES: 'm:issues',
  AGENTS: 'm:agents',
  SQUADS: 'm:squads',
  HELP: 'm:help',
  STATUS: 'm:status',
  REFRESH: 'm:refresh',
  CHAT_END: 'c:end',
  ISSUE_NEW: 'i:new',
  ISSUE_NEW_AGENT_LIST: 'i:t:agent',
  ISSUE_NEW_SQUAD_LIST: 'i:t:squad',
  chatAgent: (id: string) => `c:a:${id}`,
  issuesList: (status: string) => `i:l:${status}`,
  issueNewAgent: (id: string) => `i:na:${id}`,
  issueNewSquad: (id: string) => `i:ns:${id}`,
} as const;

type Keyboard = Markup.Markup<InlineKeyboardMarkup>;

export interface Menu {
  text: string;
  keyboard: Keyboard;
}

/** Escapa conteúdo dinâmico para envio seguro com parse_mode HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const backButton = (target: string, label = '⬅️ Voltar') => Markup.button.callback(label, target);

/** Menu principal com as jornadas disponíveis. */
export function mainMenu(): Menu {
  return {
    text: '🤖 <b>Multica Telegram Bridge</b>\n\nO que você deseja fazer?',
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('🤖 Agentes', CB.AGENTS),
        Markup.button.callback('👥 Squads', CB.SQUADS),
      ],
      [
        Markup.button.callback('📌 Issues', CB.ISSUES),
        Markup.button.callback('💬 Chat', CB.CHAT),
      ],
      [
        Markup.button.callback('🔄 Atualizar', CB.REFRESH),
        Markup.button.callback('📊 Status', CB.STATUS),
      ],
      [Markup.button.callback('❓ Ajuda', CB.HELP)],
    ]),
  };
}

/** Teclado genérico para escolher um agente. */
function agentPicker(agents: Agent[], makeData: (id: string) => string, back: string): Keyboard {
  const rows = agents.map((a) => [Markup.button.callback(`🤖 ${a.name}`, makeData(a.id))]);
  rows.push([backButton(back)]);
  return Markup.inlineKeyboard(rows);
}

/** Teclado genérico para escolher uma squad. */
function squadPicker(squads: Squad[], makeData: (id: string) => string, back: string): Keyboard {
  const rows = squads.map((s) => [Markup.button.callback(`👥 ${s.name}`, makeData(s.id))]);
  rows.push([backButton(back)]);
  return Markup.inlineKeyboard(rows);
}

/** Sub-menu de Chat: escolher o agente. */
export function chatMenu(agents: Agent[]): Menu {
  if (agents.length === 0) {
    return {
      text: '💬 <b>Chat</b>\n\nNenhum agente disponível no workspace.',
      keyboard: Markup.inlineKeyboard([[backButton(CB.MAIN)]]),
    };
  }
  return {
    text: '💬 <b>Chat</b>\n\nEscolha o agente com quem deseja conversar:',
    keyboard: agentPicker(agents, CB.chatAgent, CB.MAIN),
  };
}

/** Mensagem exibida após escolher o agente do chat (pronto para receber). */
export function chatReadyMenu(agentName: string): Menu {
  return {
    text:
      `💬 Chat com <b>${escapeHtml(agentName)}</b> iniciado.\n\n` +
      'Envie sua mensagem por aqui. Toda mensagem de texto será encaminhada ao agente até você encerrar.',
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('⏹️ Encerrar chat', CB.CHAT_END)],
      [backButton(CB.MAIN, '🏠 Menu')],
    ]),
  };
}

const STATUS_BUTTONS: ReadonlyArray<readonly [string, string]> = [
  ['Backlog', 'backlog'],
  ['A fazer', 'todo'],
  ['Em andamento', 'in_progress'],
  ['Em revisão', 'in_review'],
  ['Concluída', 'done'],
  ['Bloqueada', 'blocked'],
  ['Cancelada', 'cancelled'],
];

/** Sub-menu de Issues. */
export function issuesMenu(): Menu {
  const statusRows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < STATUS_BUTTONS.length; i += 2) {
    const row = STATUS_BUTTONS.slice(i, i + 2).map(([label, status]) =>
      Markup.button.callback(label, CB.issuesList(status)),
    );
    statusRows.push(row);
  }
  return {
    text: '📌 <b>Issues</b>\n\nEscolha uma ação ou um status para listar:',
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('📋 Todas', CB.issuesList('all')),
        Markup.button.callback('🆕 Nova issue', CB.ISSUE_NEW),
      ],
      ...statusRows,
      [backButton(CB.MAIN, '🏠 Menu')],
    ]),
  };
}

/** Sub-menu "Nova issue": escolher tipo de assignee. */
export function issueNewTypeMenu(): Menu {
  return {
    text: '🆕 <b>Nova issue</b>\n\nA quem deseja atribuir?',
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('🤖 Agente', CB.ISSUE_NEW_AGENT_LIST),
        Markup.button.callback('👥 Squad', CB.ISSUE_NEW_SQUAD_LIST),
      ],
      [backButton(CB.ISSUES)],
    ]),
  };
}

/** "Nova issue" → escolher agente. */
export function issueNewAgentMenu(agents: Agent[]): Menu {
  if (agents.length === 0) {
    return {
      text: '🆕 <b>Nova issue</b>\n\nNenhum agente disponível.',
      keyboard: Markup.inlineKeyboard([[backButton(CB.ISSUE_NEW)]]),
    };
  }
  return {
    text: '🆕 <b>Nova issue</b>\n\nEscolha o agente responsável:',
    keyboard: agentPicker(agents, CB.issueNewAgent, CB.ISSUE_NEW),
  };
}

/** "Nova issue" → escolher squad. */
export function issueNewSquadMenu(squads: Squad[]): Menu {
  if (squads.length === 0) {
    return {
      text: '🆕 <b>Nova issue</b>\n\nNenhuma squad disponível.',
      keyboard: Markup.inlineKeyboard([[backButton(CB.ISSUE_NEW)]]),
    };
  }
  return {
    text: '🆕 <b>Nova issue</b>\n\nEscolha a squad responsável:',
    keyboard: squadPicker(squads, CB.issueNewSquad, CB.ISSUE_NEW),
  };
}

/** Mensagem pedindo os campos da nova issue (pronto para receber). */
export function issueNewReadyMenu(assigneeName: string): Menu {
  return {
    text:
      `🆕 <b>Nova issue</b> para <b>${escapeHtml(assigneeName)}</b>.\n\n` +
      'Agora envie os dados da issue em uma mensagem, no formato:\n' +
      '<code>Título | Descrição | prioridade</code>\n\n' +
      'Ou apenas o título. Prioridades: low, medium, high, urgent.',
    keyboard: Markup.inlineKeyboard([[backButton(CB.ISSUES, '🏠 Issues')]]),
  };
}

/** Envolve um texto informativo com um botão de voltar. */
export function infoMenu(text: string, back: string = CB.MAIN): Menu {
  return {
    text,
    keyboard: Markup.inlineKeyboard([[backButton(back, '🏠 Menu')]]),
  };
}
