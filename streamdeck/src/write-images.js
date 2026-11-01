// Writes the static images the manifest refers to (action list icons and default key images).
// The plugin replaces key images with live ones as soon as Display Pen answers.
import fs from "node:fs";
import path from "node:path";
import { glyphs, keySvg, listIcon } from "./icons.js";

const dir = path.join(import.meta.dirname, "..", "com.tim.display-pen.sdPlugin", "imgs");
fs.mkdirSync(dir, { recursive: true });

const images = {
	category: glyphs.pen,
	draw: glyphs.pen,
	tool: glyphs.highlighter,
	color: () => glyphs.swatch("#e53935"),
	size: (c) => glyphs.size(c, 1),
	undo: glyphs.undo,
	clear: glyphs.clear,
	toolbar: glyphs.toolbar,
	drawings: glyphs.eye,
};

for (const [name, glyph] of Object.entries(images)) {
	fs.writeFileSync(path.join(dir, `${name}.svg`), listIcon(glyph));
	if (name !== "category") fs.writeFileSync(path.join(dir, `key-${name}.svg`), keySvg(glyph()));
}
