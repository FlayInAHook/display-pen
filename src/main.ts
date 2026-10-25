// Display Pen: draw on top of the whole screen from a floating, always-on-top toolbar.
import { createIcon, shutdownGdiplus, startGdiplus } from "./gfx";
import { createBrushCursor, paintAppIcon } from "./icons";
import { Overlay, OVERLAY_CLASS, type InkStyle, type InkTool } from "./overlay";
import { loadSettings, logError, runningFromSource, saveSettings } from "./settings";
import {
  addStartMenuShortcut,
  hasStartMenuShortcut,
  removeStartMenuShortcut,
  repairStartMenuShortcut,
} from "./shortcut";
import { TIP_CLASS, Toolbar, TOOLBAR_CLASS, type Tool, type ToolbarCommand } from "./toolbar";
import { showMenu, TrayIcon, type MenuItem } from "./tray";
import { createWindow, destroyWindow, registerClass, runMessageLoop } from "./window";
import {
  DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
  IDC_ARROW,
  messageBox,
  MOD_ALT,
  MOD_CONTROL,
  MOD_NOREPEAT,
  MOD_SHIFT,
  SM_CXSMICON,
  user32,
  VK_ESCAPE,
  WM_APP,
  WM_CLOSE,
  WM_DESTROY,
  WM_DISPLAYCHANGE,
  WM_ENDSESSION,
  WM_HOTKEY,
  WM_LBUTTONUP,
  WM_QUERYENDSESSION,
  WM_RBUTTONUP,
  WM_SETTINGCHANGE,
  WM_TIMER,
  WS_EX_TOOLWINDOW,
  WS_POPUP,
  wstr,
  type Handle,
} from "./win32";

const MAIN_CLASS = "DisplayPenMain";
const WM_TRAY = WM_APP + 1;
/** Posted by a second instance so the running one shows its toolbar instead. */
const WM_SHOW_TOOLBAR = WM_APP + 2;
const TOPMOST_TIMER = 1;
const TOPMOST_INTERVAL_MS = 1500;

const COLORS = [
  { argb: 0xffe53935, name: "Red" },
  { argb: 0xfffb8c00, name: "Orange" },
  { argb: 0xfffdd835, name: "Yellow" },
  { argb: 0xff43a047, name: "Green" },
  { argb: 0xff1e88e5, name: "Blue" },
  { argb: 0xff8e24aa, name: "Purple" },
  { argb: 0xff212121, name: "Black" },
  { argb: 0xffffffff, name: "White" },
] as const;

const SIZE_NAMES = ["Thin", "Medium", "Thick"] as const;
const WIDTHS: Record<InkTool, readonly number[]> = {
  pen: [3, 6, 12],
  highlighter: [14, 24, 40],
  eraser: [16, 32, 64],
};

const HOTKEY_MODIFIERS = MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT;
const Hotkey = { toggleDraw: 1, clear: 2, undo: 3, toggleToolbar: 4, escape: 5 } as const;
const HOTKEY_KEYS: [number, string][] = [
  [Hotkey.toggleDraw, "D"],
  [Hotkey.clear, "C"],
  [Hotkey.undo, "Z"],
  [Hotkey.toggleToolbar, "H"],
];

const Menu = { toggleToolbar: 1, draw: 2, normal: 3, showDrawings: 4, undo: 5, clear: 6, startMenu: 7, exit: 8 } as const;

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function validIndex(value: number | undefined, length: number, fallback: number) {
  return Number.isInteger(value) && value! >= 0 && value! < length ? value! : fallback;
}

class App {
  private readonly settings = loadSettings();
  private tool: Tool = "cursor";
  private lastInkTool: InkTool = "pen";
  private color = validIndex(this.settings.color, COLORS.length, 0);
  private size = validIndex(this.settings.size, SIZE_NAMES.length, 1);
  /** Pen widths are in logical pixels; ink lives on a physical-pixel canvas. */
  private readonly inkScale = user32.GetDpiForSystem() / 96;
  private readonly taskbarCreated = user32.RegisterWindowMessageW(wstr("TaskbarCreated"));
  private readonly main: Handle;
  private readonly overlay: Overlay;
  private readonly toolbar: Toolbar;
  private readonly trayIcon: Handle;
  private readonly tray: TrayIcon;
  private escapeRegistered = false;
  private menuOpen = false;
  private trayHintShown = false;

