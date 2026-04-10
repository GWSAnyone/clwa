/**
 * World Editor — локальный сервер для просмотра и редактирования данных мира CLWA.
 *
 * Что делает:
 * - Раздаёт веб-страницу (файлы из папки public/)
 * - Читает JSON-файлы мира из worlds/millhaven/
 * - Принимает изменения и записывает обратно в те же файлы
 *
 * Запуск: bun run tools/world-editor/server.ts
 * Открыть: http://localhost:3001
 */

import { resolve, join } from "path";
import { readdir } from "fs/promises";

// Путь к папке с данными мира
const WORLD_DIR = resolve(import.meta.dir, "../../worlds/millhaven");
// Путь к папке с веб-файлами (HTML, JS, CSS)
const PUBLIC_DIR = resolve(import.meta.dir, "public");

const PORT = 3001;

// --- Вспомогательные функции ---

/** Прочитать JSON-файл и вернуть его содержимое */
async function readJSON(path: string) {
  const file = Bun.file(path);
  return file.json();
}

/** Записать данные в JSON-файл (красиво отформатированно, с отступами) */
async function writeJSON(path: string, data: unknown) {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

/** Прочитать тело запроса как JSON */
async function parseBody(req: Request) {
  return req.json();
}

// --- Обработчики API ---

/** GET /api/npcs — список всех персонажей */
async function getAllNpcs() {
  const npcsDir = join(WORLD_DIR, "npcs");
  const files = await readdir(npcsDir);
  const npcs = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJSON(join(npcsDir, f)))
  );
  return npcs;
}

/** Обработать запрос к API */
async function handleAPI(req: Request, pathname: string): Promise<Response> {
  const method = req.method;

  // --- NPCs ---
  if (pathname === "/api/npcs" && method === "GET") {
    const npcs = await getAllNpcs();
    return Response.json(npcs);
  }

  const npcMatch = pathname.match(/^\/api\/npcs\/([a-z]+)$/);
  if (npcMatch) {
    const id = npcMatch[1];
    const filePath = join(WORLD_DIR, "npcs", `${id}.json`);
    if (method === "GET") {
      const data = await readJSON(filePath);
      return Response.json(data);
    }
    if (method === "PUT") {
      const body = await parseBody(req);
      await writeJSON(filePath, body);
      return Response.json({ ok: true });
    }
  }

  // --- World (locations, lore, config) ---
  if (pathname === "/api/world" && method === "GET") {
    const data = await readJSON(join(WORLD_DIR, "world.json"));
    return Response.json(data);
  }
  if (pathname === "/api/world" && method === "PUT") {
    const body = await parseBody(req);
    await writeJSON(join(WORLD_DIR, "world.json"), body);
    return Response.json({ ok: true });
  }

  // --- Relationships ---
  if (pathname === "/api/relationships" && method === "GET") {
    const data = await readJSON(join(WORLD_DIR, "relationships.json"));
    return Response.json(data);
  }
  if (pathname === "/api/relationships" && method === "PUT") {
    const body = await parseBody(req);
    await writeJSON(join(WORLD_DIR, "relationships.json"), body);
    return Response.json({ ok: true });
  }

  // --- Motives ---
  if (pathname === "/api/motives" && method === "GET") {
    const data = await readJSON(join(WORLD_DIR, "motives.json"));
    return Response.json(data);
  }
  if (pathname === "/api/motives" && method === "PUT") {
    const body = await parseBody(req);
    await writeJSON(join(WORLD_DIR, "motives.json"), body);
    return Response.json({ ok: true });
  }

  // --- Secrets ---
  if (pathname === "/api/secrets" && method === "GET") {
    const data = await readJSON(join(WORLD_DIR, "secrets.json"));
    return Response.json(data);
  }
  if (pathname === "/api/secrets" && method === "PUT") {
    const body = await parseBody(req);
    await writeJSON(join(WORLD_DIR, "secrets.json"), body);
    return Response.json({ ok: true });
  }

  // --- Topics ---
  if (pathname === "/api/topics" && method === "GET") {
    const data = await readJSON(join(WORLD_DIR, "topics.json"));
    return Response.json(data);
  }
  if (pathname === "/api/topics" && method === "PUT") {
    const body = await parseBody(req);
    await writeJSON(join(WORLD_DIR, "topics.json"), body);
    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}

// --- Главный сервер ---

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0", // слушаем на всех интерфейсах (доступ по VPN)

  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // API-запросы → обработчик API
    if (pathname.startsWith("/api/")) {
      try {
        return await handleAPI(req, pathname);
      } catch (err) {
        console.error("API error:", err);
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Всё остальное → отдаём файлы из папки public/
    // Если запрашивается "/" — отдаём index.html
    const filePath = pathname === "/" ? "/index.html" : pathname;
    const fullPath = resolve(PUBLIC_DIR, "." + filePath);

    const file = Bun.file(fullPath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  World Editor запущен: http://localhost:${PORT}\n`);
