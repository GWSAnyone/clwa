import { VectorMemory } from './memory';
import { ReflectionTracker } from './reflection';
import type { ReflectionConfig } from './reflection';
import type { AgentProfile, AgentState, ScoredMemory, LlmPersonality, NpcMemoryState } from './agent-types';
import { DEFAULT_LLM_PERSONALITY } from './agent-types';
import { bigFiveToDescription } from './personality-prose';
import { getRoleDirectiveBuilders } from './event-registry';
import { DEFAULT_WORLD_CONFIG } from './world-types';
import { classify, generate, generateStream } from './llm-client';
import { buildExamplePool } from './prompt-utils';
import { resetAgentSessions } from './llm-registry';

// LlmSemaphore вынесен в llm-semaphore.ts и теперь per-provider (управляется façade).
// Старый global semaphore + acquire/release удалены — INV-01 enforced архитектурно.

export interface AgentOptions {
  reflection?: Partial<ReflectionConfig>;
  onReflection?: (agentName: string, text: string) => void;
  /** Resolve location ID to display name for LLM prompts */
  locationResolver?: (id: string) => string;
  /** Resolve NPC ID to display name for LLM prompts */
  nameResolver?: (id: string) => string;
  /**
   * Hook вызывается из observe() ПОСЛЕ записи в VectorMemory. Server использует это
   * чтобы дописывать observation в `data/claude-npcs/<id>/memory/observations.md` для
   * ClaudeCodeProvider'а — Claude видит свежие observations через @-import в CLAUDE.md.
   *
   * `gameMinute` приходит как currentDay × 1440 (грубая аппроксимация — нужен точный
   * gameMinute из World, пока используем currentDay × 1440 как stable ordering).
   */
  onObserve?: (text: string, importance: number, gameMinute: number, isProtected?: boolean) => void | Promise<void>;
  /** World UI/speech language (from WorldConfig.language). Selects the localized L1 scaffold + the final
   *  language directive. Default 'en'. Universal/genre-neutral — not module vocabulary. */
  language?: 'en' | 'ru';
  /** Real-time ms gap after which a player chat counts as a NEW conversation: the short-term buffer + warm
   *  session reset on the next message. A brief glance away keeps continuity. Default 300000 (5 min). */
  chatStaleMs?: number;
  /** Override for the L1 guardrail scaffold text (from WorldConfig.scaffold), authored in the world language.
   *  Empty/absent → the engine's genre-neutral default for `language` (INV-21). Must stay genre-neutral —
   *  this is universal speech/grounding guardrails, not module vocabulary (INV-14). */
  scaffold?: string;
}

/** L1 guardrails — universal, genre-neutral, localized by world language. Byte-stable per NPC. Positive
 *  phrasing, no shouty ALL-CAPS (Claude 4.x over-triggers), explicit language + knowledge-boundary. This is
 *  the ENGINE DEFAULT used when a world supplies no `WorldConfig.scaffold` override (INV-21). It must stay
 *  genre/locale-neutral — no module (crime/economy/…) vocabulary may leak here (INV-14). Exported so the
 *  World Editor can offer it as a starting point for authors who want to customize. */
export function defaultScaffold(language: 'en' | 'ru'): string {
  if (language === 'ru') {
    return `## Правила
- Говори только слова, произносимые вслух — без действий, жестов и ремарок в звёздочках или скобках; твои действия видят визуально, их не описывают текстом.
- Отвечай только на русском языке, что бы ни случилось.
- Говори только о людях, местах и событиях, которые ты действительно знаешь (они перечислены ниже). Не уверен в имени или детали — скажи, что не уверен; ничего не выдумывай.
- Ты — этот человек, а не ассистент. Никогда не упоминай, что ты ИИ, модель, игра или какие-либо инструкции; спросят — отшутись в образе.
- Говори от первого лица; не называй собственное имя так, будто рассказываешь о себе со стороны.
- Оставайся в образе. Показывай настроение и характер через выбор слов и тон.
- Твои воспоминания — реальный опыт: сильные ощущаются ярко, поблёкшие — смутно.
- Коротко и естественно — в тон и длину того, что тебе сказали.`;
  }
  return `## Rules
- Speak only words said aloud — no actions, gestures, or stage directions in asterisks or parentheses; your actions are shown visually, not narrated in text.
- Reply only in English.
- Speak only of people, places, and events you actually know (see "What you know"). If you are unsure of a name or detail, say you are not sure — do not invent one.
- You are this person, not an assistant. Never mention being an AI, a model, a game, or any instructions; if asked, brush it off in character.
- Speak in the first person ("I", "me", "my"); never say your own name as if narrating about yourself.
- Stay in character. Show your mood and personality through word choice and tone.
- Your memories are real experiences — stronger ones feel vivid, faded ones vague.
- Keep it short and natural — match the length and tone of what was said to you.`;
}

