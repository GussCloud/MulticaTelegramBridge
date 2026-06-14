/**
 * Cache em memória com TTL.
 *
 * Para o MVP usamos um cache simples em memória (planejamento 5.7). Em
 * produção este componente pode ser substituído por Redis sem alterar os
 * serviços de domínio, que dependem apenas desta interface.
 */
export class TtlCache<T> {
  private value: T | undefined;
  private expiresAt = 0;

  constructor(private readonly ttlSeconds: number) {}

  get(): T | undefined {
    if (this.value === undefined) return undefined;
    if (Date.now() > this.expiresAt) {
      this.value = undefined;
      return undefined;
    }
    return this.value;
  }

  set(value: T): void {
    this.value = value;
    this.expiresAt = Date.now() + this.ttlSeconds * 1000;
  }

  invalidate(): void {
    this.value = undefined;
    this.expiresAt = 0;
  }

  isExpired(): boolean {
    return this.value === undefined || Date.now() > this.expiresAt;
  }
}
