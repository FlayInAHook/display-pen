// Remote control protocol between the HTTP worker (src/remote-worker.ts) and the app's main window.
// The worker sends WM_REMOTE (command in wParam, argument in lParam) and gets the new state back as the
// LRESULT, packed into bits, so no memory is shared between the two threads.
import type { Tool } from "./toolbar";
import { WM_APP } from "./win32";

/** Local port of the control API used by the Stream Deck plugin. */
export const REMOTE_PORT = 8766;
export const WM_REMOTE = WM_APP + 3;

export const RemoteCommand = {
  status: 0,
  tool: 1,
  toggleDraw: 2,
  color: 3,
  size: 4,
  undo: 5,
  clear: 6,
  toolbar: 7,
  drawings: 8,
} as const;

/** lParam of the toolbar and drawings commands. */
export const Visibility = { hide: 0, show: 1, toggle: 2 } as const;

export const TOOLS: readonly Tool[] = ["cursor", "pen", "highlighter", "eraser"];

export interface RemoteStatus {
  tool: Tool;
  /** The ink tool that drawing mode switches back to. */
  inkTool: Tool;
  color: number;
  size: number;
  toolbar: boolean;
  drawings: boolean;
  canUndo: boolean;
}

/** Set in every packed status, so a failed SendMessage (0) is never mistaken for one. */
const VALID = 1 << 15;

export function packStatus(s: RemoteStatus): number {
  return (
    VALID |
    TOOLS.indexOf(s.tool) |
    (TOOLS.indexOf(s.inkTool) << 2) |
    (s.color << 4) |
    (s.size << 8) |
    (+s.toolbar << 10) |
    (+s.drawings << 11) |
    (+s.canUndo << 12)
  );
}

export function unpackStatus(v: number): RemoteStatus | null {
  if (!(v & VALID)) return null;
  return {
    tool: TOOLS[v & 3]!,
    inkTool: TOOLS[(v >> 2) & 3]!,
    color: (v >> 4) & 15,
    size: (v >> 8) & 3,
    toolbar: !!(v & (1 << 10)),
    drawings: !!(v & (1 << 11)),
    canUndo: !!(v & (1 << 12)),
  };
}
