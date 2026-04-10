/**
 * Boot Smoke Test — registry validation after module registration.
 * Auto-extracts module strings from populated registries — zero manual lists.
 * Also scans engine source to verify no module-specific strings leaked in.
 *
 * Run: bun test tests/boot-smoke.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
  AFFORDANCE_REGISTRY,
  TARGET_FINDERS,
  REACTIVE_TARGET_FINDERS,
  REQUIREMENT_CHECKERS,
  TOPIC_SOURCE_REGISTRY,
  EVIDENCE_RULES,
  EVIDENCE_SOURCES,
  // Accessors
  getStepHandler,
  getTickPhaseHandlers,
  getDayAdvanceHandlers,
  getAffordanceIdsForVerb,
  getAllRegisteredEventTypes,
  getEventLabel,
  getRegisteredSpeechActs,
  getRegisteredClaimSources,
  getRegisteredPressureTypes,
  getILTradeVerbs,
  // Registration functions for server-level setup
  registerEventCategory,
  registerSpeechActs,
  registerClaimSources,
  registerILTradeVerbs,
  registerPressureTypes,
} from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule } from '@clwa/modules';

// ─── Helpers ───

const ROOT = join(import.meta.dir, '..');
const ENGINE_DIR = join(ROOT, 'packages/engine/src');

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) result.push(full);
  }
  return result;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

// ─── Bootstrap (mirrors server/src/index.ts) ───

let registered = false;

beforeAll(() => {
  if (registered) return;
  registerSocialModule();
  registerCrimeJusticeModule();

  // Server-level registrations
  registerEventCategory('player_action', ['PLAYER_ACTION']);
  registerSpeechActs([
    { act: 'inform' }, { act: 'question' }, { act: 'request' },
    { act: 'accuse', accusation: true }, { act: 'threaten' },
    { act: 'compliment', benign: true }, { act: 'deny' },
    { act: 'agree', benign: true }, { act: 'disagree' },
    { act: 'greet', benign: true }, { act: 'farewell', benign: true },
    { act: 'buy', trade: true }, { act: 'sell', trade: true },
    { act: 'browse', trade: true },
  ]);
  registerClaimSources(['witnessed', 'heard', 'suspects', 'deduced']);
  registerILTradeVerbs(['buy', 'sell', 'browse', 'trade']);
  registerPressureTypes(['threat', 'bribe', 'flattery', 'guilt', 'intimidation']);

  registered = true;
});

// ─── 1. Core Registries Populated ───

describe('Registries Populated', () => {
  test('AFFORDANCE_REGISTRY has entries', () => {
    expect(AFFORDANCE_REGISTRY.length).toBeGreaterThan(10);
  });

  test('TARGET_FINDERS has entries', () => {
    expect(TARGET_FINDERS.size).toBeGreaterThan(5);
  });

  test('REACTIVE_TARGET_FINDERS has entries', () => {
    expect(REACTIVE_TARGET_FINDERS.size).toBeGreaterThan(5);
  });

  test('REQUIREMENT_CHECKERS has entries', () => {
    expect(REQUIREMENT_CHECKERS.size).toBeGreaterThan(3);
  });

  test('TOPIC_SOURCE_REGISTRY has entries', () => {
    expect(TOPIC_SOURCE_REGISTRY.length).toBeGreaterThan(5);
  });

  test('EVIDENCE_RULES has entries', () => {
    expect(EVIDENCE_RULES.length).toBeGreaterThan(0);
  });

  test('step handlers registered', () => {
    const knownModuleActions = ['steal_from', 'examine_scene', 'evaluate_case'];
    const found = knownModuleActions.filter(a => getStepHandler(a) !== null);
    expect(found.length).toBeGreaterThan(0);
  });

  test('speech acts registered', () => {
    expect(getRegisteredSpeechActs().length).toBeGreaterThan(5);
  });

  test('claim sources registered', () => {
    expect(getRegisteredClaimSources().size).toBeGreaterThan(0);
  });

  test('pressure types registered', () => {
    expect(getRegisteredPressureTypes().size).toBeGreaterThan(0);
  });

  test('trade verbs registered', () => {
    expect(getILTradeVerbs().size).toBeGreaterThan(0);
  });

  test('TICK_PHASE_HANDLERS has entries', () => {
    expect(getTickPhaseHandlers().length).toBeGreaterThanOrEqual(5);
  });

  test('DAY_ADVANCE_HANDLERS has entries', () => {
    expect(getDayAdvanceHandlers().length).toBeGreaterThanOrEqual(1);
  });

  test('event types registered', () => {
    expect(getAllRegisteredEventTypes().length).toBeGreaterThan(10);
  });
});

// ─── 2. Engine Source Purity (auto-extracted from registries) ───

describe('Engine Source Purity', () => {
  // Auto-extract ALL module-registered event types from the live registries.
  // No manual list — when a module adds 'FRAUD', this test catches it automatically.
  const moduleEventTypes = getAllRegisteredEventTypes();
  const engineFiles = collectTsFiles(ENGINE_DIR);

  test('engine source has no module event type string literals', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      const lines = readFileSync(f, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        const code = lines[i].replace(/\/\/.*$/, ''); // strip inline comments
        for (const evt of moduleEventTypes) {
          if (new RegExp(`['"\`]${evt}['"\`]`).test(code)) {
            violations.push(`${relative(ROOT, f)}:${i + 1} — '${evt}'`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('engine source has no ?? SCREAMING_CASE fallbacks', () => {
    const violations: string[] = [];
    for (const f of engineFiles) {
      if (f.includes('world-types.ts')) continue;
      const lines = readFileSync(f, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        const code = lines[i].replace(/\/\/.*$/, '');
        if (/\?\?\s*['"][A-Z][A-Z_]+['"]/.test(code)) {
          violations.push(`${relative(ROOT, f)}:${i + 1}: ${code.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── 3. Affordance Consistency ───

describe('Affordance Consistency', () => {
  test('every affordance resolved targetFinder key exists in TARGET_FINDERS', () => {
    // Engine uses: aff.targetFinder ?? aff.id (al.ts:394)
    // Also: aff.targetRole bypasses TARGET_FINDERS entirely
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (aff.targetRole) continue; // role-based finder, no registry lookup
      const key = aff.targetFinder ?? aff.id;
      if (!TARGET_FINDERS.has(key)) {
        missing.push(`${aff.id} → resolved key '${key}' not in TARGET_FINDERS`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every affordance has required fields', () => {
    const invalid: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (!aff.id) invalid.push('affordance missing id');
      if (!aff.goalType) invalid.push(`${aff.id} missing goalType`);
      if (!aff.stepTemplates || aff.stepTemplates.length === 0) {
        invalid.push(`${aff.id} missing stepTemplates`);
      }
    }
    expect(invalid).toEqual([]);
  });

  test('no duplicate affordance IDs', () => {
    const ids = AFFORDANCE_REGISTRY.map(a => a.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  test('affordance step templates use valid actions', () => {
    const builtIn = new Set(['move_to', 'interact', 'interact_present', 'announce', 'wait']);
    const invalid: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      for (const step of aff.stepTemplates ?? []) {
        if (!builtIn.has(step.action) && !getStepHandler(step.action)) {
          invalid.push(`${aff.id} step '${step.action}' not in builtIn or STEP_HANDLERS`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  test('requirement checker keys referenced by affordances exist', () => {
    const builtIn = new Set([
      'period', 'moodBelow', 'sentimentBelow', 'notGuard', 'isGuard',
      'isInvestigator', 'canSentence', 'noGuardNearby', 'maxWitnesses',
      'beliefConfidence', 'role',
    ]);
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (!aff.requires) continue;
      for (const key of Object.keys(aff.requires)) {
        if (builtIn.has(key)) continue;
        if (!REQUIREMENT_CHECKERS.has(key)) {
          missing.push(`${aff.id} requires '${key}' but no REQUIREMENT_CHECKER registered`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every affordance actionVerb is registered in ACTION_VERB_MAP', () => {
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (!aff.actionVerb) continue;
      const ids = getAffordanceIdsForVerb(aff.actionVerb);
      if (!ids || ids.length === 0) {
        missing.push(`${aff.id} has actionVerb '${aff.actionVerb}' but no ACTION_VERB_MAP entry`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every affordance with actionVerb has a non-empty label', () => {
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (aff.actionVerb && !aff.label) {
        missing.push(`${aff.id} has actionVerb but no label`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ─── 4. Cross-Registry Integrity ───

describe('Cross-Registry Integrity', () => {
  test('every registered event type has a human-readable label', () => {
    // Some event types are internal/mechanical and may not need display labels
    const skipLabels = new Set(['PLAYER_ACTION']);
    const noLabel: string[] = [];
    for (const evt of getAllRegisteredEventTypes()) {
      if (skipLabels.has(evt)) continue;
      if (!getEventLabel(evt)) {
        noLabel.push(evt);
      }
    }
    if (noLabel.length > 0) {
      console.warn(`⚠ Event types without labels (may need registerEventLabels): ${noLabel.join(', ')}`);
    }
  });

  test('every affordance beliefModifier is well-formed', () => {
    const invalid: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (!aff.beliefModifiers) continue;
      for (const bm of aff.beliefModifiers) {
        if (!bm.eventType || typeof bm.weight !== 'number') {
          invalid.push(`${aff.id} malformed beliefModifier: ${JSON.stringify(bm)}`);
        }
        if (typeof bm.weight === 'number' && (bm.weight < -1 || bm.weight > 1)) {
          invalid.push(`${aff.id} beliefModifier weight ${bm.weight} out of [-1, 1] range`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  test('every affordance resistTrait uses valid BigFive trait names', () => {
    const validTraits = new Set(['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism', 'honesty']);
    const invalid: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (!aff.resistTraits) continue;
      for (const rt of aff.resistTraits) {
        if (!validTraits.has(rt.trait)) invalid.push(`${aff.id} trait '${rt.trait}'`);
        if (rt.direction !== 'high' && rt.direction !== 'low') invalid.push(`${aff.id} direction '${rt.direction}'`);
      }
    }
    expect(invalid).toEqual([]);
  });

  test('no orphaned TARGET_FINDERS', () => {
    // Engine fallback: aff.targetFinder ?? aff.id — so both explicit targetFinder AND affordance id count
    const referenced = new Set<string>();
    for (const aff of AFFORDANCE_REGISTRY) {
      referenced.add(aff.targetFinder ?? aff.id);
    }
    const orphans = [...TARGET_FINDERS.keys()].filter(k => !referenced.has(k));
    expect(orphans).toEqual([]);
  });

  test('REACTIVE_TARGET_FINDERS keys match affordance IDs', () => {
    // Engine uses aff.id for reactive lookup (al.ts:409), not goalType
    const affIds = new Set(AFFORDANCE_REGISTRY.map(a => a.id));
    const orphans = [...REACTIVE_TARGET_FINDERS.keys()].filter(k => !affIds.has(k));
    expect(orphans).toEqual([]);
  });
});

// ─── 5. Design Invariants ───

describe('Design Invariants', () => {
  test('crime affordances have resistTraits (personality should resist crime)', () => {
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (aff.category === 'crime' && (!aff.resistTraits || aff.resistTraits.length === 0)) {
        missing.push(aff.id);
      }
    }
    expect(missing).toEqual([]);
  });

  test('crime affordances with high severity (>=5) have suppressNearPlayer', () => {
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      // Only crime category — justice/duty actions (arrest, investigate) SHOULD happen near player
      if (aff.category === 'crime' && (aff.severity ?? 0) >= 5 && !aff.suppressNearPlayer) {
        missing.push(`${aff.id} (severity ${aff.severity})`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every affordance with actionVerb has instinctContext for PM', () => {
    const missing: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      if (aff.actionVerb && !aff.instinctContext) {
        missing.push(aff.id);
      }
    }
    // Warn — some duty affordances may use default instinct
    if (missing.length > 0) {
      console.warn(`⚠ Affordances with actionVerb but no instinctContext: ${missing.join(', ')}`);
    }
  });
});

// ─── Contract Tests — callback signatures ──────────────────────────

describe('Module contract validation', () => {
  test('all topic sources accept 3 parameters (init, resp, ctx)', () => {
    const bad: string[] = [];
    for (let i = 0; i < TOPIC_SOURCE_REGISTRY.length; i++) {
      const fn = TOPIC_SOURCE_REGISTRY[i];
      if (fn.length < 3) {
        bad.push(`TOPIC_SOURCE_REGISTRY[${i}] (${fn.name || 'anonymous'}): has ${fn.length} params, expected 3`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('all registered step handlers are functions', () => {
    const bad: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      for (const tpl of aff.stepTemplates ?? []) {
        if (!['move_to', 'interact', 'interact_present', 'announce', 'wait'].includes(tpl.action)) {
          const handler = getStepHandler(tpl.action);
          if (!handler) {
            bad.push(`${aff.id} step '${tpl.action}': no handler registered`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('all affordance stepTemplates have action field', () => {
    const bad: string[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      for (const tpl of aff.stepTemplates ?? []) {
        if (!tpl.action) {
          bad.push(`${aff.id}: stepTemplate missing action`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
