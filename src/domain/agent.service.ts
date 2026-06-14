import type { MulticaClient } from '../multica/multica.client.js';
import type { Agent } from '../multica/multica.types.js';
import { TtlCache } from '../storage/cache.js';

/** Serviço de agentes com cache TTL sobre o client REST do Multica. */
export class AgentService {
  private readonly cache: TtlCache<Agent[]>;

  constructor(
    private readonly client: MulticaClient,
    cacheTtlSeconds: number,
  ) {
    this.cache = new TtlCache<Agent[]>(cacheTtlSeconds);
  }

  async list(forceRefresh = false): Promise<Agent[]> {
    if (!forceRefresh) {
      const cached = this.cache.get();
      if (cached) return cached;
    }
    const agents = await this.client.listAgents();
    this.cache.set(agents);
    return agents;
  }

  invalidate(): void {
    this.cache.invalidate();
  }
}
