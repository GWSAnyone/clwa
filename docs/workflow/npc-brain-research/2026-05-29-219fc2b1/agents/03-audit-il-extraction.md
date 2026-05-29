# Agent 03 — audit: IL dialogue-meaning extraction

**Site**: `il.ts` extractDialogueMeaning (:186-256), buildILSchema (:36-83), validateAndResolve (:262-371),
resolveClaim/resolveNpcName/resolveLocation (:373-428); enums registered at `server/index.ts:138-157`; route in
`world.json` (qwen, temp 0.15, maxTokens 400, **no fallback**). Verbatim prompt in `raw.json`.

## Structure
One `classify()` call. Static 1-line system ("You are a dialogue meaning extractor."). Large user message: instruction
+ quoted player text + context block (Known NPCs/locations/event types) + 7 numbered fields (speechAct, claims,
questions, requestedAction, emotionalPressure, tradeIntent, extractionConfidence) + 2 trailing "RARE/OMIT" paragraphs.
**No markdown, no few-shot.** Output constrained by a dynamically-built **non-strict** JSON schema.

## Top quality risks
- **No few-shot anywhere**; over-extraction fought with repeated "RARE/OMIT/never" nagging — the real defense is in
  code (non-strict schema + isReal() sentinels + intensity gating). Fragile, depends on Qwen emitting junk sentinels.
- `requestedAction.action` enum-forced to affordance verbs → "show me your wares" → nearest verb ("steal"); only the
  trade-priority hack + trade-context discard rescue it.
- `speechAct` REQUIRED single-valued, but real messages are multi-act → lossy.
- Full NPC/location/event-type lists dumped **uncapped** every call → prompt bloat + enum-mismatch surface.
- **No fallback route** → any Qwen hiccup silently degrades every player line to `smalltalk`/conf 0 (console.warn only).
- `resolveNpcName` bidirectional substring match → cross-matches ("Ed" in "Edmund").
- `extractionConfidence` self-scored with no rubric; gates nothing downstream (decorative).
- Trade categories hardcoded inline while all other vocab is registry-driven.

## Top improvements
2–3 inline few-shot (benign→{speechAct,conf}, claim+question, genuine-threat); filter/cap the injected entity lists to
plausibly-relevant; define or drop extractionConfidence; allow multi-act speechAct; **add an IL fallback route**;
tighten resolveNpcName (exact/prefix + min length); move trade categories to a registry; document the non-strict +
isReal contract as a tested invariant so a future "strict cleanup" can't silently break it.
