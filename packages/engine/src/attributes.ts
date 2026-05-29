/**
 * Scalar-attribute subsystem (M5 Phase B / B1) — the universal quantified-state primitive.
 *
 * Generalizes the MoodModifier pattern (base value + timed/decaying modifiers, clamped) into a
 * string-keyed numeric layer on AgentState. ONE primitive backs Economy gold, Combat HP, Politics
 * standing, Survival needs — the engine assigns no meaning to the keys (modules do), exactly like
 * event types and belief sources. INV-14: no domain attribute names live in the engine.
 */

/** A timed, decaying delta applied to a scalar attribute (same decay model as MoodModifier). */
export interface AttributeModifier {
  id: string;
  /** Human-readable origin, e.g. 'sale', 'wound', 'bribe'. */
  source: string;
  /** Stacking group (module-defined). */
  category: string;
  magnitude: number;
  /** Game minutes left (0 = permanent until removed). */
  remaining: number;
  /** Original duration for decay calc (0 = permanent). */
  duration: number;
  decay: 'exponential' | 'linear' | 'none';
}

/** A named numeric attribute: clamped base value + timed modifiers. */
export interface ScalarAttribute {
  base: number;
  min: number;
  max: number;
  modifiers: AttributeModifier[];
}

function modifierEffective(m: AttributeModifier): number {
  if (m.decay === 'none' || m.duration === 0) return m.magnitude;
  const ratio = m.remaining / m.duration;
  if (m.decay === 'exponential') return m.magnitude * ratio * ratio;
  return m.magnitude * ratio; // linear
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function createAttribute(base: number, min = -Infinity, max = Infinity): ScalarAttribute {
  return { base: clamp(base, min, max), min, max, modifiers: [] };
}

/** Effective value = clamp(base + Σ decayed modifiers, min, max). */
export function attributeEffective(attr: ScalarAttribute): number {
  let sum = attr.base;
  for (const m of attr.modifiers) sum += modifierEffective(m);
  return clamp(sum, attr.min, attr.max);
}

/** Decay modifiers by dtMinutes, dropping expired ones (mirrors mood-system decay). */
export function decayAttribute(attr: ScalarAttribute, dtMinutes: number): void {
  for (let i = attr.modifiers.length - 1; i >= 0; i--) {
    const m = attr.modifiers[i];
    if (m.duration > 0) {
      m.remaining -= dtMinutes;
      if (m.remaining <= 0) attr.modifiers.splice(i, 1);
    }
  }
}

/** Read the effective value of an attribute from a map, or undefined if not declared. */
export function getAttributeValue(attributes: Record<string, ScalarAttribute> | undefined, key: string): number | undefined {
  const attr = attributes?.[key];
  return attr ? attributeEffective(attr) : undefined;
}
