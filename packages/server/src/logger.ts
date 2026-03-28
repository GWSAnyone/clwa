import { mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';

const LOGS_DIR = join(dirname(dirname(dirname(dirname(import.meta.dir)))), 'logs');

function pad(n: number): string { return n.toString().padStart(2, '0'); }

function getTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function formatTime(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let logFile: string | null = null;

export function initFileLogger(): string {
  mkdirSync(LOGS_DIR, { recursive: true });
  logFile = join(LOGS_DIR, `clwa-${getTimestamp()}.log`);

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  function writeToFile(prefix: string, args: unknown[]) {
    if (!logFile) return;
    const text = args.map(a =>
      typeof a === 'string' ? a : JSON.stringify(a, null, 2)
    ).join(' ');
    try {
      appendFileSync(logFile, `[${formatTime()}]${prefix} ${text}\n`);
    } catch { /* ignore write errors */ }
  }

  console.log = (...args: unknown[]) => {
    origLog(...args);
    writeToFile('', args);
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    writeToFile(' WARN', args);
  };

  console.error = (...args: unknown[]) => {
    origError(...args);
    writeToFile(' ERROR', args);
  };

  return logFile;
}

export function getLogFilePath(): string | null {
  return logFile;
}
