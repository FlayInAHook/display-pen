// The OBS browser-source page served at /ink: a transparent canvas showing the ink of one monitor.
//   ?monitor=1 (default) primary monitor, 2, 3... the others from left to right, all = every monitor.
// Opened in a normal browser (not OBS) it also shows setup steps with the link for each monitor.
export const INK_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Display Pen Ink</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  canvas { display: block; width: 100vw; height: 100vh; object-fit: contain; }
  /* Setup panel, only outside OBS. */
  html.setup { background: #1b1b1f; color-scheme: dark; }
  #setup { display: none; }
  html.setup #setup {
    display: block; position: fixed; top: 16px; left: 16px; max-width: min(560px, calc(100vw - 32px));
    padding: 20px 22px; border-radius: 12px; background: #26262bee; color: #ececf1;
    font: 14px/1.5 "Segoe UI", system-ui, sans-serif; box-shadow: 0 8px 30px #0008;
  }
  #setup h1 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
  #setup ol { margin: 8px 0 14px; padding-left: 20px; }
  #setup .row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #ffffff14; }
  #setup .name { flex: 1; min-width: 0; }
  #setup .name small { display: block; color: #a0a0ab; font-family: Consolas, monospace; overflow-wrap: anywhere; }
  #setup button, #setup a.btn {
    font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid #ffffff26; background: #ffffff10;
    color: inherit; cursor: pointer; text-decoration: none; white-space: nowrap;
  }
  #setup button:hover, #setup a.btn:hover { background: #ffffff22; }
  #setup .current { outline: 2px solid #5b9dff; outline-offset: -2px; }
  #setup .note { color: #a0a0ab; font-size: 13px; margin: 10px 0 0; }
</style>
</head>
<body>
<canvas id="view"></canvas>
<div id="setup">
  <h1>Show your drawings in OBS</h1>
  <ol>
    <li>In OBS, add a <b>Browser</b> source above your game or window capture.</li>
    <li>Paste the link for your monitor as its URL.</li>
    <li>Set its width and height to the size shown here.</li>
  </ol>
  <div id="monitors">Waiting for Display Pen…</div>
  <p class="note">Ink you draw now shows up behind this box. With Display Capture you don't need this, the ink is already in the picture.</p>
</div>
<script>
"use strict";
const HIGHLIGHTER_ALPHA = 0x70 / 255;
const wanted = (new URLSearchParams(location.search).get("monitor") || "1").toLowerCase();
const view = document.getElementById("view");
const vg = view.getContext("2d");
const done = document.createElement("canvas");
const dg = done.getContext("2d");
let state = { layout: null, strokes: [], active: null, visible: true };
let area = { x: 0, y: 0, w: 1, h: 1 };
let queued = false;

function css(stroke) {
  const c = stroke.color >>> 0;
  const a = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : ((c >>> 24) & 255) / 255;
  return "rgba(" + ((c >>> 16) & 255) + "," + ((c >>> 8) & 255) + "," + (c & 255) + "," + a + ")";
}

function paint(g, s) {
  const p = s.points;
  if (p.length < 2) return;
  g.save();
  g.translate(-area.x, -area.y);
  g.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
  g.strokeStyle = g.fillStyle = s.tool === "eraser" ? "#000" : css(s);
  g.lineWidth = s.width;
  g.lineCap = g.lineJoin = "round";
  g.beginPath();
  if (p.length === 2) {
    g.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2);
    g.fill();
  } else {
    g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
  }
  g.restore();
}

function pickArea() {
  const l = state.layout;
  if (!l) return { x: 0, y: 0, w: 1, h: 1 };
  const s = l.screen;
  const m = wanted === "all" ? s : l.monitors[Number(wanted) - 1] || l.monitors[0] || s;
  return { x: m.left - s.left, y: m.top - s.top, w: m.right - m.left, h: m.bottom - m.top };
}

function repaintAll() {
  area = pickArea();
  if (done.width !== area.w || done.height !== area.h) {
    done.width = view.width = area.w;
    done.height = view.height = area.h;
  }
  dg.clearRect(0, 0, done.width, done.height);
  for (const s of state.strokes) paint(dg, s);
  queue();
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    vg.clearRect(0, 0, view.width, view.height);
    if (!state.visible) return;
    vg.drawImage(done, 0, 0);
    if (state.active) paint(vg, state.active);
  });
}

function onEvent(e) {
  switch (e.t) {
    case "state":
      state = e;
      renderSetup();
      return repaintAll();
    case "layout":
      state.layout = e.layout;
      renderSetup();
      return repaintAll();
    case "strokes":
      state.strokes = e.strokes;
      state.active = null;
      return repaintAll();
    case "visible":
      state.visible = e.on;
      return queue();
    case "begin":
      state.active = e.stroke;
      return queue();
    case "point":
      if (state.active) state.active.points.push(e.x, e.y);
      return queue();
    case "end":
      if (state.active) {
        state.strokes.push(state.active);
        paint(dg, state.active);
        state.active = null;
      }
      return queue();
  }
}

const inObs = typeof window.obsstudio !== "undefined";
if (!inObs) document.documentElement.classList.add("setup");

function renderSetup() {
  if (inObs || !state.layout) return;
  const l = state.layout;
  const base = location.origin + location.pathname;
  const rows = l.monitors.map((m, i) => ({
    key: String(i + 1),
    name: "Monitor " + (i + 1) + (m.primary ? " (primary)" : ""),
    r: m,
  }));
  if (l.monitors.length > 1) rows.push({ key: "all", name: "All monitors", r: l.screen });
  const box = document.getElementById("monitors");
  box.textContent = "";
  for (const row of rows) {
    const url = row.key === "1" ? base : base + "?monitor=" + row.key;
    const el = document.createElement("div");
    el.className = "row" + (row.key === wanted ? " current" : "");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = row.name + " · " + (row.r.right - row.r.left) + " × " + (row.r.bottom - row.r.top);
    const link = document.createElement("small");
    link.textContent = url;
    name.append(link);
    const copy = document.createElement("button");
    copy.textContent = "Copy link";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy failed";
      }
      setTimeout(() => (copy.textContent = "Copy link"), 1500);
    };
    const preview = document.createElement("a");
    preview.className = "btn";
    preview.href = url;
    preview.textContent = "Preview";
    el.append(name, copy, preview);
    box.append(el);
  }
}

function connect() {
  const ws = new WebSocket("ws://" + location.host + "/ink/ws");
  ws.onmessage = (m) => onEvent(JSON.parse(m.data));
  ws.onclose = () => {
    // Display Pen was closed or restarted: show nothing until it is back.
    state = { layout: state.layout, strokes: [], active: null, visible: true };
    repaintAll();
    setTimeout(connect, 1000);
  };
}
connect();
</script>
</body>
</html>
`;
