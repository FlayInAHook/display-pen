// The floating, draggable toolbar and its hover tips.
import type { Pointer } from "bun:ffi";
import {
  drawLine,
  drawText,
  fillCircle,
  fillRoundRect,
  Font,
  LayeredPresenter,
  measureText,
  strokeCircle,
  strokeRoundRect,
  Surface,
} from "./gfx";
import { ACCENT, Glyph, ICON_FONTS } from "./icons";
import type { InkTool } from "./overlay";
import { createWindow, destroyWindow } from "./window";
import {
  cursorPos,
  highSigned,
  HTCLIENT,
  IDC_ARROW,
  IDC_SIZEALL,
  key,
  lowSigned,
  MA_NOACTIVATE,
  moveWindow,
  readRect,
  setTopmost,
  SW_HIDE,
  SW_SHOWNOACTIVATE,
  TME_LEAVE,
  user32,
  windowRect,
  workAreaFor,
  addr,
  MONITOR_DEFAULTTOPRIMARY,
  WM_CAPTURECHANGED,
  WM_DPICHANGED,
  WM_LBUTTONDOWN,
  WM_LBUTTONUP,
  WM_MOUSEACTIVATE,
  WM_MOUSELEAVE,
  WM_MOUSEMOVE,
  WM_SETCURSOR,
  WM_TIMER,
  WS_EX_LAYERED,
  WS_EX_NOACTIVATE,
  WS_EX_TOOLWINDOW,
  WS_EX_TOPMOST,
  WS_EX_TRANSPARENT,
  WS_POPUP,
  type Handle,
  type Rect,
} from "./win32";

export const TOOLBAR_CLASS = "DisplayPenToolbar";
export const TIP_CLASS = "DisplayPenTip";

export type Tool = "cursor" | InkTool;

export type ToolbarCommand =
  | { type: "tool"; tool: Tool }
  | { type: "color"; index: number }
  | { type: "size"; index: number }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "hide" };

export interface ToolbarState {
  tool: Tool;
  colors: readonly { argb: number; name: string }[];
  color: number;
  size: number;
  sizeNames: readonly string[];
  canUndo: boolean;
}

interface Item {
  command: ToolbarCommand;
  tip: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Layout in logical (96 DPI) pixels.
const WIDTH = 52;
const PAD = 6;
const GRIP = 16;
const BUTTON = 40;
const GAP = 2;
const SEPARATOR = 9;
const SWATCH = 18;
const SWATCH_STEP = 22;
const SIZE_ROW = 26;
const SIZE_DOTS = [4, 8, 13];
const RADIUS = 12;

const BODY = 0xf0202124;
const BORDER = 0x30ffffff;
const HOVER = 0x22ffffff;
const PRESSED = 0x40ffffff;
const SELECTED = 0x33ffffff;
const WHITE = 0xffffffff;
const DISABLED = 0x55ffffff;

const TIP_TIMER = 1;
const TIP_DELAY_MS = 450;

const TOOL_TIPS: Record<Tool, string> = {
  cursor: "Mouse - normal mode (Esc)",
  pen: "Pen",
  highlighter: "Highlighter",
  eraser: "Eraser (or right-drag while drawing)",
};

function layout(state: ToolbarState) {
  const items: Item[] = [];
  const separators: number[] = [];
  let y = PAD + GRIP;
  const add = (command: ToolbarCommand, tip: string, h = BUTTON) => {
    items.push({ command, tip, x: PAD, y, w: BUTTON, h });
    y += h + GAP;
  };
  const separator = () => {
    y -= GAP;
    separators.push(y + SEPARATOR / 2);
    y += SEPARATOR;
  };

  for (const tool of ["cursor", "pen", "highlighter", "eraser"] as const) add({ type: "tool", tool }, TOOL_TIPS[tool]);
  separator();

  state.colors.forEach((color, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    items.push({
      command: { type: "color", index },
      tip: color.name,
      x: PAD + col * SWATCH_STEP,
      y: y + row * SWATCH_STEP,
      w: SWATCH,
      h: SWATCH,
    });
  });
  y += Math.ceil(state.colors.length / 2) * SWATCH_STEP;
  separator();

  state.sizeNames.forEach((name, index) => add({ type: "size", index }, name, SIZE_ROW));
  separator();

  add({ type: "undo" }, "Undo");
  add({ type: "clear" }, "Clear all");
  add({ type: "hide" }, "Hide to tray");
  y += PAD - GAP;
  return { items, separators, height: y };
}

export class Toolbar {
  readonly hwnd: Handle;
  private readonly presenter: LayeredPresenter;
  private readonly tip: Tip;
  private readonly iconFont = new Font(ICON_FONTS, 18);
  private surface: Surface | null = null;
  private scale = 1;
  private state: ToolbarState | null = null;
  private items: Item[] = [];
  private separators: number[] = [];
  private height = 0;
  private hover = -1;
  private pressed = -1;
  private drag: { dx: number; dy: number } | null = null;
  private trackingLeave = false;
  private readonly arrow = user32.LoadCursorW(null, IDC_ARROW);
  private readonly sizeAll = user32.LoadCursorW(null, IDC_SIZEALL);

