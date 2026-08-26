const token = new URLSearchParams(location.search).get("token") || "";
const statusEl = document.getElementById("status");
const listEl = document.getElementById("cameras");
const nameEl = document.getElementById("cam-name");
const metaEl = document.getElementById("cam-meta");
const nametagsEl = document.getElementById("nametags");
const recEl = document.getElementById("rec");
const clockEl = document.getElementById("clock");
const channelEl = document.getElementById("cam-channel");
const coordsEl = document.getElementById("cam-coords");
const countEl = document.getElementById("cam-count");
const nosignalEl = document.getElementById("nosignal");
const canvas = document.getElementById("view");
const gl = canvas.getContext("webgl", { antialias: false, alpha: false });

let cameras = [];
let currentId = null;
let socket = null;
let mesh = null;
let atlasTex = null;
let hasAtlas = 0;
let atlasLoading = false;
let pendingMesh = null;
let pendingPatches = [];
let players = [];
let mobs = [];
let breaking = [];
let particles = [];
let items = [];
let eye = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 };
let loaded = false;
let sky = { r: 0.47, g: 0.65, b: 1, fogR: 0.55, fogG: 0.72, fogB: 0.98, fogNear: 34, fogFar: 52, bright: 1, angle: 0 };
const skins = new Map();
const itemTex = new Map();
const armorTex = new Map();
const poses = new Map();
const chestGeom = new Map();
let lastFrame = performance.now();
let animClock = 0;

const vs = `
attribute vec3 aPos;
attribute vec2 aUv;
attribute vec3 aCol;
attribute float aTile;
uniform mat4 uViewProj;
uniform float uTiles;
uniform vec3 uEye;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying vec3 vCol;
varying float vFog;
void main() {
	float tiles = max(uTiles, 1.0);
	float col = mod(aTile, tiles);
	float row = floor(aTile / tiles);
	float pad = tiles > 1.5 ? 0.5 / 16.0 : 0.0;
	vUv = vec2((col + mix(pad, 1.0 - pad, aUv.x)) / tiles, (row + mix(pad, 1.0 - pad, aUv.y)) / tiles);
	vCol = aCol;
	float dist = length(aPos - uEye);
	float span = max(uFogFar - uFogNear, 0.001);
	float fog = clamp((dist - uFogNear) / span, 0.0, 1.0);
	fog = fog * fog * (3.0 - 2.0 * fog);
	vFog = fog * 0.62;
	gl_Position = uViewProj * vec4(aPos, 1.0);
}`;
const fs = `
precision mediump float;
varying vec2 vUv;
varying vec3 vCol;
varying float vFog;
uniform sampler2D uAtlas;
uniform float uHasAtlas;
uniform vec3 uFogColor;
uniform float uAlphaPass;
void main() {
	vec4 tex = uHasAtlas > 0.5 ? texture2D(uAtlas, vUv) : vec4(1.0);
	if (uAlphaPass > 0.5 && tex.a < 0.5) discard;
	vec3 col = tex.rgb * vCol;
	gl_FragColor = vec4(mix(col, uFogColor, vFog), tex.a);
}`;
const skyVs = `
attribute vec3 aPos;
attribute vec3 aCol;
uniform mat4 uViewProj;
varying vec3 vCol;
void main() {
	vCol = aCol;
	gl_Position = uViewProj * vec4(aPos, 1.0);
}`;
const skyFs = `
precision mediump float;
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }`;

function compile(type, src) {
	const s = gl.createShader(type);
	gl.shaderSource(s, src);
	gl.compileShader(s);
	return s;
}
function makeProg(vsrc, fsrc) {
	const p = gl.createProgram();
	gl.attachShader(p, compile(gl.VERTEX_SHADER, vsrc));
	gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsrc));
	gl.linkProgram(p);
	return p;
}
const prog = makeProg(vs, fs);
const skyProg = makeProg(skyVs, skyFs);
const loc = {
	pos: gl.getAttribLocation(prog, "aPos"),
	uv: gl.getAttribLocation(prog, "aUv"),
	col: gl.getAttribLocation(prog, "aCol"),
	tile: gl.getAttribLocation(prog, "aTile"),
	viewProj: gl.getUniformLocation(prog, "uViewProj"),
	tiles: gl.getUniformLocation(prog, "uTiles"),
	atlas: gl.getUniformLocation(prog, "uAtlas"),
	hasAtlas: gl.getUniformLocation(prog, "uHasAtlas"),
	eye: gl.getUniformLocation(prog, "uEye"),
	fogNear: gl.getUniformLocation(prog, "uFogNear"),
	fogFar: gl.getUniformLocation(prog, "uFogFar"),
	fogColor: gl.getUniformLocation(prog, "uFogColor"),
	alphaPass: gl.getUniformLocation(prog, "uAlphaPass")
};
const skyLoc = {
	pos: gl.getAttribLocation(skyProg, "aPos"),
	col: gl.getAttribLocation(skyProg, "aCol"),
	viewProj: gl.getUniformLocation(skyProg, "uViewProj")
};
const buf = gl.createBuffer();
const skyBuf = gl.createBuffer();
const terrainBufs = {
	opaque: gl.createBuffer(),
	cutout: gl.createBuffer(),
	trans: gl.createBuffer()
};
let atlasPixels = null;
let tileKind = null;
let terrainGen = 0;
let terrainUploaded = -1;
let skyCache = null;
let skyCacheKey = "";
let skyBufKey = "";
let poseStamp = 0;
atlasTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, atlasTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const crackTex = { tex: gl.createTexture(), ready: false, tiles: 4 };
gl.bindTexture(gl.TEXTURE_2D, crackTex.tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
fetch("/api/destroy.png").then(r => r.ok ? r.blob() : Promise.reject()).then(blob => createImageBitmap(blob)).then(img => {
	gl.bindTexture(gl.TEXTURE_2D, crackTex.tex);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
	crackTex.ready = true;
}).catch(() => { crackTex.ready = false; });

function mat4() { return new Float32Array(16); }
function identity(m) {
	m.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
	return m;
}
function perspective(out, fovy, aspect, near, far) {
	const f = 1 / Math.tan(fovy / 2);
	out.fill(0);
	out[0] = f / aspect;
	out[5] = f;
	out[10] = (far + near) / (near - far);
	out[11] = -1;
	out[14] = (2 * far * near) / (near - far);
	return out;
}
function look(out, eyePos, yawDeg, pitchDeg) {
	const yaw = yawDeg * Math.PI / 180;
	const pitch = pitchDeg * Math.PI / 180;
	const dx = -Math.sin(yaw) * Math.cos(pitch);
	const dy = -Math.sin(pitch);
	const dz = Math.cos(yaw) * Math.cos(pitch);
	const z0 = -dx, z1 = -dy, z2 = -dz;
	let x0 = z2, x1 = 0, x2 = -z0;
	let xlen = Math.hypot(x0, x1, x2);
	if (xlen < 1e-6) {
		x0 = 1;
		x1 = 0;
		x2 = 0;
		xlen = 1;
	}
	x0 /= xlen;
	x1 /= xlen;
	x2 /= xlen;
	const y0 = z1 * x2 - z2 * x1;
	const y1 = z2 * x0 - z0 * x2;
	const y2 = z0 * x1 - z1 * x0;
	out.set([
		x0, y0, z0, 0,
		x1, y1, z1, 0,
		x2, y2, z2, 0,
		-(x0 * eyePos.x + x1 * eyePos.y + x2 * eyePos.z),
		-(y0 * eyePos.x + y1 * eyePos.y + y2 * eyePos.z),
		-(z0 * eyePos.x + z1 * eyePos.y + z2 * eyePos.z),
		1
	]);
	return out;
}
function mul(a, b) {
	const o = mat4();
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			o[i * 4 + j] =
				a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
		}
	}
	return o;
}

function resize() {
	const dpr = Math.min(devicePixelRatio || 1, 2);
	canvas.width = canvas.clientWidth * dpr;
	canvas.height = canvas.clientHeight * dpr;
	gl.viewport(0, 0, canvas.width, canvas.height);
}
addEventListener("resize", resize);
resize();

function sceneLight() {
	return 0.42 + 0.58 * (sky.bright == null ? 1 : sky.bright);
}
function applySky(msg) {
	if (!msg) return;
	if (msg.skyR != null) sky.r = msg.skyR;
	if (msg.skyG != null) sky.g = msg.skyG;
	if (msg.skyB != null) sky.b = msg.skyB;
	if (msg.fogR != null) sky.fogR = msg.fogR;
	if (msg.fogG != null) sky.fogG = msg.fogG;
	if (msg.fogB != null) sky.fogB = msg.fogB;
	if (msg.fogNear != null) sky.fogNear = msg.fogNear;
	if (msg.fogFar != null) sky.fogFar = msg.fogFar;
	if (msg.skyBrightness != null) sky.bright = msg.skyBrightness;
	if (msg.skyAngle != null) sky.angle = msg.skyAngle;
}
function lerp(a, b, t) {
	return a + (b - a) * t;
}
function lerpAngle(a, b, t) {
	let d = (b - a) % 360;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return a + d * t;
}
function wrapDeg(d) {
	d %= 360;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}
function tickFlap(st, dt) {
	if (st.flap == null && st.wing == null) return;
	const ticks = Math.min(2, dt * 20);
	const grounded = !st.air;
	if (st.flapSpeed == null) st.flapSpeed = 1;
	st.flap = st.flap || 0;
	st.wing = st.wing || 0;
	st.wing += (grounded ? -1 : 4) * 0.3 * ticks;
	st.wing = Math.max(0, Math.min(1, st.wing));
	if (!grounded && st.flapSpeed < 1) st.flapSpeed = 1;
	st.flapSpeed *= Math.pow(0.9, ticks);
	st.flap += st.flapSpeed * 2 * ticks;
}
function entityKey(e) {
	return e.uuid || e.name || "?";
}
function poseOf(e) {
	return {
		x: e.x, y: e.y, z: e.z,
		yaw: e.yaw || 0,
		pitch: e.pitch || 0,
		bodyYaw: e.bodyYaw != null ? e.bodyYaw : (e.yaw || 0),
		headYaw: e.headYaw != null ? e.headYaw : (e.yaw || 0)
	};
}
function ingestChests(list) {
	const seen = new Set();
	for (const e of list) {
		const id = "chest:" + (e.uuid || (e.x + "," + e.y + "," + e.z));
		seen.add(id);
		const prev = poses.get(id);
		poses.set(id, Object.assign({}, e, {
			kind: "chest",
			lid: prev && prev.lid != null ? prev.lid : (e.open ? 1 : 0),
			open: !!e.open
		}));
	}
	for (const id of [...poses.keys()]) {
		if (id.startsWith("chest:") && !seen.has(id)) poses.delete(id);
	}
	stealChestVerts();
}
function ingestEntities(list, kind) {
	if (kind === "chest") {
		ingestChests(list);
		return;
	}
	const now = performance.now();
	const seen = new Set();
	for (const e of list) {
		const id = kind + ":" + entityKey(e);
		seen.add(id);
		const prev = poses.get(id);
		const to = poseOf(e);
		const from = prev ? { x: prev.x, y: prev.y, z: prev.z, yaw: prev.yaw, pitch: prev.pitch, bodyYaw: prev.bodyYaw, headYaw: prev.headYaw != null ? prev.headYaw : prev.yaw } : to;
		const interval = prev && prev.t0 ? Math.min(250, Math.max(60, now - prev.t0)) : 100;
		const incomingSwing = !!(e.swinging || (e.swing || 0) > 0.02);
		const retrigger = incomingSwing && prev && prev.localSwing > 0.4 && (e.swing || 0) + 0.15 < (prev.swing || 0);
		const startSwing = incomingSwing && (!prev || !prev.playingSwing || retrigger);
		poses.set(id, Object.assign({}, e, {
			kind,
			from,
			to,
			t0: now,
			dur: interval,
			limb: prev ? prev.limb : 0,
			amt: prev ? prev.amt : 0,
			x: from.x, y: from.y, z: from.z,
			yaw: from.yaw, pitch: from.pitch, bodyYaw: from.bodyYaw, headYaw: from.headYaw,
			playingSwing: startSwing ? true : (prev ? prev.playingSwing : false),
			localSwing: startSwing ? 0 : (prev ? prev.localSwing : 0),
			flap: prev && prev.flap != null ? prev.flap : e.flap,
			wing: prev && prev.wing != null ? prev.wing : e.wing,
			flapSpeed: prev && prev.flapSpeed != null ? prev.flapSpeed : 1
		}));
	}
	for (const id of [...poses.keys()]) {
		if (id.startsWith(kind + ":") && !seen.has(id)) poses.delete(id);
	}
}
function tickPoses(dt) {
	const now = performance.now();
	const playersOut = [];
	const mobsOut = [];
	const tntOut = [];
	const framesOut = [];
	const signsOut = [];
	const chestsOut = [];
	for (const st of poses.values()) {
		if (st.kind === "chest") {
			const target = st.open ? 1 : 0;
			st.lid = st.lid || 0;
			if (st.lid < target) st.lid = Math.min(target, st.lid + dt * 2);
			else if (st.lid > target) st.lid = Math.max(target, st.lid - dt * 2);
			chestsOut.push(st);
			continue;
		}
		const t = st.dur ? Math.min(1, (now - st.t0) / st.dur) : 1;
		const s = t * t * (3 - 2 * t);
		const nx = lerp(st.from.x, st.to.x, s);
		const ny = lerp(st.from.y, st.to.y, s);
		const nz = lerp(st.from.z, st.to.z, s);
		const dist = Math.hypot(nx - st.x, nz - st.z);
		st.limb += Math.min(dist * 4, 20 * dt);
		const bps = dt > 1e-4 ? dist / dt : 0;
		const targetAmt = Math.min(1, bps / 5);
		st.amt += (targetAmt - st.amt) * Math.min(1, dt * 8);
		st.x = nx;
		st.y = ny;
		st.z = nz;
		st.yaw = lerpAngle(st.from.yaw, st.to.yaw, s);
		st.pitch = lerp(st.from.pitch, st.to.pitch, s);
		st.bodyYaw = lerpAngle(st.from.bodyYaw, st.to.bodyYaw, s);
		st.headYaw = lerpAngle(st.from.headYaw, st.to.headYaw, s);
		if (st.playingSwing) {
			st.localSwing += dt / 0.3;
			if (st.localSwing >= 1) {
				st.localSwing = 0;
				st.playingSwing = false;
			}
		} else {
			st.localSwing = 0;
		}
		tickFlap(st, dt);
		if (st.kind === "player") playersOut.push(st);
		else if (st.kind === "mob") mobsOut.push(st);
		else if (st.kind === "tnt") tntOut.push(st);
		else if (st.kind === "frame") framesOut.push(st);
		else if (st.kind === "sign") signsOut.push(st);
	}
	return { players: playersOut, mobs: mobsOut, tnt: tntOut, frames: framesOut, signs: signsOut, chests: chestsOut };
}

function parseMesh(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 36 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "MCCT") return;
	const version = view.getUint32(4, true);
	const vf = version >= 2 ? 12 : 9;
	let o = 8;
	eye.x = view.getFloat32(o, true); o += 4;
	eye.y = view.getFloat32(o, true); o += 4;
	eye.z = view.getFloat32(o, true); o += 4;
	eye.yaw = view.getFloat32(o, true); o += 4;
	eye.pitch = view.getFloat32(o, true); o += 4;
	const tiles = view.getUint32(o, true); o += 4;
	const count = view.getUint32(o, true); o += 4;
	const floats = count * vf;
	let data;
	if ((bytes.byteOffset + o) % 4 === 0) {
		data = new Float32Array(bytes.buffer, bytes.byteOffset + o, floats).slice();
	} else {
		data = new Float32Array(floats);
		for (let i = 0; i < floats; i++, o += 4) data[i] = view.getFloat32(o, true);
	}
	mesh = { data, count, tiles, vf };
	chestGeom.clear();
	if (pendingPatches.length) {
		const queued = pendingPatches;
		pendingPatches = [];
		for (const patch of queued) parsePatch(patch);
	} else {
		refreshTerrain();
		stealChestVerts();
	}
}

function captureAtlasPixels(img) {
	const c = document.createElement("canvas");
	c.width = img.width;
	c.height = img.height;
	const ctx = c.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(img, 0, 0);
	atlasPixels = ctx.getImageData(0, 0, img.width, img.height);
}

function classifyTiles() {
	tileKind = null;
	if (!atlasPixels || !mesh || !mesh.tiles) return;
	const n = mesh.tiles;
	const tw = atlasPixels.width / n;
	const th = atlasPixels.height / n;
	if (!(tw >= 1 && th >= 1)) return;
	const kinds = new Uint8Array(n * n);
	const pix = atlasPixels.data;
	const w = atlasPixels.width;
	for (let t = 0; t < kinds.length; t++) {
		const col = t % n;
		const row = (t / n) | 0;
		const x0 = (col * tw) | 0;
		const y0 = (row * th) | 0;
		const x1 = ((col + 1) * tw) | 0;
		const y1 = ((row + 1) * th) | 0;
		let minA = 255, maxA = 0, mid = 0;
		for (let y = y0; y < y1; y++) {
			for (let x = x0; x < x1; x++) {
				const a = pix[(y * w + x) * 4 + 3];
				if (a < minA) minA = a;
				if (a > maxA) maxA = a;
				if (a > 28 && a < 242) mid++;
			}
		}
		if (maxA < 28) kinds[t] = 1;
		else if (mid > 4) kinds[t] = 2;
		else if (minA < 28 && maxA > 28) kinds[t] = 1;
		else kinds[t] = 0;
	}
	tileKind = kinds;
}

function splitTerrain() {
	if (!mesh) return;
	const vf = mesh.vf || 9;
	const tri = vf * 3;
	const d = mesh.data;
	const kinds = tileKind;
	let n0 = 0, n1 = 0, n2 = 0;
	const bucket = new Uint8Array(d.length / tri);
	for (let t = 0, i = 0; i < d.length; i += tri, t++) {
		const tile = d[i + 8] | 0;
		const k = kinds && tile < kinds.length ? kinds[tile] : 0;
		bucket[t] = k;
		if (k === 2) n2 += tri;
		else if (k === 1) n1 += tri;
		else n0 += tri;
	}
	const opaque = new Float32Array(n0);
	const cutout = new Float32Array(n1);
	const trans = new Float32Array(n2);
	let i0 = 0, i1 = 0, i2 = 0;
	for (let t = 0, i = 0; i < d.length; i += tri, t++) {
		const k = bucket[t];
		if (k === 2) {
			trans.set(d.subarray(i, i + tri), i2);
			i2 += tri;
		} else if (k === 1) {
			cutout.set(d.subarray(i, i + tri), i1);
			i1 += tri;
		} else {
			opaque.set(d.subarray(i, i + tri), i0);
			i0 += tri;
		}
	}
	mesh.parts = {
		opaque: { data: opaque, count: n0 / vf },
		cutout: { data: cutout, count: n1 / vf },
		trans: { data: trans, count: n2 / vf }
	};
	terrainGen++;
}

function refreshTerrain() {
	if (!tileKind) classifyTiles();
	splitTerrain();
}

function punchPart(part, keys, vf) {
	if (!part || !part.data || !part.count) return { data: new Float32Array(0), count: 0 };
	const d = part.data;
	const tri = vf * 3;
	let w = 0;
	for (let i = 0; i < d.length; i += tri) {
		const bx = Math.round(d[i + 9]);
		const by = Math.round(d[i + 10]);
		const bz = Math.round(d[i + 11]);
		if (keys.has(bx + "," + by + "," + bz)) continue;
		if (w !== i) d.copyWithin(w, i, i + tri);
		w += tri;
	}
	return { data: w === d.length ? d : d.subarray(0, w), count: w / vf };
}

function extractPart(part, keys, vf) {
	if (!part || !part.data || !part.count) return new Float32Array(0);
	const d = part.data;
	const tri = vf * 3;
	const taken = [];
	let w = 0;
	for (let i = 0; i < d.length; i += tri) {
		const bx = Math.round(d[i + 9]);
		const by = Math.round(d[i + 10]);
		const bz = Math.round(d[i + 11]);
		if (keys.has(bx + "," + by + "," + bz)) {
			taken.push(d.slice(i, i + tri));
			continue;
		}
		if (w !== i) d.copyWithin(w, i, i + tri);
		w += tri;
	}
	part.data = w === d.length ? d : d.subarray(0, w);
	part.count = w / vf;
	if (!taken.length) return new Float32Array(0);
	const out = new Float32Array(taken.length * tri);
	for (let i = 0; i < taken.length; i++) out.set(taken[i], i * tri);
	return out;
}

function stealChestVerts() {
	if (!mesh || !mesh.parts) return;
	const vf = mesh.vf || 9;
	if (vf < 12) return;
	const needed = new Set();
	for (const st of poses.values()) {
		if (st.kind === "chest") needed.add(st.x + "," + st.y + "," + st.z);
	}
	const missing = new Set();
	for (const key of needed) {
		if (!chestGeom.has(key)) missing.add(key);
	}
	if (missing.size) {
		const chunks = [];
		for (const name of ["opaque", "cutout", "trans"]) {
			const got = extractPart(mesh.parts[name], missing, vf);
			if (got.length) chunks.push(got);
		}
		if (chunks.length) {
			const tri = vf * 3;
			const buckets = new Map();
			for (const chunk of chunks) {
				for (let i = 0; i < chunk.length; i += tri) {
					const key = Math.round(chunk[i + 9]) + "," + Math.round(chunk[i + 10]) + "," + Math.round(chunk[i + 11]);
					if (!buckets.has(key)) buckets.set(key, []);
					buckets.get(key).push(chunk.subarray(i, i + tri));
				}
			}
			for (const [key, tris] of buckets) {
				const data = new Float32Array(tris.length * tri);
				for (let i = 0; i < tris.length; i++) data.set(tris[i], i * tri);
				chestGeom.set(key, data);
			}
			terrainGen++;
		}
	}
	let restored = false;
	for (const key of [...chestGeom.keys()]) {
		if (needed.has(key)) continue;
		mesh.parts.opaque = concatPart(mesh.parts.opaque, chestGeom.get(key), vf);
		chestGeom.delete(key);
		restored = true;
	}
	if (restored) terrainGen++;
}

function chestLidPitch(p) {
	p = Math.max(0, Math.min(1, p));
	let g = 1 - p;
	g = 1 - g * g * g;
	return -g * Math.PI / 2;
}

function isChestLidVert(mx, my, mz) {
	if (my > 10.4) return true;
	if (my > 8.4 && my < 9.6) return true;
	return mz > 14.4 && my > 6.4 && my < 8;
}

function transformChestGeom(src, ox, oy, oz, rotY, pitch, vf) {
	const out = new Float32Array(src);
	if (!pitch) return out;
	const rad = -rotY * Math.PI / 180;
	const cy = Math.cos(rad), sy = Math.sin(rad);
	const icy = Math.cos(-rad), isy = Math.sin(-rad);
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	for (let i = 0; i < out.length; i += vf) {
		const x0 = (out[i] - ox) * 16;
		const y0 = (out[i + 1] - oy) * 16;
		const z0 = (out[i + 2] - oz) * 16;
		const lx = x0 - 8, lz = z0 - 8;
		const mx = lx * icy + lz * isy + 8;
		const mz = -lx * isy + lz * icy + 8;
		if (!isChestLidVert(mx, y0, mz)) continue;
		const ly = y0 - 9, lz2 = mz - 1;
		const y1 = ly * cp - lz2 * sp + 9;
		const z1 = ly * sp + lz2 * cp + 1;
		const lx2 = mx - 8, lz3 = z1 - 8;
		out[i] = ox + (lx2 * cy + lz3 * sy + 8) / 16;
		out[i + 1] = oy + y1 / 16;
		out[i + 2] = oz + (-lx2 * sy + lz3 * cy + 8) / 16;
	}
	return out;
}

function concatPart(part, extra, vf) {
	if (!extra || !extra.length) return part || { data: new Float32Array(0), count: 0 };
	if (!part || !part.data || !part.count) return { data: extra, count: extra.length / vf };
	const merged = new Float32Array(part.data.length + extra.length);
	merged.set(part.data);
	merged.set(extra, part.data.length);
	return { data: merged, count: (part.data.length + extra.length) / vf };
}

function bucketAdded(added, vf) {
	const tri = vf * 3;
	let n0 = 0, n1 = 0, n2 = 0;
	const kindAt = new Uint8Array(added.length / tri);
	for (let t = 0, i = 0; i < added.length; i += tri, t++) {
		const tile = added[i + 8] | 0;
		const k = tileKind && tile < tileKind.length ? tileKind[tile] : 0;
		kindAt[t] = k;
		if (k === 2) n2 += tri;
		else if (k === 1) n1 += tri;
		else n0 += tri;
	}
	const opaque = new Float32Array(n0);
	const cutout = new Float32Array(n1);
	const trans = new Float32Array(n2);
	let i0 = 0, i1 = 0, i2 = 0;
	for (let t = 0, i = 0; i < added.length; i += tri, t++) {
		const k = kindAt[t];
		if (k === 2) {
			trans.set(added.subarray(i, i + tri), i2);
			i2 += tri;
		} else if (k === 1) {
			cutout.set(added.subarray(i, i + tri), i1);
			i1 += tri;
		} else {
			opaque.set(added.subarray(i, i + tri), i0);
			i0 += tri;
		}
	}
	return { opaque, cutout, trans };
}

function bindAttribs(stride) {
	gl.enableVertexAttribArray(loc.pos);
	gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, stride, 0);
	gl.enableVertexAttribArray(loc.uv);
	gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, stride, 12);
	gl.enableVertexAttribArray(loc.col);
	gl.vertexAttribPointer(loc.col, 3, gl.FLOAT, false, stride, 20);
	gl.enableVertexAttribArray(loc.tile);
	gl.vertexAttribPointer(loc.tile, 1, gl.FLOAT, false, stride, 32);
}

function uploadTerrain() {
	if (!mesh || !mesh.parts || terrainUploaded === terrainGen) return;
	for (const key of ["opaque", "cutout", "trans"]) {
		gl.bindBuffer(gl.ARRAY_BUFFER, terrainBufs[key]);
		gl.bufferData(gl.ARRAY_BUFFER, mesh.parts[key].data, gl.STATIC_DRAW);
	}
	terrainUploaded = terrainGen;
}

function drawTerrainPart(key, alphaPass) {
	const part = mesh.parts && mesh.parts[key];
	if (!part || !part.count) return;
	gl.bindBuffer(gl.ARRAY_BUFFER, terrainBufs[key]);
	bindAttribs((mesh.vf || 9) * 4);
	gl.uniform1f(loc.alphaPass, alphaPass);
	gl.drawArrays(gl.TRIANGLES, 0, part.count);
}

function punchBlocks(blocks) {
	if (!mesh || !blocks.length) return;
	const keys = new Set(blocks.map(b => b.x + "," + b.y + "," + b.z));
	const vf = mesh.vf || 9;
	if (mesh.parts) {
		mesh.parts.opaque = punchPart(mesh.parts.opaque, keys, vf);
		mesh.parts.cutout = punchPart(mesh.parts.cutout, keys, vf);
		mesh.parts.trans = punchPart(mesh.parts.trans, keys, vf);
		return;
	}
	const d = mesh.data;
	const tri = vf * 3;
	let w = 0;
	for (let i = 0; i < d.length; i += tri) {
		const bx = vf >= 12 ? Math.round(d[i + 9]) : Math.floor((d[i] + d[i + vf] + d[i + vf * 2]) / 3);
		const by = vf >= 12 ? Math.round(d[i + 10]) : Math.floor((d[i + 1] + d[i + vf + 1] + d[i + vf * 2 + 1]) / 3);
		const bz = vf >= 12 ? Math.round(d[i + 11]) : Math.floor((d[i + 2] + d[i + vf + 2] + d[i + vf * 2 + 2]) / 3);
		if (keys.has(bx + "," + by + "," + bz)) continue;
		if (w !== i) d.copyWithin(w, i, i + tri);
		w += tri;
	}
	mesh.data = d.subarray(0, w);
	mesh.count = w / vf;
}

