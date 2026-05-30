/**
 * World Editor — local server for viewing and editing CLWA world data.
 *
 * - Serves web UI from public/
 * - Reads/writes JSON files in the world directory
 * - Supports any world via --world= argument
 *
 * Usage: bun run tools/world-editor/server.ts [--world=path/to/world]
 * Default: worlds/millhaven
 * Open: http://localhost:3001
 */

import { resolve, join, basename } from "path";
import { readdir } from "fs/promises";
import { getAllRegisteredEventTypes, getEventTypesByCategory, getAllRegisteredSources, BELIEF_SOURCE, getRegisteredRelationshipTypes, getRegisteredLlmTasks, defaultScaffold } from "@clwa/engine";
import { registerCrimeJusticeModule, registerSocialModule } from "@clwa/modules";
import { buildDefaultRouter } from "../../packages/server/src/llm-defaults";

// Populate engine registries so we can serve valid options to the editor UI
registerSocialModule();
registerCrimeJusticeModule();

// ─── Configuration ───

const worldArg = process.argv.find(a => a.startsWith('--world='))?.split('=')[1];
const WORLD_DIR = resolve(
  worldArg ?? join(import.meta.dir, "../../worlds/millhaven")
);
const WORLD_NAME = basename(WORLD_DIR);
const PUBLIC_DIR = resolve(import.meta.dir, "public");
const PORT = 3001;

// ─── Helpers ───

async function readJSON(path: string) {
  const file = Bun.file(path);
  return file.json();
}

