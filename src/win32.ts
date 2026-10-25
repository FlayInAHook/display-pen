// Thin bun:ffi bindings for the parts of Win32, GDI and GDI+ that Display Pen uses.
import { dlopen, FFIType, ptr, read, type Pointer } from "bun:ffi";

const { ptr: P, i32, u32, u16, i64, u64, f32 } = FFIType;
const V = FFIType.void;

/** A Win32 handle or pointer as bun:ffi hands it back. */
export type Handle = Pointer | bigint | null;

export const user32 = dlopen("user32.dll", {
  RegisterClassExW: { args: [P], returns: u16 },
  CreateWindowExW: { args: [u32, P, P, u32, i32, i32, i32, i32, P, P, P, P], returns: P },
  DestroyWindow: { args: [P], returns: i32 },
  DefWindowProcW: { args: [P, u32, u64, i64], returns: i64 },
  GetMessageW: { args: [P, P, u32, u32], returns: i32 },
  TranslateMessage: { args: [P], returns: i32 },
  DispatchMessageW: { args: [P], returns: i64 },
  PostMessageW: { args: [P, u32, u64, i64], returns: i32 },
  PostQuitMessage: { args: [i32], returns: V },
  FindWindowW: { args: [P, P], returns: P },
  ShowWindow: { args: [P, i32], returns: i32 },
  IsWindowVisible: { args: [P], returns: i32 },
  SetWindowPos: { args: [P, i64, i32, i32, i32, i32, u32], returns: i32 },
  GetWindowRect: { args: [P, P], returns: i32 },
  GetWindowLongPtrW: { args: [P, i32], returns: i64 },
  SetWindowLongPtrW: { args: [P, i32, i64], returns: i64 },
  SetPropW: { args: [P, P, u64], returns: i32 },
  GetSystemMetrics: { args: [i32], returns: i32 },
  SetProcessDpiAwarenessContext: { args: [i64], returns: i32 },
  GetDpiForWindow: { args: [P], returns: u32 },
  GetDpiForSystem: { args: [], returns: u32 },
  UpdateLayeredWindowIndirect: { args: [P, P], returns: i32 },
  SetCapture: { args: [P], returns: P },
  ReleaseCapture: { args: [], returns: i32 },
  GetCapture: { args: [], returns: P },
  GetCursorPos: { args: [P], returns: i32 },
  LoadCursorW: { args: [P, u64], returns: P },
  SetCursor: { args: [P], returns: P },
  DestroyIcon: { args: [P], returns: i32 },
  TrackMouseEvent: { args: [P], returns: i32 },
  SetForegroundWindow: { args: [P], returns: i32 },
  CreatePopupMenu: { args: [], returns: P },
  AppendMenuW: { args: [P, u32, u64, P], returns: i32 },
  TrackPopupMenu: { args: [P, u32, i32, i32, i32, P, P], returns: i32 },
  DestroyMenu: { args: [P], returns: i32 },
  RegisterHotKey: { args: [P, i32, u32, u32], returns: i32 },
  UnregisterHotKey: { args: [P, i32], returns: i32 },
  SetTimer: { args: [P, u64, u32, P], returns: u64 },
  KillTimer: { args: [P, u64], returns: i32 },
  RegisterWindowMessageW: { args: [P], returns: u32 },
  MonitorFromRect: { args: [P, u32], returns: P },
  GetMonitorInfoW: { args: [P, P], returns: i32 },
  MessageBoxW: { args: [P, P, P, u32], returns: i32 },
}).symbols;

export const gdi32 = dlopen("gdi32.dll", {
  CreateCompatibleDC: { args: [P], returns: P },
  DeleteDC: { args: [P], returns: i32 },
  CreateDIBSection: { args: [P, P, u32, P, P, u32], returns: P },
  SelectObject: { args: [P, P], returns: P },
  DeleteObject: { args: [P], returns: i32 },
  BitBlt: { args: [P, i32, i32, i32, i32, P, i32, i32, u32], returns: i32 },
  GdiFlush: { args: [], returns: i32 },
}).symbols;

