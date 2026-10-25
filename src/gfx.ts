// GDI+ drawing on 32-bit premultiplied DIB sections, presented through layered windows.
import { toArrayBuffer, type Pointer } from "bun:ffi";
import {
  addr,
  CompositingModeSourceOver,
  FillModeWinding,
  FlushIntentionSync,
  gdi32,
  gdip,
  gpOut,
  LineCapRound,
  LineJoinRound,
  MatrixOrderPrepend,
  PixelFormat32bppPARGB,
  PixelOffsetModeHalf,
  SmoothingModeAntiAlias,
  SRCCOPY,
  StringAlignmentCenter,
  StringFormatFlagsNoClip,
  StringFormatFlagsNoWrap,
  TextRenderingHintAntiAliasGridFit,
  ULW_ALPHA,
  UnitPixel,
  user32,
  wstr,
  type Handle,
} from "./win32";

let gdiplusToken: bigint | null = null;
let centeredFormat: Pointer | null = null;

export function startGdiplus() {
  const input = new Uint8Array(24);
  new DataView(input.buffer).setUint32(0, 1, true); // GdiplusVersion
  const token = new BigUint64Array(1);
  const status = gdip.GdiplusStartup(token, input, null);
  if (status !== 0) throw new Error(`GdiplusStartup failed (status ${status})`);
  gdiplusToken = token[0];
  centeredFormat = gpOut("GdipCreateStringFormat", (o) => gdip.GdipCreateStringFormat(0, 0, o));
  gdip.GdipSetStringFormatAlign(centeredFormat, StringAlignmentCenter);
  gdip.GdipSetStringFormatLineAlign(centeredFormat, StringAlignmentCenter);
  gdip.GdipSetStringFormatFlags(centeredFormat, StringFormatFlagsNoWrap | StringFormatFlagsNoClip);
}

export function shutdownGdiplus() {
  if (centeredFormat) gdip.GdipDeleteStringFormat(centeredFormat);
  if (gdiplusToken !== null) gdip.GdiplusShutdown(gdiplusToken);
  centeredFormat = null;
  gdiplusToken = null;
}

/** Integer pixel rectangle, right/bottom exclusive. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** A top-down 32bpp PARGB bitmap usable both as a GDI DC and a GDI+ Graphics. */
export class Surface {
  readonly hdc: Handle;
  readonly bits: Pointer;
  readonly bitmap: Pointer;
  readonly g: Pointer;
  private readonly hbmp: Handle;
  private readonly previous: Handle;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const bmi = new Uint8Array(44);
    const dv = new DataView(bmi.buffer);
    dv.setUint32(0, 40, true); // biSize
    dv.setInt32(4, width, true);
    dv.setInt32(8, -height, true); // negative = top-down rows
    dv.setUint16(12, 1, true); // biPlanes
    dv.setUint16(14, 32, true); // biBitCount
    this.hdc = gdi32.CreateCompatibleDC(null);
    const bitsOut = new BigUint64Array(1);
    this.hbmp = gdi32.CreateDIBSection(this.hdc, bmi, 0, bitsOut, null, 0);
    if (!this.hdc || !this.hbmp) throw new Error(`Could not allocate a ${width}x${height} bitmap`);
    this.previous = gdi32.SelectObject(this.hdc, this.hbmp);
    const bits = Number(bitsOut[0]) as Pointer;
    this.bits = bits;
    this.bitmap = gpOut("GdipCreateBitmapFromScan0", (o) =>
      gdip.GdipCreateBitmapFromScan0(width, height, width * 4, PixelFormat32bppPARGB, bits, o),
    );
    const bitmap = this.bitmap;
    this.g = gpOut("GdipGetImageGraphicsContext", (o) => gdip.GdipGetImageGraphicsContext(bitmap, o));
    gdip.GdipSetSmoothingMode(this.g, SmoothingModeAntiAlias);
    gdip.GdipSetPixelOffsetMode(this.g, PixelOffsetModeHalf);
    gdip.GdipSetCompositingMode(this.g, CompositingModeSourceOver);
    gdip.GdipSetTextRenderingHint(this.g, TextRenderingHintAntiAliasGridFit);
  }

  clear(argb: number) {
    gdip.GdipGraphicsClear(this.g, argb >>> 0);
  }

  /** Paints in logical units: everything drawn afterwards is multiplied by `scale`. */
  setScale(scale: number) {
    gdip.GdipResetWorldTransform(this.g);
    gdip.GdipScaleWorldTransform(this.g, scale, scale, MatrixOrderPrepend);
  }

  flush() {
    gdip.GdipFlush(this.g, FlushIntentionSync);
  }

  /** Copies the same rectangle from another surface of identical size. */
  copyFrom(src: Surface, box: Box) {
    if (box.r <= box.l || box.b <= box.t) return;
    this.flush();
    src.flush();
    gdi32.BitBlt(this.hdc, box.l, box.t, box.r - box.l, box.b - box.t, src.hdc, box.l, box.t, SRCCOPY);
    gdi32.GdiFlush();
  }

  /** Raw premultiplied BGRA pixels, top row first. */
  pixels(): Uint8Array {
    this.flush();
    return new Uint8Array(toArrayBuffer(this.bits, 0, this.width * this.height * 4));
  }

  dispose() {
    gdip.GdipDeleteGraphics(this.g);
    gdip.GdipDisposeImage(this.bitmap);
    gdi32.SelectObject(this.hdc, this.previous);
    gdi32.DeleteObject(this.hbmp);
    gdi32.DeleteDC(this.hdc);
  }
}

