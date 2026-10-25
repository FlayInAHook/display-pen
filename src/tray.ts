// Notification-area icon and its context menu.
import {
  addr,
  MF_CHECKED,
  MF_GRAYED,
  MF_SEPARATOR,
  MF_STRING,
  shell32,
  TPM_NONOTIFY,
  TPM_RETURNCMD,
  TPM_RIGHTBUTTON,
  user32,
  cursorPos,
  wstr,
  WM_NULL,
  type Handle,
} from "./win32";

const NIM_ADD = 0;
const NIM_MODIFY = 1;
const NIM_DELETE = 2;
const NIF_MESSAGE = 0x01;
const NIF_ICON = 0x02;
const NIF_TIP = 0x04;
const NIF_INFO = 0x10;
const NIIF_INFO = 0x01;

// NOTIFYICONDATAW field offsets on 64-bit Windows.
const SIZE = 976;
const OFFSET_FLAGS = 20;
const OFFSET_TIP = 40;
const OFFSET_INFO = 304;
const OFFSET_INFO_TITLE = 820;
const OFFSET_INFO_FLAGS = 948;

export class TrayIcon {
  private readonly data = new Uint8Array(SIZE);
  private readonly view = new DataView(this.data.buffer);

  constructor(hwnd: Handle, callbackMessage: number, icon: Handle, tip: string) {
    this.view.setUint32(0, SIZE, true); // cbSize
    this.view.setBigUint64(8, addr(hwnd), true); // hWnd
    this.view.setUint32(16, 1, true); // uID
    this.view.setUint32(24, callbackMessage, true); // uCallbackMessage
    this.view.setBigUint64(32, addr(icon), true); // hIcon
    this.writeString(OFFSET_TIP, tip, 128);
  }

  /** Also used to re-add the icon after Explorer restarts. */
  add() {
    this.view.setUint32(OFFSET_FLAGS, NIF_MESSAGE | NIF_ICON | NIF_TIP, true);
    return shell32.Shell_NotifyIconW(NIM_ADD, this.data) !== 0;
  }

  remove() {
    shell32.Shell_NotifyIconW(NIM_DELETE, this.data);
  }

  notify(title: string, text: string) {
    this.writeString(OFFSET_INFO, text, 256);
    this.writeString(OFFSET_INFO_TITLE, title, 64);
    this.view.setUint32(OFFSET_INFO_FLAGS, NIIF_INFO, true);
    this.view.setUint32(OFFSET_FLAGS, NIF_INFO, true);
    shell32.Shell_NotifyIconW(NIM_MODIFY, this.data);
  }

  private writeString(offset: number, s: string, capacity: number) {
    const bytes = Buffer.from(s.slice(0, capacity - 1) + "\0", "utf16le");
    this.data.fill(0, offset, offset + capacity * 2);
    this.data.set(bytes, offset);
  }
}

export type MenuItem = { id: number; label: string; checked?: boolean; disabled?: boolean } | "separator";

/** Shows a popup menu at the mouse and returns the chosen id, or 0 if dismissed. */
export function showMenu(hwnd: Handle, items: MenuItem[]): number {
  const menu = user32.CreatePopupMenu();
  for (const item of items) {
    if (item === "separator") {
      user32.AppendMenuW(menu, MF_SEPARATOR, 0, null);
    } else {
      const flags = MF_STRING | (item.checked ? MF_CHECKED : 0) | (item.disabled ? MF_GRAYED : 0);
      user32.AppendMenuW(menu, flags, item.id, wstr(item.label));
    }
  }
  const p = cursorPos();
  // Without this the menu would not close when clicking elsewhere.
  user32.SetForegroundWindow(hwnd);
  const id = user32.TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY, p.x, p.y, 0, hwnd, null);
  user32.PostMessageW(hwnd, WM_NULL, 0, 0);
  user32.DestroyMenu(menu);
  return id;
}
