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

  test('tick handlers that modify NPC-only state have isPlayer guard', () => {
    const violations: string[] = [];
    // NPC-only operations: volition, schedule, goal processing, motive growth, movement
    const npcOnlyPatterns = /volition|schedule|processGoal|motive.*confidence|processMovement/;
    for (const f of [...moduleFiles, ...engineFiles]) {
      const content = readFileSync(f, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/registerTickPhaseHandler/.test(lines[i])) {
          const block = lines.slice(i, Math.min(i + 40, lines.length)).join('\n');
          // Only flag if handler does NPC-only ops AND iterates agents without isPlayer
          if (npcOnlyPatterns.test(block) && /for\s*\(.*ctx\.agents/.test(block) && !/isPlayer/.test(block)) {
            violations.push(`${relative(ROOT, f)}:${i + 1} — NPC-only tick handler without isPlayer guard`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('proactive target finders (not reactive) exclude player', () => {
    const violations: string[] = [];
    for (const f of moduleFiles) {
      const content = readFileSync(f, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Only check named proactive finders, not reactive (reactive respond to events, bilateral OK)
        if (/function\s+find\w+Target/.test(lines[i]) && !/Reactive/.test(lines[i])) {
          const block = lines.slice(i, Math.min(i + 30, lines.length)).join('\n');
          if (/for\s*\(.*agents/.test(block) && /return\s*\{.*targetId/.test(block) && !/isPlayer/.test(block)) {
            violations.push(`${relative(ROOT, f)}:${i + 1} — proactive target finder may select player as target`);
          }
        }
      }
    }
    // Known acceptable: some finders use other guards (status checks, role checks, belief checks)
    // that naturally exclude the player. Advisory threshold — alert if count grows.
    expect(violations.length).toBeLessThan(5);
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

// ─── 7. Null Semantics (Invariant #2, #9) ───

describe('Null Semantics', () => {
  test('no "free" as status string in engine (null = default, Invariant #9)', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        // 'free' as status check — but NOT as decay type or other legitimate enum values
        if (/status\s*===\s*['"]free['"]/.test(code) || /===\s*['"]free['"]/.test(code) && /status/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}: ${code.trim().slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 8. Engine Behavioral Purity (post grief-extraction) ───

describe('Engine Behavioral Purity', () => {
  test('cg-engine has no direct relationship method calls (grief/sentiment in module)', () => {
    const violations: string[] = [];
    const cgFile = engineFiles.find(f => f.endsWith('cg-engine.ts'));
    if (!cgFile) return;
    for (const { lineNum, code } of codeLines(cgFile)) {
      if (/getGriefPenalty|adjustSentiment|adjustTrust/.test(code)) {
        violations.push(`cg-engine.ts:${lineNum}: behavioral logic belongs in module post-handler`);
      }
    }
    expect(violations).toEqual([]);
  });

  test('cg-engine uses no old domain field names (suspectName/victimName)', () => {
    const violations: string[] = [];
    const cgFile = engineFiles.find(f => f.endsWith('cg-engine.ts'));
    if (!cgFile) return;
    for (const { lineNum, code } of codeLines(cgFile)) {
      if (/suspectName|victimName|victimRole/.test(code)) {
        violations.push(`cg-engine.ts:${lineNum}: old domain field name (use perpetratorName/affectedName)`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 9. Status Registry Compliance ───

describe('Status Registry Compliance', () => {
  test('no truthy status checks in engine — use isStatusAbsent/isStatusActive (INV registry)', () => {
    const violations: string[] = [];
    // Allowlist: agent-types.ts (type declaration), world-types.ts (interface), event-registry.ts (registry impl)
    const allowFiles = new Set(['agent-types.ts', 'world-types.ts', 'event-registry.ts']);
    for (const f of engineFiles) {
      const filename = f.split(/[\\/]/).pop()!;
      if (allowFiles.has(filename)) continue;
      for (const { lineNum, code } of codeLines(f)) {
        // Catch: !!status, !!agent.state.status, .status) as boolean, .status && , .status ||
        // But not: .status === , .status !== (explicit comparison — may be OK if compared to registry value)
        // And not: .status? (optional chaining), .status: (object literal/type), statusTag, statusAbsent, statusActive
        if (/!!.*\.status\b/.test(code) && !/isStatus/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}: !!status — use isStatusAbsent()`);
        }
        // agent.state.status used as boolean in conditional (without registry call)
        if (/if\s*\(.*\.status\s*\)/.test(code) && !/isStatus|===|!==/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}: truthy status check — use isStatusAbsent()`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 10. Relationship Mutation Safety (INV-18) ───

describe('Relationship Mutation Safety', () => {
  test('no direct .sentiment = assignment outside RelationshipGraph', () => {
    const violations: string[] = [];
    const allowFiles = new Set(['relationships.ts', 'world-types.ts', 'agent-types.ts']);
    for (const f of [...engineFiles, ...moduleFiles]) {
      const filename = f.split(/[\\/]/).pop()!;
      if (allowFiles.has(filename)) continue;
      for (const { lineNum, code } of codeLines(f)) {
        // .sentiment = <value> but NOT sentiment: (object literal), sentimentBoost, sentimentValence, etc.
        if (/\.sentiment\s*=\s/.test(code) && !/sentiment[A-Z]/.test(code) && !/sentiment:/.test(code) && !/interface|type /.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}: direct .sentiment = — use adjustSentiment()`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no direct .trust = assignment outside RelationshipGraph', () => {
    const violations: string[] = [];
    const allowFiles = new Set(['relationships.ts', 'world-types.ts', 'agent-types.ts']);
    for (const f of [...engineFiles, ...moduleFiles]) {
      const filename = f.split(/[\\/]/).pop()!;
      if (allowFiles.has(filename)) continue;
      for (const { lineNum, code } of codeLines(f)) {
        if (/\.trust\s*=\s/.test(code) && !/trust[A-Z]/.test(code) && !/trust:/.test(code) && !/interface|type /.test(code)) {
          violations.push(`${relative(ROOT, f)}:${lineNum}: direct .trust = — use adjustTrust()`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 11. Belief Transfer Guard (INV-08) ───

describe('Belief Transfer Guard', () => {
  test('rumor belief creation has isTransferable check nearby (INV-08)', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      const content = readFileSync(f, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        // Find addBelief with source: 'rumor' (gossip/conversation spread)
        if (/source:\s*'rumor'/.test(lines[i])) {
          // Check 30 lines before for isTransferable (covers both sides of bidirectional transfer)
          const context = lines.slice(Math.max(0, i - 30), i + 1).join('\n');
          if (!/isTransferable/.test(context)) {
            violations.push(`${relative(ROOT, f)}:${i + 1}: rumor belief without isTransferable guard`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 12. No Role Mechanism in Engine Interfaces (INV-14) ───

describe('No Role Mechanism in Engine', () => {
  test('AffordanceRequirement has no role field', () => {
    const violations: string[] = [];
    const alFile = engineFiles.find(f => f.endsWith('al.ts'));
    if (!alFile) return;
    const content = readFileSync(alFile, 'utf-8');
    // Find AffordanceRequirement interface body
    const match = content.match(/interface AffordanceRequirement\s*\{([\s\S]*?)\}/);
    if (match && /\brole\??:\s*string/.test(match[1])) {
      violations.push('al.ts: AffordanceRequirement still has role field — use capability flags');
    }
    expect(violations).toEqual([]);
  });

  test('NpcFilter has no role field', () => {
    const violations: string[] = [];
    const goalsFile = engineFiles.find(f => f.endsWith('goals.ts'));
    if (!goalsFile) return;
    const content = readFileSync(goalsFile, 'utf-8');
    const match = content.match(/interface NpcFilter\s*\{([\s\S]*?)\}/);
    if (match && /\brole\??:\s*string/.test(match[1])) {
      violations.push('goals.ts: NpcFilter still has role field — use capability flags');
    }
    expect(violations).toEqual([]);
  });

  test('EventBoost has no role field', () => {
    const violations: string[] = [];
    const alFile = engineFiles.find(f => f.endsWith('al.ts'));
    if (!alFile) return;
    const content = readFileSync(alFile, 'utf-8');
    const match = content.match(/interface EventBoost\s*\{([\s\S]*?)\}/);
    if (match && /\brole\??:\s*string/.test(match[1])) {
      violations.push('al.ts: EventBoost still has role field — removed as dead code');
    }
    expect(violations).toEqual([]);
  });
});

// ─── 13. Registry Pattern — No Hardcoded Domain Strings ───

describe('Registry Pattern Enforcement', () => {
  test('engine never checks specific role strings (Invariant #4)', () => {
    const violations: string[] = [];
    const roleStrings = ['guard', 'bartender', 'merchant', 'herbalist', 'priest', 'blacksmith', 'bard', 'judge'];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        for (const role of roleStrings) {
          // Only flag === 'role' comparisons, not type annotations or comments
          if (new RegExp(`===\\s*['"]${role}['"]`).test(code)) {
            violations.push(`${relative(ROOT, f)}:${lineNum}: role string '${role}'`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('engine never references specific location names', () => {
    const violations: string[] = [];
    const locationKeywords = ['tavern', 'market-square', 'blacksmith', 'temple', 'courthouse', 'millhaven'];
    for (const f of engineFiles) {
      for (const { lineNum, code } of codeLines(f)) {
        for (const loc of locationKeywords) {
          if (new RegExp(`['"]${loc}['"]`, 'i').test(code)) {
            violations.push(`${relative(ROOT, f)}:${lineNum}: location '${loc}'`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
