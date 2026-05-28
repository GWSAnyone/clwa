/**
 * NpcMemoryManager — управляет файловой структурой per-NPC папок для ClaudeCodeProvider.
 *
 * Каждый NPC получает:
 *   data/claude-npcs/<id>/
 *   ├── CLAUDE.md              # auto-loaded из cwd как system prompt NPC
 *   ├── .mcp.json              # {"mcpServers":{}} — блокирует все MCP servers
 *   ├── .claude/settings.json  # {"autoMemoryEnabled": false} — мы курируем память сами
 *   └── memory/                # CLWA-curated memory, @-импорты из CLAUDE.md
 *       ├── current-state.md   # ← Stage 5: refresh per-call (mood/location/status)
 *       ├── relationships.md   # ← Stage 5: refresh per-call (live sentiment/trust)
 *       ├── beliefs.md         # ← Stage 5: refresh per-call (top-30 beliefs)
 *       ├── observations.md    # ← live append via onObserve hook
 *       ├── reflections.md     # ← live append via onReflection hook
 *       └── secrets.md         # ← static (set once at ensureNpcDir)
 *
 * Provider читает эти файлы через cwd; этот менеджер их пишет. Provider ничего не знает
 * про память напрямую — orthogonal concern.
 *
 * Atomic writes: snapshot файлы перезаписываются целиком через tmp+rename. Чтобы избежать
 * race между concurrent Claude calls для одного NPC, держим per-file Promise-chain mutex.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { NpcMemoryState } from '@clwa/engine';

export type MemoryKind = 'observation' | 'reflection' | 'relationship';

export interface NpcDirInit {
  /** Полный текст CLAUDE.md — system prompt NPC. Включает @-импорты на memory/*.md. */
  personality: string;
  /** Опциональный начальный текст для memory/relationships.md (overridden later by snapshotState). */
  relationships?: string;
  /** Опциональный начальный текст для memory/secrets.md. */
  secrets?: string;
}

export class NpcMemoryManager {
  /** Per-file Promise-chain mutex для atomic writes без race conditions. */
  private fileLocks = new Map<string, Promise<void>>();

  constructor(private readonly npcsRoot: string) {}