/** Presents surfaces on a WS_EX_LAYERED window with per-pixel alpha. */
export class LayeredPresenter {
  private readonly info = new Uint8Array(80);
  private readonly view = new DataView(this.info.buffer);
  private readonly dst = new Int32Array(2);
  private readonly size = new Int32Array(2);
  private readonly src = new Int32Array(2);
  private readonly dirty = new Int32Array(4);
  private readonly blend = new Uint8Array([0, 0, 255, 1]); // AC_SRC_OVER, 255, AC_SRC_ALPHA

  constructor(private readonly hwnd: Handle) {}

  /** `at` moves the window (screen coordinates); `box` limits the update to a dirty rectangle. */
  present(surface: Surface, at: { x: number; y: number } | null = null, box: Box | null = null) {
    surface.flush();
    const v = this.view;
    this.size[0] = surface.width;
    this.size[1] = surface.height;
    v.setUint32(0, 80, true); // cbSize
    v.setBigUint64(8, 0n, true); // hdcDst
    if (at) {
      this.dst[0] = at.x;
      this.dst[1] = at.y;
    }
    v.setBigUint64(16, at ? addr(this.dst) : 0n, true); // pptDst
    v.setBigUint64(24, addr(this.size), true); // psize
    v.setBigUint64(32, addr(surface.hdc), true); // hdcSrc
    v.setBigUint64(40, addr(this.src), true); // pptSrc
    v.setUint32(48, 0, true); // crKey
    v.setBigUint64(56, addr(this.blend), true); // pblend
    v.setUint32(64, ULW_ALPHA, true); // dwFlags
    let dirty = 0n;
    if (box) {
      const l = Math.max(0, box.l);
      const t = Math.max(0, box.t);
      const r = Math.min(surface.width, box.r);
      const b = Math.min(surface.height, box.b);
      if (r <= l || b <= t) return;
      this.dirty.set([l, t, r, b]);
      dirty = addr(this.dirty);
    }
    v.setBigUint64(72, dirty, true); // prcDirty
    user32.UpdateLayeredWindowIndirect(this.hwnd, this.info);
  }
}

// --- Painting helpers (coordinates in the graphics' current units) ---

function withBrush(argb: number, fn: (brush: Pointer) => void) {
  const brush = gpOut("GdipCreateSolidFill", (o) => gdip.GdipCreateSolidFill(argb >>> 0, o));
  try {
    fn(brush);
  } finally {
    gdip.GdipDeleteBrush(brush);
  }
}

export function createPen(argb: number, width: number): Pointer {
  const pen = gpOut("GdipCreatePen1", (o) => gdip.GdipCreatePen1(argb >>> 0, width, UnitPixel, o));
  gdip.GdipSetPenStartCap(pen, LineCapRound);
  gdip.GdipSetPenEndCap(pen, LineCapRound);
  gdip.GdipSetPenLineJoin(pen, LineJoinRound);
  return pen;
}

function withPen(argb: number, width: number, fn: (pen: Pointer) => void) {
  const pen = createPen(argb, width);
  try {
    fn(pen);
  } finally {
    gdip.GdipDeletePen(pen);
  }
}

