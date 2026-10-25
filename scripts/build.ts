// Builds the portable dist/display-pen.exe (with an icon generated from the same artwork as the tray icon).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shutdownGdiplus, startGdiplus, Surface } from "../src/gfx";
import { paintAppIcon } from "../src/icons";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const iconPath = join(dist, "display-pen.ico");
const exePath = join(dist, "display-pen.exe");
const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

/** One ICO image: a bottom-up 32bpp BMP (straight alpha) followed by an empty AND mask. */
function iconImage(size: number): Buffer {
  const surface = new Surface(size, size);
  surface.clear(0);
  paintAppIcon(surface.g, size);
  const px = surface.pixels(); // premultiplied BGRA, top-down
  const maskRow = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8); // colour + mask
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = 40 + (y * size + x) * 4;
      const a = px[src + 3];
      for (let c = 0; c < 3; c++) out[dst + c] = a ? Math.min(255, Math.round((px[src + c] * 255) / a)) : 0;
      out[dst + 3] = a;
    }
  }
  surface.dispose();
  return out;
}

function iconFile(sizes: number[]): Buffer {
  const images = sizes.map(iconImage);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

mkdirSync(dist, { recursive: true });
startGdiplus();
writeFileSync(iconPath, iconFile(ICON_SIZES));
shutdownGdiplus();
console.log(`icon   ${iconPath}`);

const build = Bun.spawnSync(
  [
    process.execPath,
    "build",
    join(root, "src", "main.ts"),
    "--compile",
    "--minify",
    "--windows-hide-console",
    `--windows-icon=${iconPath}`,
    "--windows-title=Display Pen",
    `--windows-description=${pkg.description}`,
    `--windows-version=${pkg.version}.0`,
    "--outfile",
    exePath,
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
console.log(`exe    ${exePath}`);