function parsePatch(bytes) {
	if (!mesh) {
		pendingPatches.push(bytes);
		return;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let o = 0;
	if (bytes.length < 8) return;
	const n = view.getInt32(o, true); o += 4;
	const blocks = [];
	for (let i = 0; i < n; i++) {
		blocks.push({ x: view.getInt32(o, true), y: view.getInt32(o + 4, true), z: view.getInt32(o + 8, true) });
		o += 12;
	}
	for (const b of blocks) chestGeom.delete(b.x + "," + b.y + "," + b.z);
	punchBlocks(blocks);
	const count = view.getInt32(o, true); o += 4;
	const vf = mesh.vf || 9;
	let added = null;
	if (count > 0) {
		if ((bytes.byteOffset + o) % 4 === 0) {
			added = new Float32Array(bytes.buffer, bytes.byteOffset + o, count * vf).slice();
		} else {
			added = new Float32Array(count * vf);
			for (let i = 0; i < added.length; i++, o += 4) added[i] = view.getFloat32(o, true);
		}
	}
	if (mesh.parts) {
		if (added && added.length) {
			const bins = bucketAdded(added, vf);
			mesh.parts.opaque = concatPart(mesh.parts.opaque, bins.opaque, vf);
			mesh.parts.cutout = concatPart(mesh.parts.cutout, bins.cutout, vf);
			mesh.parts.trans = concatPart(mesh.parts.trans, bins.trans, vf);
		}
		terrainGen++;
		stealChestVerts();
		return;
	}
	if (added && added.length) {
		const merged = new Float32Array(mesh.data.length + added.length);
		merged.set(mesh.data);
		merged.set(added, mesh.data.length);
		mesh.data = merged;
		mesh.count = merged.length / vf;
	}
	refreshTerrain();
	stealChestVerts();
}

function spawnBurst(msg) {
	const x = msg.x, y = msg.y, z = msg.z;
	const tile = msg.tile || 0;
	const cr = msg.r != null ? msg.r : 1;
	const cg = msg.g != null ? msg.g : 1;
	const cb = msg.b != null ? msg.b : 1;
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			for (let k = 0; k < 4; k++) {
				const ox = (i + 0.5) / 4, oy = (j + 0.5) / 4, oz = (k + 0.5) / 4;
				let vx = (ox - 0.5) + (Math.random() * 2 - 1) * 0.4;
				let vy = (oy - 0.5) + (Math.random() * 2 - 1) * 0.4;
				let vz = (oz - 0.5) + (Math.random() * 2 - 1) * 0.4;
				const d = (Math.random() + Math.random() + 1) * 0.15;
				const len = Math.hypot(vx, vy, vz) || 1;
				vx = vx / len * d * 0.4;
				vy = vy / len * d * 0.4 + 0.1;
				vz = vz / len * d * 0.4;
				const su = (Math.random() * 4) | 0;
				const sv = (Math.random() * 4) | 0;
				const ticks = Math.max(4, (4 / (Math.random() * 0.9 + 0.1)) | 0);
				particles.push({
					x: x + ox, y: y + oy, z: z + oz,
					vx: vx * 20, vy: vy * 20, vz: vz * 20,
					life: ticks / 20,
					age: 0,
					floor: y,
					size: 0.05 + Math.random() * 0.05,
					tile,
					u0: su / 4, v0: 1 - (sv + 1) / 4, u1: (su + 1) / 4, v1: 1 - sv / 4,
					cr, cg, cb
				});
			}
		}
	}
}

function tickParticles(dt) {
	if (!particles.length) return;
	const next = [];
	const drag = Math.pow(0.98, dt * 20);
	for (const p of particles) {
		p.vy -= 16 * dt;
		p.x += p.vx * dt;
		p.y += p.vy * dt;
		p.z += p.vz * dt;
		p.vx *= drag;
		p.vy *= drag;
		p.vz *= drag;
		if (p.y < p.floor) {
			p.y = p.floor;
			p.vy *= -0.2;
			p.vx *= 0.7;
			p.vz *= 0.7;
		}
		p.age += dt;
		if (p.age < p.life) next.push(p);
	}
	particles = next;
}

function buildSky(eyePos) {
	const data = [];
	const r = 140;
	const rings = 16;
	const segs = 24;
	const hr = sky.fogR;
	const hg = sky.fogG;
	const hb = sky.fogB;
	const push = (x, y, z, cr, cg, cb) => {
		data.push(eyePos.x + x, eyePos.y + y, eyePos.z + z, cr, cg, cb);
	};
	const colorAt = (elev) => {
		if (elev >= 0) {
			const t = Math.pow(elev, 0.38);
			return [
				hr + (sky.r - hr) * t,
				hg + (sky.g - hg) * t,
				hb + (sky.b - hb) * t
			];
		}
		const t = Math.min(1, -elev);
		return [
			hr * (1 - t * 0.22),
			hg * (1 - t * 0.22),
			hb * (1 - t * 0.16)
		];
	};
	for (let i = 0; i < rings; i++) {
		const a0 = -Math.PI / 2 + (i / rings) * Math.PI;
		const a1 = -Math.PI / 2 + ((i + 1) / rings) * Math.PI;
		const y0 = Math.sin(a0) * r, rad0 = Math.cos(a0) * r;
		const y1 = Math.sin(a1) * r, rad1 = Math.cos(a1) * r;
		const c0 = colorAt(i / rings * 2 - 1);
		const c1 = colorAt((i + 1) / rings * 2 - 1);
		for (let s = 0; s < segs; s++) {
			const u0 = s / segs * Math.PI * 2;
			const u1 = (s + 1) / segs * Math.PI * 2;
			const p00 = [Math.cos(u0) * rad0, y0, Math.sin(u0) * rad0];
			const p10 = [Math.cos(u1) * rad0, y0, Math.sin(u1) * rad0];
			const p01 = [Math.cos(u0) * rad1, y1, Math.sin(u0) * rad1];
			const p11 = [Math.cos(u1) * rad1, y1, Math.sin(u1) * rad1];
			push(...p00, ...c0); push(...p10, ...c0); push(...p11, ...c1);
			push(...p00, ...c0); push(...p11, ...c1); push(...p01, ...c1);
		}
	}
	const theta = (sky.angle || 0) * Math.PI * 2;
	const sun = { x: -Math.sin(theta), y: Math.cos(theta), z: 0 };
	const sunUp = Math.max(0, sun.y);
	if (sunUp > 0.02) {
		const dist = 120;
		const size = 8 + 6 * sunUp;
		const sx = sun.x * dist, sy = sun.y * dist, sz = sun.z * dist;
		const right = { x: Math.cos(theta), y: Math.sin(theta), z: 0 };
		const up = { x: 0, y: 0, z: 1 };
		const quad = (ox, oy) => [
			sx + right.x * ox * size + up.x * oy * size,
			sy + right.y * ox * size + up.y * oy * size,
			sz + right.z * ox * size + up.z * oy * size
		];
		const cr = 1, cg = 0.92, cb = 0.65;
		const q00 = quad(-1, -1), q10 = quad(1, -1), q11 = quad(1, 1), q01 = quad(-1, 1);
		push(...q00, cr, cg, cb); push(...q10, cr, cg, cb); push(...q11, cr, cg, cb);
		push(...q00, cr, cg, cb); push(...q11, cr, cg, cb); push(...q01, cr, cg, cb);
	} else {
		const moon = { x: Math.sin(theta), y: -Math.cos(theta), z: 0 };
		if (moon.y > 0.02) {
			const dist = 120;
			const size = 5;
			const sx = moon.x * dist, sy = moon.y * dist, sz = moon.z * dist;
			const right = { x: -Math.cos(theta), y: -Math.sin(theta), z: 0 };
			const up = { x: 0, y: 0, z: 1 };
			const quad = (ox, oy) => [
				sx + right.x * ox * size + up.x * oy * size,
				sy + right.y * ox * size + up.y * oy * size,
				sz + right.z * ox * size + up.z * oy * size
			];
			const cr = 0.82, cg = 0.86, cb = 0.95;
			const q00 = quad(-1, -1), q10 = quad(1, -1), q11 = quad(1, 1), q01 = quad(-1, 1);
			push(...q00, cr, cg, cb); push(...q10, cr, cg, cb); push(...q11, cr, cg, cb);
			push(...q00, cr, cg, cb); push(...q11, cr, cg, cb); push(...q01, cr, cg, cb);
		}
	}
	return new Float32Array(data);
}
function skyMesh(eyePos) {
	const key = eyePos.x + "," + eyePos.y + "," + eyePos.z + "," + sky.r + "," + sky.g + "," + sky.b + "," + sky.fogR + "," + sky.fogG + "," + sky.fogB + "," + (sky.angle || 0);
	if (skyCache && skyCacheKey === key) return skyCache;
	skyCacheKey = key;
	skyCache = buildSky(eyePos);
	return skyCache;
}

function ensureSkin(player) {
	const id = player.uuid || "steve";
	if (skins.has(id)) return skins.get(id);
	const rec = { tex: gl.createTexture(), ready: false, slim: !!player.slim };
	gl.bindTexture(gl.TEXTURE_2D, rec.tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	skins.set(id, rec);
	fetch("/api/skin/" + encodeURIComponent(id)).then(r => {
		if (!r.ok) return fetch("https://crafatar.com/skins/" + encodeURIComponent(id));
		return r;
	}).then(r => {
		if (r.ok) return r;
		return fetch("/api/skin/steve");
	}).then(r => r.ok ? r.blob() : Promise.reject()).then(blob => createImageBitmap(blob)).then(img => {
		gl.bindTexture(gl.TEXTURE_2D, rec.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		if (img.height >= 64 && img.width >= 64) {
			const c = document.createElement("canvas");
			c.width = img.width;
			c.height = img.height;
			const ctx = c.getContext("2d", { willReadFrequently: true });
			ctx.drawImage(img, 0, 0);
			rec.slim = ctx.getImageData(54, 20, 1, 1).data[3] < 128;
		}
		rec.ready = true;
	}).catch(() => {});
	return rec;
}

function ensureItem(id) {
	const key = id || "unknown";
	if (itemTex.has(key)) return itemTex.get(key);
	const rec = { tex: gl.createTexture(), ready: false };
	gl.bindTexture(gl.TEXTURE_2D, rec.tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	itemTex.set(key, rec);
	fetch("/api/item/" + encodeURIComponent(key) + ".png").then(r => r.ok ? r.blob() : Promise.reject()).then(blob => createImageBitmap(blob)).then(img => {
		gl.bindTexture(gl.TEXTURE_2D, rec.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		rec.mesh = buildItemMesh(img);
		rec.ready = true;
	}).catch(() => {});
	return rec;
}

function buildItemMesh(img) {
	const w = 16, h = 16;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(img, 0, 0, w, h);
	const pix = ctx.getImageData(0, 0, w, h).data;
	const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && pix[(y * w + x) * 4 + 3] > 16;
	const quads = [];
	const add = (pts, u0, v0, u1, v1) => {
		quads.push({ p: pts, uv: [[u0, v1], [u1, v1], [u1, v0], [u0, v0]] });
	};
	const z0 = 7.5, z1 = 8.5;
	add([[0, 0, z0], [16, 0, z0], [16, 16, z0], [0, 16, z0]], 0, 0, 1, 1);
	add([[16, 0, z1], [0, 0, z1], [0, 16, z1], [16, 16, z1]], 1, 0, 0, 1);
	for (let ty = 0; ty < h; ty++) {
		for (let tx = 0; tx < w; tx++) {
			if (!solid(tx, ty)) continue;
			const x0 = tx, x1 = tx + 1, y0 = h - ty - 1, y1 = h - ty;
			const u0 = tx / w, u1 = (tx + 1) / w, v0 = ty / h, v1 = (ty + 1) / h;
			if (!solid(tx, ty - 1)) add([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], u0, v0, u1, v1);
			if (!solid(tx, ty + 1)) add([[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]], u0, v0, u1, v1);
			if (!solid(tx - 1, ty)) add([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], u0, v0, u1, v1);
			if (!solid(tx + 1, ty)) add([[x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]], u0, v0, u1, v1);
		}
	}
	return quads;
}

function ensureArmor(layer, id) {
	const key = (layer || "humanoid") + "/" + (id || "");
	if (!id) return null;
	if (armorTex.has(key)) return armorTex.get(key);
	const rec = { tex: gl.createTexture(), ready: false, w: 64, h: 64 };
	gl.bindTexture(gl.TEXTURE_2D, rec.tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	armorTex.set(key, rec);
	fetch("/api/armor/" + encodeURIComponent(layer) + "/" + encodeURIComponent(id) + ".png").then(r => r.ok ? r.blob() : Promise.reject()).then(blob => createImageBitmap(blob)).then(img => {
		gl.bindTexture(gl.TEXTURE_2D, rec.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		rec.w = img.width;
		rec.h = img.height;
		rec.ready = true;
	}).catch(() => {});
	return rec;
}

const P = 1 / 16;
function rotX(x, y, z, a) {
	const c = Math.cos(a), s = Math.sin(a);
	return [x, y * c - z * s, y * s + z * c];
}
function rotY(x, y, z, a) {
	const c = Math.cos(a), s = Math.sin(a);
	return [x * c + z * s, y, -x * s + z * c];
}
function rotZ(x, y, z, a) {
	const c = Math.cos(a), s = Math.sin(a);
	return [x * c - y * s, x * s + y * c, z];
}
function rotXYZ(x, y, z, rx, ry, rz) {
	let q = rotX(x, y, z, rx);
	q = rotY(q[0], q[1], q[2], ry);
	return rotZ(q[0], q[1], q[2], rz);
}
function lerpKf(frames, t) {
	if (!frames || !frames.length) return [0, 0, 0];
	if (t <= frames[0][0]) return frames[0].slice(1);
	const last = frames[frames.length - 1];
	if (t >= last[0]) return last.slice(1);
	for (let i = 0; i < frames.length - 1; i++) {
		const a = frames[i], b = frames[i + 1];
		if (t <= b[0]) {
			const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
			return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
		}
	}
	return last.slice(1);
}
function degKf(frames, t) {
	const v = lerpKf(frames, t);
	const d = Math.PI / 180;
	return [v[0] * d, v[1] * d, v[2] * d];
}
function toWorld(x, y, z, yawDeg, px, py, pz) {
	const yaw = yawDeg * Math.PI / 180;
	return [
		px + (-Math.cos(yaw) * x - Math.sin(yaw) * z),
		py + y,
		pz + (-Math.sin(yaw) * x + Math.cos(yaw) * z)
	];
}

function pushBox(out, px, py, pz, bodyYaw, pivot, rx, ry, x0, y0, z0, x1, y1, z1, u, v, w, h, d, inflate, shade, tw, th, parentPivot, parentRx, rz, tint, swapZ, copySide, flipV, parentRy, parentRz) {
	x0 -= inflate; y0 -= inflate; z0 -= inflate;
	x1 += inflate; y1 += inflate; z1 += inflate;
	const ox = pivot[0], oy = pivot[1], oz = pivot[2];
	const hip = parentPivot || [0, 12 * P, 0];
	const pre = parentRx || 0;
	const corners = [
		[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
		[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]
	].map(([x, y, z]) => {
		let q = [x - ox, y - oy, z - oz];
		q = rotX(q[0], q[1], q[2], rx);
		q = rotY(q[0], q[1], q[2], ry);
		if (rz) q = rotZ(q[0], q[1], q[2], rz);
		q = [q[0] + ox, q[1] + oy, q[2] + oz];
		if (pre || parentRy || parentRz) {
			q = rotX(q[0] - hip[0], q[1] - hip[1], q[2] - hip[2], pre);
			if (parentRy) q = rotY(q[0], q[1], q[2], parentRy);
			if (parentRz) q = rotZ(q[0], q[1], q[2], parentRz);
			q = [q[0] + hip[0], q[1] + hip[1], q[2] + hip[2]];
		}
		return toWorld(q[0], q[1], q[2], bodyYaw, px, py, pz);
	});
	tw = tw || 64;
	th = th || 64;
	const faceUV = (fu, fv, fw, fh) => {
		const pu = Math.abs(fw) > 0.01 ? Math.min(0.5, Math.abs(fw) * 0.49) : 0;
		const pv = Math.abs(fh) > 0.01 ? Math.min(0.5, Math.abs(fh) * 0.49) : 0;
		const u0 = (fu + pu) / tw, v0 = (fv + pv) / th, u1 = (fu + fw - pu) / tw, v1 = (fv + fh - pv) / th;
		return flipV
			? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
			: [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
	};
	const west = faceUV(u, v + d, d, h);
	const east = faceUV(u + d + w, v + d, d, h);
	const faces = [
		{ idx: [0, 1, 2, 3], uv: copySide ? west : faceUV(u + d, v + d, w, h), s: 0.9 },
		{ idx: [4, 5, 6, 7], uv: copySide ? east : faceUV(u + d + w + d, v + d, w, h), s: 0.7 },
		{ idx: [5, 0, 3, 6], uv: east, s: 0.65 },
		{ idx: [1, 4, 7, 2], uv: west, s: 0.8 },
		{ idx: [3, 2, 7, 6], uv: faceUV(u + d, v, w, d), s: 1.0 },
		{ idx: [5, 4, 1, 0], uv: faceUV(u + d + w, v, w, d), s: 0.5 }
	];
	if (swapZ && !copySide) {
		const uv = faces[0].uv;
		faces[0].uv = faces[1].uv;
		faces[1].uv = uv;
	}
	const order = [0, 1, 2, 0, 2, 3];
	const light = sceneLight();
	for (const f of faces) {
		const a = f.uv[0], c = f.uv[2];
		if (Math.abs(c[0] - a[0]) < 1e-4 || Math.abs(c[1] - a[1]) < 1e-4) continue;
		for (const i of order) {
			const p = corners[f.idx[i]];
			const uv = f.uv[i];
			const s = f.s * shade * light;
			const tr = tint || [1, 1, 1];
			out.push(p[0], p[1], p[2], uv[0], uv[1], s * tr[0], s * tr[1], s * tr[2], 0);
		}
	}
}

function modelBox(out, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, tw, th, shade, rz, inflate, tint, swapOverride, flipV, parentXf) {
	const jx0 = pivot[0] + ox, jx1 = jx0 + sx;
	const jy0 = pivot[1] + oy, jy1 = jy0 + sy;
	const jz0 = pivot[2] + oz, jz1 = jz0 + sz;
	const pvt = [pivot[0] * unit, (24 - pivot[1]) * unit, pivot[2] * unit];
	const yaw = m._facing != null ? m._facing : (m.bodyYaw != null ? m.bodyYaw : m.yaw);
	const inf = (inflate || 0) * unit;
	const snout = swapOverride != null ? !!swapOverride : !!(m._snout && Math.abs(Math.abs(rx) - Math.PI / 2) > 0.4);
	const copySide = sx <= 1 && sz <= 1 && sy >= 6;
	const hip = parentXf ? [parentXf[0] * unit, (24 - parentXf[1]) * unit, parentXf[2] * unit] : null;
	pushBox(out, m.x, m.y + 0.02, m.z, yaw, pvt, rx, ry,
		jx0 * unit, (24 - jy1) * unit, jz0 * unit,
		jx1 * unit, (24 - jy0) * unit, jz1 * unit,
		u, v, sx, sy, sz, inf, shade == null ? 1 : shade, tw, th, hip, parentXf ? parentXf[3] : 0, rz || 0, tint, snout, copySide, flipV, parentXf ? parentXf[4] : 0, parentXf ? parentXf[5] : 0);
}

function attackPose(swing, headPitch) {
	if (!(swing > 0)) return { rx: 0, ry: 0 };
	let g = 1 - swing;
	g *= g;
	g *= g;
	g = 1 - g;
	const h = Math.sin(g * Math.PI);
	const i = Math.sin(swing * Math.PI) * -(headPitch - 0.7) * 0.75;
	const body = Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.2;
	return { rx: -(h * 1.2 + i), ry: body * 2 };
}

function playerPose(p) {
	if (p._ps === poseStamp) return p._pose;
	const slim = !!p.slim;
	const aw = p.aw != null ? p.aw : (slim ? 3 * P : 4 * P);
	const sneak = p.sneaking || p.pose === "crouching";
	const limb = p.limb || 0;
	const amt = p.amt || 0;
	const swing = Math.cos(limb * 0.6662) * amt;
	const armSwing = swing;
	const legSwing = swing * 1.4;
	const bodyYaw = p.bodyYaw != null ? p.bodyYaw : p.yaw;
	const headYaw = (wrapDeg((p.headYaw != null ? p.headYaw : p.yaw) - bodyYaw) * Math.PI) / 180;
	const headPitch = ((p.pitch || 0) * Math.PI) / 180;
	const bodyPitch = sneak ? 0.5 : (p.pose === "swimming" || p.pose === "fall_flying" ? 1.4 : 0);
	const armExtra = p.armExtra != null ? p.armExtra : (sneak ? 0.4 : 0);
	const atk = attackPose(p.localSwing || 0, headPitch);
	if (p.swingLeft) atk.ry = -atk.ry;
	const pose = {
		slim, aw, armSwing, legSwing, bodyYaw, headYaw, headPitch, bodyPitch, armExtra, sneak,
		rightAtk: p.swingLeft ? { rx: 0, ry: 0 } : atk,
		leftAtk: p.swingLeft ? atk : { rx: 0, ry: 0 },
		px: p.x, py: p.y, pz: p.z
	};
	p._ps = poseStamp;
	p._pose = pose;
	return pose;
}

function playerMesh(list, p) {
	const s = playerPose(p);
	const aw = s.aw;
	const hip = [0, 12 * P, 0];
	const lean = s.bodyPitch;
	pushBox(list, s.px, s.py, s.pz, s.bodyYaw, hip, lean, 0, -4 * P, 12 * P, -2 * P, 4 * P, 24 * P, 2 * P, 16, 16, 8, 12, 4, 0, 1);
	pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [0, 24 * P, 0], s.headPitch, s.headYaw, -4 * P, 24 * P, -4 * P, 4 * P, 32 * P, 4 * P, 0, 0, 8, 8, 8, 0, 1, 64, 64, hip, lean);
	pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [5 * P, 22 * P, 0], s.armSwing + s.armExtra + s.rightAtk.rx, s.rightAtk.ry, 4 * P, 12 * P, -2 * P, 4 * P + aw, 24 * P, 2 * P, 40, 16, s.slim ? 3 : 4, 12, 4, 0, 1, 64, 64, hip, lean);
	pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-5 * P, 22 * P, 0], -s.armSwing + s.armExtra + s.leftAtk.rx, s.leftAtk.ry, -4 * P - aw, 12 * P, -2 * P, -4 * P, 24 * P, 2 * P, 32, 48, s.slim ? 3 : 4, 12, 4, 0, 1, 64, 64, hip, lean);
	pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [2 * P, 12 * P, 0], -s.legSwing, 0, 0, 0, -2 * P, 4 * P, 12 * P, 2 * P, 0, 16, 4, 12, 4, 0, 1);
	pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-2 * P, 12 * P, 0], s.legSwing, 0, -4 * P, 0, -2 * P, 0, 12 * P, 2 * P, 16, 48, 4, 12, 4, 0, 1);
	const armor = p.armor || {};
	const inf = 0.5 * P;
	if (!armor.chest) {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, hip, lean, 0, -4 * P, 12 * P, -2 * P, 4 * P, 24 * P, 2 * P, 16, 32, 8, 12, 4, inf, 1);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [5 * P, 22 * P, 0], s.armSwing + s.armExtra + s.rightAtk.rx, s.rightAtk.ry, 4 * P, 12 * P, -2 * P, 4 * P + aw, 24 * P, 2 * P, 40, 32, s.slim ? 3 : 4, 12, 4, inf, 1, 64, 64, hip, lean);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-5 * P, 22 * P, 0], -s.armSwing + s.armExtra + s.leftAtk.rx, s.leftAtk.ry, -4 * P - aw, 12 * P, -2 * P, -4 * P, 24 * P, 2 * P, 48, 48, s.slim ? 3 : 4, 12, 4, inf, 1, 64, 64, hip, lean);
	}
	if (!armor.head) {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [0, 24 * P, 0], s.headPitch, s.headYaw, -4 * P, 24 * P, -4 * P, 4 * P, 32 * P, 4 * P, 32, 0, 8, 8, 8, inf, 1, 64, 64, hip, lean);
	}
	if (!armor.legs) {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [2 * P, 12 * P, 0], -s.legSwing, 0, 0, 0, -2 * P, 4 * P, 12 * P, 2 * P, 0, 32, 4, 12, 4, inf, 1);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-2 * P, 12 * P, 0], s.legSwing, 0, -4 * P, 0, -2 * P, 0, 12 * P, 2 * P, 0, 48, 4, 12, 4, inf, 1);
	}
}

