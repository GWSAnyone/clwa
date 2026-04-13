/**
 * Docs Reader — local server for browsing and editing CLWA documentation.
 *
 * - Serves web UI from public/
 * - Reads markdown files from docs/ directory
 * - Supports editing (save) but not creating new files
 * - Mobile-friendly for LAN reading from phone
 *
 * Usage: bun run tools/docs-reader/server.ts
 * Open: http://localhost:3002
 */

import { resolve, join, relative, extname, basename, dirname } from "path";
import { readdir, stat } from "fs/promises";

// ─── Configuration ───

const DOCS_DIR = resolve(import.meta.dir, "../../docs");
const CLAUDE_MD = resolve(import.meta.dir, "../../CLAUDE.md");
const PUBLIC_DIR = resolve(import.meta.dir, "public");
const PORT = 3002;

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

  // Sort: directories first, then files. Alphabetical within each group.
  const dirs: string[] = [];
  const files: string[] = [];
  for (const item of items) {
    if (item.startsWith('.') || item.startsWith('_')) continue;
    const fullPath = join(dir, item);
    const s = await stat(fullPath);
    if (s.isDirectory()) dirs.push(item);
    else if (extname(item) === '.md') files.push(item);
  }
  dirs.sort();
  files.sort();

  for (const d of dirs) {
    const relPath = basePath ? `${basePath}/${d}` : d;
    const children = await buildDocTree(join(dir, d), relPath);
    if (children.length > 0) {
      entries.push({ name: d, path: relPath, type: 'directory', children });
    }
  }
  for (const f of files) {
    const relPath = basePath ? `${basePath}/${f}` : f;
    entries.push({ name: f.replace('.md', ''), path: relPath, type: 'file' });
  }
  return entries;
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
    const cors = { 'Access-Control-Allow-Origin': '*' };

    // ─── API ───

    // GET /api/tree — document tree
    if (pathname === '/api/tree' && method === 'GET') {
      const tree = await buildDocTree(DOCS_DIR);
      // Add CLAUDE.md as top-level entry
      tree.unshift({ name: 'CLAUDE', path: '__CLAUDE_MD__', type: 'file' });
      return Response.json(tree, { headers: cors });
    }

    // GET /api/doc?path=specs/SPEC-heat-system.md — read file
    if (pathname === '/api/doc' && method === 'GET') {
      const docPath = url.searchParams.get('path');
      if (!docPath) return new Response('Missing path', { status: 400 });

      const fullPath = docPath === '__CLAUDE_MD__'
        ? CLAUDE_MD
        : resolve(DOCS_DIR, docPath);

      // Security: must be within docs dir or be CLAUDE.md
      if (docPath !== '__CLAUDE_MD__' && !fullPath.startsWith(DOCS_DIR)) {
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
        : resolve(DOCS_DIR, docPath);

      if (docPath !== '__CLAUDE_MD__' && !fullPath.startsWith(DOCS_DIR)) {
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
      const query = url.searchParams.get('q')?.toLowerCase();
      if (!query || query.length < 2) return Response.json([], { headers: cors });

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

      return Response.json(results, { headers: cors });
    }

    // ─── Static files ───

    let filePath = pathname === '/' ? '/index.html' : pathname;
    const full = join(PUBLIC_DIR, filePath);

    try {
      const file = Bun.file(full);
      if (await file.exists()) {
        const ext = extname(full);
        return new Response(file, {
          headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
        });
      }
    } catch {}

    // SPA fallback
    return new Response(Bun.file(join(PUBLIC_DIR, 'index.html')), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