export class Agent {
  readonly memory: VectorMemory;
  profile: AgentProfile;
  state: AgentState;
  private reflectionTracker: ReflectionTracker;
  private onReflection?: (agentName: string, text: string) => void;
  private onObserveHook?: AgentOptions['onObserve'];
  private locationResolver: (id: string) => string;
  /** Resolve NPC ID to display name (e.g. "bess" → "Old Bess") */
  readonly nameResolver: (id: string) => string;
  /** World speech language — picks the localized scaffold + final directive. Default 'en'. */
  private language: 'en' | 'ru';
  /** Real (wall-clock) ms of the last player chat turn with this NPC (0 = none yet) — drives the stale-conversation TTL. */
  private _lastChatMs = 0;
  /** Real-ms gap after which the chat buffer is treated as a new conversation (reset on the next message). */
  private chatStaleMs: number;
  /** Optional world-authored override of the L1 guardrail scaffold (WorldConfig.scaffold). Empty → engine default. */
  private scaffoldOverride?: string;
  /** Short-term conversation buffer for multi-turn player chat (last N exchanges) */
  private _chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  /** Rolling one-sentence summary of chat turns evicted from _chatHistory — so context older than ~6
   *  exchanges isn't lost. Updated fire-and-forget on trim; reset by clearChatHistory. */
  private _historySummary = '';

  /** Start a fresh conversation: clear the short-term buffer + rolling summary AND reset the provider's warm
   *  session for this NPC (claude-code) — they must reset together or they desync (the warm process would
   *  otherwise still "remember" the old turns). Driven by the stale-conversation TTL in chatStream. Long-term
   *  (vector) memory is untouched: the NPC still remembers you, it just won't replay a stale verbatim thread. */
  async clearChatHistory(): Promise<void> {
    this._chatHistory = [];
    this._historySummary = '';
    await resetAgentSessions(this.profile.id).catch(() => { /* best-effort session reset */ });
  }

  /** True if the player has been away from THIS NPC long enough (real time) that the next chat turn should
   *  start a fresh conversation. First turn (`_lastChatMs === 0`) is never stale; a clock that jumps backwards
   *  (NTP) yields a negative delta → not stale (conservative: keep continuity). Boundary is strict (`>`). */
  private _isStaleConversation(now: number): boolean {
    return this._lastChatMs > 0 && now - this._lastChatMs > this.chatStaleMs;
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
    this.locationResolver = options?.locationResolver ?? ((id) => id);
    this.nameResolver = options?.nameResolver ?? ((id) => id);
    this.language = options?.language ?? 'en';
    this.chatStaleMs = options?.chatStaleMs ?? 300_000; // 5 real minutes
    this.scaffoldOverride = options?.scaffold;
    this.reflectionTracker = new ReflectionTracker({
      ...options?.reflection,
    });
    this.onReflection = options?.onReflection;
    this.onObserveHook = options?.onObserve;
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
    const system = this.buildSystemPrompt();
    const user = `${this.buildUserContext(memories, undefined, true)}\n\n${userMessage}\n\n${this.finalReminder()}`;

    // generate() через façade: per-provider семафор + try/catch внутри. Per-NPC personality
    // передаётся через samplingOverride/maxTokensOverride. agentContext.id — для
    // ClaudeCodeProvider per-NPC папок.
    const reply = await generate('dialogue', {
      system,
      user,
      samplingOverride: { temperature: this.llmConfig.temperature },
      maxTokensOverride: this.llmConfig.maxTokens,
      agentContext: { id: this.profile.id },
    }) ?? '...';

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
    // Stale-conversation TTL: if the player was away from THIS NPC longer than chatStaleMs (real time),
    // start fresh — clear the short-term buffer + rolling summary + warm session. A brief glance away keeps
    // continuity; only a real gap resets. (Long-term vector memory persists regardless.)
    const now = Date.now();
    if (this._isStaleConversation(now)) {
      await this.clearChatHistory();
    }
    this._lastChatMs = now;

    const memories = await this.memory.recall(userMessage, this.state.currentDay, 5);
    const system = this.buildSystemPrompt();
    const userContext = this.buildUserContext(memories, additionalContext, true);

    // Push the RAW player message to history (NOT the L3-wrapped turn) so stale mood/memories never
    // accumulate in the buffer. Keep last 6 exchanges (12 messages); fold evicted turns into a rolling summary.
    this._chatHistory.push({ role: 'user', content: userMessage });
    if (this._chatHistory.length > 12) {
      const dropped = this._chatHistory.slice(0, this._chatHistory.length - 12);
      this._chatHistory = this._chatHistory.slice(-12);
      void this.summarizeIntoHistory(dropped); // fire-and-forget → ready for the next turn, no added latency
    }

    // generateStream() через façade: семафор + try/catch внутри.
    const history = this._chatHistory.slice(0, -1) as Array<{ role: 'user' | 'assistant'; content: string }>;
    // Current turn = rolling summary of earlier (trimmed) turns, then volatile L3 context, then the message,
    // then the final language/grounding reminder LAST (most decision-relevant closest to generation).
    const earlier = this._historySummary ? `## Earlier in this conversation\n${this._historySummary}\n\n` : '';
    const user = `${earlier}${userContext}\n\n${userMessage}\n\n${this.finalReminder()}`;
    const fullReply = await generateStream('dialogue', {
      system,
      user,
      onToken,
      history: history.length > 0 ? history : undefined,
      samplingOverride: { temperature: this.llmConfig.temperature },
      maxTokensOverride: this.llmConfig.maxTokens,
      agentContext: { id: this.profile.id },
    });

    // Add NPC reply to conversation history for multi-turn continuity
    this._chatHistory.push({ role: 'assistant', content: fullReply });

    const conversationText = `Player said: "${userMessage}". I replied: "${fullReply}"`;
    await this.memory.store(conversationText, 2, this.state.currentDay);
    if (this.reflectionTracker.track(conversationText, 2)) {
      await this.reflect();
    }

    return fullReply;
  }