const mobTex = new Map();
function ensureMob(tex) {
	const key = tex || "";
	if (!key) return null;
	if (mobTex.has(key)) return mobTex.get(key);
	const rec = { tex: gl.createTexture(), ready: false, key, w: 64, h: 64 };
	gl.bindTexture(gl.TEXTURE_2D, rec.tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	mobTex.set(key, rec);
	fetch("/api/mob/" + key.split("/").map(encodeURIComponent).join("/") + ".png").then(r => r.ok ? r.blob() : Promise.reject()).then(blob => createImageBitmap(blob)).then(img => {
		gl.bindTexture(gl.TEXTURE_2D, rec.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		rec.w = img.width;
		rec.h = img.height;
		rec.ready = true;
	}).catch(() => {});
	return rec;
}

const MOB_ARMOR_STAND = new Set(["armor_stand"]);
const MOB_BIPED = new Set(["zombie", "husk", "drowned", "piglin", "piglin_brute", "zombified_piglin"]);
const MOB_SKELETON = new Set(["skeleton", "stray", "bogged", "parched", "wither_skeleton"]);
const MOB_CREEPER = new Set(["creeper"]);
const MOB_SPIDER = new Set(["spider", "cave_spider"]);
const MOB_CHICKEN = new Set(["chicken"]);
const MOB_SLIME = new Set(["slime"]);
const MOB_HORSE = new Set(["horse", "donkey", "mule", "skeleton_horse", "zombie_horse"]);
const MOB_CAMEL = new Set(["camel", "camel_husk"]);
const MOB_CAT = new Set(["cat", "ocelot"]);
const MOB_WOLF = new Set(["wolf"]);
const MOB_PARROT = new Set(["parrot"]);
const MOB_ARMADILLO = new Set(["armadillo"]);
const MOB_BAT = new Set(["bat"]);
const MOB_BEE = new Set(["bee"]);
const MOB_FOX = new Set(["fox"]);
const MOB_GOAT = new Set(["goat"]);
const MOB_LLAMA = new Set(["llama", "trader_llama"]);
const MOB_BEAR = new Set(["polar_bear"]);
const MOB_PANDA = new Set(["panda"]);
const MOB_RABBIT = new Set(["rabbit"]);
const MOB_SNIFFER = new Set(["sniffer"]);
const MOB_IRON_GOLEM = new Set(["iron_golem"]);
const MOB_SNOW_GOLEM = new Set(["snow_golem"]);
const MOB_COPPER_GOLEM = new Set(["copper_golem"]);
const MOB_VILLAGER = new Set(["villager", "wandering_trader", "zombie_villager"]);
const MOB_BREEZE = new Set(["breeze"]);
const MOB_CREAKING = new Set(["creaking"]);
const MOB_NAUTILUS = new Set(["nautilus", "zombie_nautilus"]);
const MOB_GUARDIAN = new Set(["guardian", "elder_guardian"]);
const MOB_PHANTOM = new Set(["phantom"]);
const MOB_SILVERFISH = new Set(["silverfish"]);
const MOB_WARDEN = new Set(["warden"]);
const MOB_WITCH = new Set(["witch"]);
const MOB_ILLAGER = new Set(["evoker", "pillager", "vindicator", "illusioner"]);
const MOB_RAVAGER = new Set(["ravager"]);
const MOB_VEX = new Set(["vex"]);
const MOB_BLAZE = new Set(["blaze"]);
const MOB_GHAST = new Set(["ghast"]);
const MOB_HAPPY_GHAST = new Set(["happy_ghast"]);
const MOB_HOGLIN = new Set(["hoglin", "zoglin"]);
const MOB_MAGMA = new Set(["magma_cube"]);
const MOB_STRIDER = new Set(["strider"]);
const MOB_ENDERMAN = new Set(["enderman"]);
const MOB_ENDERMITE = new Set(["endermite"]);
const MOB_SHULKER = new Set(["shulker"]);
const MOB_AXOLOTL = new Set(["axolotl"]);
const MOB_COD = new Set(["cod"]);
const MOB_DOLPHIN = new Set(["dolphin"]);
const MOB_FROG = new Set(["frog"]);
const MOB_SQUID = new Set(["squid", "glow_squid"]);
const MOB_PUFFER = new Set(["pufferfish"]);
const MOB_SALMON = new Set(["salmon"]);
const MOB_TADPOLE = new Set(["tadpole"]);
const MOB_TROPICAL = new Set(["tropical_fish"]);
const MOB_TURTLE = new Set(["turtle"]);
const MOB_ALLAY = new Set(["allay"]);

function mobFlips(family) {
	return family === "chicken" || family === "spider" || family === "quad" || family === "horse" || family === "camel" || family === "cat" || family === "wolf" || family === "parrot" || family === "armadillo" || family === "bat" || family === "bee" || family === "fox" || family === "goat" || family === "llama" || family === "bear" || family === "panda" || family === "rabbit" || family === "sniffer" || family === "iron_golem" || family === "nautilus" || family === "guardian" || family === "phantom" || family === "silverfish" || family === "ravager" || family === "vex" || family === "blaze" || family === "hoglin" || family === "magma_cube" || family === "strider" || family === "endermite" || family === "axolotl" || family === "cod" || family === "dolphin" || family === "frog" || family === "squid" || family === "pufferfish" || family === "salmon" || family === "tadpole" || family === "tropical_fish" || family === "turtle" || family === "allay";
}

function mobFamily(type) {
	if (MOB_ARMOR_STAND.has(type)) return "armor_stand";
	if (MOB_BIPED.has(type)) return "biped";
	if (MOB_SKELETON.has(type)) return "skeleton";
	if (MOB_CREEPER.has(type)) return "creeper";
	if (MOB_SPIDER.has(type)) return "spider";
	if (MOB_CHICKEN.has(type)) return "chicken";
	if (MOB_SLIME.has(type)) return "slime";
	if (MOB_HORSE.has(type)) return "horse";
	if (MOB_CAMEL.has(type)) return "camel";
	if (MOB_CAT.has(type)) return "cat";
	if (MOB_WOLF.has(type)) return "wolf";
	if (MOB_PARROT.has(type)) return "parrot";
	if (MOB_ARMADILLO.has(type)) return "armadillo";
	if (MOB_BAT.has(type)) return "bat";
	if (MOB_BEE.has(type)) return "bee";
	if (MOB_FOX.has(type)) return "fox";
	if (MOB_GOAT.has(type)) return "goat";
	if (MOB_LLAMA.has(type)) return "llama";
	if (MOB_BEAR.has(type)) return "bear";
	if (MOB_PANDA.has(type)) return "panda";
	if (MOB_RABBIT.has(type)) return "rabbit";
	if (MOB_SNIFFER.has(type)) return "sniffer";
	if (MOB_IRON_GOLEM.has(type)) return "iron_golem";
	if (MOB_SNOW_GOLEM.has(type)) return "snow_golem";
	if (MOB_COPPER_GOLEM.has(type)) return "copper_golem";
	if (MOB_VILLAGER.has(type)) return "villager";
	if (MOB_BREEZE.has(type)) return "breeze";
	if (MOB_CREAKING.has(type)) return "creaking";
	if (MOB_NAUTILUS.has(type)) return "nautilus";
	if (MOB_GUARDIAN.has(type)) return "guardian";
	if (MOB_PHANTOM.has(type)) return "phantom";
	if (MOB_SILVERFISH.has(type)) return "silverfish";
	if (MOB_WARDEN.has(type)) return "warden";
	if (MOB_WITCH.has(type)) return "witch";
	if (MOB_ILLAGER.has(type)) return "illager";
	if (MOB_RAVAGER.has(type)) return "ravager";
	if (MOB_VEX.has(type)) return "vex";
	if (MOB_BLAZE.has(type)) return "blaze";
	if (MOB_GHAST.has(type)) return "ghast";
	if (MOB_HAPPY_GHAST.has(type)) return "happy_ghast";
	if (MOB_HOGLIN.has(type)) return "hoglin";
	if (MOB_MAGMA.has(type)) return "magma_cube";
	if (MOB_STRIDER.has(type)) return "strider";
	if (MOB_ENDERMAN.has(type)) return "enderman";
	if (MOB_ENDERMITE.has(type)) return "endermite";
	if (MOB_SHULKER.has(type)) return "shulker";
	if (MOB_AXOLOTL.has(type)) return "axolotl";
	if (MOB_COD.has(type)) return "cod";
	if (MOB_DOLPHIN.has(type)) return "dolphin";
	if (MOB_FROG.has(type)) return "frog";
	if (MOB_SQUID.has(type)) return "squid";
	if (MOB_PUFFER.has(type)) return "pufferfish";
	if (MOB_SALMON.has(type)) return "salmon";
	if (MOB_TADPOLE.has(type)) return "tadpole";
	if (MOB_TROPICAL.has(type)) return "tropical_fish";
	if (MOB_TURTLE.has(type)) return "turtle";
	if (MOB_ALLAY.has(type)) return "allay";
	return "quad";
}

function mobMesh(list, m, rec, layer) {
	const type = m.type || "";
	const family = mobFamily(type);
	const unit = P * (m.baby ? 0.5 : 1) * (family === "rabbit" ? 0.6 : 1) * (type === "husk" ? 1.0625 : 1) * (type === "elder_guardian" ? 2.35 : 1) * (type === "ghast" ? 4.5 : 1) * (type === "happy_ghast" ? 4 : 1) * (type === "wither_skeleton" ? 1.2 : 1) * (family === "salmon" && m.scale ? m.scale : 1) * (family === "magma_cube" ? Math.max(0.52, m.h || 1) / 0.52 : 1);
	const limb = m.limb || 0;
	const amt = m.amt || 0;
	const swing = Math.cos(limb * 0.6662) * 1.4 * amt;
	const yaw0 = m.bodyYaw != null ? m.bodyYaw : m.yaw;
	const look = m.headYaw != null ? m.headYaw : m.yaw;
	let rel = wrapDeg(look - yaw0);
	rel = Math.max(-50, Math.min(50, rel));
	const headYaw = (rel * Math.PI) / 180;
	const headPitch = ((m.pitch || 0) * Math.PI) / 180;
	const tw = rec.w || 64, th = rec.h || 64;
	const flip = mobFlips(family);
	m = Object.assign({}, m, { _facing: yaw0 + (flip ? 180 : 0), _snout: flip });
	const box = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, shade, rz, inflate, tint, swapOverride, flipV, parentXf) => {
		modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, tw, th, shade, rz, inflate, tint, swapOverride, flipV, parentXf);
	};
	if (family === "armor_stand") {
		armorStandMesh(box, m, layer);
		return;
	}
	if (family === "biped" || family === "skeleton") {
		const overlay = !!layer;
		const parched = type === "parched";
		const slim = family === "skeleton";
		const aw = slim ? 2 : 4;
		const ad = slim ? 2 : 4;
		const dil = overlay ? (type === "bogged" ? 0.2 : 0.25) : 0;
		const zpose = (type === "zombie" || type === "husk" || type === "drowned" || type === "zombie_villager" || type === "zombified_piglin") ? -1.4 : 0;
		const armSwing = zpose ? 0 : swing;
		const drownedLike = type === "drowned";
		const leftArmU = drownedLike && th >= 64 ? 32 : (parched && !overlay ? 56 : 40);
		const leftArmV = drownedLike && th >= 64 ? 48 : 16;
		const leftLegU = drownedLike && th >= 64 ? 16 : 0;
		const leftLegV = drownedLike && th >= 64 ? 48 : 16;
		const legX = slim ? 2 : 1.9;
		const piglin = type === "piglin" || type === "piglin_brute" || type === "zombified_piglin";
		box([0, 0, 0], 0, 0, -4, 0, -2, 8, 12, 4, 16, 16, 1, 0, dil);
		if (piglin) {
			const headXf = [0, 0, 0, headPitch, headYaw, 0];
			box([0, 0, 0], headPitch, headYaw, -5, -8, -4, 10, 8, 8, 0, 0, 1, 0, dil);
			box([0, 0, 0], headPitch, headYaw, -2, -4, 4, 4, 4, 1, 31, 1, 1, 0, dil);
			box([0, 0, 0], headPitch, headYaw, 2, -2, 4, 1, 2, 1, 2, 4, 1, 0, dil);
			box([0, 0, 0], headPitch, headYaw, -3, -2, 4, 1, 2, 1, 2, 0, 1, 0, dil);
			box([4.5, -6, 0], 0, 0, 0, 0, -2, 1, 5, 4, 51, 6, 1, type === "zombified_piglin" ? 0.9 : 0.5236, dil, null, null, null, headXf);
			box([-4.5, -6, 0], 0, 0, -1, 0, -2, 1, 5, 4, 39, 6, 1, type === "zombified_piglin" ? -0.9 : -0.5236, dil, null, null, null, headXf);
		} else {
			box([0, 0, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 0, 1, 0, dil);
			if (overlay || parched || type === "drowned") {
				box([0, 0, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 32, 0, 1, 0, 0.5 + dil);
			}
		}
		box([5, 2, 0], armSwing + zpose, 0, -1, -2, slim ? -1 : -2, aw, 12, ad, 40, 16, 1, 0, dil);
		box([-5, 2, 0], -armSwing + zpose, 0, slim ? -1 : -3, -2, slim ? -1 : -2, aw, 12, ad, leftArmU, leftArmV, 1, 0, dil);
		box([legX, 12, 0], -swing, 0, slim ? -1 : -2, 0, slim ? -1 : -2, slim ? 2 : 4, 12, ad, 0, 16, 1, 0, dil);
		box([-legX, 12, 0], swing, 0, slim ? -1 : -2, 0, slim ? -1 : -2, slim ? 2 : 4, 12, ad, leftLegU, leftLegV, 1, 0, dil);
		if (slim && !overlay) {
			box([0, 0, 0], 0, 0, -4, 10, -2, 8, 2, 4, 16, 26, 1, 0, 0.05);
		}
		if (parched && !overlay) {
			box([0, 0, 0], 0, 0, -4, 10, -2, 8, 1, 4, 28, 0);
			box([0, 0, 0], 0, 0, -4, 0, -2, 8, 12, 4, 16, 48, 1, 0, 0.025);
			box([0, 0, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 32, 1, 0, 0.2);
			box([5.5, 2, 0], swing + zpose, 0, -1.55, -2.025, -1.5, 3, 12, 3, 42, 33);
			box([-5.5, 2, 0], -swing + zpose, 0, -1.45, -2.025, -1.5, 3, 12, 3, 40, 48);
			box([2, 12, 0], -swing, 0, -1.5, 0, -1.5, 3, 12, 3, 0, 49);
			box([-2, 12, 0], swing, 0, -1.5, 0, -1.5, 3, 12, 3, 4, 49);
		}
		if (type === "bogged" && !overlay && !m.sheared) {
			box([0, 0, 0], headPitch, headYaw + 0.7854, 0, -11, 3, 6, 4, 0.05, 50, 16);
			box([0, 0, 0], headPitch, headYaw + 2.3562, 0, -11, 3, 6, 4, 0.05, 50, 16);
			box([0, 0, 0], headPitch, headYaw + 0.7854, -6, -11, -3, 6, 4, 0.05, 50, 22);
			box([0, 0, 0], headPitch, headYaw + 2.3562, -6, -11, -3, 6, 4, 0.05, 50, 22);
		}
		return;
	}
	if (family === "creeper") {
		box([0, 6, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 0);
		box([0, 6, 0], 0, 0, -4, 0, -2, 8, 12, 4, 16, 16);
		box([-2, 18, 4], swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		box([2, 18, 4], -swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		box([-2, 18, -4], -swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		box([2, 18, -4], swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		return;
	}
	if (family === "spider") {
		const cave = type === "cave_spider" ? 0.7 : 1;
		const u2 = P * (m.baby ? 0.5 : 1) * cave;
		const b = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
			modelBox(list, m, u2, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, tw, th, 1, rz || 0, 0, null, false);
		};
		if (layer === "eyes") {
			b([0, 15, -3], headPitch, headYaw, -4, -4, -8, 8, 8, 8, 32, 4, 0);
			return;
		}
		b([0, 15, -3], headPitch, headYaw, -4, -4, -8, 8, 8, 8, 32, 4, 0);
		b([0, 15, 0], 0, 0, -3, -3, -3, 6, 6, 6, 0, 0, 0);
		b([0, 15, 9], 0, 0, -5, -4, -6, 10, 8, 12, 0, 12, 0);
		const k = Math.PI / 4, m8 = Math.PI / 8;
		const a = limb * 0.6662 * 2;
		const n = -(Math.cos(a) * 0.4) * amt;
		const o = -(Math.cos(a + Math.PI) * 0.4) * amt;
		const p = -(Math.cos(a + Math.PI / 2) * 0.4) * amt;
		const q = -(Math.cos(a + Math.PI * 1.5) * 0.4) * amt;
		const r = Math.abs(Math.sin(limb * 0.6662) * 0.4) * amt;
		const s = Math.abs(Math.sin(limb * 0.6662 + Math.PI) * 0.4) * amt;
		const t = Math.abs(Math.sin(limb * 0.6662 + Math.PI / 2) * 0.4) * amt;
		const u = Math.abs(Math.sin(limb * 0.6662 + Math.PI * 1.5) * 0.4) * amt;
		const legs = [
			[-4, 15, 2, k + n, k - r, -15],
			[4, 15, 2, -k - n, -k + r, -1],
			[-4, 15, 1, m8 + o, 0.58119464 - s, -15],
			[4, 15, 1, -m8 - o, -0.58119464 + s, -1],
			[-4, 15, 0, -m8 + p, 0.58119464 - t, -15],
			[4, 15, 0, m8 - p, -0.58119464 + t, -1],
			[-4, 15, -1, -k + q, k - u, -15],
			[4, 15, -1, k - q, -k + u, -1]
		];
		for (const L of legs) {
			b([L[0], L[1], L[2]], 0, L[3], L[5], -1, -1, 16, 2, 2, 18, 0, L[4]);
		}
		return;
	}
	if (family === "chicken") {
		box([0, 15, -4], headPitch, headYaw, -2, -6, -2, 4, 6, 3, 0, 0);
		box([0, 15, -4], headPitch, headYaw, -2, -4, -4, 4, 2, 2, 14, 0);
		box([0, 15, -4], headPitch, headYaw, -1, -2, -3, 2, 2, 2, 14, 4);
		box([0, 16, 0], -Math.PI / 2, 0, -3, -4, -3, 6, 8, 6, 0, 9);
		box([-1, 19, 1], -swing, 0, -1, 0, -1, 3, 5, 3, 26, 0);
		box([1, 19, 1], swing, 0, -1, 0, -1, 3, 5, 3, 26, 0);
		const flap = (Math.sin(m.flap || 0) + 1) * (m.wing || 0);
		box([-4, 13, 0], 0, 0, 0, 0, -3, 1, 4, 6, 24, 13, 1, flap);
		box([4, 13, 0], 0, 0, -1, 0, -3, 1, 4, 6, 24, 13, 1, -flap);
		return;
	}
	if (family === "slime") {
		const size = Math.max(0.52, m.h || 1);
		pushBox(list, m.x, m.y + 0.02, m.z, m.bodyYaw || m.yaw, [0, 0, 0], 0, 0, -size / 2, 0, -size / 2, size / 2, size, size / 2, 0, 0, 8, 8, 8, 0, 1, tw, th);
		return;
	}
	if (family === "horse") {
		const neck = headPitch - 0.5236;
		const donkey = type === "donkey" || type === "mule";
		box([0, 11, 5], 0, 0, -5, -8, -17, 10, 10, 22, 0, 32);
		box([0, 6, 7], -0.5236, 0, -1.5, 0, 0, 3, 14, 4, 42, 36);
		box([0, 4, -12], neck, headYaw, -2.05, -6, -2, 4, 12, 7, 0, 35);
		box([0, 4, -12], neck, headYaw, -3, -11, -2, 6, 5, 7, 0, 13);
		box([0, 4, -12], neck, headYaw, -1, -11, 5, 2, 16, 2, 56, 36);
		box([0, 4, -12], neck, headYaw, -2, -11, -7, 4, 5, 5, 0, 25);
		if (donkey) {
			box([0, 4, -12], neck, headYaw, 0.5, -18, 4, 2, 8, 1, 0, 12);
			box([0, 4, -12], neck, headYaw, -2.5, -18, 4, 2, 8, 1, 0, 12);
		} else {
			box([0, 4, -12], neck, headYaw, 0.55, -13, 4, 2, 3, 1, 19, 16);
			box([0, 4, -12], neck, headYaw, -2.55, -13, 4, 2, 3, 1, 19, 16);
		}
		box([4, 14, 7], swing, 0, -3, -1, -1, 4, 11, 4, 48, 21);
		box([-4, 14, 7], -swing, 0, -1, -1, -1, 4, 11, 4, 48, 21);
		box([4, 14, -10], -swing, 0, -3, -1, -1.9, 4, 11, 4, 48, 21);
		box([-4, 14, -10], swing, 0, -1, -1, -1.9, 4, 11, 4, 48, 21);
		return;
	}
	if (family === "camel") {
		box([0, 4, 9.5], 0, 0, -7.5, -12, -23.5, 15, 12, 27, 0, 25);
		box([0, -8, -0.5], 0, 0, -4.5, -5, -5.5, 9, 5, 11, 74, 0);
		box([0, -5, 13], 0, 0, -1.5, 0, 0, 3, 14, 1, 122, 0);
		box([0, 1, -10], headPitch, headYaw, -3.5, -7, -15, 7, 8, 19, 60, 24);
		box([0, 1, -10], headPitch, headYaw, -3.5, -21, -15, 7, 14, 7, 21, 0);
		box([0, 1, -10], headPitch, headYaw, -2.5, -21, -21, 5, 5, 6, 50, 0);
		box([0, 1, -10], headPitch, headYaw, 2, -21, -10.5, 3, 2, 1, 45, 0);
		box([0, 1, -10], headPitch, headYaw, -5, -21, -10.5, 3, 2, 1, 67, 0);
		box([4.9, 3, 9.5], swing, 0, -2.5, 0, -2.5, 5, 21, 5, 58, 16);
		box([-4.9, 3, 9.5], -swing, 0, -2.5, 0, -2.5, 5, 21, 5, 94, 16);
		box([4.9, 3, -10.5], -swing, 0, -2.5, 0, -2.5, 5, 21, 5, 0, 0);
		box([-4.9, 3, -10.5], swing, 0, -2.5, 0, -2.5, 5, 21, 5, 0, 26);
		return;
	}
	if (family === "cat") {
		box([0, 15, -9], headPitch, headYaw, -2.5, -2, -3, 5, 4, 5, 0, 0);
		box([0, 15, -9], headPitch, headYaw, -1.5, 0, -4, 3, 2, 2, 0, 24);
		box([0, 15, -9], headPitch, headYaw, -2, -3, 0, 1, 1, 2, 0, 10);
		box([0, 15, -9], headPitch, headYaw, 1, -3, 0, 1, 1, 2, 6, 10);
		box([0, 12, -10], -Math.PI / 2, 0, -2, 3, -8, 4, 16, 6, 20, 0, 1, 0, 0, null, true);
		box([0, 15, 8], -0.9, 0, -0.5, 0, 0, 1, 8, 1, 0, 15);
		box([0, 20, 14], -1.7279, 0, -0.5, 0, 0, 1, 8, 1, 4, 15);
		box([1.1, 18, 5], swing, 0, -1, 0, 1, 2, 6, 2, 8, 13);
		box([-1.1, 18, 5], -swing, 0, -1, 0, 1, 2, 6, 2, 8, 13);
		box([1.2, 14.1, -5], -swing, 0, -1, 0, 0, 2, 10, 2, 40, 0);
		box([-1.2, 14.1, -5], swing, 0, -1, 0, 0, 2, 10, 2, 40, 0);
		return;
	}
	if (family === "wolf") {
		box([-1, 13.5, -7], headPitch, headYaw, -2, -3, -2, 6, 6, 4, 0, 0);
		box([-1, 13.5, -7], headPitch, headYaw, -2, -5, 0, 2, 2, 1, 16, 14);
		box([-1, 13.5, -7], headPitch, headYaw, 2, -5, 0, 2, 2, 1, 16, 14);
		box([-1, 13.5, -7], headPitch, headYaw, -0.5, 0, -5, 3, 3, 4, 0, 10);
		box([0, 14, 2], -Math.PI / 2, 0, -3, -2, -3, 6, 9, 6, 18, 14);
		box([-1, 14, -3], -Math.PI / 2, 0, -3, -3, -3, 8, 6, 7, 21, 0);
		box([-2.5, 16, 7], swing, 0, 0, 0, -1, 2, 8, 2, 0, 18);
		box([0.5, 16, 7], -swing, 0, 0, 0, -1, 2, 8, 2, 0, 18);
		box([-2.5, 16, -4], -swing, 0, 0, 0, -1, 2, 8, 2, 0, 18);
		box([0.5, 16, -4], swing, 0, 0, 0, -1, 2, 8, 2, 0, 18);
		box([-1, 12, 8], -0.6283, 0, 0, 0, -1, 2, 8, 2, 9, 18);
		return;
	}
	if (family === "parrot") {
		const flap = (Math.sin(m.flap || 0) + 1) * (m.wing || 0);
		const flying = !!m.air || (m.wing || 0) > 0.3;
		const bob = flap * 0.3;
		const tailSwing = Math.cos(limb * 0.6662) * 0.3 * amt;
		const wingPitch = flying ? 0.15 : 0.6981;
		const wingYaw = flying ? 0 : Math.PI;
		const leftRoll = flying ? 0.9 + flap : -0.0873 - flap;
		const rightRoll = flying ? -(0.9 + flap) : 0.0873 + flap;
		box([0, 16.5 + bob, -3], -0.4937, 0, -1.5, 0, -1.5, 3, 6, 3, 2, 8);
		box([0, 21.07 + bob, 1.16], -1.015 - tailSwing, 0, -1.5, -1, -1, 3, 4, 1, 22, 1);
		box([1.5, 16.94 + bob, -2.76], wingPitch, wingYaw, -0.5, 0, -1.5, 1, 5, 3, 19, 8, 1, leftRoll);
		box([-1.5, 16.94 + bob, -2.76], wingPitch, wingYaw, -0.5, 0, -1.5, 1, 5, 3, 19, 8, 1, rightRoll);
		box([0, 15.69 + bob, -2.76], headPitch, headYaw, -1, -1.5, -1, 2, 3, 2, 2, 2);
		box([0, 15.69 + bob, -2.76], headPitch, headYaw, -1, -2.5, -3, 2, 1, 4, 10, 0);
		box([0, 15.69 + bob, -2.76], headPitch, headYaw, -0.5, -1.5, -2, 1, 2, 1, 11, 7);
		box([0, 15.69 + bob, -2.76], headPitch, headYaw, -0.5, -1.75, -2.95, 1, 2, 1, 16, 7);
		box([0, 15.69 + bob, -2.76], headPitch + 0.2214, headYaw, 0, -6.15, -1.85, 0, 5, 4, 2, 18, 1, 0, 0.04);
		box([1, 22 + bob, -1.05], -swing, 0, -0.5, 0, -0.5, 1, 2, 1, 14, 18);
		box([-1, 22 + bob, -1.05], swing, 0, -0.5, 0, -0.5, 1, 2, 1, 14, 18);
		return;
	}
	if (family === "bat") {
		const hang = m.roost ? Math.PI : 0;
		const beat = m.roost ? 0.55 : 0.25 + Math.sin(limb * 3.2) * 0.7;
		box([0, 17, 0], hang, 0, -1.5, 0, -1, 3, 5, 2, 0, 0);
		box([0, 17, 0], hang + headPitch, headYaw, -2, -3, -1, 4, 3, 2, 0, 7);
		box([0, 17, 0], hang + headPitch, headYaw, -4, -6, 0, 3, 5, 0, 1, 15, 1, 0, 0.04);
		box([0, 17, 0], hang + headPitch, headYaw, 1, -6, 0, 3, 5, 0, 8, 15, 1, 0, 0.04);
		box([-1.5, 17, 0], hang, 0, -2, -2, 0, 2, 7, 0, 12, 0, 1, beat, 0.04);
		box([-1.5, 17, 0], hang, 0, -8, -2, 0, 6, 8, 0, 16, 0, 1, beat, 0.04);
		box([1.5, 17, 0], hang, 0, 0, -2, 0, 2, 7, 0, 12, 7, 1, -beat, 0.04);
		box([1.5, 17, 0], hang, 0, 2, -2, 0, 6, 8, 0, 16, 8, 1, -beat, 0.04);
		box([0, 22, 0], hang, 0, -1.5, 0, 0, 3, 2, 0, 16, 16, 1, 0, 0.04);
		return;
	}
	if (family === "bee") {
		const buzz = m.air ? Math.sin(limb * 2.4) * 0.55 : 0.12;
		box([0, 19, 0], 0, 0, -3.5, -4, -5, 7, 7, 10, 0, 0);
		box([0, 19, 0], 0, 0, 0, -1, 5, 0, 1, 2, 26, 7, 1, 0, 0.04);
		box([0, 19, 0], 0.15, 0, 1.5, -4, -8, 1, 2, 3, 2, 0);
		box([0, 19, 0], 0.15, 0, -2.5, -4, -8, 1, 2, 3, 2, 3);
		box([-1.5, 15, -3], 0, -0.2618, -9, 0, 0, 9, 0, 6, 0, 18, 1, buzz, 0.04);
		box([1.5, 15, -3], 0, 0.2618, 0, 0, 0, 9, 0, 6, 0, 18, 1, -buzz, 0.04);
		box([1.5, 22, -2], 0, 0, -5, 0, 0, 7, 2, 0, 26, 1, 1, 0, 0.04);
		box([1.5, 22, 0], 0, 0, -5, 0, 0, 7, 2, 0, 26, 3, 1, 0, 0.04);
		box([1.5, 22, 2], 0, 0, -5, 0, 0, 7, 2, 0, 26, 5, 1, 0, 0.04);
		return;
	}
	if (family === "fox") {
		box([-1, 16.5, -3], headPitch, headYaw, -3, -2, -5, 8, 6, 6, 1, 5);
		box([-1, 16.5, -3], headPitch, headYaw, -3, -4, -4, 2, 2, 1, 8, 1);
		box([-1, 16.5, -3], headPitch, headYaw, 3, -4, -4, 2, 2, 1, 15, 1);
		box([-1, 16.5, -3], headPitch, headYaw, -1, 2.01, -8, 4, 2, 3, 6, 18);
		box([0, 16, -6], -Math.PI / 2, 0, -3, 4, -3.5, 6, 11, 6, 24, 15, 1, 0, 0, null, true);
		box([0, 16, -6], -Math.PI / 2 + 0.052, 0, -2, 15, -2, 4, 9, 5, 30, 0, 1, 0, 0, null, true);
		box([-5, 17.5, 7], swing, 0, 2, 0.5, -1, 2, 6, 2, 4, 24);
		box([-1, 17.5, 7], -swing, 0, 2, 0.5, -1, 2, 6, 2, 13, 24);
		box([-5, 17.5, 0], -swing, 0, 2, 0.5, -1, 2, 6, 2, 4, 24);
		box([-1, 17.5, 0], swing, 0, 2, 0.5, -1, 2, 6, 2, 13, 24);
		return;
	}
	if (family === "goat") {
		box([1, 14, 0], headPitch, headYaw, -6, -11, -10, 3, 2, 1, 2, 61);
		box([1, 14, 0], headPitch, headYaw, 2, -11, -10, 3, 2, 1, 2, 61);
		box([1, 14, 0], headPitch, headYaw, -0.5, -3, -14, 0, 7, 5, 23, 52, 1, 0, 0.04);
		box([1, 6, -8], headPitch - 0.9599, headYaw, -3, -4, -8, 5, 7, 10, 34, 46, 1, 0, 0, null, null, true);
		if (!m.baby) {
			box([1, 14, 0], headPitch, headYaw, -0.01, -16, -10, 2, 7, 2, 12, 55);
			box([1, 14, 0], headPitch, headYaw, -2.99, -16, -10, 2, 7, 2, 12, 55);
		}
		box([0, 24, 0], 0, 0, -4, -17, -7, 9, 11, 16, 1, 1);
		box([0, 24, 0], 0, 0, -5, -18, -8, 11, 14, 11, 0, 28);
		box([1, 14, 4], swing, 0, 0, 4, 0, 3, 6, 3, 36, 29);
		box([-3, 14, 4], -swing, 0, 0, 4, 0, 3, 6, 3, 49, 29);
		box([1, 14, -6], -swing, 0, 0, 0, 0, 3, 10, 3, 49, 2);
		box([-3, 14, -6], swing, 0, 0, 0, 0, 3, 10, 3, 35, 2);
		return;
	}
	if (family === "llama") {
		box([0, 7, -6], headPitch, headYaw, -2, -14, -10, 4, 4, 9, 0, 0);
		box([0, 7, -6], headPitch, headYaw, -4, -16, -6, 8, 18, 6, 0, 14);
		box([0, 7, -6], headPitch, headYaw, -4, -19, -4, 3, 3, 2, 17, 0);
		box([0, 7, -6], headPitch, headYaw, 1, -19, -4, 3, 3, 2, 17, 0);
		box([0, 5, 2], -Math.PI / 2, 0, -6, -10, -7, 12, 18, 10, 29, 0);
		box([-3.5, 10, 6], swing, 0, -2, 0, -2, 4, 14, 4, 29, 29);
		box([3.5, 10, 6], -swing, 0, -2, 0, -2, 4, 14, 4, 29, 29);
		box([-3.5, 10, -5], -swing, 0, -2, 0, -2, 4, 14, 4, 29, 29);
		box([3.5, 10, -5], swing, 0, -2, 0, -2, 4, 14, 4, 29, 29);
		return;
	}
	if (family === "bear") {
		box([0, 10, -16], headPitch, headYaw, -3.5, -3, -3, 7, 7, 7, 0, 0);
		box([0, 10, -16], headPitch, headYaw, -2.5, 1, -6, 5, 3, 3, 0, 44);
		box([0, 10, -16], headPitch, headYaw, -4.5, -4, -1, 2, 2, 1, 26, 0);
		box([0, 10, -16], headPitch, headYaw, 2.5, -4, -1, 2, 2, 1, 26, 0);
		box([-2, 9, 12], -Math.PI / 2, 0, -5, -13, -7, 14, 14, 11, 0, 19);
		box([-2, 9, 12], -Math.PI / 2, 0, -4, -25, -7, 12, 12, 10, 39, 0);
		box([-4.5, 14, 6], swing, 0, -2, 0, -2, 4, 10, 8, 50, 22);
		box([4.5, 14, 6], -swing, 0, -2, 0, -2, 4, 10, 8, 50, 22);
		box([-3.5, 14, -8], -swing, 0, -2, 0, -2, 4, 10, 6, 50, 40);
		box([3.5, 14, -8], swing, 0, -2, 0, -2, 4, 10, 6, 50, 40);
		return;
	}
	if (family === "panda") {
		box([0, 11.5, -17], headPitch, headYaw, -6.5, -5, -4, 13, 10, 9, 0, 6);
		box([0, 11.5, -17], headPitch, headYaw, -3.5, 0, -6, 7, 5, 2, 45, 16);
		box([0, 11.5, -17], headPitch, headYaw, 3.5, -8, -1, 5, 4, 1, 52, 25);
		box([0, 11.5, -17], headPitch, headYaw, -8.5, -8, -1, 5, 4, 1, 52, 25);
		box([0, 10, 0], -Math.PI / 2, 0, -9.5, -13, -6.5, 19, 26, 13, 0, 25);
		box([-5.5, 15, 9], swing, 0, -3, 0, -3, 6, 9, 6, 40, 0);
		box([5.5, 15, 9], -swing, 0, -3, 0, -3, 6, 9, 6, 40, 0);
		box([-5.5, 15, -9], -swing, 0, -3, 0, -3, 6, 9, 6, 40, 0);
		box([5.5, 15, -9], swing, 0, -3, 0, -3, 6, 9, 6, 40, 0);
		return;
	}
	if (family === "rabbit") {
		box([0, 16, -1], headPitch, headYaw, -2.5, -4, -5, 5, 4, 5, 32, 0);
		box([0, 16, -1], headPitch, headYaw, -0.5, -2.5, -5.5, 1, 1, 1, 32, 9);
		box([0, 16, -1], headPitch, headYaw - 0.2618, -2.5, -9, -1, 2, 5, 1, 52, 0);
		box([0, 16, -1], headPitch, headYaw + 0.2618, 0.5, -9, -1, 2, 5, 1, 58, 0);
		box([0, 19, 8], 0.3491, 0, -3, -2, -10, 6, 5, 10, 0, 0);
		box([0, 20, 7], 0.3491, 0, -1.5, -1.5, 0, 3, 3, 2, 52, 6);
		box([3, 17.5, 3.7], 0.3665 + swing, 0, -1, 0, 0, 2, 4, 5, 30, 15);
		box([-3, 17.5, 3.7], 0.3665 - swing, 0, -1, 0, 0, 2, 4, 5, 16, 15);
		box([3, 17.5, 3.7], swing, 0, -1, 5.5, -3.7, 2, 1, 7, 26, 24);
		box([-3, 17.5, 3.7], -swing, 0, -1, 5.5, -3.7, 2, 1, 7, 8, 24);
		box([3, 17, -1], 0.192 - swing, 0, -1, 0, -1, 2, 7, 2, 8, 15);
		box([-3, 17, -1], 0.192 + swing, 0, -1, 0, -1, 2, 7, 2, 0, 15);
		return;
	}
	if (family === "sniffer") {
		const kick = Math.cos(limb * 0.6662) * 0.6 * amt;
		box([0, 5, 0], 0, 0, -12.5, -14, -20, 25, 29, 40, 62, 68);
		box([0, 5, 0], 0, 0, -12.5, -14, -20, 25, 24, 40, 62, 0, 1, 0, 0.5);
		box([0, 11.5, -19.48], headPitch, headYaw, -6.5, -7.5, -11.5, 13, 18, 11, 8, 15);
		box([0, 11.5, -19.48], headPitch, headYaw, 6.51, -7.5, -7.51, 1, 19, 7, 2, 0);
		box([0, 11.5, -19.48], headPitch, headYaw, -7.51, -7.5, -7.51, 1, 19, 7, 48, 0);
		box([0, 11.5, -19.48], headPitch, headYaw, -6.5, -6.5, -20.5, 13, 2, 9, 10, 45);
		box([0, 11.5, -19.48], headPitch, headYaw, -6.5, -4.5, -20.5, 13, 12, 9, 10, 57);
		box([-7.5, 15, -15], -kick, 0, -3.5, -1, -4, 7, 10, 8, 32, 87);
		box([7.5, 15, -15], kick, 0, -3.5, -1, -4, 7, 10, 8, 0, 87);
		box([-7.5, 15, 0], kick, 0, -3.5, -1, -4, 7, 10, 8, 32, 105);
		box([7.5, 15, 0], -kick, 0, -3.5, -1, -4, 7, 10, 8, 0, 105);
		box([-7.5, 15, 15], -kick, 0, -3.5, -1, -4, 7, 10, 8, 32, 123);
		box([7.5, 15, 15], kick, 0, -3.5, -1, -4, 7, 10, 8, 0, 123);
		return;
	}
	if (family === "iron_golem") {
		box([0, -7, -2], headPitch, headYaw, -4, -12, -5.5, 8, 10, 8, 0, 0);
		box([0, -7, -2], headPitch, headYaw, -1, -5, -7.5, 2, 4, 2, 24, 0);
		box([0, -7, 0], 0, 0, -9, -2, -6, 18, 12, 11, 0, 40);
		box([0, -7, 0], 0, 0, -4.5, 10, -3, 9, 5, 6, 0, 70, 1, 0, 0.5);
		box([0, -7, 0], swing * 0.5, 0, -13, -2.5, -3, 4, 30, 6, 60, 21);
		box([0, -7, 0], -swing * 0.5, 0, 9, -2.5, -3, 4, 30, 6, 60, 58);
		box([-4, 11, 0], -swing, 0, -3.5, -3, -3, 6, 16, 5, 37, 0);
		box([5, 11, 0], swing, 0, -3.5, -3, -3, 6, 16, 5, 60, 0);
		return;
	}
	if (family === "snow_golem") {
		box([0, 4, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 0, 1, 0, -0.5);
		box([0, 13, 0], 0, 0, -5, -10, -5, 10, 10, 10, 0, 16, 1, 0, -0.5);
		box([0, 24, 0], 0, 0, -6, -12, -6, 12, 12, 12, 0, 36, 1, 0, -0.5);
		box([5, 6, 1], 0, 0, -1, 0, -1, 12, 2, 2, 32, 0, 1, -1, -0.5);
		box([-5, 6, -1], 0, Math.PI, -1, 0, -1, 12, 2, 2, 32, 0, 1, 1, -0.5);
		return;
	}
	if (family === "copper_golem") {
		const glow = layer === "eyes" ? 1.8 : 1;
		box([0, 19, 0], 0, 0, -4, -6, -3, 8, 6, 6, 0, 15, glow);
		box([0, 13, 0], headPitch, headYaw, -4, -5, -5, 8, 5, 10, 0, 0, glow, 0, 0.015);
		box([0, 13, 0], headPitch, headYaw, -1, -2, 4, 2, 3, 2, 56, 0, glow, 0, 0.2);
		box([0, 13, 0], headPitch, headYaw, -1, -9, -1, 2, 4, 2, 37, 8, glow, 0, -0.015);
		box([0, 13, 0], headPitch, headYaw, -2, -13, -2, 4, 4, 4, 37, 0, glow, 0, -0.015);
		box([-4, 13, 0], swing, 0, -3, -1, -2, 3, 10, 4, 36, 16, glow);
		box([4, 13, 0], -swing, 0, 0, -1, -2, 3, 10, 4, 50, 16, glow);
		box([0, 19, 0], -swing, 0, -4, 0, -2, 4, 5, 4, 0, 27, glow);
		box([0, 19, 0], swing, 0, 0, 0, -2, 4, 5, 4, 16, 27, glow);
		return;
	}
	if (family === "villager") {
		const extra = layer ? 0.12 : 0;
		const armRx = type === "zombie_villager" ? -1.4 : -0.75;
		box([0, 0, 0], headPitch, headYaw, -4, -10, -4, 8, 10, 8, 0, 0, 1, 0, extra);
		box([0, 0, 0], headPitch, headYaw, -4, -10, -4, 8, 10, 8, 32, 0, 1, 0, 0.51 + extra);
		box([0, 0, 0], headPitch, headYaw, -1, -3, 4, 2, 4, 2, 24, 0, 1, 0, extra);
		box([0, 0, 0], 0, 0, -4, 0, -3, 8, 12, 6, 16, 20, 1, 0, extra);
		if (layer || type !== "villager") {
			box([0, 0, 0], 0, 0, -4, 0, -3, 8, 20, 6, 0, 38, 1, 0, 0.5 + extra);
		}
		box([0, 3, 1], armRx, 0, -8, -2, -2, 4, 8, 4, 44, 22, 1, 0, extra);
		box([0, 3, 1], armRx, 0, 4, -2, -2, 4, 8, 4, 44, 22, 1, 0, extra);
		box([0, 3, 1], armRx, 0, -4, 2, -2, 8, 4, 4, 40, 38, 1, 0, extra);
		box([-2, 12, 0], -swing, 0, -2, 0, -2, 4, 12, 4, 0, 22, 1, 0, extra);
		box([2, 12, 0], swing, 0, -2, 0, -2, 4, 12, 4, 0, 22, 1, 0, extra);
		return;
	}
	if (family === "breeze") {
		const glow = layer === "eyes" ? 1.8 : 1;
		const idleT = ((animClock % 2) + 2) % 2;
		const rodSpin = idleT / 2 * Math.PI * 6;
		const headBob = idleT < 1 ? idleT : 2 - idleT;
		const rodDip = idleT < 1 ? -idleT : idleT - 2;
		const rodsXf = [0, 8 - rodDip, 0, 0, rodSpin, 0];
		const wTop = lerpKf([
			[0, 0.5, 0, 0], [0.25, 0.5, 0, -0.5], [0.75, -0.5, 0, -0.5],
			[1.25, -0.5, 0, 0.5], [1.75, 0.5, 0, 0.5], [2, 0.5, 0, 0]
		], idleT);
		const wMid = lerpKf([
			[0, 0.5, 0, -0.5], [0.5, -0.5, 0, -0.5], [1, -0.5, 0, 0.5],
			[1.5, 0.5, 0, 0.5], [2, 0.5, 0, -0.5]
		], idleT);
		if (layer === "wind") {
			box([wTop[0], 11 - wTop[1], wTop[2]], 0, 0, -9, -8, -9, 18, 8, 18, 0, 0, 0.55);
			box([wTop[0], 11 - wTop[1], wTop[2]], 0, 0, -6, -8, -6, 12, 8, 12, 6, 6, 0.5);
			box([wTop[0], 11 - wTop[1], wTop[2]], 0, 0, -2.5, -8, -2.5, 5, 8, 5, 105, 57, 0.45);
			box([wMid[0], 17 - wMid[1], wMid[2]], 0, 0, -6, -6, -6, 12, 6, 12, 74, 28, 0.55);
			box([wMid[0], 17 - wMid[1], wMid[2]], 0, 0, -4, -6, -4, 8, 6, 8, 78, 32, 0.5);
			box([wMid[0], 17 - wMid[1], wMid[2]], 0, 0, -2.5, -6, -2.5, 5, 6, 5, 49, 71, 0.45);
			box([0, 24, 0], 0, 0, -2.5, -7, -2.5, 5, 7, 5, 1, 83, 0.6);
			return;
		}
		const hp = [0, 4 - headBob, 0];
		if (layer === "eyes") {
			box(hp, headPitch, headYaw, -5, -5, -4.2, 10, 3, 4, 4, 24, glow);
			return;
		}
		box(hp, headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 0, glow);
		box([0, 5, -3], -0.3927, 0, -1, 0, -3, 2, 8, 2, 0, 17, 1, 0, 0, null, null, null, rodsXf);
		box([2.5981, 5, 1.5], 2.7489, -1.0472, -1, 0, -3, 2, 8, 2, 0, 17, 1, -Math.PI, 0, null, null, null, rodsXf);
		box([-2.5981, 5, 1.5], 2.7489, 1.0472, -1, 0, -3, 2, 8, 2, 0, 17, 1, -Math.PI, 0, null, null, null, rodsXf);
		return;
	}
	if (family === "creaking") {
		const glow = layer === "eyes" ? 1.8 : 1;
		const walkT = ((limb * 50) % 1125) / 1000;
		const w = amt > 0.02 ? amt : 0;
		const scale3 = (v) => [v[0] * w, v[1] * w, v[2] * w];
		const yUp = (v) => [-v[0], v[1], -v[2]];
		const ub = yUp(scale3(w ? degKf([
			[0, 26.8802, -23.399, -9.0616], [0.125, -2.2093, 5.9119, 0.0675], [0.5417, 23.0778, 14.2906, 4.6066],
			[0.7083, -10, 0, 0], [0.875, 7.5, 0, 0], [1.125, 26.8802, -23.399, -9.0616]
		], walkT) : [0, 0, 0]));
		const hd = yUp(scale3(w ? degKf([
			[0, 0, 0, 0], [0.0417, -17.5, -62.5, 0], [0.0833, 0, 0, 0], [0.4167, 0, 0, 0],
			[0.4583, 0, 15, 0], [0.5, 0, 0, 0], [1.0417, 0, 0, 0],
			[1.0833, -37.1532, 81.1131, -28.3621], [1.125, 0, 0, 0]
		], walkT) : [0, 0, 0]));
		const ra = yUp(scale3(w ? degKf([
			[0, 12.5, 0, 0], [0.25, -32, 0, 0], [0.875, 12, 0, 0], [1.125, -15, 0, 0]
		], walkT) : [0, 0, 0]));
		const la = yUp(scale3(w ? degKf([
			[0, -15, 0, 0], [0.125, 10, 0, 0], [0.5417, -25, 0, 0], [0.75, -9.0923, 0, 0],
			[0.7917, -15.137, -66.7758, 13.9603], [0.8333, -9.0923, 0, 0], [1, 10, 0, 0], [1.125, -15, 0, 0]
		], walkT) : [0, 0, 0]));
		const ll = yUp(scale3(w ? degKf([
			[0, 0, 0, 0], [0.25, 30, 0, 0], [0.375, 49.8924, -3.8282, 3.2187], [0.5, 17.5, 0, 0],
			[0.625, -56.5613, -12.2403, -8.7374], [0.9167, 0, 0, 0], [1.125, 0, 0, 0]
		], walkT) : [0, 0, 0]));
		const llp = scale3(w ? lerpKf([
			[0, 0, 0, 2], [0.25, 0, 0.1846, 0.5979], [0.375, 0, -0.0665, -2.2177], [0.5, 0, 1.3563, -4.3474],
			[0.625, 0, 0.1047, -1.6556], [0.9167, 0, 0, -1], [1.125, 0, 0, 2]
		], walkT) : [0, 0, 0]);
		const rl = yUp(scale3(w ? degKf([
			[0, 25.5305, 11.3126, 5.3525], [0.125, -49.5628, 7.3556, 6.7933], [0.25, 0, 0, 0], [0.4583, 0, 0, 0],
			[0.9167, 30, 0, 0], [1.0417, 55, 0, 0], [1.125, 25.5305, 11.3126, 5.3525]
		], walkT) : [0, 0, 0]));
		const rlp = scale3(w ? lerpKf([
			[0, 0, 0.9674, -3.6579], [0.125, 0, -0.2979, -0.9411], [0.25, 0, -0.3, -0.94],
			[0.4583, 0, -0.3, 1.06], [1.125, 0, 0.9674, -3.6579]
		], walkT) : [0, 0, 0]);
		const up = [-1, 5, 0, ub[0], ub[1], ub[2]];
		if (layer === "eyes") {
			box([-4, -6, 0], headPitch + hd[0], headYaw + hd[1], -3, -10, -3, 6, 10, 6, 0, 0, glow, hd[2], 0, null, null, null, up);
			return;
		}
		box([-1, -2, 1], 0, 0, 0, -3, -3, 6, 13, 5, 0, 16, glow, 0, 0, null, null, null, up);
		box([-1, -2, 1], 0, 0, -6, -4, -3, 6, 7, 5, 24, 0, glow, 0, 0, null, null, null, up);
		box([-4, -6, 0], headPitch + hd[0], headYaw + hd[1], -3, -10, -3, 6, 10, 6, 0, 0, glow, hd[2], 0, null, null, null, up);
		box([-4, -6, 0], headPitch + hd[0], headYaw + hd[1], -3, -13, -3, 6, 3, 6, 28, 31, glow, hd[2], 0, null, null, null, up);
		box([-8, -4.5, 1.5], ra[0], ra[1], -2, -1.5, -1.5, 3, 21, 3, 22, 13, glow, ra[2], 0, null, null, null, up);
		box([-8, -4.5, 1.5], ra[0], ra[1], -2, 19.5, -1.5, 3, 4, 3, 46, 0, glow, ra[2], 0, null, null, null, up);
		box([5, -4, 0.5], la[0], la[1], 0, -1, -1.5, 3, 16, 3, 30, 40, glow, la[2], 0, null, null, null, up);
		box([5, -4, 0.5], la[0], la[1], 0, -5, -1.5, 3, 4, 3, 52, 12, glow, la[2], 0, null, null, null, up);
		box([5, -4, 0.5], la[0], la[1], 0, 15, -1.5, 3, 4, 3, 52, 19, glow, la[2], 0, null, null, null, up);
		box([-1 + rlp[0], 6.5 - rlp[1], 0.5 + rlp[2]], rl[0], rl[1], -3, -1.5, -1.5, 3, 19, 3, 0, 34, glow, rl[2]);
		box([-1 + rlp[0], 6.5 - rlp[1], 0.5 + rlp[2]], rl[0], rl[1], -3, -4.5, -1.5, 3, 3, 3, 12, 34, glow, rl[2]);
		box([1.5 + llp[0], 8 - llp[1], 0.5 + llp[2]], ll[0], ll[1], -1.5, 0, -1.5, 3, 16, 3, 42, 40, glow, ll[2]);
		return;
	}
	if (family === "nautilus") {
		const nbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, inflate) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 128, 128, 1, 0, inflate || 0);
		};
		const look = headPitch * 0.2;
		const shell = [0, 16, -1];
		nbox(shell, look, headYaw, -7, -10, -7, 14, 10, 16, 0, 0);
		nbox(shell, look, headYaw, -7, 0, -7, 14, 8, 20, 0, 26);
		nbox(shell, look, headYaw, -7, 0, 6, 14, 8, 0.05, 48, 26);
		const body = [0, 20.5, 6.3];
		nbox(body, look, headYaw, -5, -4.51, -3, 10, 8, 14, 0, 54);
		nbox(body, look, headYaw, -5, -4.51, 7, 10, 8, 0.05, 0, 76);
		nbox([0, 17.99, 13.3], look, headYaw, -5, -2, 0, 10, 4, 4, 54, 54, -0.001);
		nbox([0, 19.99, 13.8], look, headYaw, -3, -2, -0.5, 6, 4, 4, 54, 70);
		nbox([0, 21.99, 13.3], look, headYaw, -5, -1.98, 0, 10, 4, 4, 54, 62, -0.001);
		return;
	}
	if (family === "cod") {
		const wag = Math.sin(animClock * 8) * 0.45;
		const fbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 32, 32, 1, rz || 0);
		};
		fbox([0, 22, 0], 0, 0, -1, -2, 0, 2, 4, 7, 0, 0);
		fbox([0, 22, 0], 0, 0, -1, -2, -3, 2, 4, 3, 11, 0);
		fbox([0, 22, -3], 0, 0, -1, -2, -1, 2, 3, 1, 0, 0);
		fbox([0, 22, 7], 0, wag, 0, -2, 0, 0.05, 4, 4, 22, 3);
		fbox([0, 20, 0], 0, 0, 0, -1, 0, 0.05, 1, 6, 20, 0);
		fbox([-1, 23, 0], 0, 0, 0, -2, -1, 0.05, 2, 2, 22, 1, -0.7854);
		fbox([1, 23, 0], 0, 0, 0, -2, -1, 0.05, 2, 2, 22, 4, 0.7854);
		return;
	}
	if (family === "salmon") {
		const wag = Math.sin(animClock * 8) * 0.35;
		const fbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 32, 32, 1, rz || 0);
		};
		fbox([0, 20, -7.2], 0, 0, -1.5, -2.5, 0, 3, 5, 8, 0, 0);
		fbox([0, 20, 0.8], 0, wag, -1.5, -2.5, 0, 3, 5, 8, 0, 13);
		fbox([0, 20, -7.2], 0, 0, -1, -2, -3, 2, 4, 3, 22, 0);
		fbox([0, 20, 8.8], 0, wag, 0, -2.5, 0, 0.05, 5, 6, 20, 10);
		fbox([0, 15.5, -2.2], 0, 0, 0, 0, 0, 0.05, 5, 3, 2, 1);
		fbox([-1.5, 21.5, -7.2], 0, 0, 0, -2, 0, 0.05, 2, 2, 0, 0, -0.7854);
		fbox([1.5, 21.5, -7.2], 0, 0, 0, -2, 0, 0.05, 2, 2, 0, 0, 0.7854);
		return;
	}
	if (family === "pufferfish") {
		const puff = m.puff == null ? 1 : m.puff;
		const fbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 32, 32, 1, rz || 0);
		};
		if (puff <= 0) {
			fbox([0, 23, 0], 0, 0, -1.5, -2, -1.5, 3, 3, 3, 0, 27);
			fbox([-1.5, 21, 0], 0, 0, 0, 0, 0, 1, 1, 1, 24, 6);
			fbox([0.5, 21, 0], 0, 0, 0, 0, 0, 1, 1, 1, 28, 6);
			fbox([0, 22, 1.5], 0, 0, 0, -1.5, 0, 0.05, 3, 3, 0, 0);
			return;
		}
		if (puff === 1) {
			fbox([0, 22, 0], 0, 0, -2.5, -5, -2.5, 5, 5, 5, 12, 22);
			return;
		}
		fbox([0, 22, 0], 0, 0, -4, -8, -4, 8, 8, 8, 0, 0);
		fbox([0, 14, -4], 0.7854, 0, -4, -1, 0, 8, 1, 1, 15, 17);
		fbox([0, 14, 0], 0, 0, -4, -1, 0, 8, 1, 1, 14, 16);
		fbox([0, 14, 4], -0.7854, 0, -4, -1, 0, 8, 1, 1, 23, 18);
		fbox([-4, 22, -4], 0, 0, 0, -8, 0, 1, 8, 0.05, 5, 17, -0.7854);
		fbox([4, 22, -4], 0, 0, 0, -8, 0, 1, 8, 0.05, 1, 17, 0.7854);
		return;
	}
	if (family === "squid") {
		const glow = type === "glow_squid" ? 1.55 : 1;
		const sbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, inflate) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 64, 32, glow, 0, inflate || 0, null, false);
		};
		sbox([0, 8, 0], 0, 0, -6, -8, -6, 12, 16, 12, 0, 0, 0.02);
		for (let i = 0; i < 8; i++) {
			const a = i * Math.PI / 4;
			const yaw = -a + Math.PI / 2;
			const pit = 0.35 + 0.2 * Math.sin(animClock * 2.6 + i);
			sbox([Math.cos(a) * 5, 15, Math.sin(a) * 5], pit, yaw, -1, 0, -1, 2, 18, 2, 48, 0);
		}
		return;
	}
	if (family === "dolphin") {
		const wag = Math.sin(animClock * 6) * 0.25;
		const dbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 64, 64, 1, rz || 0);
		};
		dbox([0, 20, -3], headPitch * 0.4, headYaw * 0.4, -4, -3.5, -6.5, 8, 7, 13, 22, 0);
		dbox([0, 20, -9.5], headPitch * 0.4, headYaw * 0.4, -4, -3, -3, 8, 7, 6, 0, 0);
		dbox([0, 21, -12.5], headPitch * 0.4, headYaw * 0.4, -1, 0, -4, 2, 2, 4, 0, 13);
		dbox([0, 20, 6.5], 0, wag, -2, -2.5, 0, 4, 5, 11, 0, 19);
		dbox([0, 20, 16], 0, wag, -5, -0.5, 0, 10, 1, 6, 19, 20);
		dbox([0, 16.5, -1], -1.047, 0, -0.5, 0, 0, 1, 4, 5, 51, 0);
		dbox([-4, 21, -1], 0, 0, 0, -0.5, -4, 1, 4, 7, 48, 20, 1.047);
		dbox([4, 21, -1], 0, 0, -1, -0.5, -4, 1, 4, 7, 48, 20, -1.047);
		return;
	}
	if (family === "axolotl") {
		const headXf = [0, 20, -4, headPitch * 0.6, headYaw, 0];
		const kick = Math.cos(limb * 0.6662) * 0.6 * amt;
		const abox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz, inflate, parentXf) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 64, 64, 1, rz || 0, inflate || 0, null, null, null, parentXf);
		};
		abox([0, 20, 5], 0, 0, -4, -2, -9, 8, 4, 10, 0, 11);
		abox([0, 20, 5], 0, 0, 0, -3, -8, 0.05, 5, 9, 2, 17);
		abox([0, 20, -4], headPitch * 0.6, headYaw, -4, -3, -5, 8, 5, 5, 0, 1, 0, 0.001);
		abox([0, 17, -5], 0, 0, -4, -3, 0, 8, 3, 0.05, 3, 37, 0, 0.001, headXf);
		abox([-4, 20, -5], 0, 0, -3, -5, 0, 3, 7, 0.05, 0, 40, 0, 0.001, headXf);
		abox([4, 20, -5], 0, 0, 0, -5, 0, 3, 7, 0.05, 11, 40, 0, 0.001, headXf);
		abox([-3.5, 21, -3], kick, 0, -2, 0, 0, 3, 5, 0.05, 2, 13, 0, 0.001);
		abox([3.5, 21, -3], -kick, 0, -1, 0, 0, 3, 5, 0.05, 2, 13, 0, 0.001);
		abox([-3.5, 21, 4], -kick, 0, -2, 0, 0, 3, 5, 0.05, 2, 13, 0, 0.001);
		abox([3.5, 21, 4], kick, 0, -1, 0, 0, 3, 5, 0.05, 2, 13, 0, 0.001);
		abox([0, 20, 6], 0, Math.sin(animClock * 3) * 0.2, 0, -3, 0, 0.05, 5, 12, 2, 19);
		return;
	}
	if (family === "frog") {
		const hop = Math.abs(Math.sin(limb * 0.6662)) * amt;
		const fbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz, parentXf) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 48, 48, 1, rz || 0, 0, null, null, null, parentXf);
		};
		const headXf = [0, 20, 3, headPitch, headYaw, 0];
		fbox([0, 22, 4], 0, 0, -3.5, -2, -8, 7, 3, 9, 3, 1);
		fbox([0, 22, 4], 0, 0, -3.5, -1, -8, 7, 0.05, 9, 23, 22);
		fbox([0, 20, 3], headPitch, headYaw, -3.5, -1, -7, 7, 0.05, 9, 23, 13);
		fbox([0, 20, 3], headPitch, headYaw, -3.5, -2, -7, 7, 3, 9, 0, 13);
		fbox([-2, 17, -1.5], 0, 0, -1.5, -1, -1.5, 3, 2, 3, 0, 0, 0, headXf);
		fbox([2, 17, -1.5], 0, 0, -1.5, -1, -1.5, 3, 2, 3, 0, 5, 0, headXf);
		const rArm = [-4, 21, -2.5, hop * 0.4, 0, 0];
		const lArm = [4, 21, -2.5, hop * 0.4, 0, 0];
		const rLeg = [-3.5, 21, 4, -hop, 0, 0];
		const lLeg = [3.5, 21, 4, -hop, 0, 0];
		fbox([-4, 21, -2.5], hop * 0.4, 0, -1, 0, -1, 2, 3, 3, 0, 38);
		fbox([4, 21, -2.5], hop * 0.4, 0, -1, 0, -1, 2, 3, 3, 0, 32);
		fbox([-4, 24, -2.5], 0, 0, -4, 0.01, -5, 8, 0.05, 8, 2, 40, 0, rArm);
		fbox([4, 24, -3.5], 0, 0, -4, 0.01, -4, 8, 0.05, 8, 18, 40, 0, lArm);
		fbox([-3.5, 21, 4], -hop, 0, -2, 0, -2, 3, 3, 4, 0, 25);
		fbox([3.5, 21, 4], -hop, 0, -1, 0, -2, 3, 3, 4, 14, 25);
		fbox([-5.5, 24, 4], 0, 0, -4, 0.01, -4, 8, 0.05, 8, 18, 32, 0, rLeg);
		fbox([5.5, 24, 4], 0, 0, -4, 0.01, -4, 8, 0.05, 8, 2, 32, 0, lLeg);
		return;
	}
	if (family === "tadpole") {
		const wag = -Math.sin(animClock * 0.3 * 20) * 0.25;
		const tbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 16, 16);
		};
		tbox([0, 22, -3], 0, 0, -1.5, -1, 0, 3, 2, 3, 0, 0);
		tbox([0, 22, 0], 0, wag, 0, -1, 0, 0.05, 2, 7, 0, 0);
		return;
	}
	if (family === "tropical_fish") {
		const hex = parseInt(String((layer === "fishpat" ? m.patCol : m.baseCol) || "FFFFFF").replace("#", ""), 16);
		const tint = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
		const wag = -Math.sin(animClock * 0.6 * 20) * 0.45;
		const fbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 32, 32, 1, rz || 0, 0, tint);
		};
		if (m.fishSize === "large") {
			fbox([0, 19, 0], 0, 0, -1, -3, -3, 2, 6, 6, 0, 20);
			fbox([0, 19, 3], 0, wag, 0, -3, 0, 0.05, 6, 5, 21, 16);
			fbox([-1, 20, 0], 0, 0.7854, -2, 0, 0, 2, 2, 0.05, 2, 16);
			fbox([1, 20, 0], 0, -0.7854, 0, 0, 0, 2, 2, 0.05, 2, 12);
			fbox([0, 16, -3], 0, 0, 0, -4, 0, 0.05, 4, 6, 20, 11);
			fbox([0, 22, -3], 0, 0, 0, 0, 0, 0.05, 4, 6, 20, 21);
			return;
		}
		fbox([0, 22, 0], 0, 0, -1, -1.5, -3, 2, 3, 6, 0, 0);
		fbox([0, 22, 3], 0, wag, 0, -1.5, 0, 0.05, 3, 6, 22, 26);
		fbox([-1, 22.5, 0], 0, 0.7854, -2, -1, 0, 2, 2, 0.05, 2, 16);
		fbox([1, 22.5, 0], 0, -0.7854, 0, -1, 0, 2, 2, 0.05, 2, 12);
		fbox([0, 20.5, -3], 0, 0, 0, -3, 0, 0.05, 3, 6, 10, 27);
		return;
	}
	if (family === "turtle") {
		const kick = Math.cos(limb * 0.6662) * amt;
		const tbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz, swap) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 128, 64, 1, rz || 0, 0, null, swap);
		};
		tbox([0, 19, -10], headPitch, headYaw, -3, -1, -3, 6, 5, 6, 3, 0);
		tbox([0, 11, -10], -Math.PI / 2, 0, -9.5, 3, -10, 19, 20, 6, 7, 37, 0, true);
		tbox([0, 11, -10], -Math.PI / 2, 0, -5.5, 3, -13, 11, 18, 3, 31, 1, 0, true);
		if (m.egg) {
			tbox([0, 11, -10], -Math.PI / 2, 0, -4.5, 3, -14, 9, 18, 1, 70, 33, 0, true);
		}
		tbox([-3.5, 22, 11], -kick, 0, -2, 0, 0, 4, 1, 10, 1, 23);
		tbox([3.5, 22, 11], kick, 0, -2, 0, 0, 4, 1, 10, 1, 12);
		tbox([-5, 21, -4], kick * 0.6, 0, -13, 0, -2, 13, 1, 5, 27, 30);
		tbox([5, 21, -4], -kick * 0.6, 0, 0, 0, -2, 13, 1, 5, 27, 24);
		return;
	}
	if (family === "allay") {
		const bodyP = -0.1 + 0.15 * Math.cos(animClock * 2.2);
		const bodyXf = [0, 19.5, 0, bodyP, 0, 0];
		const flap = 0.6 + Math.cos(animClock * 20 * 45.8 * Math.PI / 180) * 16 * Math.PI / 180;
		const armR = -(0.55 + Math.cos(animClock * 12) * 0.08);
		const abox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz, inflate, parentXf) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 32, 32, 1, rz || 0, inflate || 0, null, null, null, parentXf);
		};
		abox([0, 19.51, 0], headPitch, headYaw, -2.5, -5, -2.5, 5, 5, 5, 0, 0);
		abox([0, 19.5, 0], bodyP, 0, -1.5, 0, -1, 3, 4, 2, 0, 10);
		abox([0, 19.5, 0], bodyP, 0, -1.5, 0, -1, 3, 5, 2, 0, 16, 0, -0.2);
		abox([-1.75, 20, 0], armR, 0, -0.75, -0.5, -1, 1, 4, 2, 23, 0, 0, -0.01, bodyXf);
		abox([1.75, 20, 0], -armR, 0, -0.25, -0.5, -1, 1, 4, 2, 23, 6, 0, -0.01, bodyXf);
		abox([-0.5, 19.5, 0.6], -0.4, flap, 0, 1, 0, 0.05, 5, 8, 16, 14, 0.4, 0, bodyXf);
		abox([0.5, 19.5, 0.6], -0.4, -flap, 0, 1, 0, 0.05, 5, 8, 16, 14, -0.4, 0, bodyXf);
		return;
	}
	if (family === "guardian") {
		const hx = [0, 0, 0, -headPitch, headYaw, 0];
		const glow = layer === "eyes" ? 1.8 : 1;
		if (layer === "eyes") {
			box([0, 0, -8.25], 0, 0, -1, 15, 0, 2, 2, 1, 8, 0, glow, 0, 0, null, null, null, hx);
			return;
		}
		box([0, 0, 0], 0, 0, -6, 10, -8, 12, 12, 16, 0, 0, 1, 0, 0, null, null, null, hx);
		box([0, 0, 0], 0, 0, -8, 10, -6, 2, 12, 12, 0, 28, 1, 0, 0, null, null, null, hx);
		box([0, 0, 0], 0, 0, 6, 10, -6, 2, 12, 12, 0, 28, 1, 0, 0, null, null, null, hx);
		box([0, 0, 0], 0, 0, -6, 8, -6, 12, 2, 12, 16, 40, 1, 0, 0, null, null, null, hx);
		box([0, 0, 0], 0, 0, -6, 22, -6, 12, 2, 12, 16, 40, 1, 0, 0, null, null, null, hx);
		box([0, 0, -8.25], 0, 0, -1, 15, 0, 2, 2, 1, 8, 0, 1, 0, 0, null, null, null, hx);
		const px = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8];
		const py = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8];
		const pz = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
		const sp = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0];
		const sy = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0];
		const sr = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25];
		const age = animClock * 20;
		for (let i = 0; i < 12; i++) {
			const ang = 1 + Math.cos(age * 1.5 + i) * 0.01 - 0.55;
			const pit = -Math.PI * sp[i], yw = Math.PI * sy[i], rl = -Math.PI * sr[i];
			box([px[i] * ang, 16 + py[i] * ang, pz[i] * ang], pit, yw, -1, -4.5, -1, 2, 9, 2, 0, 0, 1, rl, 0, null, null, null, hx);
		}
		const tail = animClock * 2.5;
		box([0, 0, 0], 0, 0, -2, 14, 7, 4, 4, 8, 40, 0, 1, 0, 0, null, null, null, hx);
		box([-1.5, 0.5, 14], 0, Math.sin(tail + 0.4) * 0.25, 0, 14, 0, 3, 3, 7, 0, 54, 1, 0, 0, null, null, null, [0, 0, 0, hx[3], hx[4], hx[5]]);
		box([-1, 1, 20], 0, Math.sin(tail + 0.8) * 0.35, 0, 14, 0, 2, 2, 6, 41, 32, 1, 0, 0, null, null, null, [0, 0, 0, hx[3], hx[4], hx[5]]);
		box([-1, 1, 20], 0, Math.sin(tail + 0.8) * 0.35, 1, 10.5, 3, 1, 9, 9, 25, 19, 1, 0, 0, null, null, null, [0, 0, 0, hx[3], hx[4], hx[5]]);
		return;
	}
	if (family === "phantom") {
		const flap = Math.cos(animClock * 7.448451 * Math.PI / 180) * 16 * Math.PI / 180;
		const tailP = -(5 + Math.cos(animClock * 7.448451 * Math.PI / 90) * 5) * Math.PI / 180;
		const bodyXf = [0, 24, 0, 0.1, 0, 0];
		const headXf = [0, 25, -7, 0.2 + headPitch, headYaw, 0];
		const tailXf = [0, 22, 1, tailP, 0, 0];
		const lw = [2, 22, -8, 0, 0, -flap];
		const rw = [-3, 22, -8, 0, 0, flap];
		if (layer === "eyes") {
			box(headXf.slice(0, 3), headXf[3], headXf[4], -4, -2, -5, 7, 3, 5, 0, 0, 1.8, 0, 0, null, null, null, bodyXf);
			return;
		}
		box([0, 24, 0], 0, 0, -3, -2, -8, 5, 3, 9, 0, 8, 1, 0, 0, null, null, null, bodyXf);
		box(tailXf.slice(0, 3), tailP, 0, -2, 0, 0, 3, 2, 6, 3, 20, 1, 0, 0, null, null, null, bodyXf);
		box([0, 22.5, 7], tailP, 0, -1, 0, 0, 1, 1, 6, 4, 29, 1, 0, 0, null, null, null, tailXf);
		box(headXf.slice(0, 3), headXf[3], headXf[4], -4, -2, -5, 7, 3, 5, 0, 0, 1, 0, 0, null, null, null, bodyXf);
		box(lw.slice(0, 3), 0, 0, 0, 0, 0, 6, 2, 9, 23, 12, 1, -flap, 0, null, null, null, bodyXf);
		box([8, 22, -8], 0, 0, 0, 0, 0, 13, 1, 9, 16, 24, 1, -flap, 0, null, null, null, lw);
		box(rw.slice(0, 3), 0, 0, -6, 0, 0, 6, 2, 9, 23, 12, 1, flap, 0, null, null, null, bodyXf);
		box([-9, 22, -8], 0, 0, -13, 0, 0, 13, 1, 9, 16, 24, 1, flap, 0, null, null, null, rw);
		return;
	}
	if (family === "silverfish") {
		const segs = [
			[3, 2, 2, 0, 0], [4, 3, 2, 0, 4], [6, 4, 3, 0, 9], [3, 3, 3, 0, 16],
			[2, 2, 3, 0, 22], [2, 1, 2, 11, 0], [1, 1, 2, 13, 4]
		];
		let z = -3.5;
		const zs = [];
		for (let i = 0; i < 7; i++) {
			zs.push(z);
			const [w, h, d] = segs[i];
			const a = animClock * 20 * 0.9 + i * 0.15 * Math.PI;
			const yaw = Math.cos(a) * Math.PI * 0.05 * (1 + Math.abs(i - 2));
			const ox = Math.sin(a) * Math.PI * 0.2 * Math.abs(i - 2);
			box([ox, 24 - h, z], 0, yaw, -w / 2, 0, -d / 2, w, h, d, segs[i][3], segs[i][4]);
			if (i < 6) z += 0.5 * (d + segs[i + 1][2]);
		}
		const layers = [
			[16, 2, -5, 0, -1.5, 10, 8, 3, 20, 0],
			[20, 4, -3, 0, -1.5, 6, 4, 3, 20, 11],
			[19, 1, -3, 0, -1, 6, 5, 2, 20, 18]
		];
		for (const L of layers) {
			const i = L[1];
			const a = animClock * 20 * 0.9 + i * 0.15 * Math.PI;
			const yaw = Math.cos(a) * Math.PI * 0.05 * (1 + Math.abs(i - 2));
			box([0, L[0], zs[i]], 0, yaw, L[2], L[3], L[4], L[5], L[6], L[7], L[8], L[9]);
		}
		return;
	}
	if (family === "warden") {
		const glow = layer === "eyes" || layer === "heart" ? 1.8 : (layer === "spots" ? 0.85 + 0.35 * Math.sin(animClock * 3) : 1);
		const a = Math.min(0.5, 3 * amt);
		const t = limb * 0.8662;
		const c = Math.cos(t), s = Math.sin(t);
		const h = Math.min(0.35, a);
		const bodyP = -c * h;
		const bodyR = -0.1 * s * a;
		const bodyXf = [0, 3, 0, bodyP, 0, bodyR];
		const hdP = headPitch - 1.2 * Math.cos(t + Math.PI / 2) * h;
		const hdR = -0.3 * s * a;
		if (layer === "tendrils") {
			const tp = Math.cos(animClock * 2.25) * Math.PI * 0.1;
			box([-8, -22, 0], hdP - tp, headYaw, -16, -13, 0, 16, 16, 0.05, 52, 32, glow, hdR, 0.04, null, null, null, bodyXf);
			box([8, -22, 0], hdP + tp, headYaw, 0, -13, 0, 16, 16, 0.05, 58, 0, glow, hdR, 0.04, null, null, null, bodyXf);
			return;
		}
		if (layer === "heart") {
			box([0, 3, 0], 0, 0, -9, -13, -4, 18, 21, 11, 0, 0, glow, 0, 0, null, null, null, bodyXf);
			return;
		}
		box([0, 3, 0], 0, 0, -9, -13, -4, 18, 21, 11, 0, 0, glow, 0, 0, null, null, null, bodyXf);
		box([0, -10, 0], hdP, headYaw, -8, -16, -5, 16, 16, 10, 0, 32, glow, hdR, 0, null, null, null, bodyXf);
		if (layer !== "spots") {
			const tp = Math.cos(animClock * 2.25) * Math.PI * 0.1;
			box([-8, -22, 0], hdP - tp, headYaw, -16, -13, 0, 16, 16, 0.05, 52, 32, glow, hdR, 0.04, null, null, null, bodyXf);
			box([8, -22, 0], hdP + tp, headYaw, 0, -13, 0, 16, 16, 0.05, 58, 0, glow, hdR, 0.04, null, null, null, bodyXf);
		}
		box([-13, -10, 1], -0.8 * c * a, 0, -4, 0, -4, 8, 28, 8, 44, 50, glow, 0, 0, null, null, null, bodyXf);
		box([13, -10, 1], 0.8 * c * a, 0, -4, 0, -4, 8, 28, 8, 0, 58, glow, 0, 0, null, null, null, bodyXf);
		box([-5.9, 11, 0], c * a, 0, -3.1, 0, -3, 6, 13, 6, 76, 48, glow);
		box([5.9, 11, 0], Math.cos(t + Math.PI) * a, 0, -2.9, 0, -3, 6, 13, 6, 76, 76, glow);
		return;
	}
	if (family === "witch") {
		const extra = layer ? 0.12 : 0;
		box([0, 0, 0], headPitch, headYaw, -4, -10, -4, 8, 10, 8, 0, 0, 1, 0, extra);
		const headXf = [0, 0, 0, headPitch, headYaw, 0];
		box([0, -2, 0], 0, 0, -1, -1, 4, 2, 4, 2, 24, 0, 1, 0, extra, null, null, null, headXf);
		box([0, -4, 0], 0, 0, 0, 3, 5.75, 1, 1, 1, 0, 0, 1, 0, extra - 0.25, null, null, null, headXf);
		const hat = [0, 0, 0, headPitch, headYaw, 0];
		box([-5, -10.03, -5], 0, 0, 0, 0, 0, 10, 2, 10, 0, 64, 1, 0, extra, null, null, null, hat);
		box([-3.25, -14.03, -3], -0.0524, 0, 0, 0, 0, 7, 4, 7, 0, 76, 1, 0.0262, extra, null, null, null, hat);
		box([-1.5, -18.03, -1], -0.1047, 0, 0, 0, 0, 4, 4, 4, 0, 87, 1, 0.0524, extra, null, null, null, hat);
		box([0.25, -20.03, -1.25], -0.2094, 0, 0, 0, 1, 1, 2, 0.25, 0, 95, 1, 0.1047, extra, null, null, null, hat);
		box([0, 0, 0], 0, 0, -4, 0, -3, 8, 12, 6, 16, 20, 1, 0, extra);
		box([0, 0, 0], 0, 0, -4, 0, -3, 8, 20, 6, 0, 38, 1, 0, 0.5 + extra);
		box([0, 3, 1], -0.75, 0, -8, -2, -2, 4, 8, 4, 44, 22, 1, 0, extra);
		box([0, 3, 1], -0.75, 0, 4, -2, -2, 4, 8, 4, 44, 22, 1, 0, extra);
		box([0, 3, 1], -0.75, 0, -4, 2, -2, 8, 4, 4, 40, 38, 1, 0, extra);
		box([-2, 12, 0], -swing, 0, -2, 0, -2, 4, 12, 4, 0, 22, 1, 0, extra);
		box([2, 12, 0], swing, 0, -2, 0, -2, 4, 12, 4, 0, 22, 1, 0, extra);
		return;
	}
	if (family === "illager") {
		const extra = layer ? 0.12 : 0;
		const folded = type === "evoker" || type === "illusioner";
		box([0, 0, 0], headPitch, headYaw, -4, -10, -4, 8, 10, 8, 0, 0, 1, 0, extra);
		box([0, 0, 0], headPitch, headYaw, -4, -10, -4, 8, 10, 8, 32, 0, 1, 0, 0.5 + extra);
		box([0, 0, 0], headPitch, headYaw, -1, -3, 4, 2, 4, 2, 24, 0, 1, 0, extra);
		box([0, 0, 0], 0, 0, -4, 0, -3, 8, 12, 6, 16, 20, 1, 0, extra);
		box([0, 0, 0], 0, 0, -4, 0, -3, 8, 18, 6, 0, 38, 1, 0, 0.5 + extra);
		if (folded) {
			box([0, 3, 1], -0.75, 0, -8, -2, -2, 4, 8, 4, 44, 22, 1, 0, extra);
			box([0, 3, 1], -0.75, 0, 4, -2, -2, 4, 8, 4, 44, 22, 1, 0, extra);
			box([0, 3, 1], -0.75, 0, -4, 2, -2, 8, 4, 4, 40, 38, 1, 0, extra);
		} else {
			const hold = type === "pillager" ? -0.8727 : 0;
			const armR = Math.cos(limb * 0.6662 + Math.PI) * 2 * amt * 0.5 + hold;
			const armL = Math.cos(limb * 0.6662) * 2 * amt * 0.5 + hold * 0.85;
			box([-5, 2, 0], armR, 0, -3, -2, -2, 4, 12, 4, 40, 46, 1, 0, extra);
			box([5, 2, 0], armL, 0, -1, -2, -2, 4, 12, 4, 40, 46, 1, 0, extra);
		}
		box([-2, 12, 0], Math.cos(limb * 0.6662) * 1.4 * amt * 0.5, 0, -2, 0, -2, 4, 12, 4, 0, 22, 1, 0, extra);
		box([2, 12, 0], Math.cos(limb * 0.6662 + Math.PI) * 1.4 * amt * 0.5, 0, -2, 0, -2, 4, 12, 4, 0, 22, 1, 0, extra);
		return;
	}
	if (family === "ravager") {
		const neckXf = [0, -7, 5.5, 0, 0, 0];
		const headXf = [0, 9, -11.5, headPitch, headYaw, 0];
		box([0, -7, 5.5], 0, 0, -5, -1, -18, 10, 10, 18, 68, 73);
		box([0, 9, -11.5], headPitch, headYaw, -8, -20, -14, 16, 20, 16, 0, 0, 1, 0, 0, null, null, null, neckXf);
		box([0, 9, -11.5], headPitch, headYaw, -2, -6, -18, 4, 8, 4, 0, 0, 1, 0, 0, null, null, null, neckXf);
		box([-10, -5, -19.5], 1.0996, 0, 0, -14, -2, 2, 14, 4, 74, 55, 1, 0, 0, null, null, null, headXf);
		box([8, -5, -19.5], 1.0996, 0, 0, -14, -2, 2, 14, 4, 74, 55, 1, 0, 0, null, null, null, headXf);
		box([0, 7, -9.5], 0, 0, -8, 0, -16, 16, 3, 16, 0, 36, 1, 0, 0, null, null, null, headXf);
		box([0, 1, 2], Math.PI / 2, 0, -7, -10, -7, 14, 16, 20, 0, 55);
		box([0, 1, 2], Math.PI / 2, 0, -6, 6, -7, 12, 13, 18, 0, 91);
		box([-8, -13, 18], swing * 0.5, 0, -4, 0, -4, 8, 37, 8, 96, 0);
		box([8, -13, 18], -swing * 0.5, 0, -4, 0, -4, 8, 37, 8, 96, 0);
		box([-8, -13, -5], -swing * 0.5, 0, -4, 0, -4, 8, 37, 8, 96, 0);
		box([8, -13, -5], swing * 0.5, 0, -4, 0, -4, 8, 37, 8, 96, 0);
		return;
	}
	if (family === "vex") {
		const bodyP = -0.1571;
		const bodyXf = [0, 17.5, 0, bodyP, 0, 0];
		const flap = 1.0996 + Math.cos(animClock * 20 * 45.836624 * Math.PI / 180) * 16.2 * Math.PI / 180;
		const armR = -(0.6283 + Math.cos(animClock * 20 * 5.5 * Math.PI / 180) * 0.1);
		box([0, 17.5, 0], headPitch, headYaw, -2.5, -5, -2.5, 5, 5, 5, 0, 0);
		box([0, 17.5, 0], bodyP, 0, -1.5, 0, -1, 3, 4, 2, 0, 10);
		box([0, 17.5, 0], bodyP, 0, -1.5, 1, -1, 3, 5, 2, 0, 16, 1, 0, -0.2);
		box([-1.75, 17.75, 0], 0, 0, -1.25, -0.5, -1, 2, 4, 2, 23, 0, 1, armR, -0.1, null, null, null, bodyXf);
		box([1.75, 17.75, 0], 0, 0, -0.75, -0.5, -1, 2, 4, 2, 23, 6, 1, -armR, -0.1, null, null, null, bodyXf);
		box([0.5, 18.5, 1], -0.4712, flap, 0, 0, 0, 0.05, 5, 8, 16, 14, 1, 0.4712, 0, null, null, null, bodyXf);
		box([-0.5, 18.5, 1], -0.4712, -flap, 0, 0, 0, 0.05, 5, 8, 16, 14, 1, -0.4712, 0, null, null, null, bodyXf);
		return;
	}
	if (family === "blaze") {
		const age = animClock * 20;
		box([0, 0, 0], headPitch, headYaw, -4, -4, -4, 8, 8, 8, 0, 0);
		let spin = age * Math.PI * -0.1;
		for (let i = 0; i < 4; i++) {
			const y = -2 + Math.cos((i * 2 + age) * 0.25);
			box([Math.cos(spin) * 9, y, Math.sin(spin) * 9], 0, 0, 0, 0, 0, 2, 8, 2, 0, 16);
			spin += Math.PI / 2;
		}
		spin = 0.7853982 + age * Math.PI * 0.03;
		for (let i = 4; i < 8; i++) {
			const y = 2 + Math.cos((i * 2 + age) * 0.25);
			box([Math.cos(spin) * 7, y, Math.sin(spin) * 7], 0, 0, 0, 0, 0, 2, 8, 2, 0, 16);
			spin += Math.PI / 2;
		}
		spin = 0.47123894 + age * Math.PI * 0.05;
		for (let i = 8; i < 12; i++) {
			const y = 11 + Math.cos((i * 1.5 + age) * 0.5);
			box([Math.cos(spin) * 5, y, Math.sin(spin) * 5], 0, 0, 0, 0, 0, 2, 8, 2, 0, 16);
			spin += Math.PI / 4;
		}
		return;
	}
	if (family === "ghast" || family === "happy_ghast") {
		const uvW = 64, uvH = family === "ghast" ? 32 : 64;
		const gbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, shade, rz, inflate, tint, swapOverride, flipV, parentXf) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, uvW, uvH, shade, rz, inflate, tint, swapOverride, flipV, parentXf);
		};
		const bodyXf = [0, 16, 0, 0, 0, 0];
		gbox([0, 16, 0], 0, 0, -8, -8, -8, 16, 16, 16, 0, 0, 1, 0, 0, null, false);
		const tents = family === "happy_ghast"
			? [[-3.75, -5, 5], [1.25, -5, 7], [6.25, -5, 4], [-6.25, 0, 5], [-1.25, 0, 5], [3.75, 0, 7], [-3.75, 5, 8], [1.25, 5, 8], [6.25, 5, 5]]
			: null;
		for (let i = 0; i < 9; i++) {
			let x, z, h;
			if (tents) {
				x = tents[i][0];
				z = tents[i][1];
				h = tents[i][2];
			} else {
				const col = i % 3, row = Math.floor(i / 3);
				x = (col - (row % 2) * 0.5 + 0.25 - 1) * 5;
				z = (row - 1) * 5;
				h = 8 + (i * 3 + 5) % 7;
			}
			const pit = -(0.2 * Math.sin(animClock * 20 * 0.3 + i) + 0.4);
			gbox([x, 23, z], pit, 0, -1, 0, -1, 2, h, 2, 0, 0, 1, 0, 0, null, false, null, bodyXf);
		}
		return;
	}
	if (family === "hoglin") {
		const bodyXf = [0, 7, 0, 0, 0, 0];
		const headRx = -0.8727 + headPitch;
		const headXf = [0, 2, -12, headRx, headYaw, 0];
		const kick = Math.cos(limb * 0.6662) * 1.2 * amt;
		box([0, 7, 0], 0, 0, -8, -7, -13, 16, 14, 26, 1, 1);
		box([0, -7, -7], 0, 0, 0, 0, -9, 0.05, 10, 19, 90, 33, 1, 0, 0.001, null, null, null, bodyXf);
		box([0, 2, -12], headRx, headYaw, -7, -3, -19, 14, 6, 19, 61, 1);
		box([-6, 0, -15], 0, 0, -6, -1, -2, 6, 1, 4, 1, 1, 1, 0.6981, 0, null, null, null, headXf);
		box([6, 0, -15], 0, 0, 0, -1, -2, 6, 1, 4, 1, 6, 1, -0.6981, 0, null, null, null, headXf);
		box([-7, 4, -24], 0, 0, -1, -11, -1, 2, 11, 2, 10, 13, 1, 0, 0, null, null, null, headXf);
		box([7, 4, -24], 0, 0, -1, -11, -1, 2, 11, 2, 1, 13, 1, 0, 0, null, null, null, headXf);
		box([-4, 10, -8.5], kick, 0, -3, 0, -3, 6, 14, 6, 66, 42);
		box([4, 10, -8.5], -kick, 0, -3, 0, -3, 6, 14, 6, 41, 42);
		box([-5, 13, 10], -kick, 0, -2.5, 0, -2.5, 5, 11, 5, 21, 45);
		box([5, 13, 10], kick, 0, -2.5, 0, -2.5, 5, 11, 5, 0, 45);
		return;
	}
	if (family === "magma_cube") {
		box([0, 0, 0], 0, 0, -2, 18, -2, 4, 4, 4, 24, 40);
		for (let i = 0; i < 8; i++) {
			const u = i > 3 ? 32 : 0;
			const v = i > 3 ? 9 * i - 36 : (i > 0 ? 9 * i : 0);
			box([0, 0, 0], 0, 0, -4, 16 + i, -4, 8, 1, 8, u, v);
		}
		return;
	}
	if (family === "strider") {
		const bodyXf = [0, 1, 0, 0, 0, 0];
		const kick = Math.cos(limb * 0.6662) * 1.4 * amt;
		const sbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, shade, rz, inflate, parentXf) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 64, 128, shade, rz, inflate, null, null, null, parentXf);
		};
		sbox([0, 1, 0], 0, 0, -8, -6, -8, 16, 14, 16, 0, 0);
		sbox([-4, 8, 0], kick, 0, -2, 0, -2, 4, 16, 4, 0, 32);
		sbox([4, 8, 0], -kick, 0, -2, 0, -2, 4, 16, 4, 0, 55);
		sbox([-8, 5, -8], 0, 0, -12, 0, 0, 16, 1, 16, 16, 65, 1, 1.2217, -0.01, bodyXf);
		sbox([-8, 0, -8], 0, 0, -12, 0, 0, 16, 1, 16, 16, 49, 1, 1.1345, -0.01, bodyXf);
		sbox([-8, -4, -8], 0, 0, -12, 0, 0, 16, 1, 16, 16, 33, 1, 0.8727, -0.01, bodyXf);
		sbox([8, -5, -8], 0, 0, -4, 0, 0, 16, 1, 16, 16, 33, 1, -0.8727, -0.01, bodyXf);
		sbox([8, -1, -8], 0, 0, -4, 0, 0, 16, 1, 16, 16, 49, 1, -1.1345, -0.01, bodyXf);
		sbox([8, 4, -8], 0, 0, -4, 0, 0, 16, 1, 16, 16, 65, 1, -1.2217, -0.01, bodyXf);
		return;
	}
	if (family === "enderman") {
		const ebox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, shade) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 64, 32, shade);
		};
		if (layer === "eyes") {
			ebox([0, -13, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 0, 1.8);
			return;
		}
		ebox([0, -14, 0], 0, 0, -4, 0, -2, 8, 12, 4, 32, 16);
		ebox([0, -13, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 0);
		ebox([0, -13, 0], headPitch, headYaw, -4, -8, -4, 8, 8, 8, 0, 16, 1);
		ebox([-5, -12, 0], swing - 0.1, 0, -1, -2, -1, 2, 30, 2, 56, 0);
		ebox([5, -12, 0], -swing - 0.1, 0, -1, -2, -1, 2, 30, 2, 56, 0);
		ebox([-2, -5, 0], -swing, 0, -1, 0, -1, 2, 30, 2, 56, 0);
		ebox([2, -5, 0], swing, 0, -1, 0, -1, 2, 30, 2, 56, 0);
		return;
	}
	if (family === "endermite") {
		const segs = [
			[4, 3, 2, 0, 0], [6, 4, 5, 0, 5], [3, 3, 1, 0, 14], [1, 2, 1, 0, 18]
		];
		let z = -3.5;
		for (let i = 0; i < 4; i++) {
			const [w, h, d, u, v] = segs[i];
			const a = animClock * 20 * 0.9 + i * 0.15 * Math.PI;
			const yaw = Math.cos(a) * Math.PI * 0.05 * (1 + Math.abs(i - 1.5));
			modelBox(list, m, unit, [Math.sin(a) * 0.15, 24 - h, z], 0, yaw, -w / 2, 0, -d / 2, w, h, d, u, v, 64, 32);
			if (i < 3) z += 0.5 * (d + segs[i + 1][2]);
		}
		return;
	}
	if (family === "shulker") {
		const peek = Math.max(0, Math.min(1, m.peek || 0));
		const lidY = 24 - peek * 8;
		const headY = 12 + peek * 6;
		const sbox = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v) => {
			modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, 64, 64, 1, 0, 0, null, false);
		};
		sbox([0, 24, 0], 0, 0, -8, -8, -8, 16, 8, 16, 0, 28);
		sbox([0, lidY, 0], 0, 0, -8, -16, -8, 16, 12, 16, 0, 0);
		sbox([0, headY, 0], headPitch, headYaw, -3, -3, -3, 6, 6, 6, 0, 52);
		return;
	}
	if (family === "armadillo") {
		const walk = Math.min(1, amt * 1.6);
		const sway = Math.sin(limb * 0.6662) * 0.4 * walk;
		const side = Math.sin(limb * 0.6662) * 1.8 * walk;
		const kick = Math.cos(limb * 0.6662) * 0.85 * walk;
		const headBob = Math.sin(limb * 0.6662) * 0.25 * walk;
		const tailWag = Math.sin(limb * 0.6662) * 0.35 * walk;
		box([side, 21, 4], 0, 0, -4, -7, -10, 8, 8, 12, 0, 20, 1, sway);
		box([side, 18, 5], -0.5061 + tailWag, 0, -0.5, 0, 0, 1, 6, 1, 44, 53, 1, sway);
		box([side, 19, -7], headPitch + 0.3927 + headBob, headYaw, -1.5, -1, -1, 3, 5, 2, 43, 15, 1, sway);
		box([side, 19, -7], headPitch + 0.3927 + headBob, headYaw, -2, -3, 0, 2, 5, 1, 43, 10, 1, sway);
		box([side, 19, -7], headPitch + 0.3927 + headBob, headYaw, 0, -3, 0, 2, 5, 1, 47, 10, 1, sway);
		box([-2 + side, 21, 4], kick, 0, -1, 0, -1, 2, 3, 2, 51, 31, 1, sway);
		box([2 + side, 21, 4], -kick, 0, -1, 0, -1, 2, 3, 2, 42, 31, 1, sway);
		box([-2 + side, 21, -4], -kick, 0, -1, 0, -1, 2, 3, 2, 51, 43, 1, sway);
		box([2 + side, 21, -4], kick, 0, -1, 0, -1, 2, 3, 2, 42, 43, 1, sway);
		return;
	}
	const pig = type === "pig";
	const sheep = type === "sheep";
	if (pig) {
		box([0, 12, -6], headPitch, headYaw, -4, -4, -8, 8, 8, 8, 0, 0);
		box([0, 12, -6], headPitch, headYaw, -2, 0, -9, 4, 3, 1, 16, 16);
		box([0, 11, 2], -Math.PI / 2, 0, -5, -10, -7, 10, 16, 8, 28, 8);
		box([-3, 18, 7], swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		box([3, 18, 7], -swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		box([-3, 18, -5], -swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		box([3, 18, -5], swing, 0, -2, 0, -2, 4, 6, 4, 0, 16);
		return;
	}
	if (sheep) {
		if (layer === "wool") {
			const hex = parseInt(String(m.wool || "E6E6E6").replace("#", ""), 16);
			const tint = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
			box([0, 6, -8], headPitch, headYaw, -3, -4, -4, 6, 6, 6, 0, 0, 1, 0, 0.6, tint);
			box([0, 5, 2], -Math.PI / 2, 0, -4, -10, -7, 8, 16, 6, 28, 8, 1, 0, 1.75, tint);
			box([-3, 12, 7], swing, 0, -2, 0, -2, 4, 6, 4, 0, 16, 1, 0, 0.5, tint);
			box([3, 12, 7], -swing, 0, -2, 0, -2, 4, 6, 4, 0, 16, 1, 0, 0.5, tint);
			box([-3, 12, -5], -swing, 0, -2, 0, -2, 4, 6, 4, 0, 16, 1, 0, 0.5, tint);
			box([3, 12, -5], swing, 0, -2, 0, -2, 4, 6, 4, 0, 16, 1, 0, 0.5, tint);
			return;
		}
		box([0, 6, -8], headPitch, headYaw, -3, -4, -6, 6, 6, 8, 0, 0);
		box([0, 5, 2], -Math.PI / 2, 0, -4, -10, -7, 8, 16, 6, 28, 8);
		box([-3, 12, 7], swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
		box([3, 12, 7], -swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
		box([-3, 12, -5], -swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
		box([3, 12, -5], swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
		return;
	}
	box([0, 4, -8], headPitch, headYaw, -4, -4, -6, 8, 8, 6, 0, 0);
	if (type === "cow" || type === "mooshroom") {
		box([0, 4, -8], headPitch, headYaw, -3, 1, -7, 6, 3, 1, 1, 33);
		box([0, 4, -8], headPitch, headYaw, -5, -5, -5, 1, 3, 1, 22, 0);
		box([0, 4, -8], headPitch, headYaw, 4, -5, -5, 1, 3, 1, 22, 0);
	}
	box([0, 5, 2], -Math.PI / 2, 0, -6, -10, -7, 12, 18, 10, 18, 4);
	box([-4, 12, 7], swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
	box([4, 12, 7], -swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
	box([-4, 12, -6], -swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
	box([4, 12, -6], swing, 0, -2, 0, -2, 4, 12, 4, 0, 16);
}

function standEuler(m, key, def) {
	const a = m[key];
	const d = Math.PI / 180;
	if (!a || a.length < 3) return [def[0] * d, def[1] * d, def[2] * d];
	return [(+a[0] || 0) * d, (+a[1] || 0) * d, (+a[2] || 0) * d];
}

function armorStandMesh(box, m, layer) {
	if (m.invis || layer) return;
	const [hrx, hry, hrz] = standEuler(m, "hp", [0, 0, 0]);
	const [brx, bry, brz] = standEuler(m, "bp", [0, 0, 0]);
	const [lax, lay, laz] = standEuler(m, "la", [-10, 0, -10]);
	const [rax, ray, raz] = standEuler(m, "ra", [-15, 0, 10]);
	const [llx, lly, llz] = standEuler(m, "ll", [-1, 0, -1]);
	const [rlx, rly, rlz] = standEuler(m, "rl", [1, 0, 1]);
	box([0, 1, 0], hrx, hry, -1, -7, -1, 2, 7, 2, 0, 0, 1, hrz);
	box([0, 0, 0], brx, bry, -6, 0, -1.5, 12, 3, 3, 0, 26, 1, brz);
	box([0, 0, 0], brx, bry, -3, 3, -1, 2, 7, 2, 16, 0, 1, brz);
	box([0, 0, 0], brx, bry, 1, 3, -1, 2, 7, 2, 48, 16, 1, brz);
	box([0, 0, 0], brx, bry, -4, 10, -1, 8, 2, 2, 0, 48, 1, brz);
	if (m.arms) {
		box([5, 2, 0], rax, ray, 0, -2, -1, 2, 12, 2, 24, 0, 1, raz);
		box([-5, 2, 0], lax, lay, -2, -2, -1, 2, 12, 2, 32, 16, 1, laz);
	}
	box([1.9, 12, 0], rlx, rly, -1, 0, -1, 2, 11, 2, 8, 0, 1, rlz);
	box([-1.9, 12, 0], llx, lly, -1, 0, -1, 2, 11, 2, 40, 16, 1, llz);
	if (m.base !== false) {
		box([0, 12, 0], 0, 0, -6, 11, -6, 12, 1, 12, 0, 32);
	}
}

function armorStandSlot(list, m, slot, rec) {
	const unit = P * (m.baby ? 0.5 : 1);
	const tw = rec.w || 64;
	const th = rec.h || 64;
	const [hrx, hry, hrz] = standEuler(m, "hp", [0, 0, 0]);
	const [brx, bry, brz] = standEuler(m, "bp", [0, 0, 0]);
	const [lax, lay, laz] = standEuler(m, "la", [-10, 0, -10]);
	const [rax, ray, raz] = standEuler(m, "ra", [-15, 0, 10]);
	const [llx, lly, llz] = standEuler(m, "ll", [-1, 0, -1]);
	const [rlx, rly, rlz] = standEuler(m, "rl", [1, 0, 1]);
	const dil = slot === "legs" ? 0.5 : 1;
	const leftArmU = th >= 64 ? 32 : 40;
	const leftArmV = th >= 64 ? 48 : 16;
	const leftLegU = th >= 64 ? 16 : 0;
	const leftLegV = th >= 64 ? 48 : 16;
	const box = (pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, rz) => {
		modelBox(list, m, unit, pivot, rx, ry, ox, oy, oz, sx, sy, sz, u, v, tw, th, 1, rz, dil);
	};
	if (slot === "head") {
		box([0, 0, 0], hrx, hry, -4, -8, -4, 8, 8, 8, 0, 0, hrz);
	} else if (slot === "chest") {
		box([0, 0, 0], brx, bry, -4, 0, -2, 8, 12, 4, 16, 16, brz);
		box([5, 2, 0], rax, ray, -1, -2, -2, 4, 12, 4, 40, 16, raz);
		box([-5, 2, 0], lax, lay, -3, -2, -2, 4, 12, 4, leftArmU, leftArmV, laz);
	} else if (slot === "legs") {
		box([0, 0, 0], brx, bry, -4, 0, -2, 8, 12, 4, 16, 16, brz);
		box([1.9, 12, 0], rlx, rly, -2, 0, -2, 4, 12, 4, 0, 16, rlz);
		box([-1.9, 12, 0], llx, lly, -2, 0, -2, 4, 12, 4, leftLegU, leftLegV, llz);
	} else if (slot === "feet") {
		box([1.9, 12, 0], rlx, rly, -2, 0, -2, 4, 12, 4, 0, 16, rlz);
		box([-1.9, 12, 0], llx, lly, -2, 0, -2, 4, 12, 4, leftLegU, leftLegV, llz);
	}
}

function drawEquippedArmor(entity, slotFn, drawFn) {
	const armor = entity.armor || {};
	const pieces = [
		["legs", "humanoid_leggings", armor.legs],
		["head", "humanoid", armor.head],
		["chest", "humanoid", armor.chest],
		["feet", "humanoid", armor.feet]
	];
	for (const [slot, layer, mat] of pieces) {
		if (!mat) continue;
		const arec = ensureArmor(layer, mat);
		if (!arec || !arec.ready) continue;
		const ad = [];
		slotFn(ad, entity, slot, arec);
		if (ad.length) {
			gl.enable(gl.POLYGON_OFFSET_FILL);
			gl.polygonOffset(-1.5, -1.5);
			drawFn(new Float32Array(ad), ad.length / 9, 1, 1, arec.tex);
			gl.disable(gl.POLYGON_OFFSET_FILL);
		}
	}
}

function armorSlot(list, p, slot, rec) {
	const s = playerPose(p);
	const aw = s.aw;
	const hip = [0, 12 * P, 0];
	const lean = s.bodyPitch;
	const tw = rec.w || 64;
	const th = rec.h || 64;
	const leftArmU = th >= 64 ? 32 : 40;
	const leftArmV = th >= 64 ? 48 : 16;
	const leftLegU = th >= 64 ? 16 : 0;
	const leftLegV = th >= 64 ? 48 : 16;
	if (slot === "head") {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [0, 24 * P, 0], s.headPitch, s.headYaw, -4 * P, 24 * P, -4 * P, 4 * P, 32 * P, 4 * P, 0, 0, 8, 8, 8, P, 1, tw, th, hip, lean);
	} else if (slot === "chest") {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, hip, lean, 0, -4 * P, 12 * P, -2 * P, 4 * P, 24 * P, 2 * P, 16, 16, 8, 12, 4, P, 1, tw, th);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [5 * P, 22 * P, 0], s.armSwing + s.armExtra + s.rightAtk.rx, s.rightAtk.ry, 4 * P, 12 * P, -2 * P, 4 * P + aw, 24 * P, 2 * P, 40, 16, s.slim ? 3 : 4, 12, 4, P, 1, tw, th, hip, lean);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-5 * P, 22 * P, 0], -s.armSwing + s.armExtra + s.leftAtk.rx, s.leftAtk.ry, -4 * P - aw, 12 * P, -2 * P, -4 * P, 24 * P, 2 * P, leftArmU, leftArmV, s.slim ? 3 : 4, 12, 4, P, 1, tw, th, hip, lean);
	} else if (slot === "legs") {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, hip, lean, 0, -4 * P, 12 * P, -2 * P, 4 * P, 24 * P, 2 * P, 16, 16, 8, 12, 4, 0.5 * P, 1, tw, th);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [2 * P, 12 * P, 0], -s.legSwing, 0, 0, 0, -2 * P, 4 * P, 12 * P, 2 * P, 0, 16, 4, 12, 4, 0.5 * P, 1, tw, th);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-2 * P, 12 * P, 0], s.legSwing, 0, -4 * P, 0, -2 * P, 0, 12 * P, 2 * P, leftLegU, leftLegV, 4, 12, 4, 0.5 * P, 1, tw, th);
	} else if (slot === "feet") {
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [2 * P, 12 * P, 0], -s.legSwing, 0, 0, 0, -2 * P, 4 * P, 12 * P, 2 * P, 0, 16, 4, 12, 4, P, 1, tw, th);
		pushBox(list, s.px, s.py, s.pz, s.bodyYaw, [-2 * P, 12 * P, 0], s.legSwing, 0, -4 * P, 0, -2 * P, 0, 12 * P, 2 * P, leftLegU, leftLegV, 4, 12, 4, P, 1, tw, th);
	}
}

