import { VectorMemory } from './memory';
import { ReflectionTracker } from './reflection';
import type { ReflectionConfig } from './reflection';
import type { AgentProfile, AgentState, ScoredMemory, LlmPersonality } from './agent-types';
import { DEFAULT_LLM_PERSONALITY } from './agent-types';
import { getEventLabel, isPursuitEvent, isTransferable, isPerpetrator, isFirsthand } from './event-registry';
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
}

export class Agent {
  private baseUrl: string;
  readonly memory: VectorMemory;
  profile: AgentProfile;
  state: AgentState;
  private model: string;
  private reflectionTracker: ReflectionTracker;
  private onReflection?: (agentName: string, text: string) => void;
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
    } catch (err) {
      throw err;
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

  async observe(event: string, importance: number): Promise<void> {
    await this.memory.store(event, importance, this.state.currentDay);

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
        summary = await this.reflectionTracker.generateReflection(
          this.profile.name,
          this.profile.role,
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
    options?: { maxTokens?: number; additionalContext?: string },
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
      });
      return result ?? '...';
    } finally {
      llmSemaphore.release();
    }
  }

  async getMemories(): Promise<ScoredMemory[]> {
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
          return `- [${timeLabel}, significance: ${m.decayedImportance.toFixed(1)}/10] ${m.text}`;
        }).join('\n')
      : 'No relevant memories.';

    // Fix #3: dynamic facts based on current day
    const dynamicFacts = this.buildDynamicFacts();

    // Fix #4: role-specific directives
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
- Location: ${this.state.location}${this.state.currentActivity ? `\n- Activity: ${this.state.currentActivity}` : ''}
- Mood: ${this.moodDescription()}
- Current day: ${this.state.currentDay}
- Current facts: ${dynamicFacts}
${roleDirective}
${stressGrowthBlock}## Your memories (most relevant to this conversation)
${memoryBlock}

${this.profile.secret ? `## Your secret\n${this.profile.secret}\nYou will NOT reveal this unless directly confronted with evidence. If someone gets close to the topic — redirect, deflect, or change the subject.\n\n` : ''}${this.profile.innerConflict ? `## Your inner conflict\n${this.profile.innerConflict}\nThis tension leaks through — in hesitations, half-started sentences, and moments where you almost say something but catch yourself.\n\n` : ''}${additionalContext ? `${additionalContext}\n\n` : ''}## Rules
- Stay in character at all times.
- Your memories are REAL experiences. Reference them naturally and react to them emotionally.
- Stronger memories (higher significance) should weigh more in your responses.
- Fading memories (low significance) should feel vague: "I think I recall...", "wasn't there something..."
- If you don't remember something, say so honestly ("I don't recall...").
- Never break character or mention being an AI.
- Keep responses concise (2-4 sentences unless asked for detail).
- React emotionally according to your personality and mood.
- IMPORTANT: If your mood is negative, show it — be nervous, shaken, distressed, or angry as appropriate.
- Only reference people, places, and events that exist in your world. Do not invent names, locations, or details.`;
  }

  private buildDynamicFacts(): string {
    const facts = this.state.knownFacts.map(f => f.startsWith('# ') ? f.slice(2) : f);
    return facts.length > 0 ? facts.join('; ') : 'nothing noteworthy';
  }

  private buildRoleDirective(memories: ScoredMemory[]): string {
    const sections: string[] = [];

    // 1. Beliefs section (structured, not keyword-matched)
    const beliefs = this.state.beliefs;
    if (beliefs) {
      const summary = beliefs.summarizeForPrompt(3);
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
        const crimeWord = getEventLabel(top.eventType);
        const victim = top.object ?? 'a victim';
        sections.push(`## ACTIVE DUTY\nYou are investigating the ${crimeWord} of ${victim}. Suspect: ${suspect}.\nYou scan every face for guilt. You interrupt conversations to ask questions. You stand taller, hand near your weapon. This is your top priority.`);
      } else if (crimeBeliefs.some((b) => isPerpetrator(b.source))) {
        // Killer's emotional state — guilt/paranoia (complements secret-directives)
        const b = crimeBeliefs.find((b) => isPerpetrator(b.source))!;
        sections.push(`## How you feel right now\nYour hands won't stop shaking. Every time someone mentions ${b.object}, your blood runs cold. You avoid eye contact. You feel the walls closing in.`);
      } else if (crimeBeliefs.some((b) => isFirsthand(b.source))) {
        const b = crimeBeliefs.find((b) => isFirsthand(b.source))!;
        sections.push(`## How you feel right now\nYou witnessed something terrible happen to ${b.object}. Your hands tremble slightly. You start sentences and lose track of what you were saying. You do not want to talk about it but you cannot stop thinking about it.`);
      } else if (crimeBeliefs.length > 0) {
        sections.push(`## How you feel right now\nYou heard something terrible happened in town. You lower your voice when talking about it. You look over your shoulder more often. The unease sits in your stomach like a stone.`);
      }

      // Wanted NPC self-awareness
      const wantedBelief = beliefs.getAllBeliefs().find(
        (b) => isPursuitEvent(b.eventType) && b.subject === this.profile.name,
      );
      if (wantedBelief) {
        sections.push(`## Your situation\nYou know people are looking for you. You are wanted for a crime. You feel the weight of guilt and fear. Every guard's glance makes your heart race.`);
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
    const b = this.profile.bigFive;
    const traits: string[] = [];

    if (b.openness > 0.7) traits.push('curious and imaginative');
    else if (b.openness < 0.3) traits.push('practical and conventional');

    if (b.conscientiousness > 0.7) traits.push('organized and dependable');
    else if (b.conscientiousness < 0.3) traits.push('spontaneous and flexible');

    if (b.extraversion > 0.7) traits.push('outgoing and talkative');
    else if (b.extraversion < 0.3) traits.push('reserved and quiet');

    if (b.agreeableness > 0.7) traits.push('warm and cooperative');
    else if (b.agreeableness < 0.3) traits.push('direct and competitive');

    if (b.neuroticism > 0.7) traits.push('emotionally sensitive and anxious');
    else if (b.neuroticism < 0.3) traits.push('calm and emotionally stable');

    if (b.honesty > 0.7) traits.push('sincere and fair-minded');
    else if (b.honesty < 0.3) traits.push('shrewd and self-serving');

    return traits.length > 0
      ? `You are ${traits.join(', ')}.`
      : 'You have a balanced, moderate personality.';
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
