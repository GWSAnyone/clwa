/**
 * Interactive command launcher for the CLWA project.
 *
 *   bun menu        → numbered picker of the package.json scripts
 *   bun menu 1      → run entry #1 directly (non-interactive)
 *
 * Reads scripts from package.json (auto-updates as scripts change). Friendly descriptions for known
 * commands; raw command shown otherwise. Pick a number → spawns `bun run <script>` with inherited stdio.
 */
import { spawnSync } from 'bun';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> };
const scripts = pkg.scripts ?? {};

// Friendly labels for known scripts (fallback = the raw command).
const DESC: Record<string, string> = {
  clwa: 'Game server      → http://localhost:3000/game.html',
  world: 'World editor     → http://localhost:3001',
  docs: 'Docs reader      → http://localhost:3002',
  test: 'Full test suite',
  'test:arch': 'Architecture lint tests',
  'test:smoke': 'Boot-smoke tests',
  'test:save': 'Save/load tests',
  'test:cg': 'Consequence-graph tests',
  'test:cg-int': 'CG integration tests',
  'test:m3': 'M3 systems tests',
};

// Order: the three servers first, then test, then everything else — but never the menu itself.
const ORDER = ['clwa', 'world', 'docs', 'test'];
const names = Object.keys(scripts).filter((n) => n !== 'menu');
names.sort((a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
});

if (names.length === 0) {
  console.log('No scripts found in package.json.');
  process.exit(0);
}

function run(name: string): never {
  console.log(`\n▶ bun run ${name}\n`);
  const res = spawnSync(['bun', 'run', name], { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] });
  process.exit(res.exitCode ?? 0);
}

// Direct mode: `bun menu 1` or `bun menu clwa`
const arg = process.argv[2];
if (arg) {
  const byNum = names[Number(arg) - 1];
  const chosen = byNum ?? (names.includes(arg) ? arg : undefined);
  if (!chosen) { console.error(`Unknown choice: ${arg}`); process.exit(1); }
  run(chosen);
}

// Interactive menu
console.log('\n  CLWA — choose a command:\n');
names.forEach((name, i) => {
  const label = DESC[name] ?? scripts[name];
  console.log(`  ${String(i + 1).padStart(2)}. ${name.padEnd(11)} ${label}`);
});
console.log('   q. quit\n');

const answer = (prompt('  ▸ number: ') ?? '').trim();
if (answer === '' || answer.toLowerCase() === 'q') { console.log('  (cancelled)'); process.exit(0); }
const idx = Number(answer) - 1;
if (!Number.isInteger(idx) || idx < 0 || idx >= names.length) { console.error(`  invalid: ${answer}`); process.exit(1); }
run(names[idx]);