function transformPoint(px, py, pz, bodyYaw, pivot, rx, ry, x, y, z, parentRx) {
	const ox = pivot[0], oy = pivot[1], oz = pivot[2];
	let q = [x - ox, y - oy, z - oz];
	q = rotX(q[0], q[1], q[2], rx);
	q = rotY(q[0], q[1], q[2], ry);
	q = [q[0] + ox, q[1] + oy, q[2] + oz];
	if (parentRx) {
		const hipY = 12 * P;
		q = rotX(q[0], q[1] - hipY, q[2], parentRx);
		q = [q[0], q[1] + hipY, q[2]];
	}
	return toWorld(q[0], q[1], q[2], bodyYaw, px, py, pz);
}

function heldToWorld(p, left, ix, iy, iz, asBlock) {
	const s = playerPose(p);
	const sign = left ? -1 : 1;
	const aw = s.aw;
	const pivot = left ? [-5 * P, 22 * P, 0] : [5 * P, 22 * P, 0];
	const armRx = left ? -s.armSwing + s.armExtra + s.leftAtk.rx : s.armSwing + s.armExtra + s.rightAtk.rx;
	const armRy = left ? s.leftAtk.ry : s.rightAtk.ry;
	const handX = left ? -4 * P - aw * 0.5 : 4 * P + aw * 0.5;
	const handY = 12 * P;
	const handZ = 0;
	let lx, ly, lz;
	if (asBlock) {
		const sc = 0.35;
		lx = (ix - 0.5) * sc;
		ly = (iy - 0.5) * sc;
		lz = (iz - 0.5) * sc + 0.06;
	} else {
		const sc = 0.7;
		let x = ix * sc;
		let y = iy * sc;
		let z = (iz - 0.5) * sc;
		const a = -Math.PI / 4;
		const xr = x * Math.cos(a) - y * Math.sin(a);
		const yr = x * Math.sin(a) + y * Math.cos(a);
		lx = z * sign;
		ly = -yr;
		lz = xr + 0.04;
	}
	return transformPoint(s.px, s.py, s.pz, s.bodyYaw, pivot, armRx, armRy, handX + lx, handY + ly, handZ + lz, s.bodyPitch);
}

