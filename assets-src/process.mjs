import { NodeIO, Document } from '@gltf-transform/core';
import { weld, simplify, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { loadSF3D } from './sf3dcolor.mjs';

const ROOT = 'C:/Users/danir/Desktop/overboost/';
const SRC = ROOT + 'assets-src/';
const RATIO = parseFloat(process.env.RATIO || '0.16');

const doc = await new NodeIO().read('shape0.glb');
await MeshoptSimplifier.ready;
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.0008 }), dedup(), prune());
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const posA = prim.getAttribute('POSITION');
const N = posA.getCount();
const P = new Float32Array(N * 3);
const tmpv = [0, 0, 0];
for (let i = 0; i < N; i++) { posA.getElement(i, tmpv); P.set(tmpv, i * 3); }
let I = Uint32Array.from(prim.getIndices().getArray());
console.log('after simplify verts', N, 'tris', I.length / 3);

const bb = () => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  return { mn, mx };
};
let { mn, mx } = bb();
const H0 = mx[1] - mn[1];
let sx = 0, cnt = 0;
for (let i = 0; i < P.length; i += 3) if (P[i + 1] > mx[1] - H0 * 0.06) { sx += P[i]; cnt++; }
const rearSign = Math.sign(sx / cnt);
console.log('top mean x', (sx / cnt).toFixed(3), 'rear at', rearSign > 0 ? '+x' : '-x');
const LEN = 1.32, s = LEN / (mx[0] - mn[0]);
const cx = (mx[0] + mn[0]) / 2, cz = (mx[2] + mn[2]) / 2;
for (let i = 0; i < P.length; i += 3) {
  let x = (P[i] - cx) * s, y = (P[i + 1] - mn[1]) * s, z = (P[i + 2] - cz) * s;
  if (rearSign > 0) { x = -x; z = -z; }
  P[i] = x; P[i + 1] = y; P[i + 2] = z;
}
({ mn, mx } = bb());
console.log('dims L/H/W', (mx[0] - mn[0]).toFixed(3), (mx[1] - mn[1]).toFixed(3), (mx[2] - mn[2]).toFixed(3));

// wheels from the contact patches
const low = [];
for (let i = 0; i < P.length; i += 3) if (P[i + 1] < 0.02) low.push([P[i], P[i + 2]]);
const fr = low.filter((p) => p[0] > 0), re = low.filter((p) => p[0] < 0);
const mean = (a, k) => a.reduce((t, p) => t + p[k], 0) / a.length;
const wf = mean(fr, 0), wr = mean(re, 0);
const absz = low.map((p) => Math.abs(p[1])).sort((a, b) => a - b);
const zin = absz[Math.floor(absz.length * 0.03)], zout = absz[Math.floor(absz.length * 0.97)];
const r = 0.0975 * LEN;
console.log('wheels x', wf.toFixed(3), wr.toFixed(3), 'z', zin.toFixed(3), zout.toFixed(3), 'r', r.toFixed(3), 'lowpts', low.length);

