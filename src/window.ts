// Window class registration, message dispatch to per-window handlers, and the message loop.
import { FFIType, JSCallback } from "bun:ffi";
import { logError } from "./settings";
import { addr, kernel32, key, user32, wstr, type Handle } from "./win32";

/** Returns the LRESULT for a message, or undefined to fall through to DefWindowProc. */
export type MessageHandler = (msg: number, wParam: bigint, lParam: bigint) => number | bigint | undefined;

const handlers = new Map<number, MessageHandler>();
const classNames: Buffer[] = [];

export const hInstance = kernel32.GetModuleHandleW(null);

const wndProc = new JSCallback(
  (hwnd: Handle, msg: number, wParam: bigint, lParam: bigint) => {
    const handler = handlers.get(key(hwnd));
    if (handler) {
      try {
        const result = handler(msg, wParam, lParam);
        if (result !== undefined) return result;
      } catch (e) {
        logError(e);
      }
    }
    return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
  },
  { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
);

export function registerClass(name: string, cursor: Handle = null) {
  const className = wstr(name);
  classNames.push(className);
  const wc = new Uint8Array(80);
  const dv = new DataView(wc.buffer);
  dv.setUint32(0, 80, true); // cbSize
  dv.setBigUint64(8, addr(wndProc.ptr), true); // lpfnWndProc
  dv.setBigUint64(24, addr(hInstance), true); // hInstance
  dv.setBigUint64(40, addr(cursor), true); // hCursor
  dv.setBigUint64(64, addr(className), true); // lpszClassName
  if (!user32.RegisterClassExW(wc)) throw new Error(`RegisterClassExW(${name}) failed`);
}

export interface WindowOptions {
  className: string;
  title?: string;
  exStyle: number;
  style: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  owner?: Handle;
}

export function createWindow(o: WindowOptions, handler: MessageHandler): Handle {
  const hwnd = user32.CreateWindowExW(
    o.exStyle >>> 0,
    wstr(o.className),
    wstr(o.title ?? ""),
    o.style >>> 0,
    o.x ?? 0,
    o.y ?? 0,
    o.width ?? 0,
    o.height ?? 0,
    o.owner ?? null,
    null,
    hInstance,
    null,
  );
  if (!hwnd) throw new Error(`CreateWindowExW(${o.className}) failed`);
  handlers.set(key(hwnd), handler);
  return hwnd;
}

export function destroyWindow(hwnd: Handle) {
  user32.DestroyWindow(hwnd);
  handlers.delete(key(hwnd));
}

/** Pumps messages until WM_QUIT. All window procedures run inside this call. */
export function runMessageLoop() {
  const msg = new Uint8Array(48);
  while (user32.GetMessageW(msg, null, 0, 0) > 0) {
    user32.TranslateMessage(msg);
    user32.DispatchMessageW(msg);
  }
}
