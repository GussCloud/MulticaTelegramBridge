import type { MulticaClient } from '../multica/multica.client.js';
import type { Repository } from '../storage/repository.js';
import type { MentionResolver } from './mention-resolver.js';
import { ValidationError } from '../utils/errors.js';
import type { ChatMessage } from '../multica/multica.types.js';

/**
 * Serviço de chat com agentes (planejamento 5.x / Fase 3).
 *
 * Cria ou reutiliza uma chat session por (usuário do Telegram + agente),
 * envia a mensagem e retorna a resposta mais recente do agente.
 */
export class ChatService {
  constructor(
    private readonly client: MulticaClient,
    private readonly mentions: MentionResolver,
    private readonly repo: Repository,
  ) {}

  /**
   * Faz o parse de `/chat @agente mensagem` e envia para a session.
   * Retorna a sessão e as mensagens conhecidas (a resposta pode chegar
   * depois via WebSocket).
   */
  async send(
    telegramUserId: number,
    raw: string,
  ): Promise<{ sessionId: string; agentName: string; messages: ChatMessage[] }> {
    const text = raw.trim();
    const mentionMatch = text.match(/@([a-zA-Z0-9_-]+)/);
    if (!mentionMatch) {
      throw new ValidationError('❌ Informe o agente com @. Ex.: /chat @claude sua pergunta');
    }
    const mention = mentionMatch[1]!;
    const message = text.replace(mentionMatch[0], '').trim();
    if (!message) {
      throw new ValidationError('❌ Escreva a mensagem para o agente. Ex.: /chat @claude analise a issue 123');
    }

    const resolved = await this.mentions.resolve(mention);
    if (resolved.type !== 'agent') {
      throw new ValidationError('❌ O chat direto só está disponível para agentes, não squads.');
    }

    return this.sendToAgent(telegramUserId, resolved.id, resolved.name, message);
  }

  /**
   * Envia uma mensagem para um agente já identificado (fluxo por botões).
   * Cria ou reutiliza a chat session por (usuário do Telegram + agente).
   */
  async sendToAgent(
    telegramUserId: number,
    agentId: string,
    agentName: string,
    message: string,
  ): Promise<{ sessionId: string; agentName: string; messages: ChatMessage[] }> {
    if (!message.trim()) {
      throw new ValidationError('❌ Escreva a mensagem para o agente.');
    }

    // Reutiliza a session existente ou cria uma nova.
    let sessionId = this.repo.getChatSession(telegramUserId, agentId);
    if (!sessionId) {
      const session = await this.client.createChatSession(agentId, `Telegram ${telegramUserId}`);
      sessionId = session.id;
      this.repo.setChatSession(telegramUserId, agentId, sessionId);
    }

    await this.client.sendChatMessage(sessionId, message.trim());
    const messages = await this.client.listChatMessages(sessionId);

    return { sessionId, agentName, messages };
  }
}