  constructor(
    owner: Handle,
    private readonly startAt: { x: number; y: number } | null,
    private readonly onCommand: (command: ToolbarCommand) => void,
    private readonly onMoved: () => void,
  ) {
    const primary = workAreaFor({ left: 0, top: 0, right: 1, bottom: 1 }, MONITOR_DEFAULTTOPRIMARY);
    const at = startAt ?? { x: primary?.left ?? 0, y: primary?.top ?? 0 };
    this.hwnd = createWindow(
      {
        className: TOOLBAR_CLASS,
        title: "Display Pen",
        exStyle: WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        style: WS_POPUP,
        x: at.x,
        y: at.y,
        width: 1,
        height: 1,
        owner,
      },
      this.handle,
    );
    this.presenter = new LayeredPresenter(this.hwnd);
    this.tip = new Tip(this.hwnd);
    this.scale = user32.GetDpiForWindow(this.hwnd) / 96;
  }

  get visible() {
    return user32.IsWindowVisible(this.hwnd) !== 0;
  }

  update(state: ToolbarState) {
    const first = this.state === null;
    this.state = state;
    ({ items: this.items, separators: this.separators, height: this.height } = layout(state));
    if (!first) return this.paint();

    let at = this.startAt;
    if (!at) {
      // Default: vertically centred at the right edge of the primary monitor.
      const work = workAreaFor({ left: 0, top: 0, right: 1, bottom: 1 }, MONITOR_DEFAULTTOPRIMARY);
      const w = Math.round(WIDTH * this.scale);
      const h = Math.round(this.height * this.scale);
      at = work
        ? { x: work.right - w - Math.round(16 * this.scale), y: work.top + Math.round((work.bottom - work.top - h) / 2) }
        : { x: 0, y: 0 };
    }
    this.paint(at);
    this.clampToScreen();
  }

  show() {
    if (!this.visible) user32.ShowWindow(this.hwnd, SW_SHOWNOACTIVATE);
    this.raise();
  }

  hide() {
    this.tip.hide();
    user32.ShowWindow(this.hwnd, SW_HIDE);
  }

  raise() {
    if (this.visible) setTopmost(this.hwnd);
  }

  position() {
    const r = windowRect(this.hwnd);
    return { x: r.left, y: r.top };
  }

  /** Keeps the toolbar fully inside the work area of the monitor it is on. */
  clampToScreen() {
    const r = windowRect(this.hwnd);
    const work = workAreaFor(r);
    if (!work) return;
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    const x = Math.max(work.left, Math.min(r.left, work.right - w));
    const y = Math.max(work.top, Math.min(r.top, work.bottom - h));
    if (x !== r.left || y !== r.top) moveWindow(this.hwnd, x, y);
  }

  dispose() {
    this.tip.dispose();
    destroyWindow(this.hwnd);
    this.surface?.dispose();
    this.iconFont.dispose();
  }

  private paint(at: { x: number; y: number } | null = null) {
    const state = this.state;
    if (!state) return;
    const width = Math.round(WIDTH * this.scale);
    const height = Math.round(this.height * this.scale);
    if (!this.surface || this.surface.width !== width || this.surface.height !== height) {
      this.surface?.dispose();
      this.surface = new Surface(width, height);
    }
    const s = this.surface;
    const g = s.g;
    s.clear(0);
    s.setScale(this.scale);

    fillRoundRect(g, 0.5, 0.5, WIDTH - 1, this.height - 1, RADIUS, BODY);
    strokeRoundRect(g, 0.5, 0.5, WIDTH - 1, this.height - 1, RADIUS, BORDER, 1);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) fillCircle(g, WIDTH / 2 - 6 + i * 6, PAD + 5 + j * 6, 2.5, 0x66ffffff);
    }
    for (const y of this.separators) drawLine(g, 14, y, WIDTH - 14, y, 0x26ffffff, 1);
    this.items.forEach((item, i) => this.paintItem(g, state, item, i));

