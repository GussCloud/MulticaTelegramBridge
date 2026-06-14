import type { MulticaClient } from '../multica/multica.client.js';
import type { Squad } from '../multica/multica.types.js';
import { TtlCache } from '../storage/cache.js';
import { logger } from '../utils/logger.js';

/**
 * Serviço de squads com cache TTL.
 *
 * Algumas instalações self-hosted do Multica podem ter a UI de squads mas
 * as rotas ainda não funcionais (planejamento, seção 24). Por isso, falhas
 * em `/api/squads` são degradadas para uma lista vazia (com log) em vez de
 * derrubar o bridge.
 */
export class SquadService {
  private readonly cache: TtlCache<Squad[]>;

  constructor(
    private readonly client: MulticaClient,
    cacheTtlSeconds: number,
  ) {
    this.cache = new TtlCache<Squad[]>(cacheTtlSeconds);
  }

  async list(forceRefresh = false): Promise<Squad[]> {
    if (!forceRefresh) {
      const cached = this.cache.get();
      if (cached) return cached;
    }
    try {
      const squads = await this.client.listSquads();
      this.cache.set(squads);
      return squads;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Falha ao listar squads — seguindo com lista vazia (rota pode não estar disponível)',
      );
      this.cache.set([]);
      return [];
    }
  }

  invalidate(): void {
    this.cache.invalidate();
  }
}
