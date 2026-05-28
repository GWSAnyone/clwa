/**
 * Persistent stream-JSON IPC test.
 *
 * Сравнение cold-spawn vs persistent для 5 sequential calls с одной и той же
 * verdict-схемой (реалистичный production-кейс для magistrate'а).
 *
 * Замеры:
 *   - Latency per call (wall clock)
 *   - Cost USD per call
 *   - cache_creation_input_tokens / cache_read_input_tokens
 *   - Schema compliance (каждый ответ парсится как valid JSON по schema)
 *   - File memory propagation: edit memory/observations.md между turns,
 *     проверить через explicit @-reference (Strategy A) видит ли Claude свежее
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

const NPCS_ROOT = path.join(import.meta.dir, '../data/claude-npcs');
const MAGISTRATE_DIR = path.join(NPCS_ROOT, 'magistrate');

const verdictSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['release', 'warning', 'fine', 'imprisonment', 'exile'] },
    reasoning: { type: 'string', description: '2-3 sentences in-character judicial reasoning' },
    confidence: { type: 'number', description: '0-1 your confidence in this verdict' },
  },
  required: ['verdict', 'reasoning', 'confidence'],
  additionalProperties: false,
};

interface ResultEvent {
  type: 'result';
  is_error: boolean;
  duration_ms: number;
  num_turns: number;
  result: string;
  structured_output?: unknown;
  total_cost_usd: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  session_id: string;
}

const STRIPPED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY_HELPER', 'ANTHROPIC_BASE_URL',
]);
function stripEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (STRIPPED_ENV_KEYS.has(k) || v == null) continue;
    out[k] = v;
  }
  return out;
}

const scenarios = [
  {
    label: 'fraud-fine',
    user: 'Mark sold common herbs as Valdris spice to 3 villagers (Bess, Hilda, Garrett). Strong evidence: Bess testified herbs are roadside thyme. Severity 4/10. He denies, no remorse. What is your verdict?',
  },
  {
    label: 'theft-imprisonment',
    user: 'Ted stole 30 gold from the temple offering box at night. Garrett caught him red-handed with the coins. Severity 6/10. Ted claims debts forced him. What is your verdict?',
  },
  {
    label: 'minor-warning',
    user: 'Elara was caught singing political mockery of the magistrate in the tavern. Three witnesses confirm. No prior offenses. Severity 2/10. She apologizes. What is your verdict?',
  },
  {
    label: 'murder-exile',
    user: 'Hilda killed her apprentice in the forge — body found, witnessed by Bess. Overwhelming evidence. Severity 9/10. Hilda admits but pleads self-defense (no proof). What is your verdict?',
  },
  {
    label: 'memory-test',
    user: 'You recently received a private note (see @memory/observations.md). Aldric the priest is accused of embezzling temple funds. Mild evidence: hearsay from Bess. Severity 3/10. He denies. Considering recent context, what is your verdict?',
  },
];

// ─── Cold-spawn baseline ─────────────────────────────────────────────

async function coldSpawn(prompt: string, schemaJson: string): Promise<ResultEvent | null> {
  const proc = Bun.spawn([
    'claude', '-p',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', 'project,local',
    '--output-format', 'json',
    '--model', 'sonnet',
    '--json-schema', schemaJson,
    prompt,
  ], {
    cwd: MAGISTRATE_DIR,
    env: stripEnv({ ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }),
    stdout: 'pipe', stderr: 'pipe',
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  try {
    const arr = JSON.parse(text) as Array<Record<string, unknown>>;
    const found = arr.find(e => e.type === 'result');
    return found ? (found as unknown as ResultEvent) : null;
  } catch {
    return null;
  }
}

// ─── Persistent IPC ──────────────────────────────────────────────────

type SinkLike = { write: (s: string) => number; flush: () => void; end: () => void };

class PersistentSession {
  private proc!: ReturnType<typeof Bun.spawn>;
  private stdin!: SinkLike;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = '';
  private decoder = new TextDecoder();

  async start(schemaJson: string): Promise<void> {
    this.proc = Bun.spawn([
      'claude', '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', 'project,local',
      '--model', 'sonnet',
      '--json-schema', schemaJson,
      '--permission-mode', 'acceptEdits',
    ], {
      cwd: MAGISTRATE_DIR,
      env: stripEnv({ ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }),
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    // Bun.spawn with stdin: 'pipe' gives FileSink with .write/.flush/.end methods
    this.stdin = this.proc.stdin as unknown as SinkLike;
    this.reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
  }

  async ask(prompt: string): Promise<ResultEvent | null> {
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n';
    this.stdin.write(msg);
    this.stdin.flush();

    // Read stream-JSON lines until we get a 'result' event
    while (true) {
      const { done, value } = await this.reader.read();
      if (done) return null;
      this.buffer += this.decoder.decode(value, { stream: true });
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as { type?: string };
          if (event.type === 'result') return event as unknown as ResultEvent;
        } catch { /* skip malformed */ }
      }
    }
  }

  async stop(): Promise<void> {
    try { this.stdin.end(); } catch {}
    try { this.reader.releaseLock(); } catch {}
    this.proc.kill();
    await this.proc.exited;
  }
}