  constructor() {
    this.main = createWindow(
      { className: MAIN_CLASS, title: "Display Pen", exStyle: WS_EX_TOOLWINDOW, style: WS_POPUP },
      this.handle,
    );
    this.overlay = new Overlay();
    this.overlay.onStrokesChanged = () => this.refresh();
    this.toolbar = new Toolbar(
      this.overlay.hwnd,
      this.settings.toolbar ?? null,
      (command) => this.command(command),
      () => this.save(),
    );
    this.trayIcon = createIcon(user32.GetSystemMetrics(SM_CXSMICON), paintAppIcon);
    this.tray = new TrayIcon(this.main, WM_TRAY, this.trayIcon, "Display Pen");
    this.tray.add();

    for (const [id, letter] of HOTKEY_KEYS) {
      if (!user32.RegisterHotKey(this.main, id, HOTKEY_MODIFIERS, letter.charCodeAt(0))) {
        logError(`Hotkey Ctrl+Alt+Shift+${letter} is already taken by another program`);
      }
    }
    user32.SetTimer(this.main, TOPMOST_TIMER, TOPMOST_INTERVAL_MS, null);
    if (!runningFromSource) {
      try {
        repairStartMenuShortcut(process.execPath);
      } catch (e) {
        logError(e);
      }
    }

    this.setTool("cursor");
    this.toolbar.show();
  }

  private inkStyle(tool: InkTool): InkStyle {
    return { tool, color: COLORS[this.color]!.argb, width: WIDTHS[tool][this.size]! * this.inkScale };
  }

  private setTool(tool: Tool) {
    this.tool = tool;
    this.overlay.eraserWidth = this.inkStyle("eraser").width;
    if (tool !== "cursor") {
      this.lastInkTool = tool;
      this.overlay.style = this.inkStyle(tool);
      this.overlay.setCursor(createBrushCursor(this.overlay.style));
    }
    this.overlay.setInteractive(tool !== "cursor");
    this.setEscapeHotkey(tool !== "cursor");
    this.refresh();
  }

  /** Esc leaves drawing mode, but is only taken from other apps while drawing. */
  private setEscapeHotkey(on: boolean) {
    if (on === this.escapeRegistered) return;
    if (on) this.escapeRegistered = user32.RegisterHotKey(this.main, Hotkey.escape, MOD_NOREPEAT, VK_ESCAPE) !== 0;
    else {
      user32.UnregisterHotKey(this.main, Hotkey.escape);
      this.escapeRegistered = false;
    }
  }

  private refresh() {
    this.toolbar.update({
      tool: this.tool,
      colors: COLORS,
      color: this.color,
      size: this.size,
      sizeNames: SIZE_NAMES,
      canUndo: this.overlay.strokeCount > 0,
    });
  }

  private command(c: ToolbarCommand) {
    switch (c.type) {
      case "tool":
        return this.setTool(c.tool);
      case "color":
        this.color = c.index;
        this.setTool(this.tool === "highlighter" ? "highlighter" : "pen");
        return this.save();
      case "size":
        this.size = c.index;
        this.setTool(this.tool === "cursor" ? this.lastInkTool : this.tool);
        return this.save();
      case "undo":
        return this.overlay.undo();
      case "clear":
        return this.overlay.clear();
      case "hide":
        return this.hideToolbar();
    }
  }

  private toggleDraw() {
    this.setTool(this.tool === "cursor" ? this.lastInkTool : "cursor");
  }

  private showToolbar() {
    this.toolbar.show();
  }

  private hideToolbar() {
    this.toolbar.hide();
    this.setTool("cursor");
    if (!this.trayHintShown) {
      this.trayHintShown = true;
      this.tray.notify("Display Pen is still running", "Click the tray icon to bring the toolbar back.");
    }
  }

  private inStartMenu() {
    if (runningFromSource) return false;
    try {
      return hasStartMenuShortcut(process.execPath);
    } catch (e) {
      logError(e);
      return false;
    }
  }

  private toggleStartMenu() {
    try {
      if (this.inStartMenu()) {
        removeStartMenuShortcut();
      } else {
        addStartMenuShortcut(process.execPath);
        this.tray.notify("Added to the Start menu", "Search for Display Pen in Start to open it.");
      }
    } catch (e) {
      logError(e);
      messageBox(`Could not update the Start menu shortcut:\n\n${errorText(e)}`);
    }
  }