  /**
   * Создать структуру папок NPC при старте сервера, если её нет.
   * Существующие CLAUDE.md / memory НЕ перезаписываются — только создаются если отсутствуют.
   */
  async ensureNpcDir(agentId: string, init: NpcDirInit): Promise<void> {
    const dir = path.join(this.npcsRoot, agentId);
    await fs.mkdir(path.join(dir, 'memory'), { recursive: true });
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });

    await this.writeIfMissing(path.join(dir, '.mcp.json'), '{"mcpServers":{}}');
    await this.writeIfMissing(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryEnabled: false }, null, 2),
    );
    await this.writeIfMissing(path.join(dir, 'CLAUDE.md'), init.personality);

    if (init.relationships !== undefined) {
      await this.writeIfMissing(path.join(dir, 'memory', 'relationships.md'), init.relationships);
    }
    if (init.secrets !== undefined) {
      await this.writeIfMissing(path.join(dir, 'memory', 'secrets.md'), init.secrets);
    }
    // Live files — initial empty content. CLWA дописывает/перезаписывает по ходу.
    await this.writeIfMissing(path.join(dir, 'memory', 'observations.md'), '# Observations\n');
    await this.writeIfMissing(path.join(dir, 'memory', 'reflections.md'), '# Reflections\n');
    await this.writeIfMissing(path.join(dir, 'memory', 'current-state.md'), '# Current state\n(not yet snapshotted)\n');
    await this.writeIfMissing(path.join(dir, 'memory', 'beliefs.md'), '# Beliefs\n(no beliefs yet)\n');
  }

  /** Добавить запись в memory/<kind>s.md NPC'а. */
  async appendMemory(
    agentId: string,
    kind: MemoryKind,
    text: string,
    gameMinute: number,
  ): Promise<void> {
    const file = path.join(this.npcsRoot, agentId, 'memory', `${kind}s.md`);
    const line = `- [m${gameMinute}] ${text.replace(/\n/g, ' ')}\n`;
    await this.serialize(file, () => fs.appendFile(file, line));
  }

  /** Усечь memory/<kind>s.md если длина превышает maxLines (сохраняет header + последние N entries). */
  async pruneIfOversize(agentId: string, kind: MemoryKind, maxLines: number): Promise<void> {
    const file = path.join(this.npcsRoot, agentId, 'memory', `${kind}s.md`);
    const text = await fs.readFile(file, 'utf-8').catch(() => '');
    if (!text) return;
    const lines = text.split('\n');
    if (lines.length <= maxLines) return;
    const header = lines[0];
    const tail = lines.slice(-(maxLines - 1));
    await this.writeAtomic(file, [header, ...tail].join('\n'));
  }

  /** Прочитать memory-файл для дебага / observability endpoint. */
  async readMemory(agentId: string, kind: MemoryKind): Promise<string> {
    const file = path.join(this.npcsRoot, agentId, 'memory', `${kind}s.md`);
    return fs.readFile(file, 'utf-8').catch(() => '');
  }

  /** Путь к папке NPC — для provider'а, чтобы знать cwd. */
  npcDir(agentId: string): string {
    return path.join(this.npcsRoot, agentId);
  }

  /**
   * Stage 5 — projection of engine state into NPC's memory files.
   * Перезаписывает current-state.md, relationships.md, beliefs.md атомарно.
   * Вызывается из ClaudeCodeProvider.onBeforeCall перед spawn'ом claude.
   */
  async snapshotState(agentId: string, state: NpcMemoryState): Promise<void> {
    const memDir = path.join(this.npcsRoot, agentId, 'memory');
    await Promise.all([
      this.writeAtomic(path.join(memDir, 'current-state.md'), renderCurrentState(state)),
      this.writeAtomic(path.join(memDir, 'relationships.md'), renderRelationships(state)),
      this.writeAtomic(path.join(memDir, 'beliefs.md'), renderBeliefs(state)),
    ]);
  }

  /**
   * Stage 7a — memory consolidation.
   * Если observations.md длиннее `keepRecent + consolidateOldest` entries (excl. header),
   * берём oldest `consolidateOldest`, LLM-резюмируем через `llmGenerate(text)` →
   * результат append'ится в reflections.md, observations.md truncate'ится до header + последних `keepRecent` entries.
   *
   * Возвращает true если консолидация произошла, false если файл не требовал.
   */
  async consolidateObservations(
    agentId: string,
    llmGenerate: (prompt: string) => Promise<string | null>,
    opts: { keepRecent?: number; consolidateOldest?: number; gameMinute: number },
  ): Promise<boolean> {
    const keepRecent = opts.keepRecent ?? 25;
    const consolidateOldest = opts.consolidateOldest ?? 25;
    const obsFile = path.join(this.npcsRoot, agentId, 'memory', 'observations.md');
    const reflFile = path.join(this.npcsRoot, agentId, 'memory', 'reflections.md');

    const text = await fs.readFile(obsFile, 'utf-8').catch(() => '');
    if (!text) return false;

    const lines = text.split('\n');
    const header = lines[0] ?? '# Observations';
    const entries = lines.slice(1).filter((l) => l.trim().startsWith('-'));

    // Если меньше чем keepRecent + consolidateOldest entries — рано консолидировать
    if (entries.length < keepRecent + consolidateOldest) return false;

    const toConsolidate = entries.slice(0, consolidateOldest);
    const remaining = entries.slice(consolidateOldest);

    // LLM-генерим консолидацию
    const prompt = `These are old observations from my life. Distill them into ONE concise insight (1-2 sentences) — what pattern, conclusion, or emotional truth emerges? Respond with ONLY the insight.\n\n${toConsolidate.join('\n')}`;
    const summary = await llmGenerate(prompt);
    if (!summary) return false;

    // Append to reflections.md, rewrite observations.md
    await this.serialize(reflFile, async () => {
      const consolidationLine = `- [m${opts.gameMinute}] [consolidated from ${consolidateOldest} observations] ${summary.replace(/\n/g, ' ')}\n`;
      await fs.appendFile(reflFile, consolidationLine);
    });
    await this.writeAtomic(obsFile, [header, ...remaining].join('\n'));
    return true;
  }

  /**
   * Atomic write: tmp file + rename.
   * Per-file Promise-chain serialization — concurrent writes к одному файлу выполняются последовательно.
   */
  private async writeAtomic(filePath: string, content: string): Promise<void> {
    await this.serialize(filePath, async () => {
      const tmp = `${filePath}.tmp-${crypto.randomUUID()}`;
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, filePath);
    });
  }

  /** Per-file mutex via Promise chain. */
  private async serialize(filePath: string, work: () => Promise<void>): Promise<void> {
    const prev = this.fileLocks.get(filePath) ?? Promise.resolve();
    const next = prev.then(work).catch(() => {});
    this.fileLocks.set(filePath, next);
    await next;
  }

  private async writeIfMissing(filePath: string, content: string): Promise<void> {
    try {
      await fs.writeFile(filePath, content, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }
  }
}

