// Live copy of the ink for OBS: the overlay reports every change as an InkEvent, the main thread posts it
// to the HTTP worker (src/remote-worker.ts), which keeps the current state and streams the events over a
// WebSocket to the browser-source page (src/ink-page.ts), which redraws the ink on a transparent canvas.
import type { InkTool } from "./overlay";
import type { MonitorRect, Rect } from "./win32";

export interface InkStroke {
  tool: InkTool;
  /** 0xAARRGGBB */
  color: number;
  width: number;
  /** Flat x,y pairs relative to the top-left of `screen`. */
  points: number[];
}

export interface InkLayout {
  /** The virtual screen the overlay covers, in screen coordinates. */
  screen: Rect;
  monitors: MonitorRect[];
}

export type InkEvent =
  | { t: "layout"; layout: InkLayout }
  | { t: "strokes"; strokes: InkStroke[] }
  | { t: "visible"; on: boolean }
  | { t: "begin"; stroke: InkStroke }
  | { t: "point"; x: number; y: number }
  | { t: "end" };

export interface InkState {
  t: "state";
  layout: InkLayout | null;
  strokes: InkStroke[];
  active: InkStroke | null;
  visible: boolean;
}

export function emptyInkState(): InkState {
  return { t: "state", layout: null, strokes: [], active: null, visible: true };
}

export function applyInk(s: InkState, e: InkEvent) {
  switch (e.t) {
    case "layout":
      s.layout = e.layout;
      break;
    case "strokes":
      s.strokes = e.strokes;
      s.active = null;
      break;
    case "visible":
      s.visible = e.on;
      break;
    case "begin":
      s.active = { ...e.stroke, points: [...e.stroke.points] };
      break;
    case "point":
      s.active?.points.push(e.x, e.y);
      break;
    case "end":
      if (s.active) s.strokes.push(s.active);
      s.active = null;
      break;
  }
}