    this.presenter.present(s, at);
  }

  private paintItem(g: Pointer, state: ToolbarState, item: Item, index: number) {
    const c = item.command;
    const { x, y, w, h } = item;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const hovered = index === this.hover && (this.pressed === -1 || this.pressed === index);
    const pressed = index === this.pressed && index === this.hover;
    const feedback = pressed ? PRESSED : hovered ? HOVER : 0;
    const background = (color: number) => {
      if (color) fillRoundRect(g, x, y, w, h, 8, color);
    };

    switch (c.type) {
      case "tool": {
        const active = state.tool === c.tool;
        background(active ? ACCENT : feedback);
        drawText(g, Glyph[c.tool], this.iconFont, x, y, w, h, WHITE);
        if (c.tool === "pen" || c.tool === "highlighter") {
          fillRoundRect(g, cx - 8, y + h - 7, 16, 3, 1.5, state.colors[state.color]!.argb);
        }
        break;
      }
      case "color": {
        const selected = state.color === c.index;
        if (selected) strokeCircle(g, cx, cy, SWATCH + 2, WHITE, 2);
        else if (hovered) strokeCircle(g, cx, cy, SWATCH + 2, 0x66ffffff, 1.5);
        const d = selected ? SWATCH - 4 : SWATCH - 1;
        fillCircle(g, cx, cy, d, state.colors[c.index]!.argb);
        strokeCircle(g, cx, cy, d, 0x40ffffff, 1);
        break;
      }
      case "size": {
        background(state.size === c.index && state.tool !== "cursor" ? SELECTED : feedback);
        if (state.size === c.index && state.tool === "cursor") strokeRoundRect(g, x, y, w, h, 8, SELECTED, 1);
        fillCircle(g, cx, cy, SIZE_DOTS[c.index]!, WHITE);
        break;
      }
      default: {
        const enabled = c.type === "hide" || state.canUndo;
        if (enabled) background(feedback);
        drawText(g, Glyph[c.type], this.iconFont, x, y, w, h, enabled ? WHITE : DISABLED);
      }
    }
  }

  private hitTest(clientX: number, clientY: number) {
    const x = clientX / this.scale;
    const y = clientY / this.scale;
    return this.items.findIndex((it) => x >= it.x - 1 && x < it.x + it.w + 1 && y >= it.y - 1 && y < it.y + it.h + 1);
  }

  private setHover(index: number) {
    if (index === this.hover) return;
    this.hover = index;
    this.paint();
    if (index < 0 || this.drag || this.pressed >= 0) {
      user32.KillTimer(this.hwnd, TIP_TIMER);
      this.tip.hide();
    } else if (this.tip.visible) {
      this.showTip();
    } else {
      user32.SetTimer(this.hwnd, TIP_TIMER, TIP_DELAY_MS, null);
    }
  }

  private showTip() {
    const item = this.items[this.hover];
    if (!item) return;
    const r = windowRect(this.hwnd);
    const gap = Math.round(6 * this.scale);
    this.tip.show(item.tip, this.scale, {
      left: r.left - gap,
      right: r.right + gap,
      y: r.top + Math.round((item.y + item.h / 2) * this.scale),
      work: workAreaFor(r),
    });
  }

  private trackLeave() {
    if (this.trackingLeave) return;
    const tme = new Uint8Array(24);
    const v = new DataView(tme.buffer);
    v.setUint32(0, 24, true);
    v.setUint32(4, TME_LEAVE, true);
    v.setBigUint64(8, addr(this.hwnd), true);
    this.trackingLeave = user32.TrackMouseEvent(tme) !== 0;
  }

  private releaseCapture() {
    if (key(user32.GetCapture()) === key(this.hwnd)) user32.ReleaseCapture();
  }

  private readonly handle = (msg: number, wParam: bigint, lParam: bigint) => {
    const l = Number(lParam & 0xffffffffn);
    switch (msg) {
      case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;

      case WM_SETCURSOR: {
        if ((l & 0xffff) !== HTCLIENT) return undefined;
        const p = cursorPos();
        const r = windowRect(this.hwnd);
        const overItem = !this.drag && this.hitTest(p.x - r.left, p.y - r.top) >= 0;
        user32.SetCursor(overItem ? this.arrow : this.sizeAll);
        return 1;
      }

      case WM_MOUSEMOVE: {
        if (this.drag) {
          const p = cursorPos();
          moveWindow(this.hwnd, p.x - this.drag.dx, p.y - this.drag.dy);
          return 0;
        }
        this.trackLeave();
        this.setHover(this.hitTest(lowSigned(l), highSigned(l)));
        return 0;
      }

      case WM_MOUSELEAVE:
        this.trackingLeave = false;
        if (!this.drag && this.pressed < 0) this.setHover(-1);
        return 0;

      case WM_LBUTTONDOWN: {
        user32.KillTimer(this.hwnd, TIP_TIMER);
        this.tip.hide();
        const index = this.hitTest(lowSigned(l), highSigned(l));
        user32.SetCapture(this.hwnd);
        if (index >= 0) {
          this.pressed = index;
          this.paint();
        } else {
          const p = cursorPos();
          const r = windowRect(this.hwnd);
          this.drag = { dx: p.x - r.left, dy: p.y - r.top };
        }
        return 0;
      }

      case WM_LBUTTONUP: {
        const dragged = this.drag !== null;
        const pressed = this.pressed;
        this.drag = null;
        this.pressed = -1;
        this.releaseCapture();
        if (dragged) {
          this.clampToScreen();
          this.onMoved();
        } else if (pressed >= 0 && this.hitTest(lowSigned(l), highSigned(l)) === pressed) {
          this.onCommand(this.items[pressed]!.command);
        }
        this.paint();
        return 0;
      }

      case WM_CAPTURECHANGED:
        if (this.drag || this.pressed >= 0) {
          this.drag = null;
          this.pressed = -1;
          this.paint();
        }
        return 0;

      case WM_TIMER:
        if (wParam === BigInt(TIP_TIMER)) {
          user32.KillTimer(this.hwnd, TIP_TIMER);
          if (!this.drag && this.pressed < 0) this.showTip();
          return 0;
        }
        return undefined;

      case WM_DPICHANGED: {
        const next = Number(wParam & 0xffffn) / 96;
        if (this.drag) {
          this.drag.dx = Math.round((this.drag.dx * next) / this.scale);
          this.drag.dy = Math.round((this.drag.dy * next) / this.scale);
        }
        this.scale = next;
        const suggested = readRect(Number(lParam) as Pointer);
        this.paint({ x: suggested.left, y: suggested.top });
        return 0;
      }
    }
    return undefined;
  };
}

