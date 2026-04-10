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
import { getAllRegisteredEventTypes, getEventTypesByCategory, getAllRegisteredSources, BELIEF_SOURCE } from "@clwa/engine";
import { registerCrimeJusticeModule, registerSocialModule } from "@clwa/modules";

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
    return Response.json({
      eventTypes: getAllRegisteredEventTypes(),
      motiveTypes: getEventTypesByCategory('motive'),
      sources: [...getAllRegisteredSources(), ...Object.values(BELIEF_SOURCE)].filter((v, i, a) => a.indexOf(v) === i),
      npcIds,
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
