# Residual crime vocabulary in engine public types after the SceneResidue rename

- **Dimension**: consistency-perf
- **Severity**: minor · **Category**: consistency
- **Location**: `packages/engine/src/event-registry.ts:567; packages/engine/src/world.ts:55,1529`
- **Adversarial verdict**: confirmed

## Issue
The rename pass renamed SceneResidue.victimId->affectedId / perpetratorId->actorId but missed DiscoveryContext.victimId (a public engine interface, event-registry.ts:567), the onAgentDeath(killerId, victimId, ...) callback param name (world.ts:55), and the hardcoded perpetratorName: null payload key (world.ts:1529). The architecture neutrality test deliberately excludes victim/perpetrator as identifiers, so these pass, but they are crime nouns left in engine surface inconsistent with the SceneResidue rename.

## Suggested fix
Rename DiscoveryContext.victimId->affectedId and the onAgentDeath victimId param->affectedId for consistency with SceneResidue; leave perpetratorName/affectedName payload keys as the accepted untyped-payload residual but consider neutral naming in a follow-up.

## Adversarial verification
All three cited locations verified verbatim in the current source on feature/engine-generalization.

(1) event-registry.ts:567 — `victimId: string;` is a field of the PUBLIC `DiscoveryContext` interface (declared line 565 `export interface DiscoveryContext {`), and notably sits one line above its sibling `affectedName: string;` (line 568). So within the same interface the rename pass used the neutral `affected*` prefix for the name but left `victimId` as a crime noun.

(2) world.ts:55 — `onAgentDeath?: (killerId: string, victimId: string, killerName: string, affectedName: string) => void;` confirmed in the WorldCallbacks interface. The param is `victimId` (also `killerId`), again paired with the neutral `affectedName`.

(3) world.ts:1529 — `perpetratorName: null,` confirmed as a payload key in the BODY_DISCOVERED event.

The finding's premise (an inconsistency vs the SceneResidue rename) holds against the actual rename evidence: world-types.ts:145-147 (`actorId?`/`affectedId?` on `SceneResidue`), scene-residue.ts:60-61 (`actorId`/`affectedId`), and world.ts:1619-1620 (`markSceneResidue(actorId, affectedId)`) all adopted the neutral pair — yet the death-discovery pathway immediately adjacent (world.ts:1541 passes `victimId: dead.id` into `DiscoveryContext`, world.ts:1513 reads `s.affectedId`) still carries `victimId`. This is a genuine intra-subsystem naming wart, which the review BAR explicitly invites.

The finding is correctly scoped as minor/consistency and does NOT overclaim: I confirmed via tests/architecture.test.ts that these pass by deliberate design, not by accident. The neutrality regex CRIME_PROSE (line 121) includes `perpetrator` but is applied ONLY to string literals (stringLiterals(), line 136), and the comment at line 120 explicitly states "'guard'/'victim' excluded (appear as universal identifiers, not prose)". The `'perpetratorName'` payload key is an object-key identifier (not a quoted string literal), so the literal scanner cannot catch it; it is also the documented accepted untyped-payload residual per the task brief. The finding correctly defers those payload keys to that residual and only asks to rename the two identifiers (DiscoveryContext.victimId, onAgentDeath victimId param) for consistency.

Caveat (does not refute): the finding is slightly under-inclusive — the same wart also affects `killerId` in the onAgentDeath signature (world.ts:55), the `processAgentDeath(victimId, killerId, ...)` public method params (world.ts:1657), and the DiscoveryContext-feeding call site world.ts:1541 — so a consistency pass would touch more than the two spots named. But every concrete claim made is accurate; nothing is refuted.
