/**
 * Architecture Lint — static source scanning.
 * Checks UNIVERSAL structural invariants by reading source files as text.
 * No runtime imports from CLWA, no hardcoded module-specific lists.
 *
 * Module-specific string checks (event types, statuses) live in boot-smoke.test.ts
 * where they auto-extract from populated registries — zero manual maintenance.
 *
 * Run: bun test tests/architecture.test.ts
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// ─── Helpers ───

const ROOT = join(import.meta.dir, '..');
const ENGINE_DIR = join(ROOT, 'packages/engine/src');
const MODULES_DIR = join(ROOT, 'packages/modules/src');

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) result.push(full);
  }
  return result;
}

/** Check if a line is inside a comment (single-line or block-style) */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Strip inline comments from a code line */
function stripInlineComments(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

/** Read file, return array of {lineNum, code} for non-comment lines */
function codeLines(filePath: string): Array<{ lineNum: number; code: string; raw: string }> {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const result: Array<{ lineNum: number; code: string; raw: string }> = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (inBlockComment) {
      if (raw.includes('*/')) inBlockComment = false;
      continue;
    }
    if (raw.trim().startsWith('/*') && !raw.includes('*/')) {
      inBlockComment = true;
      continue;
    }
    if (isCommentLine(raw)) continue;
    result.push({ lineNum: i + 1, code: stripInlineComments(raw), raw });
  }
  return result;
}

const SERVER_DIR = join(ROOT, 'packages/server/src');
const engineFiles = collectTsFiles(ENGINE_DIR);
const moduleFiles = collectTsFiles(MODULES_DIR);
const serverFiles = collectTsFiles(SERVER_DIR);

// Allowed files for mood assignment (effectiveMood computation only)
const MOOD_ASSIGN_ALLOWED = new Set(['world.ts']);

// ─── 1. Engine Boundary ───

describe('Engine Boundary', () => {
  test('engine never imports from modules/', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/from\s+['"].*modules/.test(code) || /import\s*\(.*modules/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('engine never imports from server/', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/from\s+['"].*server/.test(code) || /import\s*\(.*server/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('modules never import from server/', () => {
    const violations: string[] = [];
    for (const f of moduleFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/from\s+['"].*server/.test(code) || /import\s*\(.*server/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 2. No Direct Mood Mutation (Invariant #73) ───

describe('No Direct Mood Mutation', () => {
  test('no .mood += anywhere in engine or modules', () => {
    const violations: string[] = [];
    for (const f of [...engineFiles, ...moduleFiles]) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/\.mood\s*\+=/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no .mood -= anywhere in engine or modules', () => {
    const violations: string[] = [];
    for (const f of [...engineFiles, ...moduleFiles]) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/\.mood\s*-=/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('.mood = only in world.ts (effectiveMood computation)', () => {
    const violations: string[] = [];
    for (const f of [...engineFiles, ...moduleFiles]) {
      const filename = f.split(/[\\/]/).pop()!;
      if (MOOD_ASSIGN_ALLOWED.has(filename)) continue;
      for (const { lineNum, code } of codeLines(f)) {
        // .mood = <expression> — but NOT type annotations (mood: number), object literals (mood:), or compound names (moodBelow, moodModifiers)
        if (/\.mood\s*=\s/.test(code) && !/mood[A-Z]/.test(code) && !/mood:/.test(code) && !/:\s*number/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 3. No Text Matching (Invariant #1: structured data) ───

describe('No Text Matching', () => {
  test('no response.includes() in engine', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/response\.includes\s*\(/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no ?? with SCREAMING_CASE string fallback in engine (Invariant #8)', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      if (f.includes('world-types.ts')) continue; // DEFAULT_WORLD_CONFIG has valid defaults
      for (const { lineNum, code } of codeLines(f)) {
        // ?? 'ANY_SCREAMING_CASE' — suspicious fallback to module string
        if (/\?\?\s*['"][A-Z][A-Z_]+['"]/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}: ${code.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no .role === comparison in engine (Invariant #4: use capability flags)', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/\.role\s*===\s*['"]/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 4. Bilateral Design (Invariant #21) ───

describe('Bilateral Design', () => {
  // NPC-only operations that must have isPlayer guards either inline or in the called function.
  // We check for direct agent iteration + NPC-only processing without inline isPlayer guard.
  // Functions like findPair have isPlayer internally — we only flag DIRECT processing in loops.
  const NPC_ONLY_INLINE_OPS = ['volition', 'evaluateAllVolition', 'processMovement'];

  test('agent iteration with NPC-only processing has isPlayer guard', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      const lines = readFileSync(f, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (/for\s*\(.*(?:agents|this\.agents)/.test(lines[i])) {
          const context = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
          for (const op of NPC_ONLY_INLINE_OPS) {
            if (new RegExp(`\\b${op}\\b`).test(context) && !/isPlayer/.test(context)) {
              violations.push(`${relative(ROOT, f)}:${i + 1} — agent loop with '${op}' but no isPlayer guard`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 5. LLM Safety (Invariant #1) ───

describe('LLM Safety', () => {
  test('every llmCall/acquire has a finally block with release (Invariant #1)', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      const content = readFileSync(f, 'utf-8');
      // Find acquire() calls — should have corresponding finally { ... release() }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (/semaphore\.acquire|llmSemaphore\.acquire/.test(lines[i])) {
          // Check next 50 lines for finally + release
          const rest = lines.slice(i, Math.min(i + 50, lines.length)).join('\n');
          if (!/finally\s*\{[\s\S]*?release\(\)/.test(rest)) {
            violations.push(`${relative(ROOT, f)}:${i + 1} — acquire() without finally { release() }`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('handleEventForGoals calls are awaited (Invariant #7)', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/handleEventForGoals\s*\(/.test(code) && !/await\s+.*handleEventForGoals/.test(code) && !/async|function|export/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // ─── 6. No `as any` in module/server code (masks contract violations) ───

  test('no `as any` casts in modules or server code', () => {
    const violations: string[] = [];
    for (const f of [...moduleFiles, ...serverFiles]) {
      for (const { lineNum, code } of codeLines(f)) {
        if (/\bas\s+any\b/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum} — ${code.trim().slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
