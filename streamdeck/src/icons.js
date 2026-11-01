// Key and action-list artwork as SVG (144×144). Glyphs take the colour to draw in; `ink` tints pen tips.
const LIGHT = "#e8ecf2";
const DARK = "#1e2430";
const ACTIVE = "#2f6fdb";

const tilted = (body) => `<g transform="rotate(45 72 72)">${body}</g>`;

export const glyphs = {
	pen: (c = LIGHT, ink = c) =>
		tilted(`<rect x="60" y="18" width="24" height="76" rx="5" fill="${c}"/><path d="M60 98h24l-12 26z" fill="${ink}"/>`),
	highlighter: (c = LIGHT, ink = c) =>
		tilted(
			`<rect x="54" y="18" width="36" height="64" rx="6" fill="${c}"/><rect x="54" y="84" width="36" height="10" fill="${ink}"/>` +
				`<path d="M60 96h24v14l-24 10z" fill="${ink}"/>`,
		),
	eraser: (c = LIGHT) =>
		tilted(
			`<rect x="50" y="24" width="44" height="96" rx="10" fill="#f48fb1"/>` +
				`<path d="M50 34a10 10 0 0 1 10-10h24a10 10 0 0 1 10 10v50H50z" fill="${c}"/>`,
		),
	cursor: (c = LIGHT) =>
		`<path d="M48 24v88l23-21 15 32 15-7-15-31h31z" fill="${c}" stroke="${DARK}" stroke-width="4" stroke-linejoin="round"/>`,
	undo: (c = LIGHT) =>
		`<g fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">` +
		`<path d="M52 60h40a22 22 0 0 1 0 44H62"/><path d="M72 38 50 60l22 22"/></g>`,
	clear: (c = LIGHT) =>
		`<path d="M40 44h64" stroke="${c}" stroke-width="10" stroke-linecap="round"/>` +
		`<path d="M60 42v-8h24v8" fill="none" stroke="${c}" stroke-width="8" stroke-linejoin="round"/>` +
		`<path d="M50 54h44l-5 62H55z" fill="${c}"/>`,
	toolbar: (c = LIGHT) =>
		`<rect x="54" y="18" width="36" height="108" rx="12" fill="none" stroke="${c}" stroke-width="8"/>` +
		[44, 72, 100].map((y) => `<circle cx="72" cy="${y}" r="8" fill="${c}"/>`).join(""),
	eye: (c = LIGHT) =>
		`<path d="M18 72q54-58 108 0q-54 58-108 0z" fill="none" stroke="${c}" stroke-width="9" stroke-linejoin="round"/>` +
		`<circle cx="72" cy="72" r="15" fill="${c}"/>`,
	eyeOff: (c = LIGHT, bg = DARK) =>
		glyphs.eye(c) +
		`<path d="M36 112 108 32" stroke="${bg}" stroke-width="22" stroke-linecap="round"/>` +
		`<path d="M36 112 108 32" stroke="${c}" stroke-width="9" stroke-linecap="round"/>`,
	swatch: (fill = LIGHT) => `<circle cx="72" cy="72" r="40" fill="${fill}" stroke="#5a6270" stroke-width="3"/>`,
	/** Size 0-2 as a dot. */
	size: (c = LIGHT, size = 1) => `<circle cx="72" cy="72" r="${[10, 20, 32][size]}" fill="${c}"/>`,
	/** Small circular arrow in the corner, marking "next" keys. */
	cycle: (c = LIGHT) =>
		`<g fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">` +
		`<path d="M128 110a16 16 0 1 1-6-16"/><path d="M124 84v12h-12"/></g>`,
};

/**
 * A full key image as SVG: `content` (markup, or a function of the background colour) on the key background.
 * active: highlighted background. ring: white ring (selected colour). dim: offline / unavailable.
 */
export function keySvg(content, { active = false, ring = false, dim = false } = {}) {
	const bg = active ? ACTIVE : DARK;
	const body = typeof content === "function" ? content(bg) : content;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${bg}"/>` +
		(ring ? `<circle cx="72" cy="72" r="54" fill="none" stroke="#ffffff" stroke-width="7"/>` : "") +
		`<g opacity="${dim ? 0.35 : 1}">${body}</g></svg>`
	);
}

/** keySvg as a data URL for setImage. */
export function keyImage(content, options) {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(keySvg(content, options))}`;
}

/** A white glyph on transparent background, for the action list and category. */
export function listIcon(glyph) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${glyph("#ffffff")}</svg>`;
}
