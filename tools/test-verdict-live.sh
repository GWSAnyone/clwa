#!/usr/bin/env bash
#
# Stage 9b live verdict test — drives the REAL in-game sentencing chain through the debug API.
#
# Chain under test:
#   detain suspect → force `evaluate_case` on the magistrate → manual ticks →
#   step `sentence_npc` → classify('verdict') → ClaudeCodeProvider cold spawn (Sonnet) →
#   NPC_SENTENCED event → suspect status changes → cost recorded to data/llm-usage.jsonl
#
# Prerequisites (start these yourself before running):
#   1. `bun clwa`               — game server on :3000
#   2. LM Studio on :1234       — Qwen + embedding model (for the other NPCs' ticks)
#   3. `claude` logged in        — claude.ai OAuth (NOT an API key)
#   Qdrant is optional for THIS test — Claude verdict path does not touch it.
#
# Usage:
#   bash tools/test-verdict-live.sh
#   SUSPECT=mark JUDGE=magistrate TICKS=8 bash tools/test-verdict-live.sh
#
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
SUSPECT="${SUSPECT:-mark}"
JUDGE="${JUDGE:-magistrate}"
JUDGE_LOC="${JUDGE_LOC:-courthouse}"   # location slug of the judge's home (skips move_to delay)
TICKS="${TICKS:-8}"                    # evaluate_case = move_to + wait(4) + sentence ≈ 6 ticks

# jq is optional — fall back to raw output if missing
if command -v jq >/dev/null 2>&1; then PP="jq ."; else PP="cat"; fi

say()  { printf '\n\033[1;36m═══ %s\033[0m\n' "$1"; }
post() { curl -s -m "${2:-15}" -X POST "$BASE$1" -H 'Content-Type: application/json' ${3:+-d "$3"}; }
get()  { curl -s -m "${2:-15}" "$BASE$1"; }

say "0. Server reachable?"
if ! get /api/auto-state 5 | $PP; then
  echo "❌ Server not reachable at $BASE — run 'bun clwa' first." >&2; exit 1
fi

say "1. Disable auto-tick (deterministic manual stepping)"
running=$(get /api/auto-state | (jq -r '.running' 2>/dev/null || echo unknown))
if [ "$running" = "true" ]; then post /api/auto | $PP; else echo "auto-tick already OFF"; fi

say "2. Detain suspect: $SUSPECT"
post "/api/debug/status/$SUSPECT" 15 "{\"status\":\"detained\"}" | $PP

say "3. Teleport judge $JUDGE → $JUDGE_LOC (skip move_to delay)"
get "/api/debug/move/$JUDGE/$JUDGE_LOC" | $PP

say "4. Force affordance evaluate_case ($JUDGE → $SUSPECT), priority 10"
post "/api/debug/force-affordance/$JUDGE" 15 \
  "{\"affordanceId\":\"evaluate_case\",\"targetId\":\"$SUSPECT\",\"priority\":10}" | $PP

say "5. Run $TICKS ticks (Claude cold spawn happens inside sentence_npc — be patient, ~20-40s)"
post /api/debug/tick 900 "{\"count\":$TICKS}" | $PP

say "6. Suspect status after verdict"
get "/api/agent/$SUSPECT" | (jq '{id, name, status: .status, mood}' 2>/dev/null || cat)

say "7. LLM usage / cost stats"
get /api/debug/llm-usage | $PP

say "8. Magistrate file-memory (verify CLAUDE.md + snapshots exist & updated)"
echo "Inspect: packages/server/data/claude-npcs/$JUDGE/"
echo "  - CLAUDE.md, memory/current-state.md, memory/relationships.md, memory/beliefs.md, memory/observations.md"

say "Done. Check the [Verdict] line in the server log for the chosen verdict + reasoning."
