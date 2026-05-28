/**
 * Semaphore — ограничивает одновременные запросы к LLM-провайдеру.
 * Per-provider, не глобальный: у локального GPU и облачного API разная capacity.
 *
 * Acquire/release ОБЯЗАТЕЛЬНО в try/finally (INV-01). Это enforced архитектурно:
 * façade в llm-client.ts оборачивает acquire/release сам, call-sites не видят семафор.
 */
export class LlmSemaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number = 1) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}
