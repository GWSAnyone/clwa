# CLWA World — Dashboard

## Quick Links
- [[Design/Core Loop]] — game loop
- [[Design/Modules]] — module roadmap
- [[Design/Randomization]] — seed system, trait/mood/relationship ranges
- [[Lore/Millhaven]] — world lore

## NPC Overview (Dataview)

```dataview
TABLE personality.H as "Honesty", personality.N as "Neuroticism", role, startingMood as "Mood"
FROM "NPC"
WHERE name != null AND !contains(file.name, "template")
SORT personality.H ASC
```

## Low Honesty NPCs (Crime Candidates)

```dataview
TABLE personality.H as "H", personality.A as "A", startingMood as "Mood"
FROM "NPC"
WHERE personality.H < 0.5 AND !contains(file.name, "template")
SORT personality.H ASC
```

## Tensions by Severity

```dataview
TABLE severity, type
FROM "Tensions"
SORT severity DESC
```

## Locations by Type

```dataview
TABLE type, owner
FROM "Locations"
SORT type ASC
```

## Consistency Checks

> Пустой результат = всё в порядке. Здесь показываются только **нарушения**.

### NPCs without secrets (should be empty)
```dataview
LIST
FROM "NPC"
WHERE !contains(file.name, "template") AND !secret
```

### Tensions without NPCs (should be empty)
```dataview
LIST
FROM "Tensions"
WHERE !npcs AND !contains(file.name, "template")
```
