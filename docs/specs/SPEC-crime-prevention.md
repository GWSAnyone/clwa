# SPEC: Crime Prevention — Warn, Alert, Confront

> **Milestone**: M2 (Detective Toolkit)
> **Status**: Implemented
> **Depends on**: IL pipeline (existing)
> **Engine changes**: IL claim→belief→goal pipeline for prevention actions.
> **Created**: 2026-04-03
> **Completed**: 2026-04-03
> Milestone 2, задача 2. Игрок может предотвратить преступление через диалог.

---

## Цель

Три пути предотвращения преступления через диалог:
1. **Warn victim** — предупредить жертву → defensive goal (hide/avoid)
2. **Alert guard** — попросить стражу наблюдать → surveillance goal
3. **Confront suspect** — конфронтация с преступником → suspect may back down

Все три пути работают через существующий IL pipeline (claims + requests). Новая логика — в модуле (reactive goals из danger beliefs).

## Почему это нужно

GDD: "Player can try to stop crime before it happens." Сейчас игрок может рассказать NPC об опасности, но NPC никак структурно не реагирует — нет defensive goals, нет surveillance, нет prevention mechanic.

---

## Дизайн

### Path 1: Warn Victim

**Player flow:**
```
Player → Bess: "Mark может быть опасен для тебя. Будь осторожна."
   ↓
IL: speechAct='inform', claims=[{eventType:'NPC_KILLED', subject:'Mark', object:'Bess', source:'suspects', confidence:0.7}]
   ↓
applyDialogueMeaning: creates belief in Bess (source: testimony, conf: 0.7 × trust)
   ↓
NEW: Module reactive logic detects "danger to self" belief
   ↓
Bess evaluates: trust in player + personality → creates defensive goal
```

**"Danger to self" detection (module tick phase handler):**

```typescript
// In crime-justice tick phase handler (runs each game minute)
function checkDangerBeliefs(agent: Agent, ctx: TickPhaseContext): void {
  if (agent.isPlayer) return;
  
  const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
  const dangerBeliefs = beliefs.filter(b =>
    isTransferable(b.eventType) &&          // crime event type
    b.object === agent.profile.name &&       // I am the potential victim
    b.confidence >= 0.25 &&                  // minimum threshold
    b.source === BELIEF_SOURCE.TESTIMONY     // someone warned me
  );
  
  if (dangerBeliefs.length === 0) return;
  
  const maxDanger = dangerBeliefs.reduce((max, b) => b.confidence > max.confidence ? b : max);
  
  // Check: already reacting? (has active defensive goal)
  if (hasDefensiveGoal(agent, ctx.goalManager)) return;
  
  // Personality determines response
  createDefensiveGoal(agent, maxDanger, ctx);
}
```

**Defensive goal selection (personality-driven):**

| Trait Condition | Goal | Description |
|----------------|------|-------------|
| N > 0.6 (fearful) | `lay_low` | Go home, wait. Existing affordance. |
| N <= 0.6, C > 0.6 (dutiful) | `report_crime` variant | Go to guard, report the threat |
| N <= 0.6, C <= 0.6, A > 0.5 | Seek companion | Move to populated location (tavern/square) |
| Low N + Low C + Low A | Ignore | Brave/careless — no defensive action |

**Implementation:** Reuse existing affordance step templates where possible:
- `lay_low` — already exists, steps: move_to $home → wait(16)
- Report to guard — `report_crime` already exists, needs hasCrimeBelief. Danger belief counts.
- Seek companion — new mini-goal: move_to most populated location. Simple.

**Cooldown:** Defensive goal created once per danger belief. Track via `lastDefensiveReaction: number` (gameMinute) on agent state, or simpler: check if goal already exists.

### Path 2: Alert Guard

**Player flow:**
```
Player → Garrett: "Следи за Mark, я подозреваю его."
   ↓
IL: requestedAction={action:'watch', target:'Mark', urgency:0.6}
     + claims=[{subject:'Mark', source:'suspects'}]
   ↓
applyDialogueMeaning:
  1. Creates suspicion belief in Garrett (testimony, trust-scaled)
  2. requestedAction → resolved via ACTION_VERB_MAP → 'surveillance' affordance
  3. Trust gate: trust >= 0.4 → goal created
   ↓
Garrett creates surveillance goal → moves to Mark's location → waits (watches)
```

**New affordance: `surveillance`**