export const kernel32 = dlopen("kernel32.dll", {
  GetModuleHandleW: { args: [P], returns: P },
}).symbols;

export const shell32 = dlopen("shell32.dll", {
  Shell_NotifyIconW: { args: [u32, P], returns: i32 },
  SHGetKnownFolderPath: { args: [P, u32, P, P], returns: i32 },
}).symbols;

export const ole32 = dlopen("ole32.dll", {
  CoInitializeEx: { args: [P, u32], returns: i32 },
  CoUninitialize: { args: [], returns: V },
  CoCreateInstance: { args: [P, P, u32, P, P], returns: i32 },
  CoTaskMemFree: { args: [P], returns: V },
}).symbols;

export const gdip = dlopen("gdiplus.dll", {
  GdiplusStartup: { args: [P, P, P], returns: i32 },
  GdiplusShutdown: { args: [u64], returns: V },
  GdipCreateBitmapFromScan0: { args: [i32, i32, i32, i32, P, P], returns: i32 },
  GdipGetImageGraphicsContext: { args: [P, P], returns: i32 },
  GdipCreateHICONFromBitmap: { args: [P, P], returns: i32 },
  GdipDisposeImage: { args: [P], returns: i32 },
  GdipDeleteGraphics: { args: [P], returns: i32 },
  GdipFlush: { args: [P, i32], returns: i32 },
  GdipGraphicsClear: { args: [P, u32], returns: i32 },
  GdipSetSmoothingMode: { args: [P, i32], returns: i32 },
  GdipSetPixelOffsetMode: { args: [P, i32], returns: i32 },
  GdipSetCompositingMode: { args: [P, i32], returns: i32 },
  GdipSetTextRenderingHint: { args: [P, i32], returns: i32 },
  GdipResetWorldTransform: { args: [P], returns: i32 },
  GdipScaleWorldTransform: { args: [P, f32, f32, i32], returns: i32 },
  GdipCreatePen1: { args: [u32, f32, i32, P], returns: i32 },
  GdipDeletePen: { args: [P], returns: i32 },
  GdipSetPenStartCap: { args: [P, i32], returns: i32 },
  GdipSetPenEndCap: { args: [P, i32], returns: i32 },
  GdipSetPenLineJoin: { args: [P, i32], returns: i32 },
  GdipCreateSolidFill: { args: [u32, P], returns: i32 },
  GdipDeleteBrush: { args: [P], returns: i32 },
  GdipDrawLine: { args: [P, P, f32, f32, f32, f32], returns: i32 },
  GdipDrawLines: { args: [P, P, P, i32], returns: i32 },
  GdipDrawEllipse: { args: [P, P, f32, f32, f32, f32], returns: i32 },
  GdipFillEllipse: { args: [P, P, f32, f32, f32, f32], returns: i32 },
  GdipFillPolygon: { args: [P, P, P, i32, i32], returns: i32 },
  GdipCreatePath: { args: [i32, P], returns: i32 },
  GdipDeletePath: { args: [P], returns: i32 },
  GdipAddPathArc: { args: [P, f32, f32, f32, f32, f32, f32], returns: i32 },
  GdipClosePathFigure: { args: [P], returns: i32 },
  GdipFillPath: { args: [P, P, P], returns: i32 },
  GdipDrawPath: { args: [P, P, P], returns: i32 },
  GdipCreateFontFamilyFromName: { args: [P, P, P], returns: i32 },
  GdipDeleteFontFamily: { args: [P], returns: i32 },
  GdipCreateFont: { args: [P, f32, i32, i32, P], returns: i32 },
  GdipDeleteFont: { args: [P], returns: i32 },
  GdipCreateStringFormat: { args: [i32, u16, P], returns: i32 },
  GdipDeleteStringFormat: { args: [P], returns: i32 },
  GdipSetStringFormatAlign: { args: [P, i32], returns: i32 },
  GdipSetStringFormatLineAlign: { args: [P, i32], returns: i32 },
  GdipSetStringFormatFlags: { args: [P, i32], returns: i32 },
  GdipDrawString: { args: [P, P, i32, P, P, P, P], returns: i32 },
  GdipMeasureString: { args: [P, P, i32, P, P, P, P, P, P], returns: i32 },
}).symbols;

