// Loads the SF3D textured mesh, aligns it to the canonical Hunyuan frame (x fwd, y up, z right; ground at y=0)
// and returns a function giving the SF3D surface colour (sRGB 0..1) nearest to a canonical point.
import { NodeIO } from '@gltf-transform/core';
import jpeg from 'jpeg-js';

function eig3(m) { // Jacobi for symmetric 3x3 → {vals, vecs(columns)}
  const a = m.map((r) => r.slice()); const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1; for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [0, 1, 2].map((j) => [v[0][j], v[1][j], v[2][j]]) };
}

export async function loadSF3D(path, target) {
  const doc = await new NodeIO().read(path);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pa = prim.getAttribute('POSITION'), ua = prim.getAttribute('TEXCOORD_0');
  const n = pa.getCount();
  const P = new Float32Array(n * 3), UV = new Float32Array(n * 2), t = [0, 0, 0], u = [0, 0];
  for (let i = 0; i < n; i++) { pa.getElement(i, t); P.set(t, i * 3); ua.getElement(i, u); UV.set(u, i * 2); }
  const tex = prim.getMaterial().getBaseColorTexture();
  const img = jpeg.decode(tex.getImage(), { useTArray: true });

  // PCA
  const c = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k] / n;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) { const d = [P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b] / n; }
  const { vals, vecs } = eig3(cov);
  const ord = [0, 1, 2].sort((a, b) => vals[b] - vals[a]);
  let L = vecs[ord[0]], Wd = vecs[ord[1]], U = vecs[ord[2]];
  if (U[1] < 0) U = U.map((x) => -x);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const proj = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const d = [P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]]; proj[i * 3] = dot(d, L); proj[i * 3 + 1] = dot(d, U); proj[i * 3 + 2] = dot(d, Wd); }
  // front/rear by spoiler: top points lie toward the rear
  let ymax = -1e9; for (let i = 0; i < n; i++) ymax = Math.max(ymax, proj[i * 3 + 1]);
  let sx = 0, cnt = 0; for (let i = 0; i < n; i++) if (proj[i * 3 + 1] > ymax - 0.04) { sx += proj[i * 3]; cnt++; }
  const flip = sx / cnt > 0; // rear must be -x
  for (let i = 0; i < n; i++) if (flip) { proj[i * 3] *= -1; proj[i * 3 + 2] *= -1; }
  // right-handedness: (x fwd, y up, z right) requires z = x × y ... keep sign so that frame is proper
  const cr = [L[1] * U[2] - L[2] * U[1], L[2] * U[0] - L[0] * U[2], L[0] * U[1] - L[1] * U[0]];
  if (dot(cr, Wd) < 0 !== flip) { /* mirrored frame — irrelevant for a symmetric car */ }
  // fit bbox to target bbox (non-uniform)
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], proj[i * 3 + k]); mx[k] = Math.max(mx[k], proj[i * 3 + k]); }
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const t01 = (proj[i * 3 + k] - mn[k]) / (mx[k] - mn[k]);
    proj[i * 3 + k] = target.mn[k] + t01 * (target.mx[k] - target.mn[k]);
  }
  console.log('SF3D pca vals', vals.map((v) => v.toFixed(4)), 'flip', flip);
  // spatial hash
  const cell = 0.03, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i++) { const k = key(proj[i * 3], proj[i * 3 + 1], proj[i * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  const texel = (uu, vv) => {
    const x = Math.min(img.width - 1, Math.max(0, Math.round(uu * (img.width - 1)))), y = Math.min(img.height - 1, Math.max(0, Math.round(vv * (img.height - 1))));
    const o = (y * img.width + x) * 4; return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
  };
  return (x, y, z) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bd = 1e9;
    for (let r = 1; r <= 3 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const arr = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!arr) continue;
      for (const i of arr) { const d = (proj[i * 3] - x) ** 2 + (proj[i * 3 + 1] - y) ** 2 + (proj[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return null;
    return texel(UV[best * 2], UV[best * 2 + 1]);
  };
}
