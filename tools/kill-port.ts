/** Kill any process listening on a given port. Cross-platform (Windows/Linux/Mac). */
const port = process.argv[2];
if (!port) { console.error('Usage: bun tools/kill-port.ts <port>'); process.exit(1); }

import { execSync } from 'child_process';

try {
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' });
    const pids = new Set(out.trim().split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean));
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
    }
  } else {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
  }
} catch {}
