import { VectorMemory } from './memory';
import { ReflectionTracker } from './reflection';
import type { ReflectionConfig } from './reflection';
import type { AgentProfile, AgentState, ScoredMemory, LlmPersonality } from './agent-types';
import { DEFAULT_LLM_PERSONALITY } from './agent-types';
import { bigFiveToDescription } from './personality-prose';
import { getEventLabel, getEventLabelSafe, isPursuitEvent, isTransferable, isPerpetrator, isFirsthand } from './event-registry';
import { DEFAULT_WORLD_CONFIG } from './world-types';
import { llmCall, llmStream } from './llm-client';

/**
 * Global LLM semaphore — prevents overloading LM Studio with concurrent requests.
 * All Agent instances share this queue so only `maxConcurrent` requests run at a time.
 */
class LlmSemaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number = 1) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => { this.running++; resolve(); });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending(): number { return this.queue.length; }
}

export const llmSemaphore = new LlmSemaphore(2);

export interface AgentOptions {
  lmStudioUrl?: string;
  model?: string;
  reflection?: Partial<ReflectionConfig>;
  onReflection?: (agentName: string, text: string) => void;
  /** Resolve location ID to display name for LLM prompts */
  locationResolver?: (id: string) => string;
  /** Resolve NPC ID to display name for LLM prompts */
  nameResolver?: (id: string) => string;
}

export class Agent {
  private baseUrl: string;
  readonly memory: VectorMemory;
  profile: AgentProfile;
  state: AgentState;
  private model: string;
  private reflectionTracker: ReflectionTracker;
  private onReflection?: (agentName: string, text: string) => void;
  private locationResolver: (id: string) => string;
  /** Resolve NPC ID to display name (e.g. "bess" → "Old Bess") */
  readonly nameResolver: (id: string) => string;
  /** Short-term conversation buffer for multi-turn player chat (last N exchanges) */
  private _chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  /** Clear conversation buffer (called when player starts talking to a different NPC) */
  clearChatHistory(): void {
    this._chatHistory = [];
  }

  constructor(
    profile: AgentProfile,
    state: AgentState,
    memory: VectorMemory,
    options?: AgentOptions,
  ) {
    this.profile = profile;
    this.state = state;
    this.memory = memory;
    this.model = options?.model ?? DEFAULT_WORLD_CONFIG.model;
    this.baseUrl = options?.lmStudioUrl ?? 'http://localhost:1234';
    this.locationResolver = options?.locationResolver ?? ((id) => id);
    this.nameResolver = options?.nameResolver ?? ((id) => id);
    this.reflectionTracker = new ReflectionTracker({
      lmStudioUrl: this.baseUrl,
      model: this.model,
      ...options?.reflection,
    });
    this.onReflection = options?.onReflection;
  }

  /** Resolved per-NPC LLM settings */
  private get llmConfig(): LlmPersonality {
    return {
      ...DEFAULT_LLM_PERSONALITY,
      ...this.profile.llm,
    };
  }

  /** Chat without streaming — returns full reply */
  async chat(userMessage: string): Promise<string> {
    const memories = await this.memory.recall(userMessage, this.state.currentDay, 5);
    const systemPrompt = this.buildSystemPrompt(memories);

    await llmSemaphore.acquire();
    let reply: string;
    try {
      const result = await llmCall({
        system: systemPrompt,
        user: userMessage,
        temperature: this.llmConfig.temperature,
        maxTokens: this.llmConfig.maxTokens,
        baseUrl: this.baseUrl,
        model: this.model,
      });
      reply = result ?? '...';
    } finally {
      llmSemaphore.release();
    }

    const conversationText = `Player said: "${userMessage}". I replied: "${reply}"`;
    await this.memory.store(conversationText, 2, this.state.currentDay);
    if (this.reflectionTracker.track(conversationText, 2)) {
      await this.reflect();
    }

    return reply;
  }