// --- Window messages ---
export const WM_CREATE = 0x0001;
export const WM_DESTROY = 0x0002;
export const WM_CLOSE = 0x0010;
export const WM_QUERYENDSESSION = 0x0011;
export const WM_ENDSESSION = 0x0016;
export const WM_SETTINGCHANGE = 0x001a;
export const WM_SETCURSOR = 0x0020;
export const WM_MOUSEACTIVATE = 0x0021;
export const WM_DISPLAYCHANGE = 0x007e;
export const WM_NCHITTEST = 0x0084;
export const WM_TIMER = 0x0113;
export const WM_MOUSEMOVE = 0x0200;
export const WM_LBUTTONDOWN = 0x0201;
export const WM_LBUTTONUP = 0x0202;
export const WM_RBUTTONDOWN = 0x0204;
export const WM_RBUTTONUP = 0x0205;
export const WM_CAPTURECHANGED = 0x0215;
export const WM_HOTKEY = 0x0312;
export const WM_MOUSELEAVE = 0x02a3;
export const WM_DPICHANGED = 0x02e0;
export const WM_NULL = 0x0000;
export const WM_APP = 0x8000;

// --- Window styles ---
export const WS_POPUP = 0x80000000;
export const WS_EX_TOPMOST = 0x00000008;
export const WS_EX_TRANSPARENT = 0x00000020;
export const WS_EX_TOOLWINDOW = 0x00000080;
export const WS_EX_LAYERED = 0x00080000;
export const WS_EX_NOACTIVATE = 0x08000000;
export const GWL_EXSTYLE = -20;

export const SW_HIDE = 0;
export const SW_SHOWNOACTIVATE = 4;

export const HWND_TOPMOST = -1;
export const SWP_NOSIZE = 0x0001;
export const SWP_NOMOVE = 0x0002;
export const SWP_NOZORDER = 0x0004;
export const SWP_NOACTIVATE = 0x0010;

export const MA_NOACTIVATE = 3;
export const HTCLIENT = 1;
export const TME_LEAVE = 0x00000002;

export const SM_XVIRTUALSCREEN = 76;
export const SM_YVIRTUALSCREEN = 77;
export const SM_CXVIRTUALSCREEN = 78;
export const SM_CYVIRTUALSCREEN = 79;
export const SM_CXSMICON = 49;

export const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4n;

export const IDC_ARROW = 32512;
export const IDC_SIZEALL = 32646;

export const MONITOR_DEFAULTTONULL = 0;
export const MONITOR_DEFAULTTOPRIMARY = 1;
export const MONITOR_DEFAULTTONEAREST = 2;

export const MF_STRING = 0x0000;
export const MF_GRAYED = 0x0001;
export const MF_CHECKED = 0x0008;
export const MF_SEPARATOR = 0x0800;
export const TPM_RIGHTBUTTON = 0x0002;
export const TPM_NONOTIFY = 0x0080;
export const TPM_RETURNCMD = 0x0100;

export const MOD_ALT = 0x0001;
export const MOD_CONTROL = 0x0002;
export const MOD_SHIFT = 0x0004;
export const MOD_NOREPEAT = 0x4000;
export const VK_ESCAPE = 0x1b;

export const MB_ICONERROR = 0x10;

// --- GDI ---
export const SRCCOPY = 0x00cc0020;
export const ULW_ALPHA = 0x00000002;

