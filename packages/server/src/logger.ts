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

  // Prepend [HH:MM:SS] to the stdout copy too — the file already gets it via writeToFile.
  // Blank separator lines (boot-banner spacing) stay clean.
  function stamp(args: unknown[]): unknown[] {
    if (args.length === 0) return args;
    if (args.length === 1 && (args[0] === '' || args[0] === undefined)) return args;
    const ts = `[${formatTime()}]`;
    return typeof args[0] === 'string' ? [`${ts} ${args[0]}`, ...args.slice(1)] : [ts, ...args];
  }

  console.log = (...args: unknown[]) => {
    origLog(...stamp(args));
    writeToFile('', args);
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...stamp(args));
    writeToFile(' WARN', args);
  };

  console.error = (...args: unknown[]) => {
    origError(...stamp(args));
    writeToFile(' ERROR', args);
  };

  return logFile;
}

function getLogFilePath(): string | null {
  return logFile;
}
