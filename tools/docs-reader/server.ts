/**
 * Docs Reader — local server for browsing and editing CLWA documentation.
 *
 * - Serves web UI from public/
 * - Reads markdown files from docs/ directory
 * - Supports editing (save) but not creating new files
 * - Mobile-friendly for LAN reading from phone
 * - Intelligence Dashboard API endpoints (/api/dashboard/*)
 *
 * Usage: bun run tools/docs-reader/server.ts
 * Open: http://localhost:3002
 */

import { resolve, join, relative, extname, basename, dirname } from "path";
import { readdir, stat } from "fs/promises";
import { execSync } from "child_process";

// Engine registries — same pattern as world-editor
import { registerCrimeJusticeModule, registerSocialModule, CRIME_CG_RULES } from "@clwa/modules";
import { AFFORDANCE_REGISTRY, getAllRegisteredEventTypes } from "@clwa/engine";

registerSocialModule();
registerCrimeJusticeModule();

// ─── Configuration ───

const DOCS_DIR = resolve(import.meta.dir, "../../docs");
const CLAUDE_MD = resolve(import.meta.dir, "../../CLAUDE.md");
const SERENA_DIR = resolve(import.meta.dir, "../../../.serena/memories/clwa");
const WORLD_DIR = resolve(import.meta.dir, "../../worlds/millhaven");
const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const SPECS_DIR = resolve(DOCS_DIR, "specs");
const TESTS_DIR = resolve(PROJECT_ROOT, "tests");
const PUBLIC_DIR = resolve(import.meta.dir, "public");
const PORT = 3002;

// ─── Creation date: parsed from **Created** field in file headers, fallback to mtime ───

// ─── Helpers ───

interface DocEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: DocEntry[];
}

async function buildDocTree(dir: string, basePath: string = ''): Promise<DocEntry[]> {
  const entries: DocEntry[] = [];
  let items: string[];
  try { items = await readdir(dir); } catch { return entries; }

  // Sort: directories first (alphabetical), then files by git creation date (oldest first = chronological).
  const dirs: string[] = [];
  const files: Array<{ name: string; created: number }> = [];
  for (const item of items) {
    if (item.startsWith('.') || item.startsWith('_')) continue;
    const fullPath = join(dir, item);
    const s = await stat(fullPath);
    if (s.isDirectory()) dirs.push(item);
    else if (extname(item) === '.md') {
      // Parse Created date from file header: > **Created**: 2026-04-03
      let created = s.mtimeMs;
      try {
        const head = (await Bun.file(fullPath).text()).substring(0, 1000);
        const m = head.match(/\*\*Created\*\*\s*:\s*(\d{4}-\d{2}-\d{2})/);
        if (m) created = new Date(m[1]).getTime();
      } catch {}
      files.push({ name: item, created });
    }
  }
  dirs.sort();
  files.sort((a, b) => b.created - a.created); // newest first

  for (const d of dirs) {
    const relPath = basePath ? `${basePath}/${d}` : d;
    const children = await buildDocTree(join(dir, d), relPath);
    if (children.length > 0) {
      entries.push({ name: d, path: relPath, type: 'directory', children });
    }
  }
  for (const f of files) {
    const relPath = basePath ? `${basePath}/${f.name}` : f.name;
    entries.push({ name: f.name.replace('.md', ''), path: relPath, type: 'file' });
  }
  return entries;
}

/** Safely read a text file, return null on error */
async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

