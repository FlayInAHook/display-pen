// Full-screen layered window that holds the ink. Click-through in normal mode,
// captures the mouse while one of the drawing tools is active.
import type { Pointer } from "bun:ffi";
import { createPen, LayeredPresenter, Surface, type Box } from "./gfx";
import { createWindow } from "./window";
import {
  CompositingModeSourceCopy,
  CompositingModeSourceOver,
  gdip,
  GWL_EXSTYLE,
  gpOut,
  highSigned,
  key,
  lowSigned,
  MA_NOACTIVATE,
  setTopmost,
  SmoothingModeAntiAlias,
  SmoothingModeNone,
  SW_HIDE,
  SW_SHOWNOACTIVATE,
  SWP_NOACTIVATE,
  SWP_NOZORDER,
  user32,
  virtualScreen,
  WM_CAPTURECHANGED,
  WM_LBUTTONDOWN,
  WM_LBUTTONUP,
  WM_MOUSEACTIVATE,
  WM_MOUSEMOVE,
  WM_RBUTTONDOWN,
  WM_RBUTTONUP,
  WM_SETCURSOR,
  WS_EX_LAYERED,
  WS_EX_NOACTIVATE,
  WS_EX_TOOLWINDOW,
  WS_EX_TOPMOST,
  WS_EX_TRANSPARENT,
  WS_POPUP,
  wstr,
  type Handle,
} from "./win32";

export const OVERLAY_CLASS = "DisplayPenOverlay";

export type InkTool = "pen" | "highlighter" | "eraser";

export interface InkStyle {
  tool: InkTool;
  /** 0xAARRGGBB; ignored by the eraser. */
  color: number;
  width: number;
}

interface Stroke extends InkStyle {
  /** Flat x,y pairs in overlay coordinates. */
  points: number[];
}

/**
 * Empty overlay pixels. Alpha 1 is invisible, but unlike alpha 0 it still
 * receives mouse input, so the whole screen can be drawn on.
 */
const BACKGROUND = 0x01000000;
const HIGHLIGHTER_ALPHA = 0x70;

// Pen tablets: no press-and-hold right click, tap feedback or flicks while inking.
const TABLET_PEN_FLAGS = 0x00000001 | 0x00000008 | 0x00000010 | 0x00010000;

function inkColor(s: InkStyle) {
  if (s.tool === "eraser") return BACKGROUND;
  if (s.tool === "highlighter") return ((HIGHLIGHTER_ALPHA << 24) | (s.color & 0xffffff)) >>> 0;
  return s.color >>> 0;
}

/** Ink objects for one stroke; the eraser overwrites pixels instead of blending. */
class InkPainter {
  private readonly pen: Pointer;
  private readonly brush: Pointer;

  constructor(
    private readonly g: Pointer,
    private readonly stroke: Stroke,
  ) {
    const color = inkColor(stroke);
    this.pen = createPen(color, stroke.width);
    this.brush = gpOut("GdipCreateSolidFill", (o) => gdip.GdipCreateSolidFill(color, o));
  }

  private withMode(fn: () => void) {
    const erasing = this.stroke.tool === "eraser";
    if (erasing) {
      gdip.GdipSetCompositingMode(this.g, CompositingModeSourceCopy);
      gdip.GdipSetSmoothingMode(this.g, SmoothingModeNone);
    }
    fn();
    if (erasing) {
      gdip.GdipSetCompositingMode(this.g, CompositingModeSourceOver);
      gdip.GdipSetSmoothingMode(this.g, SmoothingModeAntiAlias);
    }
  }

  /** Paints the whole stroke. */
  all() {
    const p = this.stroke.points;
    this.withMode(() => {
      if (p.length === 2) {
        const w = this.stroke.width;
        gdip.GdipFillEllipse(this.g, this.brush, p[0] - w / 2, p[1] - w / 2, w, w);
      } else {
        gdip.GdipDrawLines(this.g, this.pen, new Float32Array(p), p.length / 2);
      }
    });
  }

  /** Paints only the segment ending at the last point. */
  last() {
    const p = this.stroke.points;
    const n = p.length;
    this.withMode(() => gdip.GdipDrawLine(this.g, this.pen, p[n - 4], p[n - 3], p[n - 2], p[n - 1]));
  }