function appendHeld(cubes, sprites, p, hand, left) {
	if (!hand || !hand.item) return;
	const asBlock = !!(hand.cube && Number.isInteger(hand.tile) && hand.tile >= 0 && mesh);
	const order = [0, 1, 2, 0, 2, 3];
	const light = sceneLight();
	if (asBlock) {
		const corners = [
			[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
			[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
		].map(pt => heldToWorld(p, left, pt[0], pt[1], pt[2], true));
		const faces = [
			[4, 5, 6, 7, 0.9],
			[1, 0, 3, 2, 0.7],
			[0, 4, 7, 3, 0.6],
			[5, 1, 2, 6, 0.8],
			[7, 6, 2, 3, 1.0],
			[0, 1, 5, 4, 0.5]
		];
		const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
		for (const f of faces) {
			const sh = f[4] * light;
			for (const i of order) {
				const pt = corners[f[i]];
				const uv = uvs[i];
				cubes.push(pt[0], pt[1], pt[2], uv[0], uv[1], sh, sh, sh, hand.tile);
			}
		}
		return;
	}
	const rec = ensureItem(hand.item);
	if (!rec.ready || !rec.mesh) return;
	if (!sprites.has(hand.item)) sprites.set(hand.item, { rec, data: [] });
	const data = sprites.get(hand.item).data;
	for (const quad of rec.mesh) {
		const pts = quad.p.map(pt => heldToWorld(p, left, pt[0] / 16, pt[1] / 16, pt[2] / 16, false));
		for (const i of order) {
			const uv = quad.uv[i];
			data.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], light, light, light, 0);
		}
	}
}