// ─── Markdown renderers ─────────────────────────────────────────────

function renderCurrentState(s: NpcMemoryState): string {
  const lines: string[] = ['# Current state', ''];
  lines.push(`Game minute: m${s.gameMinute}`);
  lines.push(`Location: ${s.location}`);
  lines.push(`Mood: ${s.mood.toFixed(2)} ${moodLabel(s.mood)} (base: ${s.baseMood.toFixed(2)})`);
  lines.push(`Status: ${s.status ?? 'free'}`);
  if (s.currentActivity) lines.push(`Activity: ${s.currentActivity}`);
  if (s.inTransit && s.transitTo) lines.push(`In transit to: ${s.transitTo}`);
  if (!s.alive) lines.push(`**I am dead.**`);
  return lines.join('\n') + '\n';
}

function moodLabel(mood: number): string {
  if (mood < -0.6) return '(deeply distressed)';
  if (mood < -0.2) return '(troubled)';
  if (mood < 0.2) return '(neutral)';
  if (mood < 0.6) return '(content)';
  return '(joyful)';
}

function renderRelationships(s: NpcMemoryState): string {
  const lines: string[] = ['# Relationships', ''];
  if (s.relationships.length === 0) {
    lines.push('(no relationships)');
    return lines.join('\n') + '\n';
  }
  for (const r of s.relationships) {
    const sentLabel = sentimentLabel(r.sentiment);
    const trustLabel = trustLabelFn(r.trust);
    lines.push(`- **${r.targetName}** (${r.type}) — sentiment ${r.sentiment.toFixed(2)} ${sentLabel}, trust ${r.trust.toFixed(2)} ${trustLabel}`);
  }
  return lines.join('\n') + '\n';
}

function sentimentLabel(s: number): string {
  if (s < -0.6) return '(hostile)';
  if (s < -0.2) return '(cold)';
  if (s < 0.2) return '(neutral)';
  if (s < 0.6) return '(friendly)';
  return '(warm)';
}

function trustLabelFn(t: number): string {
  if (t < 0.15) return '(no trust)';
  if (t < 0.35) return '(low trust)';
  if (t < 0.65) return '(moderate trust)';
  return '(high trust)';
}

function renderBeliefs(s: NpcMemoryState): string {
  const lines: string[] = ['# Beliefs', '', '*(Top by composite score — most confident + recent)*', ''];
  if (s.beliefs.length === 0) {
    lines.push('(no beliefs formed yet)');
    return lines.join('\n') + '\n';
  }
  for (const b of s.beliefs) {
    const subj = b.subjectName ?? b.subject ?? '?';
    const obj = b.objectName ? ` → ${b.objectName}` : '';
    const loc = b.location ? ` at ${b.location}` : '';
    lines.push(`- **${b.eventType}** about ${subj}${obj}${loc} — conf ${b.confidence.toFixed(2)} (src: ${b.source}, day ${b.gameDay})`);
  }
  return lines.join('\n') + '\n';
}