  dispose() {
    gdip.GdipDeletePen(this.pen);
    gdip.GdipDeleteBrush(this.brush);
  }
}

function pointBox(x: number, y: number, width: number): Box {
  const r = width / 2 + 2;
  return { l: Math.floor(x - r), t: Math.floor(y - r), r: Math.ceil(x + r), b: Math.ceil(y + r) };
}

function union(a: Box, b: Box): Box {
  return { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
}

export class Overlay {
  readonly hwnd: Handle;
  /** Style of strokes drawn with the left button. */
  style: InkStyle = { tool: "pen", color: 0xffe53935, width: 4 };
  /** Width of the eraser used while the right button is held. */
  eraserWidth = 32;
  /** Called whenever the list of finished strokes changes. */
  onStrokesChanged = () => {};

  private origin = { x: 0, y: 0 };
  private committed: Surface;
  private display: Surface;
  private readonly presenter: LayeredPresenter;
  private strokes: Stroke[] = [];
  private active: { stroke: Stroke; painter: InkPainter; box: Box; button: number } | null = null;
  private interactive = false;
  private inkVisible = true;
  private cursor: Handle = null;

  constructor() {
    const screen = virtualScreen();
    this.origin = { x: screen.left, y: screen.top };
    this.hwnd = createWindow(
      {
        className: OVERLAY_CLASS,
        title: "Display Pen Ink",
        exStyle: WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
        style: WS_POPUP,
        x: screen.left,
        y: screen.top,
        width: screen.right - screen.left,
        height: screen.bottom - screen.top,
      },
      this.handle,
    );
    user32.SetPropW(this.hwnd, wstr("MicrosoftTabletPenServiceProperty"), TABLET_PEN_FLAGS);
    this.presenter = new LayeredPresenter(this.hwnd);
    this.committed = new Surface(screen.right - screen.left, screen.bottom - screen.top);
    this.display = new Surface(this.committed.width, this.committed.height);
    this.repaint();
  }

  get strokeCount() {
    return this.strokes.length;
  }

  get drawingsVisible() {
    return this.inkVisible;
  }

  /** In interactive mode the overlay takes mouse input; otherwise clicks go through. */
  setInteractive(on: boolean) {
    if (!on && this.active) this.finishStroke();
    this.interactive = on;
    const ex = Number(user32.GetWindowLongPtrW(this.hwnd, GWL_EXSTYLE));
    const next = on ? ex & ~WS_EX_TRANSPARENT : ex | WS_EX_TRANSPARENT;
    if (next !== ex) user32.SetWindowLongPtrW(this.hwnd, GWL_EXSTYLE, next);
    this.syncVisibility();
  }

  /** Takes ownership of `cursor` and shows it while drawing. */
  setCursor(cursor: Handle) {
    const old = this.cursor;
    this.cursor = cursor;
    if (old) user32.DestroyIcon(old);
  }

  setDrawingsVisible(on: boolean) {
    this.inkVisible = on;
    this.syncVisibility();
  }

  undo() {
    if (this.active || !this.strokes.length) return;
    this.strokes.pop();
    this.repaint();
    this.onStrokesChanged();
  }

  clear() {
    if (this.active) this.finishStroke();
    if (!this.strokes.length) return;
    this.strokes = [];
    this.repaint();
    this.onStrokesChanged();
  }

  /** Re-covers the virtual screen after monitors were added, removed or rearranged. */
  fitToScreen() {
    const screen = virtualScreen();
    const width = screen.right - screen.left;
    const height = screen.bottom - screen.top;
    const dx = this.origin.x - screen.left;
    const dy = this.origin.y - screen.top;
    if (!dx && !dy && width === this.committed.width && height === this.committed.height) return;
    if (this.active) this.finishStroke();
    // Keep ink at the same place on screen when the virtual screen's origin moves.
    for (const s of this.strokes) {
      for (let i = 0; i < s.points.length; i += 2) {
        s.points[i] += dx;
        s.points[i + 1] += dy;
      }
    }
    this.origin = { x: screen.left, y: screen.top };
    this.committed.dispose();
    this.display.dispose();
    this.committed = new Surface(width, height);
    this.display = new Surface(width, height);
    user32.SetWindowPos(this.hwnd, 0, screen.left, screen.top, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
    this.repaint();
  }

  raise() {
    if (user32.IsWindowVisible(this.hwnd)) setTopmost(this.hwnd);
  }

  dispose() {
    this.setCursor(null);
    this.committed.dispose();
    this.display.dispose();
  }

  private syncVisibility() {
    const want = this.inkVisible && (this.interactive || this.strokes.length > 0);
    const visible = user32.IsWindowVisible(this.hwnd) !== 0;
    if (want && !visible) {
      user32.ShowWindow(this.hwnd, SW_SHOWNOACTIVATE);
      setTopmost(this.hwnd);
    } else if (!want && visible) {
      user32.ShowWindow(this.hwnd, SW_HIDE);
    }
  }

  /** Redraws every stroke from scratch (after undo, clear or a resize). */
  private repaint() {
    this.committed.clear(BACKGROUND);
    for (const stroke of this.strokes) {
      const painter = new InkPainter(this.committed.g, stroke);
      painter.all();
      painter.dispose();
    }
    this.display.copyFrom(this.committed, { l: 0, t: 0, r: this.committed.width, b: this.committed.height });
    this.presenter.present(this.display, this.origin);
    this.syncVisibility();
  }

  private beginStroke(x: number, y: number, button: number) {
    const style: InkStyle =
      button === WM_RBUTTONDOWN ? { tool: "eraser", color: 0, width: this.eraserWidth } : { ...this.style };
    const stroke: Stroke = { ...style, points: [x, y] };
    const painter = new InkPainter(this.display.g, stroke);
    const box = pointBox(x, y, stroke.width);
    this.active = { stroke, painter, box, button };
    user32.SetCapture(this.hwnd);
    painter.all();
    this.presenter.present(this.display, this.origin, box);
  }

  private extendStroke(x: number, y: number) {
    const a = this.active!;
    const p = a.stroke.points;
    const lastX = p[p.length - 2];
    const lastY = p[p.length - 1];
    if (x === lastX && y === lastY) return;
    p.push(x, y);
    const segment = union(pointBox(lastX, lastY, a.stroke.width), pointBox(x, y, a.stroke.width));
    a.box = union(a.box, segment);
    if (a.stroke.tool === "highlighter") {
      // Translucent ink would darken where segments overlap, so redraw the
      // whole stroke over a clean copy of what was underneath it.
      this.display.copyFrom(this.committed, a.box);
      a.painter.all();
      this.presenter.present(this.display, this.origin, a.box);
    } else {
      a.painter.last();
      this.presenter.present(this.display, this.origin, segment);
    }
  }

  private finishStroke() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.painter.dispose();
    this.committed.copyFrom(this.display, {
      l: Math.max(0, a.box.l),
      t: Math.max(0, a.box.t),
      r: Math.min(this.display.width, a.box.r),
      b: Math.min(this.display.height, a.box.b),
    });
    this.strokes.push(a.stroke);
    if (key(user32.GetCapture()) === key(this.hwnd)) user32.ReleaseCapture();
    this.onStrokesChanged();
  }

  private readonly handle = (msg: number, _wParam: bigint, lParam: bigint) => {
    const l = Number(lParam & 0xffffffffn);
    switch (msg) {
      case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
      case WM_SETCURSOR:
        if (this.interactive && this.cursor) {
          user32.SetCursor(this.cursor);
          return 1;
        }
        return undefined;
      case WM_LBUTTONDOWN:
      case WM_RBUTTONDOWN:
        if (this.interactive && !this.active) this.beginStroke(lowSigned(l), highSigned(l), msg);
        return 0;
      case WM_MOUSEMOVE:
        if (this.active) this.extendStroke(lowSigned(l), highSigned(l));
        return 0;
      case WM_LBUTTONUP:
      case WM_RBUTTONUP:
        if (this.active && this.active.button === msg - 1) this.finishStroke();
        return 0;
      case WM_CAPTURECHANGED:
        this.finishStroke();
        return 0;
    }
    return undefined;
  };
}