function villagerHeldToWorld(m, ix, iy, iz, asBlock) {
	const facing = mobFacingYaw(m);
	const unit = P * (m.baby ? 0.5 : 1);
	const pivot = [0, (24 - 3) * unit, 1 * unit];
	const sc = asBlock ? 0.32 : 0.38;
	const x = (ix - 0.5) * sc;
	const y = (iy - 0.5) * sc;
	const z = (iz - 0.5) * sc;
	return transformPoint(m.x, m.y + 0.02, m.z, facing, pivot, -0.75, 0, pivot[0] + x, pivot[1] + y - 4 * unit, pivot[2] + z);
}

function skeletonHeldDisplay(hand, asBlock) {
	if (asBlock) return { rot: [75, 45, 0], trans: [0, 2.5, 0], sc: 0.375 };
	const id = (hand && hand.item) || "";
	if (id === "bow" || id === "crossbow") return { rot: [-80, 260, -40], trans: [-1, -2, 2.5], sc: 0.9 };
	if (/(?:^|_)(?:sword|axe|pickaxe|shovel|hoe|trident|mace)$/.test(id)) {
		return { rot: [0, -90, 55], trans: [0, 4, 0.5], sc: 0.85 };
	}
	return { rot: [0, 0, 0], trans: [0, 3, 1], sc: 0.55 };
}

function skeletonHeldToWorld(m, ix, iy, iz, asBlock, hand) {
	const unit = P * (m.baby ? 0.5 : 1);
	const amt = m.amt || 0;
	const limb = m.limb || 0;
	const hold = m.type === "pillager" ? -0.8727 : 0;
	const swing = m.type === "pillager"
		? Math.cos(limb * 0.6662 + Math.PI) * 2 * amt * 0.5 + hold
		: Math.cos(limb * 0.6662) * 1.4 * amt;
	const facing = mobFacingYaw(m);
	const pivot = [5 * unit, 22 * unit, 0];
	const display = skeletonHeldDisplay(hand, asBlock);
	const d = Math.PI / 180;
	let x = (ix - 0.5) * display.sc;
	let y = (iy - 0.5) * display.sc;
	let z = (iz - 0.5) * display.sc;
	let q = rotZ(x, y, z, display.rot[2] * d);
	q = rotY(q[0], q[1], q[2], display.rot[1] * d);
	q = rotX(q[0], q[1], q[2], display.rot[0] * d);
	x = q[0] + display.trans[0] / 16;
	y = q[1] + display.trans[1] / 16;
	z = q[2] + display.trans[2] / 16;
	x += 1 / 16;
	y += 0.125;
	z -= 0.625;
	q = rotY(x, y, z, Math.PI);
	q = rotX(q[0], q[1], q[2], -Math.PI / 2);
	const s = unit / P;
	return transformPoint(m.x, m.y + 0.02, m.z, facing, pivot, swing, 0, pivot[0] - q[0] * s, pivot[1] - q[1] * s, pivot[2] - q[2] * s);
}

function vexHeldToWorld(m, ix, iy, iz, asBlock, hand) {
	const unit = P * (m.baby ? 0.5 : 1);
	const facing = mobFacingYaw(m);
	const armR = -(0.6283 + Math.cos(animClock * 20 * 5.5 * Math.PI / 180) * 0.1);
	const pivot = [-1.75 * unit, (24 - 21) * unit, 0];
	const display = skeletonHeldDisplay(hand, asBlock);
	const d = Math.PI / 180;
	const sc = display.sc * 0.32;
	let x = (ix - 0.5) * sc;
	let y = (iy - 0.5) * sc;
	let z = (iz - 0.5) * sc;
	let q = rotZ(x, y, z, display.rot[2] * d);
	q = rotY(q[0], q[1], q[2], display.rot[1] * d);
	q = rotX(q[0], q[1], q[2], display.rot[0] * d);
	x = q[0] + display.trans[0] / 16 * 0.32;
	y = q[1] + display.trans[1] / 16 * 0.32;
	z = q[2] + display.trans[2] / 16 * 0.32;
	q = rotY(x, y, z, Math.PI);
	q = rotX(q[0], q[1], q[2], -Math.PI / 2);
	q = rotZ(q[0], q[1], q[2], armR);
	return transformPoint(m.x, m.y + 0.02, m.z, facing, pivot, -0.1571, 0, pivot[0] - q[0], pivot[1] - q[1], pivot[2] - q[2]);
}

