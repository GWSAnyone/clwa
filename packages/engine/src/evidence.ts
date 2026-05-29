import type { WorldEvent } from './cg-types';
import type { Agent } from './agent';
import type { SceneResidue } from './world-types';

// ─── Data Model ───

export interface Evidence {
  id: string;
  /** What event spawned this evidence */
  eventType: string;
  /** Module-defined category (crime: 'opportunity'|'motive'|'trace'; economy: 'transaction'; etc.) */
  category: string;
  /** Entity this evidence points to (null = environmental/general) */
  subjectId: string | null;
  subjectName: string | null;
  /** Second entity involved (victim, trade partner, etc.) */
  objectId: string | null;
  objectName: string | null;
  /** Where this evidence can be found */
  location: string;
  /** Confidence delta when discovered (0.05–0.5) */
  weight: number;
  /** When evidence was created */
  gameDay: number;
  /** Who has already discovered this */
  discoveredBy: Set<string>;
  /** Human-readable description for UI/journal */
  description: string;
  /** Active = not destroyed/cleaned */
  active: boolean;
}

// ─── Rule System (declarative, filled by modules) ───

export interface EvidenceTemplate {
  /** Module-defined category */
  category: string;
  /** Registered source strategy name (e.g. 'personsPresent', 'negativeRelationship') */
  source: string;
  /** Parameters for the source strategy (e.g. { threshold: -0.3 }) */
  params?: Record<string, unknown>;
  /** Confidence delta when this evidence is discovered */
  weight: number;
  /** Template string: {subjectName}, {objectName}, {location} are interpolated */
  descriptionTemplate: string;
}

export interface EvidenceRule {
  /** Which event type triggers evidence generation */
  trigger: string;
  /** Evidence to generate */
  generate: EvidenceTemplate[];
}

// ─── Source Strategies (registered by modules) ───

export interface EvidenceContext {
  event: WorldEvent;
  agents: Map<string, Agent>;
  sceneResidues?: Map<string, SceneResidue[]>;
}

export interface EvidenceCandidate {
  subjectId: string | null;
  subjectName: string | null;
  objectId: string | null;
  objectName: string | null;
  description: string;
}

export type EvidenceSourceFn = (
  template: EvidenceTemplate,
  ctx: EvidenceContext,
) => EvidenceCandidate[];

// ─── Registries (empty, filled by modules) ───

export const EVIDENCE_RULES: EvidenceRule[] = [];
export const EVIDENCE_SOURCES = new Map<string, EvidenceSourceFn>();

// ─── Serialization ───

export interface EvidenceJSON {
  id: string;
  eventType: string;
  category: string;
  subjectId: string | null;
  subjectName: string | null;
  objectId: string | null;
  objectName: string | null;
  location: string;
  weight: number;
  gameDay: number;
  discoveredBy: string[];
  description: string;
  active: boolean;
}

// ─── EvidenceLayer Class ───

export class EvidenceLayer {
  /** Evidence stored by location */
  private byLocation = new Map<string, Evidence[]>();

  /** Generate evidence from an event using registered rules + source strategies */
  generate(event: WorldEvent, ctx: EvidenceContext): Evidence[] {
    const created: Evidence[] = [];

    for (const rule of EVIDENCE_RULES) {
      if (rule.trigger !== event.type) continue;

      for (const template of rule.generate) {
        const sourceFn = EVIDENCE_SOURCES.get(template.source);
        if (!sourceFn) {
          console.warn(`[EL] Unknown evidence source: '${template.source}'`);
          continue;
        }

        const candidates = sourceFn(template, ctx);
        for (const c of candidates) {
          const evidence: Evidence = {
            id: crypto.randomUUID(),
            eventType: event.type,
            category: template.category,
            subjectId: c.subjectId,
            subjectName: c.subjectName,
            objectId: c.objectId,
            objectName: c.objectName,
            location: event.location,
            weight: template.weight,
            gameDay: event.gameDay,
            discoveredBy: new Set<string>(),
            description: c.description,
            active: true,
          };

          const arr = this.byLocation.get(event.location);
          if (arr) {
            arr.push(evidence);
          } else {
            this.byLocation.set(event.location, [evidence]);
          }

          created.push(evidence);
        }
      }
    }

    if (created.length > 0) {
      console.log(`[EL] Generated ${created.length} evidence at ${event.location} from ${event.type}`);
    }

    return created;
  }

  /** Get active evidence at location not yet discovered by this agent */
  getUndiscovered(location: string, agentId: string): Evidence[] {
    const all = this.byLocation.get(location) ?? [];
    return all.filter((e) => e.active && !e.discoveredBy.has(agentId));
  }

  /** Get all active evidence at location */
  getAll(location: string): Evidence[] {
    const all = this.byLocation.get(location) ?? [];
    return all.filter((e) => e.active);
  }

  /** Get all evidence across all locations (for API/debug) */
  getAllEvidence(): Map<string, Evidence[]> {
    return this.byLocation;
  }

  /** Mark evidence as discovered by agent, return the evidence */
  discover(evidenceId: string, agentId: string): Evidence | null {
    for (const evidenceList of this.byLocation.values()) {
      const e = evidenceList.find((ev) => ev.id === evidenceId);
      if (e && e.active) {
        e.discoveredBy.add(agentId);
        return e;
      }
    }
    return null;
  }

  /** Destroy evidence at location (destroy_evidence affordance). Returns count destroyed. */
  destroyAt(location: string, categories?: string[]): number {
    const all = this.byLocation.get(location) ?? [];
    let count = 0;
    for (const e of all) {
      if (!e.active) continue;
      if (categories && !categories.includes(e.category)) continue;
      e.active = false;
      count++;
    }
    if (count > 0) {
      console.log(`[EL] Destroyed ${count} evidence at ${location}${categories ? ` (categories: ${categories.join(', ')})` : ''}`);
    }
    return count;
  }

  // ─── Persistence ───

  toJSON(): EvidenceJSON[] {
    const result: EvidenceJSON[] = [];
    for (const evidenceList of this.byLocation.values()) {
      for (const e of evidenceList) {
        result.push({
          id: e.id,
          eventType: e.eventType,
          category: e.category,
          subjectId: e.subjectId,
          subjectName: e.subjectName,
          objectId: e.objectId,
          objectName: e.objectName,
          location: e.location,
          weight: e.weight,
          gameDay: e.gameDay,
          discoveredBy: [...e.discoveredBy],
          description: e.description,
          active: e.active,
        });
      }
    }
    return result;
  }

  static fromJSON(data: EvidenceJSON[]): EvidenceLayer {
    const layer = new EvidenceLayer();
    for (const item of data) {
      const evidence: Evidence = {
        ...item,
        discoveredBy: new Set(item.discoveredBy),
      };
      const arr = layer.byLocation.get(evidence.location);
      if (arr) {
        arr.push(evidence);
      } else {
        layer.byLocation.set(evidence.location, [evidence]);
      }
    }
    return layer;
  }
}
