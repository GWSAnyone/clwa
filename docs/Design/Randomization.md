# Randomization System

> Milestone 1 core feature. Each restart = different scenario.

## What Gets Randomized

| Component | Ranges In | Seed Domain | Status |
|-----------|-----------|-------------|--------|
| **OCEAN+H traits** | NPC JSON `randomRanges` | `seed + hash(npcId)` | ✅ Done |
| **Starting mood** | NPC JSON `moodRange` | `seed + hash('mood_' + npcId)` | ✅ Done |
| **Relationship sentiment/trust** | relationships.json `sentimentRange/trustRange` | `seed + hash(fromId + '_' + toId)` | ✅ Done |
| **Motives (conditional)** | NPC JSON `motiveCondition` | Resolved from randomized traits + sentiment | Planned |

## What Stays Fixed (and why)

| Component | Why Fixed |
|-----------|----------|
| **Enneagram** (type, wing, coreFear, coreDesire) | Defines "why" NPC acts — changing it = different person |
| **Role, capabilities** | Structural: no guard = no investigation |
| **Secret, innerConflict** | Narrative text tied to identity |
| **Motive** (targetId, reason) | Now conditional: activates/deactivates per seed based on traits + sentiment. See SPEC-scenario-variety |
| **Schedule, home** | Determines where NPCs can be found |
| **speechStyle** | Voice identity. LLM adapts tone to traits anyway |
| **Memories** | Backstory identity |
| **Relationship type, note** | Narrative context |

## Seed System

```
Priority: --seed=N (CLI) > save.json seed (resume) > Date.now() (fresh)

Per-entity sub-seeds prevent adding new NPCs from changing existing ones:
  traitSeed = seed + hash(npcId)
  moodSeed  = seed + hash('mood_' + npcId)
  relSeed   = seed + hash(fromId + '_' + toId)
```

## Population Constraints (safety net)

| Constraint | Threshold | Guaranteed by |
|-----------|-----------|---------------|
| Crime-capable (H < 0.5) | ≥ 2 NPCs | Mark range max 0.5, Elara max 0.65 |
| Social (E > 0.5) | ≥ 2 NPCs | Ted min 0.5, Elara min 0.6 |
| Honest witnesses (H > 0.6) | ≥ 2 NPCs | Aldric min 0.6, Theron min 0.6 |
| Negative mood (mood < -0.3) | ≥ 1 NPC | Mark range goes to -0.6 |

## Example: Two Seeds

### Seed 12345
- Mark: H=0.20, mood=-0.45 → **high crime pressure, early crime**
- Garrett: H=0.46 → **borderline corrupt**
- Mark→Bess: sentiment=-0.72 → **strong motive**

### Seed 99999
- Mark: H=0.34, mood=-0.15 → **moderate pressure, later crime**
- Garrett: H=0.49 → **slightly more principled**
- Mark→Bess: sentiment=-0.41 → **weaker motive, might not escalate to murder**

Same village, same cast, completely different story.

## Specs
- [[../specs/SPEC-trait-randomization]]
- [[../specs/SPEC-mood-relationship-randomization]]

## Files
- `packages/server/src/trait-randomizer.ts` — all randomization logic
- `worlds/millhaven/npcs/*.json` — ranges per NPC
- `worlds/millhaven/relationships.json` — ranges per pair