async function writeJSON(path: string, data: unknown) {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

const sortUniq = (xs: (string | undefined | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();

/** LLM routing options for the editor — tasks/providers from the registry + default router; models grouped
 *  PER PROVIDER (lm-studio models ≠ claude-code models). lm-studio queried live; claude-code = Anthropic
 *  aliases ∪ what the default router uses. No hardcoded master list — provider-scoped, registry/data-driven. */
async function buildLlmRegistry() {
  const def = buildDefaultRouter();
  const defRoutes = def.routes as Record<string, { provider?: string; model?: string }>;
  const routeVals = [def.default, ...Object.values(defRoutes)] as Array<{ provider?: string; model?: string }>;
  const llmProviders = sortUniq(routeVals.map(r => r.provider));
  const regTasks = getRegisteredLlmTasks();
  const llmTasks = sortUniq([...regTasks.map(t => t.name), ...Object.keys(defRoutes)]);
  // Which tasks are structured (need JSON) — drives the editor's Schema-toggle enable state.
  const structuredTasks = sortUniq(regTasks.filter(t => t.requirements?.requiresStructuredOutput).map(t => t.name));

  const modelsByProvider: Record<string, string[]> = {};
  for (const r of routeVals) if (r.provider && r.model) (modelsByProvider[r.provider] ??= []).push(r.model);
  // claude-code: the provider's known model menu (Claude aliases) ∪ default-router usage.
  if (llmProviders.includes('claude-code')) modelsByProvider['claude-code'] = [...(modelsByProvider['claude-code'] ?? []), 'haiku', 'sonnet'];
  // lm-studio: query the live LM Studio model list (best-effort; falls back to default-router models if down).
  if (llmProviders.includes('lm-studio')) {
    try {
      const url = (process.env.LMSTUDIO_URL ?? 'http://localhost:1234') + '/v1/models';
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const body = await res.json() as { data?: Array<{ id?: string }> };
        for (const m of body.data ?? []) if (m.id) (modelsByProvider['lm-studio'] ??= []).push(m.id);
      }
    } catch { /* LM Studio down — keep default-router models */ }
  }
  for (const p of Object.keys(modelsByProvider)) modelsByProvider[p] = sortUniq(modelsByProvider[p]);

  return { llmTasks, structuredTasks, llmProviders, modelsByProvider, llmDefaultRouter: def };
}

// ─── API handlers ───

async function handleAPI(req: Request, pathname: string): Promise<Response> {
  const method = req.method;
  const cors = { 'Access-Control-Allow-Origin': '*' };

  // GET /api/meta — world metadata for UI
  if (pathname === "/api/meta" && method === "GET") {
    return Response.json({ worldName: WORLD_NAME, worldDir: WORLD_DIR }, { headers: cors });
  }

  // GET /api/registry — registered engine types for typed dropdowns
  if (pathname === "/api/registry" && method === "GET") {
    const npcsDir = join(WORLD_DIR, "npcs");
    const files = await readdir(npcsDir);
    const npcIds = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
    // Collect relationship types from world data
    const rels = await readJSON(join(WORLD_DIR, "relationships.json")) as Array<{ type?: string }>;
    const relTypes = [...new Set(rels.map(r => r.type).filter(Boolean))].sort();
    // Collect open-key option sets from NPC data (factions/capabilities/item kinds are open strings with
    // no engine registry by design — the "registry" for them is what the world actually uses; the UI adds
    // a free-text "+ new" so authors aren't locked to the current set). Roles + rel types likewise.
    const npcData = await Promise.all(
      files.filter(f => f.endsWith(".json")).map(f => readJSON(join(npcsDir, f)))
    ) as Array<{ role?: string; factions?: string[]; capabilities?: Record<string, boolean>;
                 shop?: Array<{ id?: string }>; inventory?: Array<{ kind?: string }> }>;
    const uniqSort = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
    const roles = uniqSort(npcData.map(n => n.role));
    const factions = uniqSort(npcData.flatMap(n => n.factions ?? []));
    const capabilities = uniqSort(npcData.flatMap(n => Object.keys(n.capabilities ?? {})));
    const itemKinds = uniqSort([
      ...npcData.flatMap(n => (n.shop ?? []).map(s => s.id)),
      ...npcData.flatMap(n => (n.inventory ?? []).map(it => it.kind)),
    ]);
    return Response.json({
      eventTypes: getAllRegisteredEventTypes(),
      motiveTypes: getEventTypesByCategory('motive'),
      sources: [...getAllRegisteredSources(), ...Object.values(BELIEF_SOURCE)].filter((v, i, a) => a.indexOf(v) === i),
      npcIds,
      // Relationship types from the engine registry (universal seeds + module-added) ∪ what the world uses.
      relationshipTypes: uniqSort([...getRegisteredRelationshipTypes(), ...relTypes]),
      roles,
      factions,       // B3 — open keys, union from world data
      capabilities,   // open keys, union from world data
      itemKinds,      // B2 — open keys (shop ids + inventory kinds)
      // L1 guardrail scaffold defaults (en/ru) so the editor can offer the engine baseline as a starting
      // point for a per-world WorldConfig.scaffold override (empty override = engine default at runtime).
      scaffoldDefaults: { en: defaultScaffold('en'), ru: defaultScaffold('ru') },
      // LLM routing: tasks from the engine registry ∪ default router; providers from the default router;
      // models PER PROVIDER (claude-code = known aliases, lm-studio = live /v1/models). See buildLlmRegistry.
      ...(await buildLlmRegistry()),
    }, { headers: cors });
  }

  // --- NPCs ---
  if (pathname === "/api/npcs" && method === "GET") {
    const npcsDir = join(WORLD_DIR, "npcs");
    const files = await readdir(npcsDir);
    const npcs = await Promise.all(
      files.filter(f => f.endsWith(".json")).map(f => readJSON(join(npcsDir, f)))
    );
    return Response.json(npcs, { headers: cors });
  }

  const npcMatch = pathname.match(/^\/api\/npcs\/([a-z_-]+)$/);
  if (npcMatch) {
    const id = npcMatch[1];
    const filePath = join(WORLD_DIR, "npcs", `${id}.json`);
    if (method === "GET") {
      return Response.json(await readJSON(filePath), { headers: cors });
    }
    if (method === "PUT") {
      const body = await req.json();
      await writeJSON(filePath, body);
      console.log(`  [Save] NPC ${id} updated`);
      return Response.json({ ok: true }, { headers: cors });
    }
  }

  // --- World (locations, lore, config) ---
  if (pathname === "/api/world" && method === "GET") {
    return Response.json(await readJSON(join(WORLD_DIR, "world.json")), { headers: cors });
  }
  if (pathname === "/api/world" && method === "PUT") {
    const body = await req.json();
    await writeJSON(join(WORLD_DIR, "world.json"), body);
    console.log(`  [Save] world.json updated`);
    return Response.json({ ok: true }, { headers: cors });
  }

  // --- Relationships ---
  if (pathname === "/api/relationships" && method === "GET") {
    return Response.json(await readJSON(join(WORLD_DIR, "relationships.json")), { headers: cors });
  }
  if (pathname === "/api/relationships" && method === "PUT") {
    const body = await req.json();
    await writeJSON(join(WORLD_DIR, "relationships.json"), body);
    console.log(`  [Save] relationships.json updated`);
    return Response.json({ ok: true }, { headers: cors });
  }

  // --- Motives ---
  if (pathname === "/api/motives" && method === "GET") {
    return Response.json(await readJSON(join(WORLD_DIR, "motives.json")), { headers: cors });
  }
  if (pathname === "/api/motives" && method === "PUT") {
    const body = await req.json();
    await writeJSON(join(WORLD_DIR, "motives.json"), body);
    console.log(`  [Save] motives.json updated`);
    return Response.json({ ok: true }, { headers: cors });
  }

  // --- Secrets ---
  if (pathname === "/api/secrets" && method === "GET") {
    return Response.json(await readJSON(join(WORLD_DIR, "secrets.json")), { headers: cors });
  }
  if (pathname === "/api/secrets" && method === "PUT") {
    const body = await req.json();
    await writeJSON(join(WORLD_DIR, "secrets.json"), body);
    console.log(`  [Save] secrets.json updated`);
    return Response.json({ ok: true }, { headers: cors });
  }

  // --- Topics ---
  if (pathname === "/api/topics" && method === "GET") {
    return Response.json(await readJSON(join(WORLD_DIR, "topics.json")), { headers: cors });
  }
  if (pathname === "/api/topics" && method === "PUT") {
    const body = await req.json();
    await writeJSON(join(WORLD_DIR, "topics.json"), body);
    console.log(`  [Save] topics.json updated`);
    return Response.json({ ok: true }, { headers: cors });
  }

  return new Response("Not found", { status: 404 });
}

// ─── Server ───

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      try {
        return await handleAPI(req, pathname);
      } catch (err) {
        console.error("API error:", err);
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Static files from public/
    const filePath = pathname === "/" ? "/index.html" : pathname;
    const fullPath = resolve(PUBLIC_DIR, "." + filePath);
    const file = Bun.file(fullPath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  World Editor: http://localhost:${PORT}`);
console.log(`  World: ${WORLD_NAME} (${WORLD_DIR})\n`);