function appendVexHeld(cubes, sprites, m, hand) {
	if (!hand || !hand.item) return;
	const asBlock = !!(hand.cube && Number.isInteger(hand.tile) && hand.tile >= 0 && mesh);
	const order = [0, 1, 2, 0, 2, 3];
	const light = sceneLight();
	if (asBlock) {
		const corners = [
			[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
			[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
		].map(pt => vexHeldToWorld(m, pt[0], pt[1], pt[2], true, hand));
		const faces = [
			[4, 5, 6, 7, 0.9],
			[1, 0, 3, 2, 0.7],
			[0, 4, 7, 3, 0.6],
			[5, 1, 2, 6, 0.8],
			[7, 6, 2, 3, 1.0],
			[0, 1, 5, 4, 0.5]
		];
		const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
		for (const f of faces) {
			const sh = f[4] * light;
			for (const i of order) {
				const pt = corners[f[i]];
				const uv = uvs[i];
				cubes.push(pt[0], pt[1], pt[2], uv[0], uv[1], sh, sh, sh, hand.tile);
			}
		}
		return;
	}
	const rec = ensureItem(hand.item);
	if (!rec.ready || !rec.mesh) return;
	if (!sprites.has(hand.item)) sprites.set(hand.item, { rec, data: [] });
	const data = sprites.get(hand.item).data;
	for (const quad of rec.mesh) {
		const pts = quad.p.map(pt => vexHeldToWorld(m, pt[0] / 16, pt[1] / 16, pt[2] / 16, false, hand));
		for (const i of order) {
			const uv = quad.uv[i];
			data.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], light, light, light, 0);
		}
	}
}

function appendSkeletonHeld(cubes, sprites, m, hand) {
	if (!hand || !hand.item) return;
	const asBlock = !!(hand.cube && Number.isInteger(hand.tile) && hand.tile >= 0 && mesh);
	const order = [0, 1, 2, 0, 2, 3];
	const light = sceneLight();
	if (asBlock) {
		const corners = [
			[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
			[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
		].map(pt => skeletonHeldToWorld(m, pt[0], pt[1], pt[2], true, hand));
		const faces = [
			[4, 5, 6, 7, 0.9],
			[1, 0, 3, 2, 0.7],
			[0, 4, 7, 3, 0.6],
			[5, 1, 2, 6, 0.8],
			[7, 6, 2, 3, 1.0],
			[0, 1, 5, 4, 0.5]
		];
		const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
		for (const f of faces) {
			const sh = f[4] * light;
			for (const i of order) {
				const pt = corners[f[i]];
				const uv = uvs[i];
				cubes.push(pt[0], pt[1], pt[2], uv[0], uv[1], sh, sh, sh, hand.tile);
			}
		}
		return;
	}
	const rec = ensureItem(hand.item);
	if (!rec.ready || !rec.mesh) return;
	if (!sprites.has(hand.item)) sprites.set(hand.item, { rec, data: [] });
	const data = sprites.get(hand.item).data;
	for (const quad of rec.mesh) {
		const pts = quad.p.map(pt => skeletonHeldToWorld(m, pt[0] / 16, pt[1] / 16, pt[2] / 16, false, hand));
		for (const i of order) {
			const uv = quad.uv[i];
			data.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], light, light, light, 0);
		}
	}
}

function appendVillagerHeld(cubes, sprites, m, hand) {
	if (!hand || !hand.item) return;
	const asBlock = !!(hand.cube && Number.isInteger(hand.tile) && hand.tile >= 0 && mesh);
	const order = [0, 1, 2, 0, 2, 3];
	const light = sceneLight();
	if (asBlock) {
		const corners = [
			[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
			[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
		].map(pt => villagerHeldToWorld(m, pt[0], pt[1], pt[2], true));
		const faces = [
			[4, 5, 6, 7, 0.9],
			[1, 0, 3, 2, 0.7],
			[0, 4, 7, 3, 0.6],
			[5, 1, 2, 6, 0.8],
			[7, 6, 2, 3, 1.0],
			[0, 1, 5, 4, 0.5]
		];
		const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
		for (const f of faces) {
			const sh = f[4] * light;
			for (const i of order) {
				const pt = corners[f[i]];
				const uv = uvs[i];
				cubes.push(pt[0], pt[1], pt[2], uv[0], uv[1], sh, sh, sh, hand.tile);
			}
		}
		return;
	}
	const rec = ensureItem(hand.item);
	if (!rec.ready || !rec.mesh) return;
	if (!sprites.has(hand.item)) sprites.set(hand.item, { rec, data: [] });
	const data = sprites.get(hand.item).data;
	for (const quad of rec.mesh) {
		const pts = quad.p.map(pt => villagerHeldToWorld(m, pt[0] / 16, pt[1] / 16, pt[2] / 16, false));
		for (const i of order) {
			const uv = quad.uv[i];
			data.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], light, light, light, 0);
		}
	}
}

function drawBox(list, x, y, z, w, h, d, r, g, b) {
	const x0 = x, y0 = y, z0 = z, x1 = x + w, y1 = y + h, z1 = z + d;
	const faces = [
		[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], 0.9],
		[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0], 0.7],
		[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], 0.6],
		[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1], 0.8],
		[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0], 1.0],
		[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1], 0.5]
	];
	const light = sceneLight();
	for (const f of faces) {
		const s = f[4] * light;
		const idx = [0,1,2,0,2,3];
		for (const i of idx) {
			list.push(f[i][0], f[i][1], f[i][2], 0, 0, r * s, g * s, b * s, 0);
		}
	}
}

function drawTexturedCube(list, x, y, z, w, h, d, r, g, b, tile, yaw) {
	const cx = x + w / 2, cy = y + h / 2, cz = z + d / 2;
	const rot = yaw || 0;
	const vt = (px, py, pz) => {
		const q = rotY(px - cx, py - cy, pz - cz, rot);
		return [q[0] + cx, q[1] + cy, q[2] + cz];
	};
	const x0 = x, y0 = y, z0 = z, x1 = x + w, y1 = y + h, z1 = z + d;
	const faces = [
		[vt(x0,y0,z1), vt(x1,y0,z1), vt(x1,y1,z1), vt(x0,y1,z1), 0.9],
		[vt(x1,y0,z0), vt(x0,y0,z0), vt(x0,y1,z0), vt(x1,y1,z0), 0.7],
		[vt(x0,y0,z0), vt(x0,y0,z1), vt(x0,y1,z1), vt(x0,y1,z0), 0.6],
		[vt(x1,y0,z1), vt(x1,y0,z0), vt(x1,y1,z0), vt(x1,y1,z1), 0.8],
		[vt(x0,y1,z1), vt(x1,y1,z1), vt(x1,y1,z0), vt(x0,y1,z0), 1.0],
		[vt(x0,y0,z0), vt(x1,y0,z0), vt(x1,y0,z1), vt(x0,y0,z1), 0.5]
	];
	const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
	const light = sceneLight();
	const order = [0, 1, 2, 0, 2, 3];
	for (const f of faces) {
		const s = f[4] * light;
		for (const i of order) {
			const uv = uvs[i];
			list.push(f[i][0], f[i][1], f[i][2], uv[0], uv[1], r * s, g * s, b * s, tile);
		}
	}
}

function drawTntCube(list, x, y, z, size, tileSide, tileTop, tileBottom, flash, scale) {
	const s = size * (scale || 1);
	const ox = x - s / 2, oy = y, oz = z - s / 2;
	const x0 = ox, y0 = oy, z0 = oz, x1 = ox + s, y1 = oy + s, z1 = oz + s;
	const faces = [
		[[x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1], 0.9, tileSide],
		[[x1,y0,z0], [x0,y0,z0], [x0,y1,z0], [x1,y1,z0], 0.7, tileSide],
		[[x0,y0,z0], [x0,y0,z1], [x0,y1,z1], [x0,y1,z0], 0.6, tileSide],
		[[x1,y0,z1], [x1,y0,z0], [x1,y1,z0], [x1,y1,z1], 0.8, tileSide],
		[[x0,y1,z1], [x1,y1,z1], [x1,y1,z0], [x0,y1,z0], 1.0, tileTop],
		[[x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [x0,y0,z1], 0.5, tileBottom]
	];
	const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
	const light = sceneLight();
	const order = [0, 1, 2, 0, 2, 3];
	const boost = flash ? 2.2 : 1;
	for (const f of faces) {
		const sh = Math.min(1, f[4] * light * boost);
		const tile = Number.isInteger(f[5]) && f[5] >= 0 ? f[5] : 0;
		for (const i of order) {
			const uv = uvs[i];
			list.push(f[i][0], f[i][1], f[i][2], uv[0], uv[1], sh, sh, sh, tile);
		}
	}
}

function frameAxes(facing) {
	switch (facing) {
		case 0: return { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] };
		case 1: return { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] };
		case 3: return { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] };
		case 4: return { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] };
		case 5: return { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] };
		default: return { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] };
	}
}

function framePoint(origin, axes, x, y, z) {
	return [
		origin[0] + axes.r[0] * x + axes.u[0] * y + axes.n[0] * z,
		origin[1] + axes.r[1] * x + axes.u[1] * y + axes.n[1] * z,
		origin[2] + axes.r[2] * x + axes.u[2] * y + axes.n[2] * z
	];
}

function rotateFrameAxes(axes, turns) {
	const a = (turns || 0) * Math.PI / 4;
	const c = Math.cos(a), s = Math.sin(a);
	return {
		n: axes.n,
		r: [
			axes.r[0] * c + axes.u[0] * s,
			axes.r[1] * c + axes.u[1] * s,
			axes.r[2] * c + axes.u[2] * s
		],
		u: [
			axes.u[0] * c - axes.r[0] * s,
			axes.u[1] * c - axes.r[1] * s,
			axes.u[2] * c - axes.r[2] * s
		]
	};
}

function drawFrameQuad(list, origin, axes, corners, su0, sv0, su1, sv1, cr, cg, cb, tile, shade) {
	const pts = corners.map(c => framePoint(origin, axes, c[0], c[1], c[2]));
	const uvs = [[su0, sv1], [su1, sv1], [su1, sv0], [su0, sv0]];
	const light = sceneLight() * (shade == null ? 0.95 : shade);
	const order = [0, 1, 2, 0, 2, 3];
	const t = Number.isInteger(tile) && tile >= 0 ? tile : 0;
	for (const i of order) {
		const uv = uvs[i];
		list.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], cr * light, cg * light, cb * light, t);
	}
}

function drawItemFrame(list, origin, axes, frameTile, woodTile, glow) {
	const p = 1 / 16;
	const inner = 5 * p;
	const outer = 6 * p;
	const backZ = 0;
	const leatherZ = 0.5 * p;
	const woodZ = p;
	const leather = Number.isInteger(frameTile) && frameTile >= 0 ? frameTile : -1;
	const wood = Number.isInteger(woodTile) && woodTile >= 0 ? woodTile : leather;
	const wr = wood >= 0 ? [1, 1, 1] : [0.86, 0.78, 0.55];
	const wt = wood >= 0 ? wood : 0;
	if (leather >= 0) {
		drawFrameQuad(list, origin, axes, [[-inner, -inner, leatherZ], [inner, -inner, leatherZ], [inner, inner, leatherZ], [-inner, inner, leatherZ]], 3 * p, 3 * p, 13 * p, 13 * p, 1, 1, 1, leather, 0.85);
	} else {
		const back = glow ? [1, 0.95, 0.55] : [0.45, 0.28, 0.18];
		drawFrameQuad(list, origin, axes, [[-inner, -inner, leatherZ], [inner, -inner, leatherZ], [inner, inner, leatherZ], [-inner, inner, leatherZ]], 0, 0, 1, 1, back[0], back[1], back[2], 0, 0.85);
	}
	drawFrameQuad(list, origin, axes, [[-outer, -outer, woodZ], [outer, -outer, woodZ], [outer, -inner, woodZ], [-outer, -inner, woodZ]], 2 * p, 13 * p, 14 * p, 14 * p, wr[0], wr[1], wr[2], wt, 0.95);
	drawFrameQuad(list, origin, axes, [[-outer, inner, woodZ], [outer, inner, woodZ], [outer, outer, woodZ], [-outer, outer, woodZ]], 2 * p, 2 * p, 14 * p, 3 * p, wr[0], wr[1], wr[2], wt, 0.95);
	drawFrameQuad(list, origin, axes, [[-outer, -inner, woodZ], [-inner, -inner, woodZ], [-inner, inner, woodZ], [-outer, inner, woodZ]], 2 * p, 3 * p, 3 * p, 13 * p, wr[0], wr[1], wr[2], wt, 0.95);
	drawFrameQuad(list, origin, axes, [[inner, -inner, woodZ], [outer, -inner, woodZ], [outer, inner, woodZ], [inner, inner, woodZ]], 13 * p, 3 * p, 14 * p, 13 * p, wr[0], wr[1], wr[2], wt, 0.95);
	drawFrameQuad(list, origin, axes, [[-inner, -inner, backZ], [inner, -inner, backZ], [inner, -inner, woodZ], [-inner, -inner, woodZ]], 2 * p, 15 * p, 14 * p, 16 * p, wr[0], wr[1], wr[2], wt, 0.7);
	drawFrameQuad(list, origin, axes, [[-inner, inner, woodZ], [inner, inner, woodZ], [inner, inner, backZ], [-inner, inner, backZ]], 2 * p, 0, 14 * p, p, wr[0], wr[1], wr[2], wt, 0.7);
	drawFrameQuad(list, origin, axes, [[-inner, -inner, woodZ], [-inner, inner, woodZ], [-inner, inner, backZ], [-inner, -inner, backZ]], 0, 3 * p, p, 13 * p, wr[0], wr[1], wr[2], wt, 0.62);
	drawFrameQuad(list, origin, axes, [[inner, -inner, backZ], [inner, inner, backZ], [inner, inner, woodZ], [inner, -inner, woodZ]], 15 * p, 3 * p, 16 * p, 13 * p, wr[0], wr[1], wr[2], wt, 0.62);
}

function signYaw(st) {
	if (st.wall) {
		switch (st.facing) {
			case 2: return 180;
			case 4: return 90;
			case 5: return 270;
			default: return 0;
		}
	}
	return -(st.rotation || 0) * 22.5;
}

function signPoint(origin, yawDeg, x, y, z) {
	const rad = yawDeg * Math.PI / 180;
	const c = Math.cos(rad), s = Math.sin(rad);
	const lx = x - 8, lz = z - 8;
	return [
		origin[0] + (lx * c + lz * s + 8) / 16,
		origin[1] + y / 16,
		origin[2] + (-lx * s + lz * c + 8) / 16
	];
}

function signBoard(st) {
	if (st.hanging && st.wall) return { x0: 1, y0: 0, z0: 0, x1: 15, y1: 10, z1: 2 };
	if (st.hanging) return { x0: 1, y0: 0, z0: 7, x1: 15, y1: 10, z1: 9 };
	const s = 2 / 3;
	if (st.wall) {
		return { x0: (-4 - 8) * s + 8, y0: 7 * s, z0: 0, x1: (20 - 8) * s + 8, y1: 19 * s, z1: 2 * s };
	}
	return {
		x0: (-4 - 8) * s + 8, y0: 7 * s, z0: (7 - 8) * s + 8,
		x1: (20 - 8) * s + 8, y1: 19 * s, z1: (9 - 8) * s + 8
	};
}

const signTex = new Map();
let asciiFont = null;
const glyphW = new Uint8Array(256);
fetch("/api/font/ascii.png").then(r => r.ok ? r.blob() : Promise.reject()).then(blob => createImageBitmap(blob)).then(img => {
	asciiFont = img;
	measureGlyphs();
	signTex.clear();
}).catch(() => { asciiFont = null; });

function fontCell() {
	return asciiFont && asciiFont.width >= 200 ? 16 : 8;
}

function measureGlyphs() {
	if (!asciiFont) return;
	const cell = fontCell();
	const cols = (asciiFont.width / cell) | 0;
	const c = document.createElement("canvas");
	c.width = asciiFont.width;
	c.height = asciiFont.height;
	const ctx = c.getContext("2d", { willReadFrequently: true });
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(asciiFont, 0, 0);
	const pix = ctx.getImageData(0, 0, c.width, c.height).data;
	for (let ch = 0; ch < 256; ch++) {
		const sx = (ch % cols) * cell;
		const sy = ((ch / cols) | 0) * cell;
		let last = 0;
		for (let x = 0; x < cell; x++) {
			for (let y = 0; y < cell; y++) {
				if (pix[((sy + y) * c.width + sx + x) * 4 + 3] > 16) last = x + 1;
			}
		}
		glyphW[ch] = ch === 32 ? Math.max(2, (cell * 0.5) | 0) : Math.max(1, last);
	}
}

function glyphAdvance(ch) {
	const cell = fontCell();
	const gw = glyphW[ch & 255] || cell;
	return ((gw * 8 / cell) | 0) + 1;
}

function lineWidth(text) {
	let w = 0;
	for (let i = 0; i < text.length; i++) {
		w += glyphAdvance(text.charCodeAt(i));
	}
	return w;
}

function blitAscii(ctx, text, x, y, color) {
	const cell = fontCell();
	const dest = 8;
	let dx = x;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i) & 255;
		const cols = (asciiFont.width / cell) | 0;
		const sx = (ch % cols) * cell;
		const sy = ((ch / cols) | 0) * cell;
		const glyphs = document.createElement("canvas");
		glyphs.width = dest;
		glyphs.height = dest;
		const g = glyphs.getContext("2d");
		g.imageSmoothingEnabled = false;
		g.clearRect(0, 0, dest, dest);
		g.drawImage(asciiFont, sx, sy, cell, cell, 0, 0, dest, dest);
		g.globalCompositeOperation = "source-in";
		g.fillStyle = color;
		g.fillRect(0, 0, dest, dest);
		ctx.drawImage(glyphs, dx, y);
		dx += glyphAdvance(ch);
	}
}

function ensureSignSide(side) {
	if (!side || !(side.lines || []).some(line => line && String(line).length)) return null;
	if (!asciiFont) return null;
	const key = (side.lines || []).join("\n") + "|" + (side.color || "#000000") + "|" + !!side.glow;
	if (signTex.has(key)) return signTex.get(key);
	const lines = [0, 1, 2, 3].map(i => String((side.lines || [])[i] || ""));
	const lineH = 10;
	const maxW = Math.max(8, ...lines.map(line => lineWidth(line) || 0));
	const w = maxW;
	const h = lineH * 4;
	const rec = { tex: gl.createTexture(), ready: false, w, h };
	signTex.set(key, rec);
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	ctx.clearRect(0, 0, w, h);
	const color = side.color || "#000000";
	const outline = color === "#000000" || color === "#000" ? "#FFFFFF" : "#000000";
	for (let i = 0; i < 4; i++) {
		const line = lines[i];
		if (!line) continue;
		const x = ((w - lineWidth(line)) / 2) | 0;
		const y = i * lineH;
		if (side.glow) {
			for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
				blitAscii(ctx, line, x + ox, y + oy, outline);
			}
		}
		blitAscii(ctx, line, x, y, color);
	}
	gl.bindTexture(gl.TEXTURE_2D, rec.tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
	rec.ready = true;
	return rec;
}

function drawSignSide(list, origin, yaw, board, front, inset, rec) {
	const z = front ? board.z1 + inset : board.z0 - inset;
	const cx = (board.x0 + board.x1) * 0.5;
	const cy = (board.y0 + board.y1) * 0.5;
	const hx = (rec.w / 96) * 8;
	const hy = (rec.h / 96) * 8;
	const pts = front ? [
		signPoint(origin, yaw, cx - hx, cy - hy, z),
		signPoint(origin, yaw, cx + hx, cy - hy, z),
		signPoint(origin, yaw, cx + hx, cy + hy, z),
		signPoint(origin, yaw, cx - hx, cy + hy, z)
	] : [
		signPoint(origin, yaw, cx + hx, cy - hy, z),
		signPoint(origin, yaw, cx - hx, cy - hy, z),
		signPoint(origin, yaw, cx - hx, cy + hy, z),
		signPoint(origin, yaw, cx + hx, cy + hy, z)
	];
	const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
	const order = [0, 1, 2, 0, 2, 3];
	for (const i of order) {
		const uv = uvs[i];
		list.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], 1, 1, 1, 0);
	}
}

function drawItemSprite(list, x, y, z, size, yaw) {
	const hx = Math.cos(yaw) * size * 0.5;
	const hz = Math.sin(yaw) * size * 0.5;
	const y0 = y, y1 = y + size;
	const faces = [
		[[x - hx, y0, z - hz], [x + hx, y0, z + hz], [x + hx, y1, z + hz], [x - hx, y1, z - hz]],
		[[x + hx, y0, z + hz], [x - hx, y0, z - hz], [x - hx, y1, z - hz], [x + hx, y1, z + hz]]
	];
	const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
	const light = sceneLight();
	const order = [0, 1, 2, 0, 2, 3];
	for (const f of faces) {
		for (const i of order) {
			const uv = uvs[i];
			list.push(f[i][0], f[i][1], f[i][2], uv[0], uv[1], light, light, light, 0);
		}
	}
}

function mobFacingYaw(m) {
	const family = mobFamily(m.type || "");
	const yaw0 = m.bodyYaw != null ? m.bodyYaw : m.yaw;
	return yaw0 + (mobFlips(family) ? 180 : 0);
}

function modelPointToWorld(m, facing, x, y, z) {
	return toWorld(x, 1.5 - y, z, facing, m.x, m.y + 0.02, m.z);
}

function rotYDeg(p, deg) {
	return rotY(p[0], p[1], p[2], deg * Math.PI / 180);
}

function mobHeadLook(m) {
	const yaw0 = m.bodyYaw != null ? m.bodyYaw : m.yaw;
	const look = m.headYaw != null ? m.headYaw : m.yaw;
	let rel = wrapDeg(look - yaw0);
	rel = Math.max(-50, Math.min(50, rel));
	return {
		pitch: ((m.pitch || 0) * Math.PI) / 180,
		yaw: (rel * Math.PI) / 180,
		facing: mobFacingYaw(m)
	};
}

function xfPlantCube(local, ops) {
	let p = [local[0] - 0.5, local[1] - 0.5, local[2] - 0.5];
	p = [-p[0], -p[1], p[2]];
	for (const op of ops) {
		if (op.ry != null) p = rotYDeg(p, op.ry);
		if (op.t) p = [p[0] + op.t[0], p[1] + op.t[1], p[2] + op.t[2]];
	}
	return p;
}

function appendPropGroup(sprites, itemId, fill) {
	const rec = ensureItem(itemId);
	if (!rec) return;
	if (!sprites.has(itemId)) sprites.set(itemId, { rec, data: [] });
	if (!rec.ready) return;
	fill(sprites.get(itemId).data);
}

function pushSpriteQuad(data, pts, uvs, shade) {
	const order = [0, 1, 2, 0, 2, 3];
	for (const i of order) {
		const p = pts[i], uv = uvs[i];
		data.push(p[0], p[1], p[2], uv[0], uv[1], shade, shade, shade, 0);
	}
}

function appendCrossPlant(sprites, itemId, xf) {
	appendPropGroup(sprites, itemId, data => {
		const light = sceneLight();
		const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
		const planes = [
			[[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]],
			[[1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]]
		];
		for (const plane of planes) {
			const pts = plane.map(xf);
			pushSpriteQuad(data, pts, uvs, light);
			pushSpriteQuad(data, [pts[1], pts[0], pts[3], pts[2]], [[1, 1], [0, 1], [0, 0], [1, 0]], light);
		}
	});
}

function appendMooshroomPlants(sprites, m) {
	if (m.baby) return;
	const item = m.tex && m.tex.indexOf("brown") >= 0 ? "brown_mushroom" : "red_mushroom";
	const look = mobHeadLook(m);
	const head = [0, 4 / 16, -8 / 16];
	const toWorldPt = p => modelPointToWorld(m, look.facing, p[0], p[1], p[2]);
	const body = [
		[{ ry: -48 }, { t: [0.2, -0.35, 0.5] }],
		[{ ry: -48 }, { t: [0.1, 0, -0.6] }, { ry: 42 }, { t: [0.2, -0.35, 0.5] }]
	];
	for (const ops of body) {
		appendCrossPlant(sprites, item, local => toWorldPt(xfPlantCube(local, ops)));
	}
	appendCrossPlant(sprites, item, local => {
		const offset = xfPlantCube(local, [{ ry: -78 }, { t: [0, -0.7, -0.2] }]);
		const pivot = [head[0], 1.5 - head[1], head[2]];
		const pt = [pivot[0] + offset[0], pivot[1] - offset[1], pivot[2] + offset[2]];
		return transformPoint(m.x, m.y + 0.02, m.z, look.facing, pivot, look.pitch, look.yaw, pt[0], pt[1], pt[2]);
	});
}

