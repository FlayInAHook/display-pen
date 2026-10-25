// Settings live next to the executable so the app stays portable.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface Settings {
  toolbar?: { x: number; y: number };
  color?: number;
  size?: number;
}

/** True under `bun run src/main.ts`, false in the compiled exe. */
export const runningFromSource = basename(process.execPath).toLowerCase().startsWith("bun");
const dataDir = runningFromSource ? process.cwd() : dirname(process.execPath);
const settingsFile = join(dataDir, "display-pen.json");
const logFile = join(dataDir, "display-pen.log");

export function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings) {
  try {
    writeFileSync(settingsFile, JSON.stringify(s, null, 2));
  } catch (e) {
    logError(e);
  }
}

export function logError(e: unknown) {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(text);
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] ${text}\n`);
  } catch {
    // Nowhere left to report it.
  }
}
