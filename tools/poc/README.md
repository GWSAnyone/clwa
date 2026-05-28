# LLM provider PoC scripts

Standalone проверки которые валидируют поведение `packages/providers/*` и infrastructure без полного `bun clwa` запуска. Каждый файл — изолированный sandbox, не требует server'а.

| Script | Цель | Что валидирует |
|---|---|---|
| `poc-claude-code.ts` | End-to-end через `ClaudeCodeProvider` | Per-NPC папка, `--strict-mcp-config`, `--json-schema`, in-character response |
| `poc-memory-realtime.ts` | File memory propagation | Plant/Edit/Add memory файлов → Claude видит fresh при следующем call'е |
| `poc-verdict-claude.ts` | Production verdict pipeline | `classify('verdict', ...)` через router, Theron magistrate response quality |
| `poc-persistent-ipc.ts` | Cold-spawn vs persistent stream-JSON benchmark | Cost / latency / schema compliance — cold выиграл (см. SPEC) |
| `poc-usage-tracking.ts` | Stage 6 cost tracking | LlmUsageTracker JSONL persistence, aggregate stats, façade emit events |

## Запуск

```bash
bun run tools/poc/poc-claude-code.ts
bun run tools/poc/poc-memory-realtime.ts
bun run tools/poc/poc-verdict-claude.ts
bun run tools/poc/poc-persistent-ipc.ts    # ~3-5 минут, дорогой (Claude Sonnet)
bun run tools/poc/poc-usage-tracking.ts
```

## Требования

- `claude` CLI в PATH с активной подпиской (`claude /login` через claude.ai)
- LM Studio на `localhost:1234` (для embed/dialogue calls — некоторые PoC требуют)
- `NPCS_ROOT` = `packages/server/data/claude-npcs/` — папки создаются на лету через `NpcMemoryManager.ensureNpcDir`

## Не использовать в production

PoC скрипты регистрируют свои routers / providers — НЕ запускать одновременно с `bun clwa` (конфликт registry). Это standalone debug-инструменты.