/** Small label shown next to the toolbar while hovering a button. */
class Tip {
  private readonly hwnd: Handle;
  private readonly presenter: LayeredPresenter;
  private readonly font = new Font(["Segoe UI Variable Text", "Segoe UI"], 12);
  private readonly measure = new Surface(1, 1);
  private surface: Surface | null = null;

  constructor(owner: Handle) {
    this.hwnd = createWindow(
      {
        className: TIP_CLASS,
        exStyle: WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
        style: WS_POPUP,
        owner,
      },
      () => undefined,
    );
    this.presenter = new LayeredPresenter(this.hwnd);
  }

  get visible() {
    return user32.IsWindowVisible(this.hwnd) !== 0;
  }

  /** Places the tip right of `right`, or left of `left` when it would leave the work area. */
  show(text: string, scale: number, anchor: { left: number; right: number; y: number; work: Rect | null }) {
    const size = measureText(this.measure.g, text, this.font);
    const w = Math.ceil(size.width) + 12;
    const h = Math.ceil(size.height) + 8;
    const pw = Math.ceil(w * scale);
    const ph = Math.ceil(h * scale);
    if (!this.surface || this.surface.width !== pw || this.surface.height !== ph) {
      this.surface?.dispose();
      this.surface = new Surface(pw, ph);
    }
    const s = this.surface;
    s.clear(0);
    s.setScale(scale);
    fillRoundRect(s.g, 0.5, 0.5, w - 1, h - 1, 5, 0xf2111214);
    strokeRoundRect(s.g, 0.5, 0.5, w - 1, h - 1, 5, BORDER, 1);
    drawText(s.g, text, this.font, 0, 0, w, h, WHITE);

    const work = anchor.work;
    const x = work && anchor.right + pw > work.right ? anchor.left - pw : anchor.right;
    let y = anchor.y - Math.round(ph / 2);
    if (work) y = Math.max(work.top, Math.min(y, work.bottom - ph));
    this.presenter.present(s, { x, y });
    if (!this.visible) user32.ShowWindow(this.hwnd, SW_SHOWNOACTIVATE);
  }

  hide() {
    if (this.visible) user32.ShowWindow(this.hwnd, SW_HIDE);
  }

  dispose() {
    destroyWindow(this.hwnd);
    this.surface?.dispose();
    this.measure.dispose();
    this.font.dispose();
  }
}
