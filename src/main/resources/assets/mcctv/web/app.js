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
let lastFrame = performance.now();

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
	if (uAlphaPass > 0.5 && tex.a < 0.1) discard;
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
function entityKey(e) {
	return e.uuid || e.name || "?";
}
function poseOf(e) {
	return {
		x: e.x, y: e.y, z: e.z,
		yaw: e.yaw || 0,
		pitch: e.pitch || 0,
		bodyYaw: e.bodyYaw != null ? e.bodyYaw : (e.yaw || 0)
	};
}
function ingestEntities(list, kind) {
	const now = performance.now();
	const seen = new Set();
	for (const e of list) {
		const id = kind + ":" + entityKey(e);
		seen.add(id);
		const prev = poses.get(id);
		const to = poseOf(e);
		const from = prev ? { x: prev.x, y: prev.y, z: prev.z, yaw: prev.yaw, pitch: prev.pitch, bodyYaw: prev.bodyYaw } : to;
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
			yaw: from.yaw, pitch: from.pitch, bodyYaw: from.bodyYaw,
			playingSwing: startSwing ? true : (prev ? prev.playingSwing : false),
			localSwing: startSwing ? 0 : (prev ? prev.localSwing : 0)
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
	for (const st of poses.values()) {
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
		if (st.playingSwing) {
			st.localSwing += dt / 0.3;
			if (st.localSwing >= 1) {
				st.localSwing = 0;
				st.playingSwing = false;
			}
		} else {
			st.localSwing = 0;
		}
		if (st.kind === "player") playersOut.push(st);
		else if (st.kind === "mob") mobsOut.push(st);
		else if (st.kind === "tnt") tntOut.push(st);
		else if (st.kind === "frame") framesOut.push(st);
		else if (st.kind === "sign") signsOut.push(st);
	}
	return { players: playersOut, mobs: mobsOut, tnt: tntOut, frames: framesOut, signs: signsOut };
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
	if (pendingPatches.length) {
		const queued = pendingPatches;
		pendingPatches = [];
		for (const patch of queued) parsePatch(patch);
	} else {
		refreshTerrain();
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
		if (mid > 4) kinds[t] = 2;
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
function toWorld(x, y, z, yawDeg, px, py, pz) {
	const yaw = yawDeg * Math.PI / 180;
	return [
		px + (-Math.cos(yaw) * x - Math.sin(yaw) * z),
		py + y,
		pz + (-Math.sin(yaw) * x + Math.cos(yaw) * z)
	];
}

function pushBox(out, px, py, pz, bodyYaw, pivot, rx, ry, x0, y0, z0, x1, y1, z1, u, v, w, h, d, inflate, shade, tw, th, parentPivot, parentRx) {
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
		q = [q[0] + ox, q[1] + oy, q[2] + oz];
		if (pre) {
			q = rotX(q[0] - hip[0], q[1] - hip[1], q[2] - hip[2], pre);
			q = [q[0] + hip[0], q[1] + hip[1], q[2] + hip[2]];
		}
		return toWorld(q[0], q[1], q[2], bodyYaw, px, py, pz);
	});
	tw = tw || 64;
	th = th || 64;
	const faceUV = (fu, fv, fw, fh) => {
		const u0 = fu / tw, v0 = fv / th, u1 = (fu + fw) / tw, v1 = (fv + fh) / th;
		return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
	};
	const faces = [
		{ idx: [0, 1, 2, 3], uv: faceUV(u + d, v + d, w, h), s: 0.9 },
		{ idx: [4, 5, 6, 7], uv: faceUV(u + d + w + d, v + d, w, h), s: 0.7 },
		{ idx: [5, 0, 3, 6], uv: faceUV(u + d + w, v + d, d, h), s: 0.65 },
		{ idx: [1, 4, 7, 2], uv: faceUV(u, v + d, d, h), s: 0.8 },
		{ idx: [3, 2, 7, 6], uv: faceUV(u + d, v, w, d), s: 1.0 },
		{ idx: [5, 4, 1, 0], uv: faceUV(u + d + w, v, w, d), s: 0.5 }
	];
	const order = [0, 1, 2, 0, 2, 3];
	const light = sceneLight();
	for (const f of faces) {
		for (const i of order) {
			const p = corners[f.idx[i]];
			const uv = f.uv[i];
			const s = f.s * shade * light;
			out.push(p[0], p[1], p[2], uv[0], uv[1], s, s, s, 0);
		}
	}
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
	const aw = slim ? 3 * P : 4 * P;
	const sneak = p.sneaking || p.pose === "crouching";
	const limb = p.limb || 0;
	const amt = p.amt || 0;
	const swing = Math.cos(limb * 0.6662) * amt;
	const armSwing = swing;
	const legSwing = swing * 1.4;
	const bodyYaw = p.bodyYaw != null ? p.bodyYaw : p.yaw;
	const headYaw = ((p.yaw - bodyYaw) * Math.PI) / 180;
	const headPitch = ((p.pitch || 0) * Math.PI) / 180;
	const bodyPitch = sneak ? 0.5 : (p.pose === "swimming" || p.pose === "fall_flying" ? 1.4 : 0);
	const armExtra = sneak ? 0.4 : 0;
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
	const heldCubes = [];
	const heldSprites = new Map();
	for (const p of sampled.players) {
		const rec = ensureSkin(p);
		const pose = Object.assign({}, p, { slim: rec.slim });
		const data = [];
		playerMesh(data, pose);
		draw(new Float32Array(data), data.length / 9, 1, rec.ready ? 1 : 0, rec.tex);
		const armor = p.armor || {};
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
			armorSlot(ad, pose, slot, arec);
			if (ad.length) {
				gl.enable(gl.POLYGON_OFFSET_FILL);
				gl.polygonOffset(-1.5, -1.5);
				draw(new Float32Array(ad), ad.length / 9, 1, 1, arec.tex);
				gl.disable(gl.POLYGON_OFFSET_FILL);
			}
		}
		const mainLeft = !!p.leftMain;
		appendHeld(heldCubes, heldSprites, pose, p.mainHand, mainLeft);
		appendHeld(heldCubes, heldSprites, pose, p.offHand, !mainLeft);
	}
	const mobData = [];
	for (const m of sampled.mobs) {
		drawBox(mobData, m.x - 0.25, m.y, m.z - 0.25, 0.5, 1.4, 0.5, 0.85, 0.4, 0.25);
	}
	if (mobData.length) draw(new Float32Array(mobData), mobData.length / 9, 1, 0, atlasTex);
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
