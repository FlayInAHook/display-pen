// Runs in a worker thread: the main thread sits in GetMessageW, so it can't serve HTTP itself.
// Each request becomes a WM_REMOTE sent to the main window, which answers with the new state.
//
//   GET  /status
//   POST /tool/{cursor|pen|highlighter|eraser}   /draw (toggle)   /color/{0-7}   /size/{0-2}
//   POST /undo   /clear   /toolbar/{show|hide|toggle}   /drawings/{show|hide|toggle}
import { workerData } from "node:worker_threads";
import { COLORS, SIZE_NAMES } from "./palette";
import { REMOTE_PORT, RemoteCommand, TOOLS, unpackStatus, Visibility, WM_REMOTE } from "./remote";
import { logError } from "./settings";
import { user32 } from "./win32";

const SMTO_ABORTIFHUNG = 0x0002;
const SEND_TIMEOUT_MS = 2000;

const mainWindow: number = workerData.hwnd;
const result = new BigUint64Array(1);

function send(command: number, arg = 0) {
  result[0] = 0n;
  if (!user32.SendMessageTimeoutW(mainWindow, WM_REMOTE, command, arg, SMTO_ABORTIFHUNG, SEND_TIMEOUT_MS, result)) {
    return null;
  }
  return unpackStatus(Number(result[0]));
}

function index(value: string | undefined, length: number) {
  const n = Number(value);
  return value !== "" && Number.isInteger(n) && n >= 0 && n < length ? n : -1;
}

/** Maps a POST path to [command, argument], or null if it isn't one. */
function route(parts: string[]): [number, number] | null {
  const [name, arg] = parts;
  const visibility = Visibility[arg as keyof typeof Visibility] ?? -1;
  switch (parts.length === 1 ? name : `${name}/`) {
    case "draw":
      return [RemoteCommand.toggleDraw, 0];
    case "undo":
      return [RemoteCommand.undo, 0];
    case "clear":
      return [RemoteCommand.clear, 0];
    case "tool/": {
      const i = TOOLS.indexOf(arg as never);
      return i < 0 ? null : [RemoteCommand.tool, i];
    }
    case "color/": {
      const i = index(arg, COLORS.length);
      return i < 0 ? null : [RemoteCommand.color, i];
    }
    case "size/": {
      const i = index(arg, SIZE_NAMES.length);
      return i < 0 ? null : [RemoteCommand.size, i];
    }
    case "toolbar/":
      return visibility < 0 ? null : [RemoteCommand.toolbar, visibility];
    case "drawings/":
      return visibility < 0 ? null : [RemoteCommand.drawings, visibility];
  }
  return null;
}

function handle(req: Request): Response {
  // Browsers always send Origin on cross-site requests; refusing them keeps web pages from drawing on you.
  if (req.headers.has("origin")) return new Response("Forbidden", { status: 403 });
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  let command: [number, number] | null;
  if (req.method === "GET" && parts.length === 1 && parts[0] === "status") command = [RemoteCommand.status, 0];
  else if (req.method === "POST") command = route(parts);
  else return new Response("Method not allowed", { status: 405 });
  if (!command) return new Response("Not found", { status: 404 });
  const status = send(...command);
  if (!status) return new Response("Display Pen is not responding", { status: 503 });
  return Response.json(status);
}

try {
  Bun.serve({ hostname: "127.0.0.1", port: REMOTE_PORT, fetch: handle });
} catch (e) {
  logError(`Stream Deck control API could not listen on port ${REMOTE_PORT}: ${e instanceof Error ? e.message : e}`);
}