// ─── Run benchmarks ──────────────────────────────────────────────────

const schemaJson = JSON.stringify(verdictSchema);

console.log('\n═══ COLD SPAWN baseline (5 calls, isolated processes) ═══\n');
const coldResults: Array<{ label: string; ms: number; cost: number; verdict: string; cacheRead: number }> = [];
const t0Cold = Date.now();
for (const sc of scenarios) {
  const t0 = Date.now();
  const result = await coldSpawn(sc.user, schemaJson);
  const ms = Date.now() - t0;
  const so = result?.structured_output as { verdict?: string } | undefined;
  const cost = result?.total_cost_usd ?? 0;
  const cacheRead = result?.usage?.cache_read_input_tokens ?? 0;
  console.log(`  [${sc.label}] ${ms}ms · $${cost.toFixed(4)} · cache_read=${cacheRead} · verdict=${so?.verdict}`);
  coldResults.push({ label: sc.label, ms, cost, verdict: so?.verdict ?? 'null', cacheRead });
}
const totalCold = Date.now() - t0Cold;
const totalCostCold = coldResults.reduce((s, r) => s + r.cost, 0);
console.log(`  TOTAL: ${totalCold}ms · $${totalCostCold.toFixed(4)} cumulative`);

// ─── Test 2: Persistent IPC ─────────────────────────────────────────

console.log('\n═══ PERSISTENT IPC (5 calls, one process) ═══\n');

// Prepare memory observations file for test 5 (memory-test)
await fs.writeFile(
  path.join(MAGISTRATE_DIR, 'memory', 'observations.md'),
  '# Observations\n- [m720] Aldric the priest visited me yesterday, asking pointed questions about temple finance audits. Unusual behavior.\n'
);

const session = new PersistentSession();
const tSpawnStart = Date.now();
await session.start(schemaJson);

const persistentResults: Array<{ label: string; ms: number; cost: number; verdict: string; cacheRead: number; cacheCreation: number }> = [];
const t0Pers = Date.now();
for (let i = 0; i < scenarios.length; i++) {
  const sc = scenarios[i];
  const t0 = Date.now();
  const result = await session.ask(sc.user);
  const ms = Date.now() - t0;
  const so = result?.structured_output as { verdict?: string } | undefined;
  const cost = result?.total_cost_usd ?? 0;
  const cacheRead = result?.usage?.cache_read_input_tokens ?? 0;
  const cacheCreation = result?.usage?.cache_creation_input_tokens ?? 0;
  console.log(`  [${sc.label}] ${ms}ms · $${cost.toFixed(4)} · cache_read=${cacheRead} cache_creation=${cacheCreation} · verdict=${so?.verdict}`);
  persistentResults.push({ label: sc.label, ms, cost, verdict: so?.verdict ?? 'null', cacheRead, cacheCreation });
}
const totalPers = Date.now() - t0Pers;
const totalCostPers = persistentResults.reduce((s, r) => s + r.cost, 0);
console.log(`  TOTAL: ${totalPers}ms (incl. ${tSpawnStart > 0 ? '~spawn' : ''}) · $${totalCostPers.toFixed(4)} cumulative`);

await session.stop();

// ─── Comparison ─────────────────────────────────────────────────────

console.log('\n═══ COMPARISON ═══\n');
console.log('|          | Cold (ms) | Pers (ms) | Cold ($) | Pers ($) | Pers cache_read | Schema OK?');
console.log('|----------|-----------|-----------|----------|----------|-----------------|-----------');
for (let i = 0; i < scenarios.length; i++) {
  const c = coldResults[i];
  const p = persistentResults[i];
  const schemaOK = c.verdict !== 'null' && p.verdict !== 'null';
  console.log(`| ${c.label.padEnd(8)} | ${String(c.ms).padStart(9)} | ${String(p.ms).padStart(9)} | $${c.cost.toFixed(4)} | $${p.cost.toFixed(4)} | ${String(p.cacheRead).padStart(15)} | ${schemaOK ? 'YES' : 'NO'}`);
}
console.log(`| TOTAL    | ${String(totalCold).padStart(9)} | ${String(totalPers).padStart(9)} | $${totalCostCold.toFixed(4)} | $${totalCostPers.toFixed(4)} |`);

// ─── Schema reliability check ────────────────────────────────────────

const allCold = coldResults.filter(r => r.verdict !== 'null');
const allPers = persistentResults.filter(r => r.verdict !== 'null');
console.log(`\nSchema compliance:`);
console.log(`  Cold spawn:  ${allCold.length}/${coldResults.length}`);
console.log(`  Persistent:  ${allPers.length}/${persistentResults.length}`);

// ─── Memory test analysis ────────────────────────────────────────────

console.log(`\nMemory test (scenario 5 "memory-test"):`);
console.log(`  Cold verdict:       ${coldResults[4].verdict}`);
console.log(`  Persistent verdict: ${persistentResults[4].verdict}`);
console.log('  → Если magistrate знал контекст про Aldric (наблюдение из observations.md), оба должны дать одинаковый осторожный verdict.');