const load = (f) => PNG.sync.read(fs.readFileSync(SRC + f));
function bbox(img) {
  const bg = [img.data[0], img.data[1], img.data[2]];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const o = (y * img.width + x) * 4;
    const d = Math.abs(img.data[o] - bg[0]) + Math.abs(img.data[o + 1] - bg[1]) + Math.abs(img.data[o + 2] - bg[2]);
    if (d > 70) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1 };
}
const side = load('side.png'), front = load('front.png'), rear = load('rear.png');
const bS = { x0: 17, y0: 18, x1: 530, y1: 229 }, bF = { x0: 25, y0: 15, x1: 305, y1: 237 }, bR = { x0: 20, y0: 17, x1: 302, y1: 238 }; void bbox;
console.log('bbox side', bS, 'front', bF, 'rear', bR);
const isBg = (img, x, y) => {
  const o = (y * img.width + x) * 4, b = (2 * img.width + 2) * 4;
  return Math.abs(img.data[o] - img.data[b]) + Math.abs(img.data[o + 1] - img.data[b + 1]) + Math.abs(img.data[o + 2] - img.data[b + 2]) < 22;
};
const sample = (img, px, py) => {
  let x = Math.max(0, Math.min(img.width - 1, Math.round(px))), y = Math.max(0, Math.min(img.height - 1, Math.round(py)));
  if (isBg(img, x, y)) {
    // nearest non-background pixel (silhouette mismatch at thin parts like the spoiler)
    let best = null, bd = 1e9;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      const d = dx * dx + dy * dy;
      if (d < bd && !isBg(img, xx, yy)) { bd = d; best = [xx, yy]; }
    }
    if (best) [x, y] = best;
  }
  const o = (y * img.width + x) * 4;
  return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
};
const L0 = mn[0], L1 = mx[0], Hh = mx[1], Z0 = mn[2], Z1 = mx[2];
const sSide = (x, y) => sample(side, bS.x0 + ((L1 - x) / (L1 - L0)) * (bS.x1 - bS.x0), bS.y1 - (y / Hh) * (bS.y1 - bS.y0));
const sFront = (z, y) => sample(front, bF.x0 + ((Z1 - z) / (Z1 - Z0)) * (bF.x1 - bF.x0), bF.y1 - (y / Hh) * (bF.y1 - bF.y0));
const sRear = (z, y) => sample(rear, bR.x0 + ((z - Z0) / (Z1 - Z0)) * (bR.x1 - bR.x0), bR.y1 - (y / Hh) * (bR.y1 - bR.y0));

const inWheel = (x, y, z) => {
  for (const wx of [wf, wr]) if (Math.hypot(x - wx, y - r) < r * 1.06 && Math.abs(z) > zin - 0.012) return true;
  return false;
};
const keep = [];
for (let t = 0; t < I.length; t += 3) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
  const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
  if (!inWheel(x, y, z)) keep.push(I[t], I[t + 1], I[t + 2]);
}
console.log('removed wheel tris', (I.length - keep.length) / 3);
I = Uint32Array.from(keep);

const Nn = new Float32Array(P.length);
for (let t = 0; t < I.length; t += 3) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const k of [a, b, c]) { Nn[k] += nx; Nn[k + 1] += ny; Nn[k + 2] += nz; }
}
for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1; Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; }
let dots = 0;
for (let i = 0; i < P.length; i += 3) dots += Nn[i] * P[i] + Nn[i + 1] * (P[i + 1] - Hh / 2) + Nn[i + 2] * P[i + 2];
if (dots < 0) {
  for (let i = 0; i < Nn.length; i++) Nn[i] = -Nn[i];
  for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  console.log('flipped normals');
}