  private showTrayMenu() {
    const hasInk = this.overlay.strokeCount > 0;
    const items: MenuItem[] = [
      { id: Menu.toggleToolbar, label: this.toolbar.visible ? "Hide toolbar\tCtrl+Alt+Shift+H" : "Show toolbar\tCtrl+Alt+Shift+H" },
      "separator",
      { id: Menu.draw, label: "Draw\tCtrl+Alt+Shift+D", checked: this.tool !== "cursor" },
      { id: Menu.normal, label: "Normal mode (mouse)\tEsc", checked: this.tool === "cursor" },
      "separator",
      { id: Menu.showDrawings, label: "Show drawings", checked: this.overlay.drawingsVisible },
      { id: Menu.undo, label: "Undo\tCtrl+Alt+Shift+Z", disabled: !hasInk },
      { id: Menu.clear, label: "Clear all\tCtrl+Alt+Shift+C", disabled: !hasInk },
      "separator",
      {
        id: Menu.startMenu,
        label: runningFromSource ? "Add to Start menu (built exe only)" : "Add to Start menu",
        checked: this.inStartMenu(),
        disabled: runningFromSource,
      },
      { id: Menu.exit, label: "Exit" },
    ];
    this.menuOpen = true;
    const choice = showMenu(this.main, items);
    this.menuOpen = false;
    switch (choice) {
      case Menu.toggleToolbar:
        return this.toolbar.visible ? this.hideToolbar() : this.showToolbar();
      case Menu.draw:
        return this.setTool(this.tool === "cursor" ? this.lastInkTool : this.tool);
      case Menu.normal:
        return this.setTool("cursor");
      case Menu.showDrawings:
        return this.overlay.setDrawingsVisible(!this.overlay.drawingsVisible);
      case Menu.undo:
        return this.overlay.undo();
      case Menu.clear:
        return this.overlay.clear();
      case Menu.startMenu:
        return this.toggleStartMenu();
      case Menu.exit:
        return this.exit();
    }
  }

  private save() {
    saveSettings({ toolbar: this.toolbar.position(), color: this.color, size: this.size });
  }

  private exit() {
    this.save();
    this.tray.remove();
    user32.KillTimer(this.main, TOPMOST_TIMER);
    for (const [id] of HOTKEY_KEYS) user32.UnregisterHotKey(this.main, id);
    this.setEscapeHotkey(false);
    this.toolbar.dispose();
    this.overlay.dispose();
    destroyWindow(this.overlay.hwnd);
    user32.DestroyIcon(this.trayIcon);
    destroyWindow(this.main);
  }

  private readonly handle = (msg: number, wParam: bigint, lParam: bigint) => {
    switch (msg) {
      case WM_TRAY: {
        const event = Number(lParam & 0xffffn);
        if (event === WM_LBUTTONUP) {
          if (this.toolbar.visible) this.hideToolbar();
          else this.showToolbar();
        } else if (event === WM_RBUTTONUP) {
          this.showTrayMenu();
        }
        return 0;
      }
      case WM_SHOW_TOOLBAR:
        this.showToolbar();
        return 0;
      case WM_HOTKEY:
        switch (Number(wParam)) {
          case Hotkey.toggleDraw:
            this.toggleDraw();
            break;
          case Hotkey.clear:
            this.overlay.clear();
            break;
          case Hotkey.undo:
            this.overlay.undo();
            break;
          case Hotkey.toggleToolbar:
            if (this.toolbar.visible) this.hideToolbar();
            else this.showToolbar();
            break;
          case Hotkey.escape:
            this.setTool("cursor");
            break;
        }
        return 0;
      case WM_TIMER:
        // Other always-on-top windows (taskbar, Task Manager...) can end up above us.
        if (wParam === BigInt(TOPMOST_TIMER) && !this.menuOpen) {
          this.overlay.raise();
          this.toolbar.raise();
        }
        return 0;
      case WM_DISPLAYCHANGE:
        this.overlay.fitToScreen();
        this.toolbar.clampToScreen();
        return 0;
      case WM_SETTINGCHANGE:
        this.toolbar.clampToScreen();
        return undefined;
      case WM_CLOSE:
        this.exit();
        return 0;
      case WM_QUERYENDSESSION:
        this.save();
        return 1;
      case WM_ENDSESSION:
        if (wParam) this.tray.remove();
        return 0;
      case WM_DESTROY:
        user32.PostQuitMessage(0);
        return 0;
    }
    if (msg === this.taskbarCreated) {
      this.tray.add();
      return 0;
    }
    return undefined;
  };
}

function main() {
  if (process.platform !== "win32") throw new Error("Display Pen only runs on Windows.");
  user32.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  const running = user32.FindWindowW(wstr(MAIN_CLASS), null);
  if (running) {
    user32.PostMessageW(running, WM_SHOW_TOOLBAR, 0, 0);
    return;
  }

  startGdiplus();
  registerClass(MAIN_CLASS);
  registerClass(OVERLAY_CLASS);
  registerClass(TOOLBAR_CLASS, user32.LoadCursorW(null, IDC_ARROW));
  registerClass(TIP_CLASS);
  new App();
  runMessageLoop();
  shutdownGdiplus();
}

try {
  main();
  process.exit(0);
} catch (e) {
  logError(e);
  messageBox(`Display Pen could not start:\n\n${errorText(e)}`);
  process.exit(1);
}