```typescript
{
  id: 'surveillance',
  actionVerb: 'watch',
  actionDescription: 'keep watch on someone suspicious',
  label: 'Keep watch on a suspicious person',
  category: 'duty',
  severity: 1,
  isDuty: true,
  
  requires: {
    isInvestigator: true,
    hasSuspicionBelief: true,        // NEW requirement checker
  },
  
  weights: [
    { trait: 'C', direction: 'high', multiplier: 0.3 },
    { trait: 'H', direction: 'high', multiplier: 0.1 },
  ],
  moodWeight: 0.0,
  relationshipWeight: 0.0,
  baseProbability: 0.2,
  
  goalType: 'surveillance',
  goalPriority: 5,                   // > schedule (3), < arrest (6)
  
  stepTemplates: [
    { action: 'move_to', location: '$target' },
    { action: 'wait', duration: 8 },          // 8 game minutes at location
  ],
  
  cooldownOverride: 120,             // 2h game time between surveillance rounds
}
```

**New requirement checker: `hasSuspicionBelief`**

```typescript
// In crime-justice/target-finders.ts
registerRequirementChecker('hasSuspicionBelief', (agent, ctx) => {
  // Any transferable belief about a suspect, any source, confidence >= 0.2
  const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
  return beliefs.some(b =>
    isTransferable(b.eventType) &&
    b.subject !== null &&
    b.confidence >= 0.2
  );
});
```

**Difference from `hasCrimeBelief`:** hasCrimeBelief requires higher confidence (from affordance params) and is tied to specific crime evidence. hasSuspicionBelief is broader — ANY suspicion about ANY person, even from rumors.

**Target finder for surveillance:**

```typescript
registerTargetFinder('surveillance', (npcId, agent, ctx) => {
  // Find most suspected NPC based on beliefs
  const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
  const suspects = new Map<string, number>();
  
  for (const b of beliefs) {
    if (isTransferable(b.eventType) && b.subject) {
      const current = suspects.get(b.subject) ?? 0;
      suspects.set(b.subject, Math.max(current, b.confidence));
    }
  }
  
  // Pick highest confidence suspect
  let bestSuspect = null;
  let bestConf = 0;
  for (const [name, conf] of suspects) {
    if (conf > bestConf) {
      bestSuspect = name;
      bestConf = conf;
    }
  }
  
  if (!bestSuspect) return null;
  
  // Resolve to agent
  const suspectAgent = findAgentByName(bestSuspect, ctx.agents);
  if (!suspectAgent) return null;
  
  return {
    targetId: suspectAgent.profile.id,
    targetName: bestSuspect,
    targetLocation: suspectAgent.state.location,
  };
});
```

**Register action verb:**
```typescript
registerActionVerbs({ watch: ['surveillance'] });
```

**Deterrence effect:** Garrett co-located with Mark → existing `suppressNearPlayer` / `detersCrime` flag → Mark's crime affordances blocked near guard. Prevention through PRESENCE, not through command.

### Path 3: Confront Suspect

**Player flow:**
```
Player → Mark: "I know what you're planning. Don't do it."
   ↓
IL: speechAct='threaten'/'accuse', claims=[{subject:'Mark', ...}],
    emotionalPressure={type:'intimidation', intensity:0.6}
   ↓
applyDialogueMeaning (EXISTING):
  1. Mark gets belief: player suspects him
  2. Mood shift (negative from pressure)
  3. Trust/sentiment toward player drops
  4. Event stored: PLAYER_ACTION (threat/accusation)
   ↓
Secret directives: if Mark is perpetrator → denial directive activates
   ↓
Mark's next volition: new beliefs + mood change affect scores:
  - lay_low score may increase (fear of detection)
  - kill/steal score may increase (desperation — escalation)
  - Result depends on personality (high N → lay_low, low N → escalate)
```

**Нет нового кода для confrontation.** Существующие системы обрабатывают:
- IL pressure → mood/trust changes
- Secret directives → criminal denial behavior
- Volition → personality-driven response (lay_low vs escalate)
- Criminal awareness → Mark knows player suspects him (belief created)

**Escalation risk:** Confrontation может УСКОРИТЬ преступление. Если criminal с low N + low A получает pressure → desperation → crime sooner. Это design-correct: GDD таблица "Confront suspect → Risk: May back down, lie low, or escalate faster."

### Criminal Awareness of Surveillance

**M2: Immediate suppression — достаточно.**

Mark видит Garrett на своей локации (co-located). `detersCrime` flag на Garrett → `suppressNearPlayer` блокирует crime affordances. Mark НЕ знает зачем Garrett пришёл. Не знает что за ним "следят". Просто не может совершить преступление пока guard рядом.

