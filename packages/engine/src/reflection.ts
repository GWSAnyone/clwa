import { DEFAULT_WORLD_CONFIG } from './world-types';

export interface ReflectionConfig {
  /** Cumulative importance threshold to trigger reflection (default: 30) */
  threshold: number;
  /** LM Studio base URL (default: http://localhost:1234) */
  lmStudioUrl: string;
  /** Model identifier (from DEFAULT_WORLD_CONFIG) */
  model: string;
  /** Importance assigned to reflection memories (default: 9) */
  reflectionImportance: number;
}

const DEFAULT_CONFIG: ReflectionConfig = {
  threshold: 30,
  lmStudioUrl: 'http://localhost:1234',
  model: DEFAULT_WORLD_CONFIG.model,
  reflectionImportance: 9,
};

interface TrackedMemory {
  text: string;
  importance: number;
}

export class ReflectionTracker {
  readonly config: ReflectionConfig;
  private accumulatedImportance: number = 0;
  private unreflectedMemories: TrackedMemory[] = [];

  constructor(config?: Partial<ReflectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Track a new memory. Returns true if threshold reached. */
  track(text: string, importance: number): boolean {
    this.accumulatedImportance += importance;
    this.unreflectedMemories.push({ text, importance });
    return this.shouldReflect();
  }

  /** Check if reflection is needed */
  shouldReflect(): boolean {
    return this.accumulatedImportance >= this.config.threshold;
  }

  /** Get current status */
  getStatus(): { accumulated: number; threshold: number; count: number } {
    return {
      accumulated: this.accumulatedImportance,
      threshold: this.config.threshold,
      count: this.unreflectedMemories.length,
    };
  }

  /** Generate reflection via LLM. Returns the summary text. */
  async generateReflection(agentName: string, agentRole: string): Promise<string> {
    const memoriesList = this.unreflectedMemories
      .map((m) => `- [importance: ${m.importance}] ${m.text}`)
      .join('\n');

    const systemPrompt = `You are the inner mind of ${agentName}, a ${agentRole}.
Below are your recent experiences. Generate a single concise insight or realization (1-2 sentences) that captures the most important pattern, conclusion, or emotional shift you've experienced.
This should feel like an epiphany — a deeper understanding that emerges from reflecting on these events together.
Respond with ONLY the insight, nothing else. No quotes, no prefixes.`;

    const input = `My recent experiences:\n${memoriesList}\n\nWhat is the deepest realization I draw from all of this?`;

    const res = await fetch(`${this.config.lmStudioUrl}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        system_prompt: systemPrompt,
        input,
        temperature: 0.7,
        reasoning: 'off',
        max_output_tokens: 150,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Reflection LLM error ${res.status}: ${text}`);
    }

    const data = await res.json() as { output: Array<{ type: string; content: string }> };
    const message = data.output.find((o: { type: string }) => o.type === 'message');
    return message?.content?.trim() ?? 'Something has changed, but I cannot put it into words.';
  }

  /** Reset tracker after reflection is stored */
  reset(): void {
    this.accumulatedImportance = 0;
    this.unreflectedMemories = [];
  }
}
