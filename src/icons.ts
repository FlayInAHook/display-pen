// Icon font glyphs, the app icon, and the brush-shaped drawing cursors.
import type { Pointer } from "bun:ffi";
import { createIcon, drawText, fillCircle, fillRoundRect, Font, strokeCircle } from "./gfx";
import type { InkStyle } from "./overlay";
import type { Handle } from "./win32";

/** Segoe Fluent Icons ships with Windows 11, Segoe MDL2 Assets with Windows 10. */
export const ICON_FONTS = ["Segoe Fluent Icons", "Segoe MDL2 Assets"];

export const Glyph = {
  cursor: "",
  pen: "",
  highlighter: "",
  eraser: "",
  undo: "",
  clear: "",
  hide: "",
} as const;

export const ACCENT = 0xff2f6fed;

export function paintAppIcon(g: Pointer, size: number) {
  fillRoundRect(g, 0.5, 0.5, size - 1, size - 1, size * 0.22, ACCENT);
  const font = new Font(ICON_FONTS, size * 0.62);
  drawText(g, Glyph.pen, font, 0, 0, size, size, 0xffffffff);
  font.dispose();
}

/** A cursor showing the brush footprint, with its hotspot in the centre. */
export function createBrushCursor(style: InkStyle): Handle {
  const d = Math.max(style.width, 6);
  let size = Math.ceil(d + 7);
  if (size % 2 === 0) size++; // odd size keeps the centre on a pixel
  return createIcon(size, (g, size) => {
    const c = size / 2;
    if (style.tool === "eraser") {
      strokeCircle(g, c, c, d + 2, 0x99000000, 1);
      strokeCircle(g, c, c, d, 0xffffffff, 1.5);
      fillCircle(g, c, c, 2, 0xcc000000);
    } else {
      const alpha = style.tool === "highlighter" ? 0x90000000 : 0xff000000;
      fillCircle(g, c, c, d, ((style.color & 0xffffff) | alpha) >>> 0);
      strokeCircle(g, c, c, d + 1.5, 0xe6ffffff, 1);
      strokeCircle(g, c, c, d + 3.5, 0x66000000, 1);
    }
  });
}