/** Safely read and parse a JSON file, return null on error */
async function safeReadJSON<T = unknown>(path: string): Promise<T | null> {
  try {
    const text = await Bun.file(path).text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Run a shell command safely, return stdout or null */
function safeExec(cmd: string): string | null {
  try {
    return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/** Extract a metadata value from spec header lines like `**Status**: value` or `Статус: **value**` */
function extractMeta(lines: string[], key: string): string | null {
  for (const line of lines) {
    const patterns = [
      new RegExp(`\\*\\*${key}\\*\\*\\s*:\\s*(.+)`, 'i'),
      new RegExp(`${key}\\s*:\\s*\\*\\*(.+?)\\*\\*`, 'i'),
      new RegExp(`>\\s*${key}\\s*:\\s*(.+)`, 'i'),
      new RegExp(`${key}\\s*:\\s*(.+)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1].replace(/\*\*/g, '').replace(/\s*$/, '').trim();
      }
    }
  }
  return null;
}

// ─── Dashboard: Specs ───

interface SpecEntry {
  name: string;
  title: string | null;
  status: string | null;
  milestone: string | null;
  depends: string | null;
  engineChanges: string | null;
}

interface SpecsSummary {
  total: number;
  implemented: number;
  inProgress: number;
  deferred: number;
  spec: number;
}

async function getSpecs(): Promise<{ specs: SpecEntry[]; summary: SpecsSummary }> {
  const specs: SpecEntry[] = [];
  const emptySummary: SpecsSummary = { total: 0, implemented: 0, inProgress: 0, deferred: 0, spec: 0 };

  let files: string[];
  try { files = await readdir(SPECS_DIR); } catch { return { specs: [], summary: emptySummary }; }

  const specFiles = files.filter(f => (f.startsWith('SPEC-') || f.startsWith('AUDIT-')) && f.endsWith('.md'));
  specFiles.sort();

  for (const file of specFiles) {
    const content = await safeReadFile(join(SPECS_DIR, file));
    if (!content) continue;

    const lines = content.split('\n').slice(0, 30);
    const name = file.replace('.md', '');

    // Title = first # heading
    let title: string | null = null;
    for (const line of lines) {
      const m = line.match(/^#\s+(.+)/);
      if (m) { title = m[1].trim(); break; }
    }

    const status = extractMeta(lines, 'Status') ?? extractMeta(lines, 'Статус');
    const milestone = extractMeta(lines, 'Milestone');
    const depends = extractMeta(lines, 'Depends on') ?? extractMeta(lines, 'Depends');
    const engineChanges = extractMeta(lines, 'Engine changes');

    specs.push({ name, title, status, milestone, depends, engineChanges });
  }

  // Summary
  const summary: SpecsSummary = { total: specs.length, implemented: 0, inProgress: 0, deferred: 0, spec: 0 };
  for (const s of specs) {
    const st = (s.status ?? '').toLowerCase();
    if (st.includes('implemented') || st.includes('done') || st.includes('complete') || st.includes('реализовано') || st.includes('verified') || st.includes('validated') || st.includes('superseded') || st.includes('near-complete')) {
      summary.implemented++;
    } else if (st.includes('partial') || st.includes('in progress') || st.includes('in-progress')) {
      summary.inProgress++;
    } else if (st.includes('deferred')) {
      summary.deferred++;
    } else if (st.includes('spec') || st.includes('спека') || st === '') {
      summary.spec++;
    }
  }

  return { specs, summary };
}

// ─── Dashboard: World ───

interface WorldNpc {
  id: string;
  name: string;
  role: string;
  bigFive: { O: number; C: number; E: number; A: number; N: number; H: number } | null;
  enneagram: { type: number; wing: number; coreFear: string; coreDesire: string } | null;
  background: string | null;
}

interface WorldRelationship {
  from: string;
  to: string;
  type: string;
  note?: string;
  sentiment?: number;
  sentimentRange?: [number, number];
  trust?: number;
  trustRange?: [number, number];
}

interface WorldMotive {
  id?: string;
  from: string;
  to: string;
  type: string;
  reason: string;
  confidence?: number;
  probability?: number;
  requires?: Record<string, number>;
}

interface WorldSecret {
  npcId: string;
  eventType: string;
  subject?: string | null;
  object?: string | null;
  confidence?: number;
  source?: string;
}

interface WorldLocation {
  name: string;
  description: string;
  connections: string[];
}

async function getWorldData(): Promise<{
  npcs: WorldNpc[];
  relationships: WorldRelationship[];
  motives: WorldMotive[];
  secrets: WorldSecret[];
  locations: WorldLocation[];
}> {
  // NPCs
  const npcs: WorldNpc[] = [];
  try {
    const npcDir = join(WORLD_DIR, "npcs");
    const npcFiles = await readdir(npcDir);
    for (const file of npcFiles.filter(f => f.endsWith('.json')).sort()) {
      const data = await safeReadJSON<any>(join(npcDir, file));
      if (!data) continue;
      npcs.push({
        id: data.id ?? file.replace('.json', ''),
        name: data.name ?? data.id ?? file.replace('.json', ''),
        role: data.role ?? 'unknown',
        bigFive: data.personality ? {
          O: data.personality.O ?? 0,
          C: data.personality.C ?? 0,
          E: data.personality.E ?? 0,
          A: data.personality.A ?? 0,
          N: data.personality.N ?? 0,
          H: data.personality.H ?? 0,
        } : null,
        enneagram: data.enneagram ? {
          type: data.enneagram.type,
          wing: data.enneagram.wing,
          coreFear: data.enneagram.coreFear ?? '',
          coreDesire: data.enneagram.coreDesire ?? '',
        } : null,
        background: data.background ?? null,
      });
    }
  } catch {}

  // Relationships
  const relationships = await safeReadJSON<WorldRelationship[]>(join(WORLD_DIR, "relationships.json")) ?? [];

  // Motives
  const motives = await safeReadJSON<WorldMotive[]>(join(WORLD_DIR, "motives.json")) ?? [];

  // Secrets
  const secrets = await safeReadJSON<WorldSecret[]>(join(WORLD_DIR, "secrets.json")) ?? [];

  // Locations from world.json
  const locations: WorldLocation[] = [];
  const worldData = await safeReadJSON<any>(join(WORLD_DIR, "world.json"));
  if (worldData?.locations) {
    for (const loc of worldData.locations) {
      locations.push({
        name: loc.name,
        description: loc.description ?? '',
        connections: loc.connections ?? [],
      });
    }
  }

  return { npcs, relationships, motives, secrets, locations };
}

// ─── Dashboard: Health ───

interface HealthData {
  version: string | null;
  lastCommit: { hash: string; message: string; date: string } | null;
  testCount: number;
  invariantCount: number;
  registryCount: number;
  affordanceCount: number;
  auditFindings: { confirmed: number; hypothesis: number; design: number; needsData: number };
}

async function getHealth(): Promise<HealthData> {
  // Version: parse first vX.Y.Z from CLAUDE.md
  let version: string | null = null;
  const claudeContent = await safeReadFile(CLAUDE_MD);
  if (claudeContent) {
    const versionMatch = claudeContent.match(/v\d+\.\d+\.\d+/);
    if (versionMatch) version = versionMatch[0];
  }

  // Last commit via git
  let lastCommit: HealthData['lastCommit'] = null;
  const gitLog = safeExec('git log -1 --format=%H:::%s:::%ci');
  if (gitLog) {
    const clean = gitLog.replace(/^"|"$/g, '');
    const parts = clean.split(':::');
    if (parts.length >= 3) {
      lastCommit = {
        hash: parts[0],
        message: parts[1],
        date: parts.slice(2).join(':::'),
      };
    }
  }

  // Test count: count test() and it() calls across test files
  let testCount = 0;
  try {
    const testFiles = await readdir(TESTS_DIR);
    for (const file of testFiles.filter(f => f.endsWith('.test.ts'))) {
      const content = await safeReadFile(join(TESTS_DIR, file));
      if (!content) continue;
      const matches = content.match(/(?:^|\s)(?:test|it)\s*\(/gm);
      if (matches) testCount += matches.length;
    }
  } catch {}

  // Invariant count: INV-NN entries in Serena invariants memory
  let invariantCount = 0;
  const invContent = await safeReadFile(join(SERENA_DIR, 'invariants.md'));
  if (invContent) {
    const matches = invContent.match(/^### INV-\d+:/gm);
    if (matches) invariantCount = matches.length;
  }

  // Registry count: count `export function register` in event-registry.ts
  let registryCount = 0;
  const registryContent = await safeReadFile(join(PROJECT_ROOT, 'packages/engine/src/event-registry.ts'));
  if (registryContent) {
    const matches = registryContent.match(/export function register/g);
    if (matches) registryCount = matches.length;
  }

  // Affordance count: count affordance definitions in module sources
  // Dynamic from registry (modules already registered at startup)
  const affordanceCount = AFFORDANCE_REGISTRY.length;

  // Audit findings: parse summary table rows (| F# | desc | STATUS | ...)
  const auditFindings = { confirmed: 0, hypothesis: 0, design: 0, needsData: 0 };
  const auditContent = await safeReadFile(join(SPECS_DIR, 'AUDIT-npc-systems-v0.13.md'));
  if (auditContent) {
    const lines = auditContent.split('\n');
    for (const line of lines) {
      const tableMatch = line.match(/\|\s*F\d+\s*\|[^|]+\|\s*(CONFIRMED|HYPOTHESIS|DESIGN|NEEDS DATA)\s*\|/);
      if (tableMatch) {
        const status = tableMatch[1];
        if (status === 'CONFIRMED') auditFindings.confirmed++;
        else if (status === 'HYPOTHESIS') auditFindings.hypothesis++;
        else if (status === 'DESIGN') auditFindings.design++;
        else if (status === 'NEEDS DATA') auditFindings.needsData++;
      }
    }
  }

  return { version, lastCommit, testCount, invariantCount, registryCount, affordanceCount, auditFindings };
}

// ─── Dashboard: Roadmap ───

interface RoadmapMilestone {
  id: string;
  name: string;
  status: 'done' | 'in-progress' | 'planned';
  features: string[];
}

async function getRoadmap(): Promise<{ milestones: RoadmapMilestone[] }> {
  const milestones: RoadmapMilestone[] = [];
  const content = await safeReadFile(join(DOCS_DIR, 'ROADMAP.md'));
  if (!content) return { milestones };

  const lines = content.split('\n');

  // Parse milestone table rows: | # | Milestone | Version | Description | Status |
  for (const line of lines) {
    const match = line.match(/\|\s*(\d+(?:\.\d+)?)\s*\|\s*\*?\*?(.+?)\*?\*?\s*\|\s*v[\d.]+(?:\.x)?\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/);
    if (match) {
      const rawId = match[1].trim();
      const rawName = match[2].replace(/\*\*/g, '').trim();
      const description = match[3].trim();
      const rawStatus = match[4].replace(/\*\*/g, '').trim().toLowerCase();

      const id = `M${rawId}`;

      let status: 'done' | 'in-progress' | 'planned';
      if (rawStatus.includes('done') || rawStatus.includes('complete') || rawStatus.includes('feature-complete')) {
        status = 'done';
      } else if (rawStatus.includes('progress') || rawStatus.includes('partial')) {
        status = 'in-progress';
      } else {
        status = 'planned';
      }

      const features = description.split(/[,;]/).map(f => f.trim()).filter(f => f.length > 0);
      milestones.push({ id, name: rawName, status, features });
    }
  }

  // Extract Phase 3/4/5 as high-level planned milestones with subsection headings as features
  const phasePatterns = [
    { pattern: /^## Phase 3: (.+)/i, id: 'P3' },
    { pattern: /^## Phase 4: (.+)/i, id: 'P4' },
    { pattern: /^## Phase 5: (.+)/i, id: 'P5' },
  ];

  for (const { pattern, id } of phasePatterns) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(pattern);
      if (m) {
        const features: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (/^## /.test(lines[j]) && j !== i) break;
          const subMatch = lines[j].match(/^#{3,4}\s+(.+)/);
          if (subMatch) {
            features.push(subMatch[1].replace(/\*\*/g, '').trim());
          }
        }
        milestones.push({ id, name: m[1].trim(), status: 'planned', features });
        break;
      }
    }
  }

  return { milestones };
}

// ─── MIME types ───

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// ─── Server ───

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      // Live dev view — always serve fresh from disk, never let the browser/proxy cache a response
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    };

    // ─── API ───

    // GET /api/tree — document tree
    if (pathname === '/api/tree' && method === 'GET') {
      const tree = await buildDocTree(DOCS_DIR);
      // Add CLAUDE.md as top-level entry
      tree.unshift({ name: 'CLAUDE', path: '__CLAUDE_MD__', type: 'file' });
      // Add Serena memories as virtual section
      try {
        const serenaFiles = (await readdir(SERENA_DIR)).filter(f => f.endsWith('.md')).sort();
        if (serenaFiles.length > 0) {
          const children = serenaFiles.map(f => ({
            name: f.replace('.md', ''),
            path: `__SERENA__/${f}`,
            type: 'file' as const,
          }));
          tree.push({ name: 'Serena Memories', path: '__SERENA__', type: 'directory', children });
        }
      } catch {}
      return Response.json(tree, { headers: cors });
    }

    // GET /api/doc?path=specs/SPEC-heat-system.md — read file
    if (pathname === '/api/doc' && method === 'GET') {
      const docPath = url.searchParams.get('path');
      if (!docPath) return new Response('Missing path', { status: 400 });

      const fullPath = docPath === '__CLAUDE_MD__'
        ? CLAUDE_MD
        : docPath.startsWith('__SERENA__/')
          ? resolve(SERENA_DIR, docPath.replace('__SERENA__/', ''))
          : resolve(DOCS_DIR, docPath);

      // Security: must be within docs dir, CLAUDE.md, or serena memories dir
      if (docPath !== '__CLAUDE_MD__' && !docPath.startsWith('__SERENA__/') && !fullPath.startsWith(DOCS_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (docPath.startsWith('__SERENA__/') && !fullPath.startsWith(SERENA_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }

      try {
        const content = await Bun.file(fullPath).text();
        const s = await stat(fullPath);
        return Response.json({
          content,
          path: docPath,
          name: basename(fullPath, '.md'),
          modified: s.mtime.toISOString(),
          size: s.size,
        }, { headers: cors });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }

    // PUT /api/doc?path=specs/SPEC-heat-system.md — save edits
    if (pathname === '/api/doc' && method === 'PUT') {
      const docPath = url.searchParams.get('path');
      if (!docPath) return new Response('Missing path', { status: 400 });

      const fullPath = docPath === '__CLAUDE_MD__'
        ? CLAUDE_MD
        : docPath.startsWith('__SERENA__/')
          ? resolve(SERENA_DIR, docPath.replace('__SERENA__/', ''))
          : resolve(DOCS_DIR, docPath);

      if (docPath !== '__CLAUDE_MD__' && !docPath.startsWith('__SERENA__/') && !fullPath.startsWith(DOCS_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (docPath.startsWith('__SERENA__/') && !fullPath.startsWith(SERENA_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }

      // Only allow editing existing files
      try { await stat(fullPath); } catch {
        return new Response('File not found — editing only, no creation', { status: 404 });
      }

      const body = await req.json() as { content: string };
      if (!body.content && body.content !== '') {
        return new Response('Missing content', { status: 400 });
      }

      await Bun.write(fullPath, body.content);
      return Response.json({ ok: true, path: docPath }, { headers: cors });
    }

    // GET /api/search?q=keyword — full-text search
    if (pathname === '/api/search' && method === 'GET') {
      const queryRaw = url.searchParams.get('q')?.toLowerCase();
      if (!queryRaw || queryRaw.length < 2) return Response.json([], { headers: cors });
      const query: string = queryRaw; // narrow string for nested closures

      const results: Array<{ path: string; name: string; matches: string[] }> = [];

      async function searchDir(dir: string, basePath: string) {
        let items: string[];
        try { items = await readdir(dir); } catch { return; }
        for (const item of items) {
          if (item.startsWith('.') || item.startsWith('_')) continue;
          const fullPath = join(dir, item);
          const s = await stat(fullPath);
          if (s.isDirectory()) {
            await searchDir(fullPath, basePath ? `${basePath}/${item}` : item);
          } else if (extname(item) === '.md') {
            const content = await Bun.file(fullPath).text();
            const lower = content.toLowerCase();
            if (lower.includes(query)) {
              const lines = content.split('\n');
              const matches = lines
                .filter(l => l.toLowerCase().includes(query))
                .slice(0, 3)
                .map(l => l.trim().substring(0, 120));
              const relPath = basePath ? `${basePath}/${item}` : item;
              results.push({ path: relPath, name: item.replace('.md', ''), matches });
            }
          }
        }
      }

      await searchDir(DOCS_DIR, '');
      // Also search CLAUDE.md
      try {
        const claudeContent = await Bun.file(CLAUDE_MD).text();
        if (claudeContent.toLowerCase().includes(query)) {
          const matches = claudeContent.split('\n')
            .filter(l => l.toLowerCase().includes(query))
            .slice(0, 3)
            .map(l => l.trim().substring(0, 120));
          results.push({ path: '__CLAUDE_MD__', name: 'CLAUDE', matches });
        }
      } catch {}

      // Also search Serena memories
      try {
        const serenaFiles = (await readdir(SERENA_DIR)).filter(f => f.endsWith('.md'));
        for (const file of serenaFiles) {
          const content = await Bun.file(join(SERENA_DIR, file)).text();
          if (content.toLowerCase().includes(query)) {
            const matches = content.split('\n')
              .filter(l => l.toLowerCase().includes(query))
              .slice(0, 3)
              .map(l => l.trim().substring(0, 120));
            results.push({ path: `__SERENA__/${file}`, name: `serena: ${file.replace('.md', '')}`, matches });
          }
        }
      } catch {}

      // Also search source code (packages/**/*.ts) — limited to avoid huge results
      const includeCode = url.searchParams.get('code') !== 'false';
      if (includeCode) {
        async function searchCode(dir: string, basePath: string) {
          let items: string[];
          try { items = await readdir(dir); } catch { return; }
          for (const item of items) {
            if (item.startsWith('.') || item === 'node_modules') continue;
            const fullPath = join(dir, item);
            const s = await stat(fullPath);
            if (s.isDirectory()) {
              await searchCode(fullPath, basePath ? `${basePath}/${item}` : item);
            } else if (extname(item) === '.ts' && !item.endsWith('.d.ts')) {
              try {
                const content = await Bun.file(fullPath).text();
                const lower = content.toLowerCase();
                if (lower.includes(query)) {
                  const lines = content.split('\n');
                  const matches = lines
                    .filter(l => l.toLowerCase().includes(query))
                    .slice(0, 3)
                    .map(l => l.trim().substring(0, 120));
                  const relPath = basePath ? `${basePath}/${item}` : item;
                  results.push({ path: 'code://' + relPath, name: item.replace('.ts', '') + ' (code)', matches });
                }
              } catch {}
            }
          }
        }
        const packagesDir = resolve(PROJECT_ROOT, 'packages');
        await searchCode(packagesDir, 'packages');
      }

      return Response.json(results, { headers: cors });
    }

    // ─── Dashboard API ───

    // GET /api/dashboard/specs — parsed spec/audit metadata with summary
    if (pathname === '/api/dashboard/specs' && method === 'GET') {
      try {
        const data = await getSpecs();
        return Response.json(data, { headers: cors });
      } catch (err) {
        return Response.json(
          { error: String(err), specs: [], summary: { total: 0, implemented: 0, inProgress: 0, deferred: 0, spec: 0 } },
          { status: 500, headers: cors },
        );
      }
    }

    // GET /api/dashboard/world — world data (NPCs, relationships, motives, secrets, locations)
    if (pathname === '/api/dashboard/world' && method === 'GET') {
      try {
        const data = await getWorldData();
        return Response.json(data, { headers: cors });
      } catch (err) {
        return Response.json(
          { error: String(err), npcs: [], relationships: [], motives: [], secrets: [], locations: [] },
          { status: 500, headers: cors },
        );
      }
    }

    // GET /api/dashboard/health — project health metrics
    if (pathname === '/api/dashboard/health' && method === 'GET') {
      try {
        const data = await getHealth();
        return Response.json(data, { headers: cors });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers: cors });
      }
    }

    // GET /api/dashboard/roadmap — parsed roadmap milestones
    if (pathname === '/api/dashboard/roadmap' && method === 'GET') {
      try {
        const data = await getRoadmap();
        return Response.json(data, { headers: cors });
      } catch (err) {
        return Response.json({ error: String(err), milestones: [] }, { status: 500, headers: cors });
      }
    }

    // GET /api/dashboard/affordances — dynamic from engine AFFORDANCE_REGISTRY
    if (pathname === '/api/dashboard/affordances' && method === 'GET') {
      const affordances: Array<Record<string, unknown>> = [];
      for (const def of AFFORDANCE_REGISTRY) {
        const id = def.id;
        const req = def.requires as Record<string, unknown>;
        // Build human-readable threshold from requirements
        const thresholdParts: string[] = [];
        if (req.moodBelow != null) thresholdParts.push(`mood <= ${req.moodBelow}`);
        if (req.sentimentBelow != null) thresholdParts.push(`sentiment < ${req.sentimentBelow}`);
        if (req.beliefConfidence != null) thresholdParts.push(`conf >= ${req.beliefConfidence}`);
        if (req.isInvestigator) thresholdParts.push('isInvestigator');
        if (req.isCriminal) thresholdParts.push('isCriminal');
        if (req.hasCrimeBelief) thresholdParts.push('hasCrimeBelief');
        if (req.hasWitnessBelief) thresholdParts.push('hasWitnessBelief');
        if (req.isWanted) thresholdParts.push('isWanted');
        if (req.hasDetainedNpc) thresholdParts.push('hasDetainedNpc');
        if (req.hasSuspicionBelief) thresholdParts.push('hasSuspicionBelief');
        if (req.notGuard) thresholdParts.push('notGuard');
        if (req.notPerpetrator) thresholdParts.push('notPerpetrator');
        const threshold = thresholdParts.join(', ') || (def.socialOnly ? `E > 0.7` : id);
        const period = req.period ? (Array.isArray(req.period) ? req.period.join('/') : String(req.period)) : null;

        affordances.push({
          id,
          name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          label: def.label,
          category: def.category,
          severity: def.severity,
          threshold,
          period,
          isDuty: def.isDuty ?? false,
          socialOnly: def.socialOnly ?? false,
          suppressNearPlayer: def.suppressNearPlayer ?? false,
          moodWeight: def.moodWeight,
          goalPriority: def.goalPriority,
          resistTraits: def.resistTraits,
          beliefModifiers: def.beliefModifiers,
        });
      }
      affordances.sort((a, b) => (b.severity as number) - (a.severity as number));
      return Response.json({ affordances }, { headers: cors });
    }

    // GET /api/dashboard/cg-rules — CG v2 rules for visualization
    if (pathname === '/api/dashboard/cg-rules' && method === 'GET') {
      const rules = CRIME_CG_RULES.map((r: any) => ({
        id: r.id,
        trigger: r.trigger,
        consequence: r.consequence?.type,
        importance: r.consequence?.importance,
        probability: r.consequence?.probability,
        targetMode: r.targetMode ?? 'affected',
        maxChainDepth: r.maxChainDepth,
        exclusive: r.exclusive ?? null,
        priority: r.priority ?? null,
        conditions: (r.conditions || []).map((c: any) => ({
          op: c.op,
          trait: c.trait,
          value: c.value,
          comparator: c.comparator,
          field: c.field,
        })),
      }));
      return Response.json({ rules }, { headers: cors });
    }

    // GET /api/dashboard/invariants — parsed from Serena memories (invariants + design-decisions)
    if (pathname === '/api/dashboard/invariants' && method === 'GET') {
      const invariants: Array<{ id: string; text: string; type: 'invariant' | 'decision' }> = [];

      // Parse hard invariants: ### INV-NN: Title
      const invContent = await safeReadFile(join(SERENA_DIR, 'invariants.md'));
      if (invContent) {
        const re = /^### (INV-\d+): (.+)$/gm;
        let m;
        while ((m = re.exec(invContent)) !== null) {
          invariants.push({ id: m[1], text: m[2].substring(0, 120), type: 'invariant' });
        }
      }

      // Parse design decisions: ### DD-NN: Title
      const ddContent = await safeReadFile(join(SERENA_DIR, 'design-decisions.md'));
      if (ddContent) {
        const re = /^### (DD-\d+): (.+)$/gm;
        let m;
        while ((m = re.exec(ddContent)) !== null) {
          invariants.push({ id: m[1], text: m[2].substring(0, 120), type: 'decision' });
        }
      }

      return Response.json({ invariants, total: invariants.length }, { headers: cors });
    }

    // GET /api/glossary — 3-tier terminology from existing docs + world data
    if (pathname === '/api/glossary' && method === 'GET') {
      interface GlossaryTerm {
        term: string;
        tier: 1 | 2 | 3;
        description: string;
        doc: string;
        anchor?: string;
      }
      const terms: GlossaryTerm[] = [];

      // Tier 1a: Subsystem abbreviations from ARCHITECTURE.md
      const archContent = await safeReadFile(join(DOCS_DIR, 'ARCHITECTURE.md'));
      if (archContent) {
        const re = /^###\s+(\w+)\s+—\s+(.+?)(?:\s*\(.*\))?$/gm;
        let m;
        while ((m = re.exec(archContent)) !== null) {
          terms.push({
            term: m[1].trim(),
            tier: 1,
            description: m[2].trim(),
            doc: 'ARCHITECTURE.md',
            anchor: m[1].trim().toLowerCase(),
          });
        }
      }

      // Tier 1b: Design principles from CLAUDE.md (### N. Term Name — Description)
      const claudeContent = await safeReadFile(CLAUDE_MD);
      if (claudeContent) {
        const re = /^###\s+\d+\.\s+(.+)$/gm;
        let m;
        while ((m = re.exec(claudeContent)) !== null) {
          const full = m[1].trim();
          // Extract short term: take part before " — " or whole if short enough
          const dashIdx = full.indexOf(' — ');
          const shortTerm = dashIdx > 0 ? full.substring(0, dashIdx).trim() : full;
          const description = dashIdx > 0 ? full.substring(dashIdx + 3).trim() : 'Design principle';
          if (shortTerm.length < 6 || shortTerm.length > 35 || /[=+(),`]/.test(shortTerm)) continue;
          terms.push({
            term: shortTerm,
            tier: 1,
            description,
            doc: '__CLAUDE_MD__',
          });
        }
      }

      // Tier 1d: Engine invariant names from Serena invariants memory (### INV-NN: Term)
      const invGlossaryContent = await safeReadFile(join(SERENA_DIR, 'invariants.md'));
      if (invGlossaryContent) {
        const re = /^### (INV-\d+): (.+)$/gm;
        let m;
        while ((m = re.exec(invGlossaryContent)) !== null) {
          const term = m[2].trim();
          if (term.length < 8 || term.length > 50) continue;
          terms.push({
            term,
            tier: 1,
            description: `Hard invariant ${m[1]}`,
            doc: '__SERENA__/invariants.md',
          });
        }
      }

      // Tier 1c: Key sections from top-level docs (GDD, VISION, ROADMAP)
      const topLevelDocs: Array<{ file: string; minWords: number }> = [
        { file: 'GDD_DETECTIVE.md', minWords: 2 },
        { file: 'VISION.md', minWords: 2 },
        { file: 'ROADMAP.md', minWords: 2 },
      ];
      for (const { file, minWords } of topLevelDocs) {
        const content = await safeReadFile(join(DOCS_DIR, file));
        if (!content) continue;
        const re = /^##\s+(.+)$/gm;
        let m;
        while ((m = re.exec(content)) !== null) {
          const heading = m[1].trim();
          if (heading.split(/\s+/).length < minWords || heading.length > 35) continue;
          // Skip non-Latin headings (too verbose for auto-linking)
          if (/[а-яА-ЯёЁ]/.test(heading)) continue;
          terms.push({
            term: heading,
            tier: 1,
            description: file.replace('.md', ''),
            doc: file,
          });
        }
      }

      // Tier 2: NPC names from world JSON
      try {
        const npcsDir = join(WORLD_DIR, 'npcs');
        const npcFiles = await readdir(npcsDir);
        for (const f of npcFiles) {
          if (!f.endsWith('.json')) continue;
          interface NpcJson {
            name?: string;
            role?: string;
            bigFive?: Record<string, number>;
          }
          const npc = await safeReadJSON<NpcJson>(join(npcsDir, f));
          if (!npc?.name) continue;
          const bf: Record<string, number> = npc.bigFive ?? {};
          // Find dominant trait
          let maxTrait = '', maxVal = 0;
          for (const [k, v] of Object.entries(bf)) {
            if (typeof v === 'number' && v > maxVal) { maxVal = v; maxTrait = k; }
          }
          const traitStr = maxTrait ? ` (${maxTrait.charAt(0).toUpperCase()}=${maxVal.toFixed(1)})` : '';
          const fullName: string = npc.name;
          const desc = `${npc.role ?? 'NPC'}${traitStr}`;
          const docPath = `NPC/${fullName}.md`;
          terms.push({ term: fullName, tier: 2, description: desc, doc: docPath });
          // Also add short name (last word) for multi-word names like "Old Bess" → "Bess"
          const parts = fullName.split(' ');
          if (parts.length > 1) {
            const shortName = parts[parts.length - 1];
            if (shortName.length >= 3) {
              terms.push({ term: shortName, tier: 2, description: desc, doc: docPath });
            }
          }
        }
      } catch {}

      // Tier 3: Spec-defined system names from SPEC-*.md titles
      try {
        const specFiles = (await readdir(SPECS_DIR)).filter(f => f.startsWith('SPEC-') && f.endsWith('.md'));
        for (const file of specFiles) {
          const head = await safeReadFile(join(SPECS_DIR, file));
          if (!head) continue;
          const titleMatch = head.match(/^#\s+(?:SPEC[-\w]*|AUDIT[-\w]*):\s*(.+)/m);
          if (!titleMatch) continue;
          const fullTitle = titleMatch[1].trim();
          let shortTitle = fullTitle.replace(/\s*—.*/, '').replace(/\s*\([^)]*$/, '').trim(); // remove trailing " — desc" and unclosed parens
          // Only link if short title is 2+ words (avoid generic single words)
          if (shortTitle.split(/\s+/).length < 2) continue;
          const statusMatch = head.match(/\*\*Status\*\*:\s*(.+)/);
          const msMatch = head.match(/\*\*Milestone\*\*:\s*(.+)/);
          const desc = (msMatch ? msMatch[1].replace(/\*\*/g, '').trim() : '') +
            (statusMatch ? ' — ' + statusMatch[1].replace(/\*\*/g, '').substring(0, 30) : '');
          terms.push({
            term: shortTitle,
            tier: 3,
            description: desc || fullTitle,
            doc: 'specs/' + file,
          });
        }
      } catch {}

      // Deduplicate: prefer spec (T3) > NPC (T2) > heading (T1) for same term
      const deduped = new Map<string, typeof terms[0]>();
      // Higher tier = more specific, prefer it
      const tierPriority = { 3: 3, 2: 2, 1: 1 } as const;
      for (const t of terms) {
        const key = t.term.toLowerCase();
        const existing = deduped.get(key);
        if (!existing || (tierPriority[t.tier] ?? 0) > (tierPriority[existing.tier] ?? 0)) {
          deduped.set(key, t);
        }
      }
      const unique = Array.from(deduped.values());

      // Sort: longer terms first (prevents "CG" matching inside "CG v2")
      unique.sort((a, b) => b.term.length - a.term.length);

      return Response.json({ terms: unique }, { headers: cors });
    }

    // ─── Static files ───

    let filePath = pathname === '/' ? '/index.html' : pathname;
    const full = join(PUBLIC_DIR, filePath);

    try {
      const file = Bun.file(full);
      if (await file.exists()) {
        const ext = extname(full);
        return new Response(file, {
          headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' },
        });
      }
    } catch {}

    // SPA fallback
    return new Response(Bun.file(join(PUBLIC_DIR, 'index.html')), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
});

console.log(`\n  CLWA Docs Reader`);
console.log(`  http://localhost:${PORT}`);
console.log(`  Docs: ${DOCS_DIR}`);
console.log(`  LAN: http://${getLocalIP()}:${PORT}\n`);

function getLocalIP(): string {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch {}
  return 'localhost';
}