const C = new Float32Array(P.length);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// --- classify into the reference's flat palette, then smooth labels over the mesh
const WHITE = 0, BLACK = 1, GLASS = 2, RED = 3, BLUE = 4, CHROME = 5;
const PAL = { [WHITE]: [0.86, 0.87, 0.89], [BLACK]: [0.035, 0.037, 0.042], [GLASS]: [0.05, 0.055, 0.07], [RED]: [0.55, 0.04, 0.05], [BLUE]: [0.1, 0.2, 0.75], [CHROME]: [0.55, 0.57, 0.6] };
const classify = (c) => {
  const lum = (c[0] + c[1] + c[2]) / 3;
  if (c[0] > c[1] + 0.18 && c[0] > c[2] + 0.12) return RED;
  if (c[2] > c[0] + 0.12 && c[2] > 0.3) return BLUE;
  if (lum < 0.3) return BLACK;
  if (lum < 0.5) return CHROME; // mid grey: lamps, fog lights, exhaust (filtered by zone below)
  return WHITE;
};
const nV = P.length / 3;
const MODE = process.env.MODE || "views";
const sf = MODE !== "views" ? await loadSF3D("sf3d.glb", { mn, mx }) : null;
let label = new Uint8Array(nV);
for (let v = 0; v < nV; v++) {
  const i = v * 3, x = P[i], y = P[i + 1], z = P[i + 2], nx = Nn[i], ny = Nn[i + 1], nz = Nn[i + 2];
  const wS = nz * nz + 0.5 * ny * ny, wF = Math.max(0, nx) ** 2, wR = Math.max(0, -nx) ** 2;
  const col = wF >= wS && wF >= wR ? sFront(z, y) : wR >= wS ? sRear(z, y) : sSide(x, y);
  let L = classify(col);
  if (sf && (MODE === "sf3d" || ny > 0.6)) { const c2 = sf(x, y, z); if (c2) L = classify(c2); }
  if (L === BLACK && y > 0.33 && y < Hh * 0.93 && x > -0.6 && x < 0.32) L = GLASS; // greenhouse band
  if (y > Hh * 0.9 && x < -0.42) L = BLACK; // roof spoiler
  for (const wx of [wf, wr]) { const d = Math.hypot(x - wx, y - r); if (d > r * 1.02 && d < r * 1.34 && y > r * 0.35 && Math.abs(z) > 0.29) L = BLACK; } // fender flares
  if (L === CHROME && !(Math.abs(x) > 0.55 && y < 0.3)) L = WHITE; // chrome only on bumpers/lamps
  if (x < -0.44 && y > 0.33 && y < Hh * 0.88 && Math.abs(z) < 0.29 && nx < -0.2) L = GLASS; // rear hatch glass
  if (x > 0.08 && x < 0.34 && y > 0.37 && Math.abs(z) < 0.3 && ny > 0.35 && L !== WHITE) L = GLASS; // windscreen
  for (const wx of [wf, wr]) if (Math.hypot(x - wx, y - r) < r * 1.15 && Math.abs(z) < zin) L = BLACK; // wheel wells
  label[v] = L;
}
// adjacency + majority smoothing
const adj = Array.from({ length: nV }, () => []);
for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b); }
for (let it = 0; it < 14; it++) {
  const nl = new Uint8Array(label);
  const cnt = new Uint16Array(6);
  for (let v = 0; v < nV; v++) {
    cnt.fill(0); cnt[label[v]] += 2;
    for (const u of adj[v]) cnt[label[u]]++;
    let best = label[v]; for (let k = 0; k < 6; k++) if (cnt[k] > cnt[best]) best = k;
    nl[v] = best;
  }
  label = nl;
}
for (let v = 0; v < nV; v++) { const c = PAL[label[v]]; const i = v * 3; C[i] = lin(c[0]); C[i + 1] = lin(c[1]); C[i + 2] = lin(c[2]); }
const counts = [0, 0, 0, 0, 0, 0]; label.forEach((l) => counts[l]++); console.log('labels W/B/G/R/Bl/Ch', counts.join(' '));

const out = new Document();
const buf = out.createBuffer();
const acc = (arr, type) => out.createAccessor().setArray(arr).setType(type).setBuffer(buf);
const mat = out.createMaterial('hatch').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.42).setMetallicFactor(0.05);
const pr = out.createPrimitive().setAttribute('POSITION', acc(P, 'VEC3')).setAttribute('NORMAL', acc(Nn, 'VEC3'))
  .setAttribute('COLOR_0', acc(C, 'VEC3')).setIndices(acc(I, 'SCALAR')).setMaterial(mat);
const node = out.createNode('HatchR').setMesh(out.createMesh('HatchR').addPrimitive(pr));
out.createScene().addChild(node);
await new NodeIO().write(ROOT + 'public/models/hatch-r.glb', out);
const meta = { wheels: { front: wf, rear: wr, zin, zout, r }, dims: { L: L1 - L0, H: Hh, W: Z1 - Z0, minZ: Z0, maxZ: Z1 } };
fs.writeFileSync(ROOT + 'public/models/hatch-r.json', JSON.stringify(meta, null, 1));
console.log('written', JSON.stringify(meta));