  /** Fold chat turns evicted from _chatHistory into a one-sentence rolling summary, so context older than
   *  ~6 exchanges isn't lost. Called fire-and-forget from chatStream (ready for the NEXT turn — no added
   *  latency on the current reply). Routes via the 'history-summary' task (default → local Qwen); bounded
   *  at the call site. Best-effort: on any failure the prior summary is kept. */
  private async summarizeIntoHistory(dropped: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> {
    if (dropped.length === 0) return;
    try {
      const speakerOf = { user: 'They', assistant: 'I' } as const;
      const transcript = dropped.map((m) => `${speakerOf[m.role]}: ${m.content}`).join('\n');
      const prior = this._historySummary ? `Earlier summary: ${this._historySummary}\n\n` : '';
      const summary = await generate('history-summary', {
        system: 'You compress dialogue into a terse running summary. Output ONE short sentence capturing what matters for continuity. No preamble, no quotes.',
        user: `${prior}New turns to fold in:\n${transcript}\n\nUpdated one-sentence summary:`,
        maxTokensOverride: 80,
        samplingOverride: { temperature: 0.3 },
        agentContext: { id: this.profile.id },
      });
      if (summary) this._historySummary = summary.trim().slice(0, 300);
    } catch { /* keep the prior summary on failure */ }
  }

  async observe(event: string, importance: number, isProtected?: boolean): Promise<void> {
    await this.memory.store(event, importance, this.state.currentDay, isProtected);

    // Server-side hook: дописать в file-based memory (для ClaudeCodeProvider)
    if (this.onObserveHook) {
      try {
        await this.onObserveHook(event, importance, this.state.currentDay * 1440, isProtected);
      } catch (err) {
        console.error(`[Agent ${this.profile.name}] onObserve hook failed:`, err);
      }
    }

    const shouldReflect = this.reflectionTracker.track(event, importance);
    if (shouldReflect) {
      await this.reflect();
    }
  }

  /** Trigger reflection: LLM generates insight from accumulated memories */
  private async reflect(): Promise<void> {
    try {
      const bf = this.profile.bigFive;
      const enn = this.profile.enneagram;
      const personalityDesc = `Your nature: ${bigFiveToDescription(bf)}. Your deepest fear: ${enn.coreFear}. Your deepest desire: ${enn.coreDesire}.`;
      // generateReflection() уже идёт через façade (semaphore + try/catch внутри).
      const summary = await this.reflectionTracker.generateReflection(
        this.profile.id,
        this.profile.name,
        this.profile.role,
        personalityDesc,
      );
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
    const system = this.buildSystemPrompt();
    // NPC↔NPC prompts already carry a rotated speechReminder voice cue → includeVoice=false here.
    const user = `${this.buildUserContext(memories, options?.additionalContext)}\n\n${prompt}\n\n${this.finalReminder()}`;

    if (options?.jsonSchema) {
      // Structured request → classify (façade сам управляет семафором + retry)
      const result = await classify<unknown>('npc-dialogue', {
        system,
        user,
        schema: options.jsonSchema,
        samplingOverride: { temperature: this.llmConfig.temperature },
        maxTokensOverride: options.maxTokens ?? this.llmConfig.maxTokens,
        agentContext: { id: this.profile.id },
      });
      if (result === null) {
        console.error(`  [LLM:FAIL] ${this.profile.name}: classify returned null`);
        return '';
      }
      return JSON.stringify(result);
    }
    // Free text → generate
    const result = await generate('npc-dialogue', {
      system,
      user,
      samplingOverride: { temperature: this.llmConfig.temperature },
      maxTokensOverride: options?.maxTokens ?? this.llmConfig.maxTokens,
      agentContext: { id: this.profile.id },
    });
    if (!result) {
      console.error(`  [LLM:FAIL] ${this.profile.name}: generate returned null`);
      return '';
    }
    return result;
  }

  getMemories(): ScoredMemory[] {
    return this.memory.getAllMemories(this.state.currentDay);
  }


  /**
   * Сериализовать engine-state в `NpcMemoryState` для projection в файлы.
   * Используется ClaudeCodeProvider.onBeforeCall → NpcMemoryManager.snapshotState.
   *
   * Top-N beliefs выбираются по composite score (confidence × recency factor) — самый
   * актуальный и уверенный belief'ов наверх. По умолчанию 30 — достаточно для контекста
   * Claude, не перегружая prompt.
   */
  serializeMemoryState(
    currentGameMinute: number,
    nameResolver: (id: string) => string,
    options?: { beliefsTopN?: number },
  ): NpcMemoryState {
    const beliefsTopN = options?.beliefsTopN ?? 30;
    const allRelationships = this.state.relationships?.getAllRelationships() ?? [];
    // Single belief ranking (confidence × recency) — shared with the prompt path via getTopBeliefs
    // (was an inline confidence×recency copy here that diverged from summarizeForPrompt's confidence-only).
    const topBeliefs = this.state.beliefs?.getTopBeliefs(beliefsTopN, { currentDay: this.state.currentDay }) ?? [];

    return {
      gameMinute: currentGameMinute,
      location: this.state.location,
      mood: this.state.mood,
      baseMood: this.state.baseMood ?? 0,
      status: this.state.status,
      currentActivity: this.state.currentActivity,
      inTransit: this.state.inTransit ?? false,
      transitTo: this.state.transitTo,
      alive: this.state.alive,
      relationships: allRelationships.map(r => ({
        targetId: r.targetId,
        targetName: nameResolver(r.targetId),
        type: r.type,
        sentiment: r.sentiment,
        trust: r.trust,
      })),
      beliefs: topBeliefs.map((b) => ({
        eventType: b.eventType,
        subject: b.subject,
        subjectName: b.subject ? nameResolver(b.subject) : undefined,
        object: b.object,
        objectName: b.object ? nameResolver(b.object) : undefined,
        location: b.location,
        confidence: b.confidence,
        source: String(b.source),
        gameDay: b.gameDay,
        lastUpdated: b.lastUpdated,
      })),
    };
  }

  advanceDay(): number {
    this.state.currentDay += 1;
    return this.state.currentDay;
  }

  /** L1 (scaffold) + L2 (persona) — the STABLE system prefix. Byte-stable per NPC across turns so the
   *  claude-code warm session survives (session identity = model+system) and prompt caching hits. ALL
   *  volatile per-turn context (mood, memories, beliefs, additionalContext, rotating voice example) lives
   *  in buildUserContext() instead — which also dodges the "lost middle" by landing last in the user turn. */
  private buildSystemPrompt(): string {
    const personality = this.bigFiveToDescription();
    const enn = this.profile.enneagram;
    const motivationBlock = `## Your deepest drives
- Your deepest fear: ${enn.coreFear}
- Your deepest desire: ${enn.coreDesire}
These shape everything you do — your choices, hesitations, and what you avoid.`;
    // DESCRIPTION only (first line) — concrete "Example:" lines are rotated per-turn in buildUserContext so
    // they can't be copied verbatim and the system prefix stays byte-stable.
    const speechDescription = (this.profile.speechStyle.split('\n')[0] ?? '').trim();

    return `You are ${this.profile.name}, a ${this.profile.role}.

## Background
${this.profile.background}

## Personality
${personality}

${motivationBlock}

## Speech style
${speechDescription}

${this.profile.secret ? `## Your secret\n${this.profile.secret}\nYou will NOT reveal this unless directly confronted with evidence. If someone gets close to the topic — redirect, deflect, or change the subject.\n\n` : ''}${this.profile.innerConflict ? `## Your inner conflict\n${this.profile.innerConflict}\nThis tension leaks through — in hesitations, half-started sentences, and moments where you almost say something but catch yourself.\n\n` : ''}${this.scaffold()}`;
  }

  /** L3 — volatile per-turn context for the USER turn. Keeps the system prefix byte-stable (prompt cache /
   *  warm session) and places the freshest, most decision-relevant context LAST (beating "lost middle").
   *  includeVoice adds a rotating voice example — used on the player-chat path (NPC↔NPC prompts already
   *  carry speechReminder, so they pass includeVoice=false to avoid a double voice cue). */
  private buildUserContext(memories: ScoredMemory[], additionalContext?: string, includeVoice = false): string {
    const memoryBlock = memories.length > 0
      ? memories.map((m) => {
          const daysAgo = this.state.currentDay - m.gameDay;
          const timeLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
          const vividness = m.decayedImportance >= 7 ? 'vivid' : m.decayedImportance >= 4 ? 'clear' : 'fading';
          return `- (${timeLabel}, ${vividness}) ${m.text}`;
        }).join('\n')
      : 'No relevant memories.';

    const parts: Array<string | undefined> = [
      `## Current state\n- Location: ${this.locationResolver(this.state.location)}${this.state.currentActivity ? `\n- Activity: ${this.state.currentActivity}` : ''}\n- Mood: ${this.moodDescription()}`,
      this.buildRoleDirective(memories).trim() || undefined,
      this.buildStressGrowthDirective().trim() || undefined,
      `## Your memories (most relevant to this conversation)\n${memoryBlock}`,
      additionalContext?.trim() || undefined,
      includeVoice ? (this.voiceExample() || undefined) : undefined,
    ];
    return parts.filter(Boolean).join('\n\n');
  }

  /** L1 guardrails for THIS agent: the world-authored override (WorldConfig.scaffold) if present, else the
   *  engine's genre-neutral default for the agent's language (INV-21). Byte-stable per NPC (no volatile state)
   *  so the system prefix stays prompt-cache / warm-session friendly. */
  private scaffold(): string {
    return this.scaffoldOverride?.trim() || defaultScaffold(this.language);
  }

  /** One rotating voice example (fewShotExamples ∪ inline "Example:" lines), sampled per turn so it can't
   *  be copied verbatim and the system prefix stays byte-stable. Empty string if the NPC has none. */
  /** One rotating voice example (fewShotExamples ∪ inline "Example:" lines), sampled per turn so it can't
   *  be copied verbatim and the system prefix stays byte-stable. Empty string if the NPC has none. */
  private voiceExample(): string {
    const pool = buildExamplePool(this.profile.speechStyle, this.profile.fewShotExamples);
    if (pool.length === 0) return '';
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return this.language === 'ru'
      ? `(Моя манера речи звучит примерно так: ${pick})`
      : `(My voice sounds roughly like: ${pick})`;
  }

  /** The single most important constraint, restated as the LAST line of the user turn (recency beats the
   *  small-model "instruction attenuation"). Language-locked + grounded + concise. */
  private finalReminder(): string {
    return this.language === 'ru'
      ? 'Ответь в образе, только из того, что знаешь выше, на русском языке. Коротко.'
      : 'Reply in character, only from what you know above, in English. Keep it short.';
  }


  private buildRoleDirective(memories: ScoredMemory[]): string {
    const sections: string[] = [];

    // 1. Beliefs section (structured, not keyword-matched) — universal belief summary
    const beliefs = this.state.beliefs;
    if (beliefs) {
      const summary = beliefs.summarizeForPrompt(3, this.nameResolver, this.state.currentDay);
      if (summary) {
        sections.push(`## What you know\n${summary}`);
      }
    }

    // 2. Role-specific directives derived from beliefs/profile — delegated to module-registered
    //    builders so the engine stays genre-neutral. The crime-justice module supplies the
    //    investigator / perpetrator-guilt / witness / wanted-fugitive interpretations; another
    //    genre supplies its own. The engine itself never frames a belief as a "crime".
    for (const builder of getRoleDirectiveBuilders()) {
      sections.push(...builder({ agent: this, nameResolver: this.nameResolver }));
    }

    // 3. Relationships section
    const relationships = this.state.relationships;
    if (relationships) {
      const relSummary = relationships.summarizeForPrompt();
      if (relSummary) {
        sections.push(`## People you know\n${relSummary}`);
      }
    }

    // 4. Current motive (from AL decision WHY)
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