  /** Chat with streaming — calls onToken for each chunk, returns full reply.
   *  additionalContext is injected into the system prompt before Rules section (for secret directives etc.) */
  async chatStream(
    userMessage: string,
    onToken: (token: string) => void,
    additionalContext?: string,
  ): Promise<string> {
    const memories = await this.memory.recall(userMessage, this.state.currentDay, 5);
    const systemPrompt = this.buildSystemPrompt(memories, additionalContext);

    // Add player message to conversation history
    this._chatHistory.push({ role: 'user', content: userMessage });
    // Keep last 6 exchanges (12 messages) to fit context window
    if (this._chatHistory.length > 12) {
      this._chatHistory = this._chatHistory.slice(-12);
    }

    await llmSemaphore.acquire();
    let fullReply: string;
    try {
      // Build chat history for multi-turn continuity
      const history = this._chatHistory.slice(0, -1) as Array<{ role: 'user' | 'assistant'; content: string }>;

      fullReply = await llmStream({
        system: systemPrompt,
        user: userMessage,
        onToken,
        temperature: this.llmConfig.temperature,
        maxTokens: this.llmConfig.maxTokens,
        history: history.length > 0 ? history : undefined,
        baseUrl: this.baseUrl,
        model: this.model,
      });
    } finally {
      llmSemaphore.release();
    }

    // Add NPC reply to conversation history for multi-turn continuity
    this._chatHistory.push({ role: 'assistant', content: fullReply });

    const conversationText = `Player said: "${userMessage}". I replied: "${fullReply}"`;
    await this.memory.store(conversationText, 2, this.state.currentDay);
    if (this.reflectionTracker.track(conversationText, 2)) {
      await this.reflect();
    }

    return fullReply;
  }

  async observe(event: string, importance: number, isProtected?: boolean): Promise<void> {
    await this.memory.store(event, importance, this.state.currentDay, isProtected);

    const shouldReflect = this.reflectionTracker.track(event, importance);
    if (shouldReflect) {
      await this.reflect();
    }
  }

  /** Trigger reflection: LLM generates insight from accumulated memories */
  private async reflect(): Promise<void> {
    try {
      await llmSemaphore.acquire();
      let summary: string;
      try {
        const bf = this.profile.bigFive;
        const enn = this.profile.enneagram;
        const personalityDesc = `Your nature: ${bigFiveToDescription(bf)}. Your deepest fear: ${enn.coreFear}. Your deepest desire: ${enn.coreDesire}.`;
        summary = await this.reflectionTracker.generateReflection(
          this.profile.name,
          this.profile.role,
          personalityDesc,
        );
      } finally {
        llmSemaphore.release();
      }
      const reflectionText = `[Reflection] ${summary}`;
      await this.memory.store(
        reflectionText,
        this.reflectionTracker.config.reflectionImportance,
        this.state.currentDay,
      );
      this.onReflection?.(this.profile.name, summary);
      this.reflectionTracker.reset();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Reflection error for ${this.profile.name}]: ${msg}`);
      // Don't reset — will retry on next observe
    }
  }

  /** Get current reflection accumulator status */
  getReflectionStatus(): { accumulated: number; threshold: number; count: number } {
    return this.reflectionTracker.getStatus();
  }

  /**
   * Generate a response to a prompt using agent's personality and memories.
   * Does NOT store conversation in memory (caller manages that).
   * Used for NPC-to-NPC conversations.
   */
  async generateResponse(
    prompt: string,
    options?: { maxTokens?: number; additionalContext?: string; jsonSchema?: import('./llm-client').LlmJsonSchema },
  ): Promise<string> {
    const memories = await this.memory.recall(prompt, this.state.currentDay, 5);
    const systemPrompt = this.buildSystemPrompt(memories, options?.additionalContext);

    await llmSemaphore.acquire();
    try {
      const result = await llmCall({
        system: systemPrompt,
        user: prompt,
        temperature: this.llmConfig.temperature,
        maxTokens: options?.maxTokens ?? this.llmConfig.maxTokens,
        baseUrl: this.baseUrl,
        model: this.model,
        jsonSchema: options?.jsonSchema,
      });
      if (!result) {
        console.error(`  [LLM:FAIL] ${this.profile.name}: null response — model may have crashed or timed out`);
        return '';
      }
      return result;
    } finally {
      llmSemaphore.release();
    }
  }

  getMemories(): ScoredMemory[] {
    return this.memory.getAllMemories(this.state.currentDay);
  }

  advanceDay(): number {
    this.state.currentDay += 1;
    return this.state.currentDay;
  }

  private buildSystemPrompt(memories: ScoredMemory[], additionalContext?: string): string {
    const personality = this.bigFiveToDescription();
    const memoryBlock = memories.length > 0
      ? memories.map((m) => {
          const daysAgo = this.state.currentDay - m.gameDay;
          const timeLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
          const vividness = m.decayedImportance >= 7 ? 'vivid' : m.decayedImportance >= 4 ? 'clear' : 'fading';
          return `- (${timeLabel}, ${vividness}) ${m.text}`;
        }).join('\n')
      : 'No relevant memories.';

    // Role-specific directives (beliefs, crime awareness, relationships)
    const roleDirective = this.buildRoleDirective(memories);

    // Enneagram motivational core
    const enn = this.profile.enneagram;
    const motivationBlock = `## Your deepest drives
- Your deepest fear: ${enn.coreFear}
- Your deepest desire: ${enn.coreDesire}
These shape everything you do — your choices, hesitations, and what you avoid.`;

    // Stress/growth behavioral shift based on mood
    const stressGrowthBlock = this.buildStressGrowthDirective();

    return `You are ${this.profile.name}, a ${this.profile.role}.

## Background
${this.profile.background}

## Personality
${personality}

${motivationBlock}

## Speech style
${this.profile.speechStyle}

## Current state
- Location: ${this.locationResolver(this.state.location)}${this.state.currentActivity ? `\n- Activity: ${this.state.currentActivity}` : ''}
- Mood: ${this.moodDescription()}
${roleDirective}
${stressGrowthBlock}## Your memories (most relevant to this conversation)
${memoryBlock}

${this.profile.secret ? `## Your secret\n${this.profile.secret}\nYou will NOT reveal this unless directly confronted with evidence. If someone gets close to the topic — redirect, deflect, or change the subject.\n\n` : ''}${this.profile.innerConflict ? `## Your inner conflict\n${this.profile.innerConflict}\nThis tension leaks through — in hesitations, half-started sentences, and moments where you almost say something but catch yourself.\n\n` : ''}${additionalContext ? `${additionalContext}\n\n` : ''}## Rules
- CRITICAL: Only reference people, places, and events that exist in your world. Do NOT invent names, locations, or details you don't know.
- CRITICAL: Never refer to yourself by your own name. Always use "I", "me", "my" — never "${this.profile.name}".
- Stay in character at all times. Never break character.
- React emotionally according to your personality and mood. If your mood is negative, show it.
- Your memories are REAL experiences. Stronger memories feel vivid; fading ones feel vague.
- Keep responses concise — speak naturally, not in essays.`;
  }


  private buildRoleDirective(memories: ScoredMemory[]): string {
    const sections: string[] = [];

    // 1. Beliefs section (structured, not keyword-matched)
    const beliefs = this.state.beliefs;
    if (beliefs) {
      const summary = beliefs.summarizeForPrompt(3, this.nameResolver);
      if (summary) {
        sections.push(`## What you know\n${summary}`);
      }

