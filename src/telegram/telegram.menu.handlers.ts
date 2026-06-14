import { Markup, type Telegraf, type Context } from 'telegraf';
import type { CommandServices } from './telegram.commands.js';
import { PendingActionStore } from '../storage/pending.js';
import {
  CB,
  escapeHtml,
  mainMenu,
  chatMenu,
  chatReadyMenu,
  issuesMenu,
  issueNewTypeMenu,
  issueNewAgentMenu,
  issueNewSquadMenu,
  issueNewReadyMenu,
  infoMenu,
  type Menu,
} from './telegram.menu.js';
import {
  HELP_TEXT,
  formatAgentList,
  formatSquadList,
  formatIssueList,
  formatIssueCreated,
  statusLabel,
} from './telegram.formatter.js';
import { toUserMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Registra a navegação por menus/botões (inline keyboards) e as jornadas
 * interativas com sub-menus e botão "Voltar":
 *  - /start e /menu mostram o menu principal;
 *  - callback_query roteia entre menus e sub-menus;
 *  - o handler de texto trata a entrada pendente (mensagem de chat ou campos
 *    de nova issue) definida pela jornada selecionada.
 */
export function registerMenu(
  bot: Telegraf,
  services: CommandServices,
  pending: PendingActionStore,
): void {
  const key = (ctx: Context): string =>
    PendingActionStore.key(ctx.chat?.id ?? 0, ctx.from?.id ?? 0);

  /** Edita a mensagem atual (callback) ou envia uma nova (comando). */
  async function present(ctx: Context, menu: Menu, edit: boolean): Promise<void> {
    const extra = { parse_mode: 'HTML' as const, reply_markup: menu.keyboard.reply_markup };
    if (edit && ctx.updateType === 'callback_query') {
      try {
        await ctx.editMessageText(menu.text, extra);
        return;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // "message is not modified": usuário reabriu o mesmo menu — ignora.
        if (msg.includes('not modified')) return;
        // Demais casos: cai para o envio de uma nova mensagem.
      }
    }
    await ctx.reply(menu.text, extra);
  }

  const findAgentName = async (id: string): Promise<string> => {
    const list = await services.agents.list();
    return list.find((a) => a.id === id)?.name ?? 'agente';
  };
  const findSquadName = async (id: string): Promise<string> => {
    const list = await services.squads.list();
    return list.find((s) => s.id === id)?.name ?? 'squad';
  };

  const buildStatusText = async (): Promise<string> => {
    let ok = false;
    try {
      ok = await services.client.healthCheck();
    } catch {
      ok = false;
    }
    const wsOn = services.config.BRIDGE_ENABLE_WEBSOCKET;
    const wsConn = services.websocket.isConnected();
    return [
      '📊 Status do Bridge',
      '',
      `Multica REST: ${ok ? '✅ conectado' : '⚠️ indisponível'}`,
      `WebSocket: ${wsOn ? (wsConn ? '✅ conectado' : '⚠️ desconectado') : '➖ desabilitado'}`,
      `Workspace: ${services.config.MULTICA_WORKSPACE_SLUG}`,
    ].join('\n');
  };

  /** Roteia um callback_data. Retorna um texto opcional para o toast. */
  async function route(ctx: Context, data: string): Promise<string | void> {
    if (data.startsWith('c:a:')) {
      const id = data.slice('c:a:'.length);
      const name = await findAgentName(id);
      pending.set(key(ctx), { kind: 'chat', agentId: id, agentName: name });
      return present(ctx, chatReadyMenu(name), true);
    }
    if (data.startsWith('i:l:')) {
      const raw = data.slice('i:l:'.length);
      const { status, issues } = await services.issues.listByStatus(raw === 'all' ? undefined : raw);
      const text = formatIssueList(issues, status ? statusLabel(status) : undefined);
      return present(ctx, infoMenu(escapeHtml(text), CB.ISSUES), true);
    }
    if (data.startsWith('i:na:')) {
      const id = data.slice('i:na:'.length);
      const name = await findAgentName(id);
      pending.set(key(ctx), {
        kind: 'new_issue',
        assigneeType: 'agent',
        assigneeId: id,
        assigneeName: name,
      });
      return present(ctx, issueNewReadyMenu(name), true);
    }
    if (data.startsWith('i:ns:')) {
      const id = data.slice('i:ns:'.length);
      const name = await findSquadName(id);
      pending.set(key(ctx), {
        kind: 'new_issue',
        assigneeType: 'squad',
        assigneeId: id,
        assigneeName: name,
      });
      return present(ctx, issueNewReadyMenu(name), true);
    }

    switch (data) {
      case CB.MAIN:
        pending.clear(key(ctx));
        return present(ctx, mainMenu(), true);
      case CB.CHAT:
        return present(ctx, chatMenu(await services.agents.list()), true);
      case CB.ISSUES:
        return present(ctx, issuesMenu(), true);
      case CB.AGENTS:
        return present(ctx, infoMenu(escapeHtml(formatAgentList(await services.agents.list()))), true);
      case CB.SQUADS:
        return present(ctx, infoMenu(escapeHtml(formatSquadList(await services.squads.list()))), true);
      case CB.HELP:
        return present(ctx, infoMenu(escapeHtml(HELP_TEXT)), true);
      case CB.STATUS:
        return present(ctx, infoMenu(escapeHtml(await buildStatusText())), true);
      case CB.REFRESH:
        services.agents.invalidate();
        services.squads.invalidate();
        await services.mentions.refresh(true);
        await present(ctx, mainMenu(), true);
        return '🔄 Cache atualizado';
      case CB.CHAT_END:
        pending.clear(key(ctx));
        await present(ctx, mainMenu(), true);
        return '⏹️ Chat encerrado';
      case CB.ISSUE_NEW:
        return present(ctx, issueNewTypeMenu(), true);
      case CB.ISSUE_NEW_AGENT_LIST:
        return present(ctx, issueNewAgentMenu(await services.agents.list()), true);
      case CB.ISSUE_NEW_SQUAD_LIST:
        return present(ctx, issueNewSquadMenu(await services.squads.list()), true);
      default:
        return;
    }
  }

  // -------------------------- /start e /menu --------------------------
  const showMain = async (ctx: Context): Promise<void> => {
    try {
      pending.clear(key(ctx));
      await present(ctx, mainMenu(), false);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Erro ao exibir o menu');
      await ctx.reply(toUserMessage(err)).catch(() => undefined);
    }
  };
  bot.start(showMain);
  bot.command('menu', showMain);

  // ---------------------------- callback_query ------------------------
  bot.on('callback_query', async (ctx) => {
    const cq = ctx.callbackQuery;
    const data = cq && 'data' in cq ? cq.data : undefined;
    let toast: string | void = undefined;
    if (data) {
      try {
        toast = await route(ctx, data);
      } catch (err) {
        logger.error({ err: (err as Error).message, data }, 'Erro ao processar callback');
        await present(ctx, infoMenu(toUserMessage(err)), false).catch(() => undefined);
      }
    }
    await ctx.answerCbQuery(typeof toast === 'string' ? toast : undefined).catch(() => undefined);
  });

  // -------------------- entrada de texto das jornadas -----------------
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    // Comandos são tratados pelos handlers de comando; ignoramos aqui.
    if (text.startsWith(services.config.BRIDGE_COMMAND_PREFIX)) return;

    const action = pending.get(key(ctx));
    if (!action) {
      // Sem jornada ativa: orienta apenas em conversas privadas (evita ruído em grupos).
      if (ctx.chat?.type === 'private') {
        await ctx.reply('Use /menu para ver as opções. 🤖');
      }
      return;
    }

    try {
      if (action.kind === 'chat') {
        const { agentName, messages } = await services.chat.sendToAgent(
          ctx.from.id,
          action.agentId,
          action.agentName,
          text,
        );
        const last = messages.filter((m) => m.role !== 'user').at(-1);
        const body = last?.content
          ? `💬 <b>${escapeHtml(agentName)}</b>:\n${escapeHtml(last.content)}`
          : `📨 Mensagem enviada para <b>${escapeHtml(agentName)}</b>. A resposta chegará por aqui assim que o agente responder.`;
        await ctx.reply(body, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('⏹️ Encerrar chat', CB.CHAT_END)],
            [Markup.button.callback('🏠 Menu', CB.MAIN)],
          ]).reply_markup,
        });
        // Mantém a jornada de chat ativa para a próxima mensagem.
      } else {
        const { issue, assigneeName } = await services.issues.createForAssignee(
          action.assigneeType,
          action.assigneeId,
          action.assigneeName,
          text,
        );
        pending.clear(key(ctx));
        await ctx.reply(escapeHtml(formatIssueCreated(issue, assigneeName)), {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', CB.MAIN)]])
            .reply_markup,
        });
      }
    } catch (err) {
      logger.error({ err: (err as Error).message, kind: action.kind }, 'Erro na jornada de texto');
      await ctx.reply(toUserMessage(err)).catch(() => undefined);
    }
  });
}
