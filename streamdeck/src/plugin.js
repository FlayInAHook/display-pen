import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { COLORS } from "../../src/palette.ts";
import { glyphs, keyImage } from "./icons.js";

// The control API that Display Pen serves while it runs (src/remote-worker.ts).
const SERVER = "http://127.0.0.1:8766";
const POLL_MS = 500;
const LAUNCH_WAIT_MS = 8000;

// The .sdPlugin folder is linked from the project, so the real path points next to ../../dist.
const exePath = path.resolve(fs.realpathSync(process.cwd()), "..", "..", "dist", "display-pen.exe");

const hex = (argb) => "#" + (argb & 0xffffff).toString(16).padStart(6, "0");
const COLOR_HEX = COLORS.map((c) => hex(c.argb));

async function call(method, route) {
	try {
		const res = await fetch(SERVER + route, { method, signal: AbortSignal.timeout(3000) });
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

const getStatus = () => call("GET", "/status");

let launching = null;

/** Starts the built exe and waits until its API answers. */
function launch() {
	launching ??= (async () => {
		if (!fs.existsSync(exePath)) {
			streamDeck.logger.warn(`Display Pen is not running and ${exePath} does not exist`);
			return null;
		}
		streamDeck.logger.info(`Starting ${exePath}`);
		spawn(exePath, [], { detached: true, stdio: "ignore" }).unref();
		const deadline = Date.now() + LAUNCH_WAIT_MS;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 250));
			const status = await getStatus();
			if (status) return status;
		}
		return null;
	})().finally(() => (launching = null));
	return launching;
}

let status = null;

class PenAction extends SingletonAction {
	settings = new Map();
	shown = new Map();

	/** The key image for the current status (null = Display Pen not running). */
	image(status, settings) {
		throw new Error("not implemented");
	}

	/** The API route a key press calls. */
	route(status, settings) {
		throw new Error("not implemented");
	}

	async render(action) {
		if (!action.isKey()) return;
		const image = this.image(status, this.settings.get(action.id) ?? {});
		const title = status ? "" : "offline";
		const key = image + "|" + title;
		if (this.shown.get(action.id) === key) return;
		this.shown.set(action.id, key);
		await action.setImage(image);
		await action.setTitle(title);
	}

	async onWillAppear(ev) {
		this.settings.set(ev.action.id, ev.payload.settings);
		this.shown.delete(ev.action.id);
		await this.render(ev.action);
	}

	onWillDisappear(ev) {
		this.settings.delete(ev.action.id);
		this.shown.delete(ev.action.id);
	}

	async onDidReceiveSettings(ev) {
		this.settings.set(ev.action.id, ev.payload.settings);
		await this.render(ev.action);
	}

	async onKeyDown(ev) {
		const current = (await getStatus()) ?? (await launch());
		const next = current && (await call("POST", this.route(current, ev.payload.settings)));
		if (!next) {
			await ev.action.showAlert();
			return;
		}
		status = next;
		await renderAll();
	}
}

/** Switches between drawing (with the last ink tool) and normal mouse use. */
class DrawToggle extends PenAction {
	manifestId = "com.tim.display-pen.draw";

	image(s) {
		const tool = s?.inkTool ?? "pen";
		const ink = s ? COLOR_HEX[s.color] : undefined;
		return keyImage(glyphs[tool](undefined, ink), { active: s && s.tool !== "cursor", dim: !s });
	}

	route() {
		return "/draw";
	}
}

/** Picks one tool; pressing the active ink tool again goes back to the mouse. */
class ToolPicker extends PenAction {
	manifestId = "com.tim.display-pen.tool";

	tool(settings) {
		return ["cursor", "pen", "highlighter", "eraser"].includes(settings.tool) ? settings.tool : "pen";
	}

	image(s, settings) {
		const tool = this.tool(settings);
		const ink = s ? COLOR_HEX[s.color] : undefined;
		return keyImage(glyphs[tool](undefined, ink), { active: s?.tool === tool, dim: !s });
	}

	route(s, settings) {
		const tool = this.tool(settings);
		return `/tool/${s.tool === tool && tool !== "cursor" ? "cursor" : tool}`;
	}
}

/** One ink colour, or "next" to cycle through them. Choosing a colour starts drawing. */
class ColorPicker extends PenAction {
	manifestId = "com.tim.display-pen.color";

	color(settings) {
		const i = Number(settings.color ?? 0);
		return settings.color === "next" ? "next" : Number.isInteger(i) && COLORS[i] ? i : 0;
	}

	image(s, settings) {
		const color = this.color(settings);
		if (color === "next") {
			return keyImage(glyphs.swatch(s ? COLOR_HEX[s.color] : undefined) + glyphs.cycle(), { dim: !s });
		}
		return keyImage(glyphs.swatch(COLOR_HEX[color]), { ring: s?.color === color, dim: !s });
	}

	route(s, settings) {
		const color = this.color(settings);
		return `/color/${color === "next" ? (s.color + 1) % COLORS.length : color}`;
	}
}

/** One size (thin / medium / thick), or "next" to cycle through them. */
class SizePicker extends PenAction {
	manifestId = "com.tim.display-pen.size";

	size(settings) {
		const i = Number(settings.size ?? 1);
		return settings.size === "next" ? "next" : [0, 1, 2].includes(i) ? i : 1;
	}

	image(s, settings) {
		const size = this.size(settings);
		if (size === "next") return keyImage(glyphs.size(undefined, s?.size ?? 1) + glyphs.cycle(), { dim: !s });
		return keyImage(glyphs.size(undefined, size), { active: s?.size === size, dim: !s });
	}

	route(s, settings) {
		const size = this.size(settings);
		return `/size/${size === "next" ? (s.size + 1) % 3 : size}`;
	}
}

class Undo extends PenAction {
	manifestId = "com.tim.display-pen.undo";

	image(s) {
		return keyImage(glyphs.undo(), { dim: !s?.canUndo });
	}

	route() {
		return "/undo";
	}
}

class Clear extends PenAction {
	manifestId = "com.tim.display-pen.clear";

	image(s) {
		return keyImage(glyphs.clear(), { dim: !s?.canUndo });
	}

	route() {
		return "/clear";
	}
}

class ToolbarToggle extends PenAction {
	manifestId = "com.tim.display-pen.toolbar";

	image(s) {
		return keyImage(glyphs.toolbar(), { active: !!s?.toolbar, dim: !s });
	}

	route() {
		return "/toolbar/toggle";
	}
}

class DrawingsToggle extends PenAction {
	manifestId = "com.tim.display-pen.drawings";

	image(s) {
		const visible = !s || s.drawings;
		return keyImage((bg) => (visible ? glyphs.eye() : glyphs.eyeOff(undefined, bg)), { dim: !s });
	}

	route() {
		return "/drawings/toggle";
	}
}

const actions = [
	new DrawToggle(),
	new ToolPicker(),
	new ColorPicker(),
	new SizePicker(),
	new Undo(),
	new Clear(),
	new ToolbarToggle(),
	new DrawingsToggle(),
];

async function renderAll() {
	for (const a of actions) for (const action of a.actions) await a.render(action);
}

actions.forEach((a) => streamDeck.actions.registerAction(a));
await streamDeck.connect();

// Keep key images in sync with Display Pen, which can also change from its toolbar, tray and hotkeys.
let polling = false;
setInterval(async () => {
	if (polling || !actions.some((a) => [...a.actions].length)) return;
	polling = true;
	try {
		status = await getStatus();
		await renderAll();
	} finally {
		polling = false;
	}
}, POLL_MS);
