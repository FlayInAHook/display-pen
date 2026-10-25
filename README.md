# display-pen

Draw on top of your whole screen, Epic Pen style. A floating, always-on-top toolbar switches between
drawing and normal mouse use; the app lives in the system tray. Windows 10/11 only.

Built with [Bun](https://bun.sh): plain Win32, GDI and GDI+ calls through `bun:ffi` (no Electron, no
WebView), compiled into a single portable `.exe`.

## Use

| Toolbar | |
| --- | --- |
| ⠿ (top) / empty space | Drag to move the toolbar anywhere |
| Arrow | **Normal mode**: the mouse works as usual, drawings stay on screen |
| Pen / Highlighter / Eraser | Draw on the screen. Right-drag erases with any tool |
| Colour swatches | Ink colour |
| Three dots | Thin / medium / thick |
| Undo, Trash | Undo the last stroke, clear everything |
| — (bottom) | Hide to the tray |

The tray icon: **left-click** shows or hides the toolbar, **right-click** opens a menu (draw/normal mode,
show or hide drawings, undo, clear, Start menu, exit).

**Start menu:** tick *Add to Start menu* in the tray menu to put a "Display Pen" shortcut in your Start menu
(per user, no admin rights needed); untick it to remove it. If you later move the exe, start it once from
its new place and the shortcut follows it. This only works in the built exe, not with `bun run start`.

Global shortcuts:

| Keys | Action |
| --- | --- |
| `Ctrl+Alt+Shift+D` | Toggle drawing / normal mode |
| `Esc` | Back to normal mode (only while drawing) |
| `Ctrl+Alt+Shift+Z` | Undo |
| `Ctrl+Alt+Shift+C` | Clear all |
| `Ctrl+Alt+Shift+H` | Show / hide the toolbar |

Toolbar position, colour and size are saved to `display-pen.json` next to the exe. Starting the exe again
while it is running just brings the toolbar back.

## Develop

```bash
bun install
```

```bash
bun run start
```

```bash
bun run typecheck
```

## Build the portable exe

```bash
bun run build
```

This writes `dist/display-pen.exe` (no console window, with an icon generated from the same artwork as
the tray icon). Copy the exe anywhere and run it; nothing needs to be installed.

## How it works

- `src/overlay.ts`: a layered, topmost window covering all monitors. Ink is drawn with GDI+ into a
  premultiplied 32-bit bitmap and shown with `UpdateLayeredWindowIndirect`, updating only the dirty
  rectangle. Empty pixels have alpha 1, which is invisible but still receives clicks, so the whole screen
  can be drawn on. In normal mode the window gets `WS_EX_TRANSPARENT`, so clicks pass through.
- `src/toolbar.ts`: the toolbar, a second layered window owned by the overlay (so it always stays above
  it), with `WS_EX_NOACTIVATE` so clicking it never steals focus from the app you are presenting.
- `src/tray.ts`: notification-area icon and menu. `src/main.ts`: app state, hotkeys, message loop.
- `src/shortcut.ts`: the Start menu shortcut, written through the `IShellLinkW` COM interface.
- `src/win32.ts`, `src/window.ts`, `src/gfx.ts`: FFI bindings, window procedure dispatch, drawing helpers.