function withRoundRect(x: number, y: number, w: number, h: number, r: number, fn: (path: Pointer) => void) {
  const path = gpOut("GdipCreatePath", (o) => gdip.GdipCreatePath(FillModeWinding, o));
  try {
    const d = Math.min(r * 2, w, h);
    gdip.GdipAddPathArc(path, x, y, d, d, 180, 90);
    gdip.GdipAddPathArc(path, x + w - d, y, d, d, 270, 90);
    gdip.GdipAddPathArc(path, x + w - d, y + h - d, d, d, 0, 90);
    gdip.GdipAddPathArc(path, x, y + h - d, d, d, 90, 90);
    gdip.GdipClosePathFigure(path);
    fn(path);
  } finally {
    gdip.GdipDeletePath(path);
  }
}

export function fillRoundRect(g: Pointer, x: number, y: number, w: number, h: number, r: number, argb: number) {
  withRoundRect(x, y, w, h, r, (path) => withBrush(argb, (brush) => gdip.GdipFillPath(g, brush, path)));
}

export function strokeRoundRect(
  g: Pointer,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  argb: number,
  width: number,
) {
  withRoundRect(x, y, w, h, r, (path) => withPen(argb, width, (pen) => gdip.GdipDrawPath(g, pen, path)));
}

export function fillCircle(g: Pointer, cx: number, cy: number, d: number, argb: number) {
  withBrush(argb, (brush) => gdip.GdipFillEllipse(g, brush, cx - d / 2, cy - d / 2, d, d));
}

export function strokeCircle(g: Pointer, cx: number, cy: number, d: number, argb: number, width: number) {
  withPen(argb, width, (pen) => gdip.GdipDrawEllipse(g, pen, cx - d / 2, cy - d / 2, d, d));
}

export function drawLine(g: Pointer, x1: number, y1: number, x2: number, y2: number, argb: number, width: number) {
  withPen(argb, width, (pen) => gdip.GdipDrawLine(g, pen, x1, y1, x2, y2));
}

export function fillPolygon(g: Pointer, points: number[], argb: number) {
  withBrush(argb, (brush) => gdip.GdipFillPolygon(g, brush, new Float32Array(points), points.length / 2, FillModeWinding));
}

export class Font {
  private readonly family: Pointer;
  readonly handle: Pointer;

  /** Uses the first installed family from `families`. */
  constructor(families: string[], sizePx: number, style = 0) {
    let family: Pointer | null = null;
    for (const name of families) {
      const out = new BigUint64Array(1);
      if (gdip.GdipCreateFontFamilyFromName(wstr(name), null, out) === 0) {
        family = Number(out[0]) as Pointer;
        break;
      }
    }
    if (!family) throw new Error(`None of these fonts are installed: ${families.join(", ")}`);
    this.family = family;
    this.handle = gpOut("GdipCreateFont", (o) => gdip.GdipCreateFont(family, sizePx, style, UnitPixel, o));
  }

  dispose() {
    gdip.GdipDeleteFont(this.handle);
    gdip.GdipDeleteFontFamily(this.family);
  }
}

/** Draws `text` centred in the given rectangle. */
export function drawText(g: Pointer, text: string, font: Font, x: number, y: number, w: number, h: number, argb: number) {
  const s = Buffer.from(text, "utf16le");
  withBrush(argb, (brush) =>
    gdip.GdipDrawString(g, s, text.length, font.handle, new Float32Array([x, y, w, h]), centeredFormat, brush),
  );
}

export function measureText(g: Pointer, text: string, font: Font): { width: number; height: number } {
  const s = Buffer.from(text, "utf16le");
  const box = new Float32Array(4);
  gdip.GdipMeasureString(g, s, text.length, font.handle, new Float32Array([0, 0, 10000, 10000]), centeredFormat, box, null, null);
  return { width: box[2], height: box[3] };
}

/** Renders a square image into an HICON (also usable as a cursor with a centred hotspot). */
export function createIcon(size: number, paint: (g: Pointer, size: number) => void): Handle {
  const surface = new Surface(size, size);
  try {
    surface.clear(0);
    paint(surface.g, size);
    surface.flush();
    const bitmap = surface.bitmap;
    return gpOut("GdipCreateHICONFromBitmap", (o) => gdip.GdipCreateHICONFromBitmap(bitmap, o));
  } finally {
    surface.dispose();
  }
}
