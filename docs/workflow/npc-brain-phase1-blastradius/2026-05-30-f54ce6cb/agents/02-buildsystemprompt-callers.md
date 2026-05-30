# Agent 2 — Agent.buildSystemPrompt — все callers и dialogue-контракт (system/user/history) для L1/L2/L3 split

## Map: Agent.buildSystemPrompt — callers + dialogue-контракт (L1/L2/L3 split)

**TL;DR:** `buildSystemPrompt` — приватный метод, собирающий ОДИН монолитный SYSTEM-string. Внешних callers нет; три внутренних: `chat` (без additionalContext, без callers), `chatStream` (player-path, единственный с настоящим multi-turn `history`), `generateResponse` (NPC↔NPC, stateless, history никогда не шлёт). `reflect` строит совершенно отдельный prompt и split не затрагивается. additionalContext инъектируется СТРОГО перед `## Rules` (agent.ts:350) и имеет 3 источника. Перенос volatile-L3 в user-turn стабилизирует system → чинит claude-code warm-cache и 'lost middle'.

**Architecture:**
- `buildSystemPrompt` (agent.ts:306) — единая сборка. Порядок секций: name/role → Background → Personality → motivation(coreFear/Desire) → Speech style → **Current state(mood)** → roleDirective → **stressGrowth(mood)** → **Your memories(recall)** → secret → innerConflict → **additionalContext** → Rules. Жирным — volatile.
- `buildRoleDirective` (agent.ts:362) — beliefs 'What you know' / module role builders / relationships 'People you know' / currentMotive. Частично volatile (currentMotive).
- Façade `llm-client.ts` — `generate`/`generateStream`/`classify`, все форвардят `{system,user,history}` в провайдер без изменений.

**Data flow (3 пути):**
- PLAYER: server.ts:296 `fullContext=[secret,trust,approach,IL].join` → chatStream(msg, onToken, fullContext) → buildSystemPrompt(memories, ctx) + `_chatHistory` (slice -1) → `generateStream('dialogue',{system,user,history,onToken})` (agent.ts:120).
- NPC↔NPC conversation: conversation.ts:107 `initContext=secrets+DIALOGUE_RULE` → generateResponse(prompt,{additionalContext, jsonSchema}) → `classify('npc-dialogue',{system,user})`, БЕЗ history (conversation.ts:116/136).
- NPC↔NPC interaction: interaction.ts:78 `ctx='## What you know'+beliefs` → generateResponse(...) → classify, БЕЗ history (interaction.ts:83/96).
- REFLECTION (отдельно): reflect()→generateReflection (reflection.ts:54) собирает собственные system+user, `generate('reflection',...)`. НЕ трогает buildSystemPrompt.

**Провайдеры (как system/user/history доходят):**
- LM Studio (lm-studio:194): `[{system}, ...history, {user}]`. Один system. history между system и user.
- Claude Code (claude-code): `req.system` → `--system-prompt` (ЗАМЕНА). **Session identity=(model, system)** (:301/379) → смена system убивает warm-session. history склеивается в начало user ТОЛЬКО при свежем спавне (:420).

**Key decisions / patterns:**
1. additionalContext в system, не в user — сделано чтобы 'получало равный attention weight' (conversation.ts:104), но code сам жалуется на 'lost middle' для 9B (server.ts:299) → trade-inventory уже вынесли в user (server.ts:303) как обход.
2. generateResponse никогда не шлёт history — NPC↔NPC stateless, 'история' инлайнится текстом в prompt builders.
3. chatStream пушит RAW userMessage в _chatHistory (agent.ts:112), не обёрнутый — важно сохранить при split.

**Что стабильно (→ SYSTEM L1+L2):** name, role, Background, Personality(BigFive), motivation(coreFear/Desire), Speech style, secret, innerConflict, весь ## Rules.
**Что volatile (→ USER L3):** Mood, stressGrowth, ## Your memories(recall), ## Current state(location/activity), currentMotive, additionalContext (secret/trust/approach/IL).

**Gotchas:**
- claude-code warm-cache завязан на байт-стабильность system (:301). Split — выигрыш, но только если L3 уйдёт из system ПОЛНОСТЬЮ (включая mood-зависимый stressGrowth).
- chatStream: L3 класть в передаваемый user, НЕ в _chatHistory — иначе устаревший mood/memories накапливается в истории (agent.ts:112/131).
- Два пути сборки user (stateful chatStream vs stateless generateResponse) → две точки правки, одной обёрткой не закрыть.
- chat() без callers — синхронизировать или удалить, чтобы не плодить второй источник правды.

**Referenced answers:**
- Q: что безопасно держать в system vs двигать в user? / A: system=L1 Rules + L2 persona (name/role/Background/Personality/motivation/SpeechStyle/secret/innerConflict); user=L3 mood/stressGrowth/memories/currentState/currentMotive/additionalContext.
- Q: что передаёт каждый caller? / A: chatStream→fullContext(secret+trust+approach+IL)+history(multi-turn); generateResponse(conversation)→secrets+DIALOGUE_RULE, no history; generateResponse(interaction)→beliefs ctx, no history; chat→ничего.
- Q: кто строит свой prompt отдельно? / A: reflect→generateReflection (reflection.ts:54) — полностью независимый system+user, исключить из split.

**Not explored:**
- Полное тело lm-studio stream() и il.ts (отдельный classify-путь, не dialogue).
- bench-dialogue-quality.ts / npc-brain/fixtures.ts — только отмечены как зависимые от структуры prompt.
