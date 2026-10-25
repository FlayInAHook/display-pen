// Start menu shortcut for the portable exe, written through the IShellLinkW COM API.
import { CFunction, FFIType, read, type Pointer } from "bun:ffi";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ole32, shell32, wstr } from "./win32";

const SHORTCUT_NAME = "Display Pen.lnk";
const DESCRIPTION = "Draw on top of your whole screen";

const CLSID_ShellLink = guid("00021401-0000-0000-C000-000000000046");
const IID_IShellLinkW = guid("000214F9-0000-0000-C000-000000000046");
const IID_IPersistFile = guid("0000010B-0000-0000-C000-000000000046");
const FOLDERID_Programs = guid("A77F5D77-2E2B-44C3-A6A2-ABA601054A51");

const COINIT_APARTMENTTHREADED = 0x2;
const CLSCTX_INPROC_SERVER = 0x1;
const STGM_READ = 0;
const SLGP_RAWPATH = 0x4;

// Vtable slots; IUnknown occupies 0-2.
const QUERY_INTERFACE = 0;
const RELEASE = 2;
const ShellLink = { GetPath: 3, SetDescription: 7, SetWorkingDirectory: 9, SetIconLocation: 17, SetPath: 20 };
const PersistFile = { Load: 5, Save: 6 };

function guid(s: string): Uint8Array {
  const hex = s.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, parseInt(hex.slice(0, 8), 16), true);
  v.setUint16(4, parseInt(hex.slice(8, 12), 16), true);
  v.setUint16(6, parseInt(hex.slice(12, 16), 16), true);
  for (let i = 0; i < 8; i++) bytes[8 + i] = parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16);
  return bytes;
}

function check(hr: number, what: string) {
  if (hr < 0) throw new Error(`${what} failed (HRESULT 0x${(hr >>> 0).toString(16)})`);
}

/** Calls vtable method `slot` of a COM interface; the methods used here all return HRESULTs. */
function invoke(obj: Pointer, slot: number, args: FFIType[], ...values: unknown[]): number {
  const vtable = read.ptr(obj) as Pointer;
  const method = CFunction({ ptr: read.ptr(vtable, slot * 8) as Pointer, args: [FFIType.ptr, ...args], returns: FFIType.i32 });
  try {
    return method(obj, ...values);
  } finally {
    method.close();
  }
}

function withShellLink<T>(fn: (link: Pointer, file: Pointer) => T): T {
  const init = ole32.CoInitializeEx(null, COINIT_APARTMENTTHREADED);
  try {
    const out = new BigUint64Array(1);
    check(ole32.CoCreateInstance(CLSID_ShellLink, null, CLSCTX_INPROC_SERVER, IID_IShellLinkW, out), "Creating ShellLink");
    const link = Number(out[0]) as Pointer;
    try {
      check(invoke(link, QUERY_INTERFACE, [FFIType.ptr, FFIType.ptr], IID_IPersistFile, out), "IPersistFile");
      const file = Number(out[0]) as Pointer;
      try {
        return fn(link, file);
      } finally {
        invoke(file, RELEASE, []);
      }
    } finally {
      invoke(link, RELEASE, []);
    }
  } finally {
    // A failed init (thread already in another apartment) must not be balanced.
    if (init >= 0) ole32.CoUninitialize();
  }
}

function samePath(a: string, b: string) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** The per-user Start menu "Programs" folder; no admin rights needed to write there. */
export function startMenuShortcutPath(): string {
  const out = new BigUint64Array(1);
  check(shell32.SHGetKnownFolderPath(FOLDERID_Programs, 0, null, out), "Finding the Start menu folder");
  const p = Number(out[0]) as Pointer;
  try {
    let folder = "";
    for (let i = 0, c = read.u16(p, 0); c; c = read.u16(p, (i += 2))) folder += String.fromCharCode(c);
    return join(folder, SHORTCUT_NAME);
  } finally {
    ole32.CoTaskMemFree(p);
  }
}

export function writeShortcut(lnkPath: string, target: string) {
  withShellLink((link, file) => {
    check(invoke(link, ShellLink.SetPath, [FFIType.ptr], wstr(target)), "SetPath");
    check(invoke(link, ShellLink.SetWorkingDirectory, [FFIType.ptr], wstr(dirname(target))), "SetWorkingDirectory");
    check(invoke(link, ShellLink.SetDescription, [FFIType.ptr], wstr(DESCRIPTION)), "SetDescription");
    check(invoke(link, ShellLink.SetIconLocation, [FFIType.ptr, FFIType.i32], wstr(target), 0), "SetIconLocation");
    check(invoke(file, PersistFile.Save, [FFIType.ptr, FFIType.i32], wstr(lnkPath), 1), "Saving the shortcut");
  });
}

/** Target of an existing shortcut, or null if there is none. */
export function readShortcutTarget(lnkPath: string): string | null {
  if (!existsSync(lnkPath)) return null;
  return withShellLink((link, file) => {
    check(invoke(file, PersistFile.Load, [FFIType.ptr, FFIType.u32], wstr(lnkPath), STGM_READ), "Reading the shortcut");
    const buf = new Uint16Array(1024);
    check(invoke(link, ShellLink.GetPath, [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], buf, buf.length, null, SLGP_RAWPATH), "GetPath");
    return new TextDecoder("utf-16le").decode(buf.subarray(0, buf.indexOf(0)));
  });
}

/** Whether the Start menu shortcut exists and opens `exe`. */
export function hasStartMenuShortcut(exe: string) {
  const target = readShortcutTarget(startMenuShortcutPath());
  return target !== null && samePath(target, exe);
}

export function addStartMenuShortcut(exe: string) {
  writeShortcut(startMenuShortcutPath(), exe);
}

export function removeStartMenuShortcut() {
  const lnk = startMenuShortcutPath();
  if (existsSync(lnk)) unlinkSync(lnk);
}

/** Moving the portable exe breaks its shortcut; point it at the new location on the next start. */
export function repairStartMenuShortcut(exe: string) {
  const lnk = startMenuShortcutPath();
  const target = readShortcutTarget(lnk);
  if (target && !samePath(target, exe) && !existsSync(target)) writeShortcut(lnk, exe);
}