// --- GDI+ enums ---
export const PixelFormat32bppPARGB = 0x000e200b;
export const UnitPixel = 2;
export const SmoothingModeNone = 3;
export const SmoothingModeAntiAlias = 4;
export const PixelOffsetModeHalf = 4;
export const CompositingModeSourceOver = 0;
export const CompositingModeSourceCopy = 1;
export const TextRenderingHintAntiAliasGridFit = 3;
export const LineCapRound = 2;
export const LineJoinRound = 2;
export const StringAlignmentCenter = 1;
export const StringFormatFlagsNoWrap = 0x00001000;
export const StringFormatFlagsNoClip = 0x00004000;
export const MatrixOrderPrepend = 0;
export const FillModeWinding = 1;
export const FlushIntentionSync = 1;

// --- Helpers ---

/** A NUL-terminated UTF-16 string for W-suffixed APIs. */
export function wstr(s: string): Buffer {
  return Buffer.from(s + "\0", "utf16le");
}

/** Numeric key for a handle, for use in maps and comparisons. */
export function key(h: Handle): number {
  return h === null ? 0 : Number(h);
}

/** A handle as a 64-bit integer, for writing into structs. */
export function addr(h: Handle | NodeJS.TypedArray): bigint {
  if (h === null) return 0n;
  if (typeof h === "number" || typeof h === "bigint") return BigInt(h);
  return BigInt(ptr(h));
}

/** Calls a GDI+ function that returns its result through an out pointer. */
export function gpOut(what: string, fn: (out: BigUint64Array) => number): Pointer {
  const out = new BigUint64Array(1);
  const status = fn(out);
  if (status !== 0) throw new Error(`${what} failed (GDI+ status ${status})`);
  return Number(out[0]) as Pointer;
}

/** Signed x coordinate packed in the low word of an LPARAM. */
export const lowSigned = (l: number) => (l << 16) >> 16;
/** Signed y coordinate packed in the high word of an LPARAM. */
export const highSigned = (l: number) => l >> 16;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function readRect(p: Pointer): Rect {
  return { left: read.i32(p, 0), top: read.i32(p, 4), right: read.i32(p, 8), bottom: read.i32(p, 12) };
}

export function windowRect(hwnd: Handle): Rect {
  const r = new Int32Array(4);
  user32.GetWindowRect(hwnd, r);
  return { left: r[0], top: r[1], right: r[2], bottom: r[3] };
}

export function cursorPos(): { x: number; y: number } {
  const pt = new Int32Array(2);
  user32.GetCursorPos(pt);
  return { x: pt[0], y: pt[1] };
}

/** Work area of the monitor that intersects `r`, or null if it is off every monitor. */
export function workAreaFor(r: Rect, flags = MONITOR_DEFAULTTONEAREST): Rect | null {
  const mon = user32.MonitorFromRect(new Int32Array([r.left, r.top, r.right, r.bottom]), flags);
  if (!mon) return null;
  const info = new Int32Array(10);
  info[0] = 40;
  if (!user32.GetMonitorInfoW(mon, info)) return null;
  return { left: info[5], top: info[6], right: info[7], bottom: info[8] };
}

export function virtualScreen(): Rect {
  const x = user32.GetSystemMetrics(SM_XVIRTUALSCREEN);
  const y = user32.GetSystemMetrics(SM_YVIRTUALSCREEN);
  return {
    left: x,
    top: y,
    right: x + user32.GetSystemMetrics(SM_CXVIRTUALSCREEN),
    bottom: y + user32.GetSystemMetrics(SM_CYVIRTUALSCREEN),
  };
}

export function setTopmost(hwnd: Handle) {
  user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

export function moveWindow(hwnd: Handle, x: number, y: number) {
  user32.SetWindowPos(hwnd, 0, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

export function messageBox(text: string, title = "Display Pen", flags = MB_ICONERROR) {
  user32.MessageBoxW(null, wstr(text), wstr(title), flags);
}