function appendSnowGolemPumpkin(sprites, m) {
	if (!m.pumpkin) return;
	const look = mobHeadLook(m);
	const pivot = [0, (24 - 4) * P, 0];
	const s = 0.625;
	const cy = 0.34375;
	const x0 = -s / 2, x1 = s / 2, y0 = cy - s / 2, y1 = cy + s / 2, z0 = -s / 2, z1 = s / 2;
	const xf = (x, y, z) => transformPoint(m.x, m.y + 0.02, m.z, look.facing, pivot, look.pitch, look.yaw, pivot[0] + x, pivot[1] + y, pivot[2] + z);
	const light = sceneLight();
	const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
	const face = (item, a, b, c, d, sh) => {
		appendPropGroup(sprites, item, data => {
			pushSpriteQuad(data, [a, b, c, d].map(p => xf(p[0], p[1], p[2])), uvs, light * sh);
		});
	};
	face("carved_pumpkin", [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.9);
	face("pumpkin_side", [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.7);
	face("pumpkin_side", [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.6);
	face("pumpkin_side", [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.8);
	face("pumpkin_top", [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1.0);
	face("pumpkin_top", [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.5);
}

function cameraAxes() {
	const yaw = eye.yaw * Math.PI / 180;
	const pitch = eye.pitch * Math.PI / 180;
	const dx = -Math.sin(yaw) * Math.cos(pitch);
	const dy = -Math.sin(pitch);
	const dz = Math.cos(yaw) * Math.cos(pitch);
	const z0 = -dx, z1 = -dy, z2 = -dz;
	let x0 = z2, x1 = 0, x2 = -z0;
	let xlen = Math.hypot(x0, x1, x2);
	if (xlen < 1e-6) {
		x0 = 1;
		x1 = 0;
		x2 = 0;
		xlen = 1;
	}
	x0 /= xlen;
	x1 /= xlen;
	x2 /= xlen;
	return {
		rx: x0, ry: x1, rz: x2,
		ux: z1 * x2 - z2 * x1,
		uy: z2 * x0 - z0 * x2,
		uz: z0 * x1 - z1 * x0
	};
}

function drawParticle(list, p, size, axes, light) {
	const hw = size * 0.5;
	const cx = p.x, cy = p.y + hw, cz = p.z;
	const rx = axes.rx * hw, ry = axes.ry * hw, rz = axes.rz * hw;
	const ux = axes.ux * hw, uy = axes.uy * hw, uz = axes.uz * hw;
	const faces = [
		[
			[cx - rx - ux, cy - ry - uy, cz - rz - uz],
			[cx + rx - ux, cy + ry - uy, cz + rz - uz],
			[cx + rx + ux, cy + ry + uy, cz + rz + uz],
			[cx - rx + ux, cy - ry + uy, cz - rz + uz]
		],
		[
			[cx + rx - ux, cy + ry - uy, cz + rz - uz],
			[cx - rx - ux, cy - ry - uy, cz - rz - uz],
			[cx - rx + ux, cy - ry + uy, cz - rz + uz],
			[cx + rx + ux, cy + ry + uy, cz + rz + uz]
		]
	];
	const r = p.cr * light, g = p.cg * light, b = p.cb * light;
	const uvs = [[p.u0, p.v1], [p.u1, p.v1], [p.u1, p.v0], [p.u0, p.v0]];
	const order = [0, 1, 2, 0, 2, 3];
	for (const f of faces) {
		for (const i of order) {
			const uv = uvs[i];
			list.push(f[i][0], f[i][1], f[i][2], uv[0], uv[1], r, g, b, p.tile);
		}
	}
}

function render() {
	requestAnimationFrame(render);
	poseStamp++;
	const now = performance.now();
	const dt = Math.min(0.08, (now - lastFrame) / 1000);
	lastFrame = now;
	animClock = now / 1000;
	const sampled = tickPoses(dt);
	tickParticles(dt);
	gl.clearColor(sky.fogR, sky.fogG, sky.fogB, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.enable(gl.DEPTH_TEST);
	gl.disable(gl.CULL_FACE);
	const proj = perspective(mat4(), 70 * Math.PI / 180, canvas.width / Math.max(canvas.height, 1), 0.05, 256);
	const view = look(mat4(), eye, eye.yaw, eye.pitch);
	const vp = mul(proj, view);

	gl.depthMask(false);
	gl.useProgram(skyProg);
	const skyData = skyMesh(eye);
	gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
	if (skyBufKey !== skyCacheKey) {
		gl.bufferData(gl.ARRAY_BUFFER, skyData, gl.STATIC_DRAW);
		skyBufKey = skyCacheKey;
	}
	gl.enableVertexAttribArray(skyLoc.pos);
	gl.vertexAttribPointer(skyLoc.pos, 3, gl.FLOAT, false, 24, 0);
	gl.enableVertexAttribArray(skyLoc.col);
	gl.vertexAttribPointer(skyLoc.col, 3, gl.FLOAT, false, 24, 12);
	gl.uniformMatrix4fv(skyLoc.viewProj, false, vp);
	gl.drawArrays(gl.TRIANGLES, 0, skyData.length / 6);
	gl.depthMask(true);

	gl.useProgram(prog);
	gl.uniformMatrix4fv(loc.viewProj, false, vp);
	gl.uniform3f(loc.eye, eye.x, eye.y, eye.z);
	gl.uniform1f(loc.fogNear, sky.fogNear);
	gl.uniform1f(loc.fogFar, sky.fogFar);
	gl.uniform3f(loc.fogColor, sky.fogR, sky.fogG, sky.fogB);
	const draw = (arr, count, tiles, hasTex, texture, stride, alphaPass) => {
		if (!count) return;
		const s = stride || 36;
		gl.bindTexture(gl.TEXTURE_2D, texture || atlasTex);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
		bindAttribs(s);
		gl.uniform1f(loc.tiles, tiles);
		gl.uniform1f(loc.hasAtlas, hasTex);
		gl.uniform1f(loc.alphaPass, alphaPass == null ? 1 : alphaPass);
		gl.uniform1i(loc.atlas, 0);
		gl.drawArrays(gl.TRIANGLES, 0, count);
	};
	if (mesh && mesh.parts) {
		uploadTerrain();
		gl.bindTexture(gl.TEXTURE_2D, atlasTex);
		gl.uniform1f(loc.tiles, mesh.tiles);
		gl.uniform1f(loc.hasAtlas, hasAtlas);
		gl.uniform1i(loc.atlas, 0);
		drawTerrainPart("opaque", 0);
		drawTerrainPart("cutout", 1);
		if (mesh.parts.trans.count) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.depthMask(false);
			drawTerrainPart("trans", 1);
			gl.depthMask(true);
			gl.disable(gl.BLEND);
		}
	}
	if (mesh && sampled.chests && sampled.chests.length) {
		const vf = mesh.vf || 12;
		const chunks = [];
		let n = 0;
		for (const st of sampled.chests) {
			const src = chestGeom.get(st.x + "," + st.y + "," + st.z);
			if (!src) continue;
			const pitched = transformChestGeom(src, st.x, st.y, st.z, st.rotY || 0, chestLidPitch(st.lid || 0), vf);
			chunks.push(pitched);
			n += pitched.length;
		}
		if (n) {
			const all = new Float32Array(n);
			let o = 0;
			for (const c of chunks) {
				all.set(c, o);
				o += c.length;
			}
			draw(all, all.length / vf, mesh.tiles, hasAtlas, atlasTex, vf * 4, 0);
		}
	}
	gl.enable(gl.CULL_FACE);
	gl.frontFace(gl.CW);
	const heldCubes = [];
	const heldSprites = new Map();
	for (const p of sampled.players) {
		const rec = ensureSkin(p);
		const pose = Object.assign({}, p, { slim: rec.slim });
		const data = [];
		playerMesh(data, pose);
		draw(new Float32Array(data), data.length / 9, 1, rec.ready ? 1 : 0, rec.tex);
		drawEquippedArmor(pose, armorSlot, draw);
		const mainLeft = !!p.leftMain;
		appendHeld(heldCubes, heldSprites, pose, p.mainHand, mainLeft);
		appendHeld(heldCubes, heldSprites, pose, p.offHand, !mainLeft);
	}
	const mobGroups = new Map();
	const overlayGroups = new Map();
	const propSprites = new Map();
	const mobFallback = [];
	const addOverlay = (mob, tex, layer) => {
		const rec = ensureMob(tex);
		if (!rec || !rec.ready) return;
		const key = rec.key + ":" + layer;
		if (!overlayGroups.has(key)) overlayGroups.set(key, { rec, data: [] });
		mobMesh(overlayGroups.get(key).data, mob, rec, layer);
	};
	for (const m of sampled.mobs) {
		if (m.type === "armor_stand") {
			if (!m.invis) {
				const rec = ensureMob(m.tex || "armorstand/wood");
				if (!rec || !rec.ready) {
					drawBox(mobFallback, m.x - 0.2, m.y, m.z - 0.2, 0.4, Math.max(0.8, m.h || 1.975), 0.4, 0.72, 0.58, 0.38);
				} else {
					if (!mobGroups.has(rec.key)) mobGroups.set(rec.key, { rec, data: [] });
					mobMesh(mobGroups.get(rec.key).data, m, rec);
				}
			}
			drawEquippedArmor(m, armorStandSlot, draw);
			continue;
		}
		const rec = ensureMob(m.tex || m.type);
		if (!rec || !rec.ready) {
			drawBox(mobFallback, m.x - 0.25, m.y, m.z - 0.25, 0.5, Math.max(0.6, m.h || 1.4), 0.5, 0.85, 0.4, 0.25);
			continue;
		}
		if (!mobGroups.has(rec.key)) mobGroups.set(rec.key, { rec, data: [] });
		mobMesh(mobGroups.get(rec.key).data, m, rec);
		if (m.type === "sheep" && !m.sheared) addOverlay(m, "sheep/sheep_wool", "wool");
		if (m.type === "drowned") addOverlay(m, "zombie/drowned_outer_layer", "clothes");
		if (m.type === "stray") addOverlay(m, "skeleton/stray_overlay", "clothes");
		if (m.type === "bogged") addOverlay(m, "skeleton/bogged_overlay", "clothes");
		if (m.type === "spider" || m.type === "cave_spider") addOverlay(m, "spider/spider_eyes", "eyes");
		if (m.type === "breeze") {
			addOverlay(m, "breeze/breeze_wind", "wind");
			addOverlay(m, "breeze/breeze_eyes", "eyes");
		}
		if (m.type === "creaking") addOverlay(m, "creaking/creaking_eyes", "eyes");
		if (m.type === "phantom") addOverlay(m, "phantom_eyes", "eyes");
		if (m.type === "enderman") addOverlay(m, "enderman/enderman_eyes", "eyes");
		if (m.type === "warden") {
			addOverlay(m, "warden/warden_bioluminescent_layer", "glow");
			addOverlay(m, "warden/warden_pulsating_spots_1", "spots");
			addOverlay(m, "warden/warden_heart", "heart");
		}
		if (m.type === "villager" || m.type === "zombie_villager") {
			const folder = m.type === "zombie_villager" ? "zombie_villager" : "villager";
			if (m.vType) addOverlay(m, folder + "/type/" + m.vType, "villager");
			if (m.vJob && m.vJob !== "none") addOverlay(m, folder + "/profession/" + m.vJob, "villager_job");
			if (m.vLevel && m.type === "villager") addOverlay(m, "villager/profession_level/" + m.vLevel, "villager_job");
		}
		if (m.type === "iron_golem" && m.crack) addOverlay(m, "iron_golem/iron_golem_crackiness_" + m.crack, "golem");
		if (m.type === "copper_golem" && m.tex) addOverlay(m, m.tex + "_eyes", "eyes");
		if (m.type === "tropical_fish" && m.fishPat != null) {
			const size = m.fishSize === "large" ? "b" : "a";
			addOverlay(m, "fish/tropical_" + size + "_pattern_" + ((m.fishPat | 0) + 1), "fishpat");
		}
		if (m.type === "mooshroom") appendMooshroomPlants(propSprites, m);
		if (m.type === "snow_golem") appendSnowGolemPumpkin(propSprites, m);
		if (m.hand && m.hand.item) {
			const family = mobFamily(m.type);
			if (family === "villager") {
				appendVillagerHeld(heldCubes, heldSprites, m, m.hand);
			} else if (family === "vex" || family === "allay") {
				appendVexHeld(heldCubes, heldSprites, m, m.hand);
			} else if (family === "skeleton" || family === "illager") {
				appendSkeletonHeld(heldCubes, heldSprites, m, m.hand);
			} else if (family === "biped" || family === "enderman") {
				const zombieArms = m.type === "zombie" || m.type === "husk" || m.type === "drowned" || m.type === "zombie_villager" || m.type === "zombified_piglin";
				const pose = {
					x: m.x, y: m.y, z: m.z,
					yaw: m.yaw,
					bodyYaw: m.bodyYaw != null ? m.bodyYaw : m.yaw,
					headYaw: m.headYaw,
					pitch: m.pitch,
					limb: m.limb, amt: zombieArms ? 0 : (m.amt || 0) * 1.4,
					slim: family === "enderman",
					aw: family === "enderman" ? 2 * P : 4 * P,
					armExtra: family === "enderman" ? -0.1 : (family === "illager" ? -0.87 : -1.4)
				};
				appendHeld(heldCubes, heldSprites, pose, m.hand, false);
			}
		}
	}
	gl.disable(gl.CULL_FACE);
	if (mobFallback.length) draw(new Float32Array(mobFallback), mobFallback.length / 9, 1, 0, atlasTex);
	for (const group of mobGroups.values()) {
		if (group.data.length) draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
	}
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.enable(gl.POLYGON_OFFSET_FILL);
	gl.polygonOffset(0, -2);
	for (const group of overlayGroups.values()) {
		if (group.data.length) draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
	}
	gl.disable(gl.POLYGON_OFFSET_FILL);
	gl.disable(gl.BLEND);
	gl.frontFace(gl.CCW);
	gl.disable(gl.CULL_FACE);
	if (propSprites.size) {
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(-1.6, -1.6);
		for (const group of propSprites.values()) {
			if (group.data.length) draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
		}
		gl.disable(gl.POLYGON_OFFSET_FILL);
		gl.disable(gl.BLEND);
	}
	const tntCubes = [];
	for (const st of sampled.tnt || []) {
		const fuse = Math.max(0, (st.fuse || 0) - (now - (st.t0 || now)) / 50);
		const flash = Math.floor(fuse / 5) % 2 === 0;
		let scale = 1;
		if (fuse < 10) {
			let g = 1 - fuse / 10;
			g = Math.max(0, Math.min(1, g));
			g *= g;
			g *= g;
			scale = 1 + g * 0.3;
		}
		const side = Number.isInteger(st.tileSide) ? st.tileSide : (Number.isInteger(st.tileTop) ? st.tileTop : 0);
		const top = Number.isInteger(st.tileTop) ? st.tileTop : side;
		const bottom = Number.isInteger(st.tileBottom) ? st.tileBottom : side;
		drawTntCube(tntCubes, st.x, st.y, st.z, 0.98, side, top, bottom, flash, scale);
	}
	if (tntCubes.length) draw(new Float32Array(tntCubes), tntCubes.length / 9, mesh ? mesh.tiles : 1, hasAtlas && mesh ? 1 : 0, atlasTex);
	const frameCubes = [];
	const frameSprites = new Map();
	for (const st of sampled.frames || []) {
		const origin = [st.x, st.y, st.z];
		const base = frameAxes(st.facing);
		drawItemFrame(frameCubes, origin, base, st.frameTile, st.woodTile, !!st.glow);
		if (!st.item) continue;
		const rot = rotateFrameAxes(base, -(st.rotation || 0));
		if (st.cube && Number.isInteger(st.tile) && st.tile >= 0 && mesh) {
			const h = 0.125;
			const corners = [];
			for (const px of [-h, h]) {
				for (const py of [-h, h]) {
					for (const pz of [1 / 16, 1 / 16 + 0.25]) {
						corners.push(framePoint(origin, rot, px, py, pz));
					}
				}
			}
			const faces = [
				[0, 2, 3, 1, 0.7],
				[4, 5, 7, 6, 0.9],
				[0, 1, 5, 4, 0.6],
				[2, 6, 7, 3, 0.8],
				[1, 3, 7, 5, 1.0],
				[0, 4, 6, 2, 0.5]
			];
			const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
			const light = sceneLight();
			const order = [0, 1, 2, 0, 2, 3];
			for (const f of faces) {
				const sh = f[4] * light;
				for (const i of order) {
					const pt = corners[f[i]];
					const uv = uvs[i];
					frameCubes.push(pt[0], pt[1], pt[2], uv[0], uv[1], sh, sh, sh, st.tile);
				}
			}
		} else {
			const rec = ensureItem(st.item);
			if (!rec.ready || !rec.mesh) continue;
			if (!frameSprites.has(st.item)) frameSprites.set(st.item, { rec, data: [] });
			const data = frameSprites.get(st.item).data;
			const order = [0, 1, 2, 0, 2, 3];
			const light = sceneLight();
			for (const quad of rec.mesh) {
				const pts = quad.p.map(pt => framePoint(origin, rot, (pt[0] / 16 - 0.5) * 0.5, (pt[1] / 16 - 0.5) * 0.5, 1 / 16 + 0.02 + (pt[2] / 16 - 0.5) * 0.08));
				for (const i of order) {
					const uv = quad.uv[i];
					data.push(pts[i][0], pts[i][1], pts[i][2], uv[0], uv[1], light, light, light, 0);
				}
			}
		}
	}
	if (frameCubes.length) draw(new Float32Array(frameCubes), frameCubes.length / 9, mesh ? mesh.tiles : 1, hasAtlas && mesh ? 1 : 0, atlasTex);
	if (frameSprites.size) {
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		for (const group of frameSprites.values()) {
			draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
		}
		gl.disable(gl.BLEND);
	}
	const signGroups = new Map();
	for (const st of sampled.signs || []) {
		const origin = [st.x, st.y, st.z];
		const yaw = signYaw(st);
		const board = signBoard(st);
		const sides = [
			[st.front, true],
			[st.back, false]
		];
		for (const [side, front] of sides) {
			const rec = ensureSignSide(side);
			if (!rec || !rec.ready) continue;
			const key = (side.lines || []).join("\n") + "|" + (side.color || "") + "|" + !!side.glow;
			if (!signGroups.has(key)) signGroups.set(key, { rec, data: [] });
			drawSignSide(signGroups.get(key).data, origin, yaw, board, front, 0.02, rec);
		}
	}
	if (signGroups.size) {
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(false);
		for (const group of signGroups.values()) {
			draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
		}
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}
	const itemCubes = [];
	const itemSprites = new Map();
	for (const st of poses.values()) {
		if (st.kind !== "item") continue;
		const age = (st.age || 0) + (now - (st.t0 || now)) / 50;
		const off = st.uniqueOffset || 0;
		const bob = 0.1 + Math.sin(age / 10 + off) * 0.1;
		const yaw = age / 20 + off;
		if (st.cube && Number.isInteger(st.tile) && st.tile >= 0 && mesh) {
			const s = 0.25;
			drawTexturedCube(itemCubes, st.x - s / 2, st.y + bob, st.z - s / 2, s, s, s, 1, 1, 1, st.tile, yaw);
		} else if (st.item) {
			const rec = ensureItem(st.item);
			if (!rec.ready) continue;
			if (!itemSprites.has(st.item)) itemSprites.set(st.item, { rec, data: [] });
			drawItemSprite(itemSprites.get(st.item).data, st.x, st.y + bob, st.z, 0.5, yaw);
		}
	}
	if (itemCubes.length) draw(new Float32Array(itemCubes), itemCubes.length / 9, mesh ? mesh.tiles : 1, hasAtlas && mesh ? 1 : 0, atlasTex);
	if (itemSprites.size) {
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		for (const group of itemSprites.values()) {
			draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
		}
		gl.disable(gl.BLEND);
	}
	if (heldCubes.length || heldSprites.size) gl.enable(gl.CULL_FACE);
	if (heldCubes.length) draw(new Float32Array(heldCubes), heldCubes.length / 9, mesh ? mesh.tiles : 1, hasAtlas && mesh ? 1 : 0, atlasTex);
	if (heldSprites.size) {
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(-2, -2);
		for (const group of heldSprites.values()) {
			draw(new Float32Array(group.data), group.data.length / 9, 1, 1, group.rec.tex);
		}
		gl.disable(gl.POLYGON_OFFSET_FILL);
		gl.disable(gl.BLEND);
	}
	if (heldCubes.length || heldSprites.size) gl.disable(gl.CULL_FACE);
	if (particles.length) {
		const pdata = [];
		const axes = cameraAxes();
		const light = sceneLight();
		for (const p of particles) {
			drawParticle(pdata, p, p.size, axes, light);
		}
		if (pdata.length) {
			gl.depthMask(false);
			draw(new Float32Array(pdata), pdata.length / 9, mesh ? mesh.tiles : 1, hasAtlas && mesh ? 1 : 0, atlasTex);
			gl.depthMask(true);
		}
	}
	if (breaking.length && crackTex.ready) {
		const crackData = [];
		for (const b of breaking) {
			if (b.stage < 0 || b.stage > 9) continue;
			drawCrackCube(crackData, b.x, b.y, b.z, b.stage);
		}
		if (crackData.length) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
			gl.enable(gl.POLYGON_OFFSET_FILL);
			gl.polygonOffset(-1, -1);
			draw(new Float32Array(crackData), crackData.length / 9, crackTex.tiles, 1, crackTex.tex);
			gl.disable(gl.POLYGON_OFFSET_FILL);
			gl.disable(gl.BLEND);
		}
	}
	drawNametags(sampled.players, vp);
}
function drawCrackCube(out, x, y, z, stage) {
	const pad = 0.002;
	const x0 = x - pad, y0 = y - pad, z0 = z - pad;
	const x1 = x + 1 + pad, y1 = y + 1 + pad, z1 = z + 1 + pad;
	const faces = [
		[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
		[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
		[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
		[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
		[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
		[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]
	];
	const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
	const order = [0, 1, 2, 0, 2, 3];
	for (const f of faces) {
		for (const i of order) {
			const p = f[i];
			const uv = uvs[i];
			out.push(p[0], p[1], p[2], uv[0], uv[1], 1, 1, 1, stage);
		}
	}
}
function projectPoint(x, y, z, vp) {
	const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
	if (w <= 0.05) return null;
	const ndcX = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w;
	const ndcY = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
	if (ndcX < -1.15 || ndcX > 1.15 || ndcY < -1.2 || ndcY > 1.2) return null;
	return {
		x: (ndcX * 0.5 + 0.5) * canvas.clientWidth,
		y: (0.5 - ndcY * 0.5) * canvas.clientHeight
	};
}
function setStatus(text, state) {
	if (statusEl) {
		statusEl.textContent = text;
		statusEl.dataset.state = state || "";
	}
}
function setLive(on) {
	document.body.classList.toggle("is-live", !!on);
	if (recEl) recEl.classList.toggle("on", !!on);
	if (nosignalEl) nosignalEl.classList.toggle("hidden", !!on);
}
function padCam(i) {
	return "CAM " + String(i + 1).padStart(2, "0");
}
function shortDim(d) {
	return String(d || "").replace(/^minecraft:/, "");
}
function tickClock() {
	if (!clockEl) return;
	clockEl.textContent = new Date().toISOString().slice(11, 19) + "Z";
}
setInterval(tickClock, 250);
tickClock();
setLive(false);

function drawNametags(list, vp) {
	if (!nametagsEl) return;
	nametagsEl.innerHTML = "";
	if (!vp || !list || !list.length) {
		if (loaded) {
			metaEl.textContent = "LIVE";
			setLive(true);
		}
		return;
	}
	for (const p of list) {
		if (!p.name) continue;
		const sneak = p.sneaking || p.pose === "crouching";
		const screen = projectPoint(p.x, p.y + (sneak ? 1.55 : 2.15), p.z, vp);
		if (!screen) continue;
		const tag = document.createElement("div");
		tag.className = "nametag";
		tag.textContent = p.name;
		tag.style.left = screen.x + "px";
		tag.style.top = screen.y + "px";
		nametagsEl.appendChild(tag);
	}
	metaEl.textContent = loaded ? "LIVE" : "NO CHUNKS";
	setLive(!!loaded);
}
render();

async function loadCameras() {
	if (!token) {
		setStatus("Missing token. Run /cctv in game.", "auth");
		return;
	}
	const res = await fetch("/api/cameras?token=" + encodeURIComponent(token));
	if (!res.ok) {
		setStatus("Unauthorized. Run /cctv again.", "auth");
		return;
	}
	const data = await res.json();
	cameras = data.cameras || [];
	if (countEl) countEl.textContent = String(cameras.length).padStart(2, "0") + " CH";
	setStatus(cameras.length ? (data.op ? "Operator view" : "Your cameras") : "No cameras placed", cameras.length ? "live" : "empty");
	listEl.innerHTML = "";
	cameras.forEach((cam, i) => {
		const row = document.createElement("div");
		row.className = "cam-row";
		row.dataset.id = cam.id;
		const btn = document.createElement("button");
		btn.className = "cam-btn";
		btn.type = "button";
		const ch = document.createElement("span");
		ch.className = "cam-ch";
		ch.textContent = padCam(i);
		const title = document.createElement("span");
		title.className = "cam-title";
		title.textContent = cam.name;
		const loc = document.createElement("span");
		loc.className = "cam-loc";
		loc.textContent = shortDim(cam.dimension) + "  " + cam.x + " " + cam.y + " " + cam.z;
		btn.appendChild(ch);
		btn.appendChild(title);
		btn.appendChild(loc);
		btn.onclick = () => connect(cam);
		const del = document.createElement("button");
		del.className = "cam-del";
		del.type = "button";
		del.title = "Remove camera";
		del.textContent = "×";
		del.onclick = ev => {
			ev.stopPropagation();
			removeCamera(cam);
		};
		row.appendChild(btn);
		row.appendChild(del);
		listEl.appendChild(row);
	});
	const still = cameras.find(c => c.id === currentId);
	if (still) {
		highlightCam(still.id);
	} else if (cameras[0]) {
		connect(cameras[0]);
	} else {
		clearFeed();
	}
}

function highlightCam(id) {
	listEl.querySelectorAll(".cam-row").forEach(row => {
		row.classList.toggle("active", row.dataset.id === id);
	});
	const idx = cameras.findIndex(c => c.id === id);
	if (channelEl) channelEl.textContent = idx >= 0 ? padCam(idx) : "CAM --";
}

async function removeCamera(cam) {
	if (!confirm("Remove " + cam.name + "?")) return;
	const res = await fetch("/api/cameras/" + encodeURIComponent(cam.id) + "/delete?token=" + encodeURIComponent(token), { method: "POST" });
	if (!res.ok) {
		setStatus("Could not remove camera", "error");
		return;
	}
	await loadCameras();
}

function applyCamHud(cam) {
	nameEl.textContent = cam.name;
	if (coordsEl) coordsEl.textContent = shortDim(cam.dimension) + "  " + cam.x + " " + cam.y + " " + cam.z;
	const idx = cameras.findIndex(c => c.id === cam.id);
	if (channelEl) channelEl.textContent = idx >= 0 ? padCam(idx) : "CAM --";
}

function clearFeed() {
	currentId = null;
	if (socket) {
		socket.onclose = null;
		socket.close();
		socket = null;
	}
	mesh = null;
	nameEl.textContent = "No camera";
	metaEl.textContent = "NO SIGNAL";
	if (coordsEl) coordsEl.textContent = "";
	if (channelEl) channelEl.textContent = "CAM --";
	if (nametagsEl) nametagsEl.innerHTML = "";
	setLive(false);
	setStatus("No cameras placed", "empty");
}

function connect(cam) {
	currentId = cam.id;
	highlightCam(cam.id);
	applyCamHud(cam);
	metaEl.textContent = "CONNECTING";
	setLive(false);
	hasAtlas = 0;
	mesh = null;
	pendingMesh = null;
	pendingPatches = [];
	atlasLoading = false;
	atlasPixels = null;
	tileKind = null;
	terrainUploaded = -1;
	skyCache = null;
	skyCacheKey = "";
	skyBufKey = "";
	breaking = [];
	particles = [];
	for (const id of [...poses.keys()]) {
		if (id.startsWith("chest:")) poses.delete(id);
	}
	chestGeom.clear();
	if (socket) socket.close();
	const proto = location.protocol === "https:" ? "wss" : "ws";
	socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&camera=${cam.id}`);
	socket.binaryType = "arraybuffer";
	socket.onopen = () => { setStatus("Live", "live"); };
	socket.onclose = () => {
		if (currentId === cam.id) {
			setStatus("Disconnected", "off");
			metaEl.textContent = "NO SIGNAL";
			setLive(false);
		}
	};
	socket.onmessage = ev => {
		if (typeof ev.data === "string") {
			const msg = JSON.parse(ev.data);
			if (msg.type === "hello") {
				eye = { x: msg.eyeX, y: msg.eyeY, z: msg.eyeZ, yaw: msg.yaw, pitch: msg.pitch };
				loaded = !!msg.loaded;
				nameEl.textContent = msg.name;
				metaEl.textContent = loaded ? "LIVE" : "NO CHUNKS";
				setLive(!!loaded);
				applySky(msg);
			} else if (msg.type === "entities") {
				players = msg.players || [];
				mobs = msg.mobs || [];
				items = msg.items || [];
				breaking = msg.breaking || [];
				ingestEntities(players, "player");
				ingestEntities(mobs, "mob");
				ingestEntities(items, "item");
				ingestEntities(msg.tnt || [], "tnt");
				ingestEntities(msg.frames || [], "frame");
				ingestEntities(msg.signs || [], "sign");
				ingestEntities(msg.chests || [], "chest");
				applySky(msg);
			} else if (msg.type === "burst") {
				spawnBurst(msg);
			} else if (msg.type === "removed") {
				loadCameras();
			} else if (msg.type === "status") {
				metaEl.textContent = msg.status;
			}
			return;
		}
		const bytes = new Uint8Array(ev.data);
		if (bytes[0] === 1) {
			const copy = new Uint8Array(bytes.subarray(1));
			if (atlasLoading) pendingMesh = copy;
			else parseMesh(copy);
		}
		if (bytes[0] === 3) {
			const copy = new Uint8Array(bytes.subarray(1));
			if (!mesh || atlasLoading || pendingMesh) pendingPatches.push(copy);
			else parsePatch(copy);
		}
		if (bytes[0] === 2) {
			atlasLoading = true;
			const blob = new Blob([bytes.subarray(1)], { type: "image/png" });
			createImageBitmap(blob).then(img => {
				gl.bindTexture(gl.TEXTURE_2D, atlasTex);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
				captureAtlasPixels(img);
				hasAtlas = 1;
				atlasLoading = false;
				if (pendingMesh) {
					const data = pendingMesh;
					pendingMesh = null;
					parseMesh(data);
				} else if (mesh) {
					refreshTerrain();
				}
			}).catch(() => { atlasLoading = false; });
		}
	};
}

loadCameras();