**Почему этого достаточно для M2:**
1. **Реализм:** В реальной жизни преступник не совершает преступление при полицейском. Не потому что "понял что следят", а потому что полицейский рядом. Точно моделирует `detersCrime`.
2. **Gameplay:** Surveillance goal имеет `cooldownOverride: 120` (2h game time). После одного раунда (move_to + wait 8 min) Garrett уходит. Mark получает окно. Создаёт естественный gameplay loop: surveillance = временная мера → собирай доказательства пока Garrett держит Mark'а в узде.
3. **Test criteria met:** "Crime prevented" = guard nearby → crime blocked. Mission accomplished.

**M3 (deferred): Inference beliefs.**

Для M3 (Living Opposition): criminal awareness = полноценная подсистема:
- Track guard co-location duration → if detersCrime NPC at same location 3+ ticks → belief `being_watched`
- Personality-driven response:
  - High N: panic → flee_town score boost
  - Low N + High C: cunning evasion → change target/timing
  - Low N + Low C: escalation → accelerated crime attempt elsewhere
- Requires: new tick phase handler, new belief type, affordance weight modifiers from awareness beliefs

### Prevention Detection

**Как система определяет что преступление предотвращено?**

Не через special event. Органически:
- Criminal's goal (kill/steal) fails: target moved → pursuit fails → goal abandoned
- Criminal lays low: lay_low goal → crime delayed/postponed
- Guard nearby: suppressNearPlayer → crime blocked
- Criminal gives up: mood improves from conversations → crime score drops below threshold

**Для test criteria:** "Player can prevent a crime by warning the victim"
1. Set conditions: Mark close to killing (mood -0.7, motive, night)
2. Player warns Bess → Bess goes home (lay_low)
3. Mark's kill goal: move_to Bess → Bess not there → pursuit to home → Bess at home (not at crime-appropriate location — home is populated)
4. Mark fails or switches to lay_low
5. Verify: no NPC_KILLED event within next 30 game minutes

---

## Registration

### Module registration (crime-justice/index.ts)

```typescript
// In registerCrimeJusticeModule():

// 1. Surveillance affordance
registerAffordance(SURVEILLANCE_AFFORDANCE);

// 2. Surveillance target finder
registerTargetFinder('surveillance', findSurveillanceTarget);

// 3. hasSuspicionBelief requirement checker
registerRequirementChecker('hasSuspicionBelief', checkSuspicionBelief);

// 4. Action verb: watch → surveillance
registerActionVerbs({ watch: ['surveillance'] });

// 5. Danger belief tick phase handler
registerTickPhaseHandler('danger_belief_check', checkDangerBeliefs);
```

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `packages/modules/src/crime-justice/affordances.ts` | New: surveillance affordance definition |
| `packages/modules/src/crime-justice/target-finders.ts` | New: findSurveillanceTarget, checkSuspicionBelief requirement |
| `packages/modules/src/crime-justice/index.ts` | Register: surveillance, watch verb, danger_belief_check handler |
| `packages/modules/src/crime-justice/` | New file or section: `prevention.ts` — checkDangerBeliefs, createDefensiveGoal |

### Engine changes: NONE

Вся логика prevention — в модуле. Engine предоставляет: beliefs, goals, tick phase handlers, requirement checkers, affordance registry. Prevention = данные + module logic.

---

## Принципы

| Принцип | Соблюдение |
|---------|-----------|
| Bilateral | NPC→NPC предупреждения работают через beliefTransfer + reactive goals. Player→NPC через IL claims. Один pipeline. |
| Engine = universal | Engine не знает о "prevention". Module регистрирует tick handler + affordance. |
| PM = instinct | Victim's personality drives defensive goal (N = hide, C = report). Guard C/H drives surveillance priority. |
| Words are weapons | Всё через речь. "Warn" = claim, "Alert" = requestedAction, "Confront" = pressure. |
| No artificial markers | Нет кнопки "предупредить". Просто скажи. |

---

## Тест

### Warn victim
1. Mark mood -0.7, motive exists, pre-crime state
2. Player → Bess: "Mark wants to harm you"
3. Belief created in Bess (danger to self)
4. Next tick: Bess creates lay_low goal (high N) → goes home
5. Mark's kill attempt → target not at expected location → fails
6. No NPC_KILLED event within 30 game minutes

### Alert guard
1. Player → Garrett: "Keep an eye on Mark"
2. Trust >= 0.4 → surveillance goal created
3. Garrett moves to Mark's location → waits 8 game minutes
4. Mark's crime suppressed (detersCrime co-location)
5. After 8 min: Garrett leaves (goal complete). Cooldown 120 min.
6. Mark has window to act → player must use surveillance time to gather evidence

### Confront suspect
1. Player → Mark: "I know about your plans"
2. Mark gets beliefs, mood drops, trust in player drops
3. Mark's next volition: lay_low or escalation (personality-dependent)
4. If high N: lay_low. If low N: may escalate faster.