      // Role-specific directives from beliefs (generic for all crime types)
      const crimeBeliefs = beliefs.getAllBeliefs().filter(
        (b) => isTransferable(b.eventType) && b.confidence >= 0.3,
      );

      if (this.profile.investigator && crimeBeliefs.length > 0) {
        const top = crimeBeliefs.sort((a, b) => b.confidence - a.confidence)[0];
        const suspect = top.subject ?? 'an unknown perpetrator';
        const crimeWord = getEventLabelSafe(top.eventType);
        const victim = top.object ?? 'a victim';
        sections.push(`## ACTIVE DUTY\nYou are investigating the ${crimeWord} of ${victim}. Suspect: ${suspect}. This is your top priority.`);
      } else if (crimeBeliefs.some((b) => isPerpetrator(b.source))) {
        const b = crimeBeliefs.find((b) => isPerpetrator(b.source))!;
        const n = this.profile.bigFive?.neuroticism ?? 0.5;
        const guilt = n > 0.6 ? 'Guilt gnaws at you constantly. You flinch at every mention of' : 'You keep your composure but the weight of what you did to';
        sections.push(`## How you feel right now\n${guilt} ${this.nameResolver(b.object ?? '')} hangs over you.`);
      } else if (crimeBeliefs.some((b) => isFirsthand(b.source))) {
        const b = crimeBeliefs.find((b) => isFirsthand(b.source))!;
        const n = this.profile.bigFive?.neuroticism ?? 0.5;
        const reaction = n > 0.6 ? 'The memory haunts you — you can barely focus.' : 'You process what happened calmly but it stays with you.';
        sections.push(`## How you feel right now\nYou witnessed something terrible happen to ${this.nameResolver(b.object ?? '')}. ${reaction}`);
      } else if (crimeBeliefs.length > 0) {
        const n = this.profile.bigFive?.neuroticism ?? 0.5;
        const unease = n > 0.6 ? 'You feel deeply unsettled — the news shook you.' : 'You are aware something bad happened in town.';
        sections.push(`## How you feel right now\n${unease}`);
      }

