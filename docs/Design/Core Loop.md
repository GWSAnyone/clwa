# Core Loop — Detective Mode

See [[../GDD_DETECTIVE.md]] for full specification.

## Summary

```
Arrival → Escalation → Crime → Resolution → Summary
(15-20m)   (20-30m)   (30-40m)  (20-30m)
```

## Player Actions Per Phase

### Phase 1: Arrival
- Walk around, meet NPCs
- Build initial trust
- Search for tipster (tutorial)
- Notice tensions

### Phase 2: Escalation
- Observe minor incidents
- Form theories
- Build alliances (Garrett? Theron? Witnesses?)
- Decide: warn? confront? wait?

### Phase 3: Crime
- Crime occurs OR player prevents
- If prevented → criminal recalculates
- Investigation: interrogate, examine, cross-reference

### Phase 4: Resolution
- Build case / present evidence
- Accusation → NPC evaluates
- Trial (if major crime)
- Consequences play out

## Key Metrics to Tune
- **Time to first minor incident**: ~10-15 min
- **Time to major crime**: ~40-60 min (if not prevented)
- **Criminal escalation speed**: adjustable via mood decay rate + escalation state
- **Session total**: 1.5-2 hours