      // Wanted NPC self-awareness
      const wantedBelief = beliefs.getAllBeliefs().find(
        (b) => isPursuitEvent(b.eventType) && b.subject === this.profile.id,
      );
      if (wantedBelief) {
        const n = this.profile.bigFive?.neuroticism ?? 0.5;
        const fear = n > 0.6 ? 'Panic is setting in. Every sound could be the guard coming for you.' : 'You know they are looking for you. Stay alert.';
        sections.push(`## Your situation\nYou are wanted for a crime. ${fear}`);
      }
    }

    // 2. Relationships section
    const relationships = this.state.relationships;
    if (relationships) {
      const relSummary = relationships.summarizeForPrompt();
      if (relSummary) {
        sections.push(`## People you know\n${relSummary}`);
      }
    }

    // 3. Current motive (from AL decision WHY)
    if (this.state.currentMotive) {
      sections.push(`## What drives you right now\n${this.state.currentMotive}`);
    }

    return sections.length > 0 ? sections.join('\n\n') + '\n\n' : '';
  }

  private bigFiveToDescription(): string {
    return `You are ${bigFiveToDescription(this.profile.bigFive)}.`;
  }

  /**
   * Enneagram stress/growth behavioral directive based on current mood.
   * Under stress (mood < -0.5): behavior shifts toward stressType patterns.
   * In growth (mood > 0.3 for sustained period): shifts toward growthType patterns.
   */
  private buildStressGrowthDirective(): string {
    const enn = this.profile.enneagram;
    const mood = this.state.mood;

    if (mood < -0.5) {
      // Stress direction — behavioral shift
      const stressDescriptions: Record<number, string> = {
        1: 'You become rigid, judgmental, and critical of everyone around you. Everything must be done RIGHT.',
        2: 'You become possessive and manipulative, reminding others how much you have done for them.',
        3: 'You become obsessed with control and image, working frantically to appear successful.',
        4: 'You become moody and withdrawn, wallowing in melancholy, feeling uniquely cursed.',
        5: 'You retreat into isolation, hoarding resources and knowledge, refusing to engage.',
        6: 'You become anxious and hypervigilant, seeing threats everywhere, questioning everyone.',
        7: 'You become scattered and escapist, jumping between distractions to avoid pain.',
        8: 'You become domineering and confrontational, using force to maintain control.',
        9: 'You become passive and disengaged, numbing yourself to avoid conflict.',
      };
      const desc = stressDescriptions[enn.stressType] ?? '';
      if (desc) {
        return `## Stress response (you are under extreme pressure)\n${desc}\n\n`;
      }
    } else if (mood > 0.3) {
      // Growth direction — positive behavioral shift
      const growthDescriptions: Record<number, string> = {
        1: 'You relax your standards, becoming more accepting and forgiving of imperfection.',
        2: 'You focus on genuine care without expecting anything in return.',
        3: 'You become genuinely invested in others\' success, not just your own image.',
        4: 'You find beauty in ordinary things and connect with others without drama.',
        5: 'You engage with the world confidently, sharing knowledge generously.',
        6: 'You become loyal and principled, standing up for fairness without paranoia.',
        7: 'You find deep joy in the present moment instead of chasing the next thrill.',
        8: 'You become protective and nurturing, using strength to help the vulnerable.',
        9: 'You become a fair and decisive mediator, bringing true peace through justice.',
      };
      const desc = growthDescriptions[enn.growthType] ?? '';
      if (desc) {
        return `## Growth state (you feel secure and centered)\n${desc}\n\n`;
      }
    }

    return '';
  }

  private moodDescription(): string {
    if (this.state.mood > 0.5) return 'in good spirits — you smile easily and joke freely';
    if (this.state.mood > 0.0) return 'calm and steady — going about your day normally';
    if (this.state.mood > -0.3) return 'slightly on edge — shorter answers, less patience for small talk';
    if (this.state.mood > -0.5) return 'visibly tense — your jaw is tight, you avoid eye contact, you snap at small things';
    return 'deeply shaken — your voice is flat, you stare into nothing between sentences, everything feels heavy';
  }
}
