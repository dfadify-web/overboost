import * as THREE from 'three';
import { ARENA } from '../core/config';

export interface PerimPoint { x: number; z: number; nx: number; nz: number; s: number; end: boolean }
export interface ProfPoint { off: number; y: number; nn: number; ny: number }

const { W, L, H, cornerR: RC, curveR: RF, goalW, goalH, bandTop } = ARENA;
const hx = W / 2, hz = L / 2, a = hx - RC, b = hz - RC;

function straight(out: PerimPoint[], x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, end: boolean, breaks: number[]) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ts = new Set<number>([0]);
  const steps = Math.ceil(len / 2.5);
  for (let i = 1; i < steps; i++) ts.add(i / steps);
  for (const bx of breaks) { const t = (bx - x0) / (x1 - x0); if (t > 0 && t < 1) ts.add(t); }
  [...ts].sort((p, q) => p - q).forEach((t) => out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz, s: 0, end }));
}
function arc(out: PerimPoint[], cx: number, cz: number, a0: number, a1: number) {
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: cx + RC * Math.cos(t), z: cz + RC * Math.sin(t), nx: Math.cos(t), nz: Math.sin(t), s: 0, end: false });
  }
}

/** Closed loop around the arena (last point not duplicated). */
export function perimeter(): PerimPoint[] {
  const p: PerimPoint[] = [];
  const g = goalW / 2;
  straight(p, -a, hz, a, hz, 0, 1, true, [-g, g]);
  arc(p, a, b, Math.PI / 2, 0);
  straight(p, hx, b, hx, -b, 1, 0, false, []);
  arc(p, a, -b, 0, -Math.PI / 2);
  straight(p, a, -hz, -a, -hz, 0, -1, true, [g, -g]);
  arc(p, -a, -b, -Math.PI / 2, -Math.PI);
  straight(p, -hx, -b, -hx, b, -1, 0, false, []);
  arc(p, -a, b, Math.PI, Math.PI / 2);
  let s = 0;
  for (let i = 0; i < p.length; i++) { if (i > 0) s += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); p[i].s = s; }
  return p;
}

/** Wall cross-section from floor edge up to ceiling edge. */
export function profile(): ProfPoint[] {
  const pts: ProfPoint[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) { const f = (i / n) * Math.PI / 2; pts.push({ off: RF * (1 - Math.sin(f)), y: RF * (1 - Math.cos(f)), nn: Math.sin(f), ny: Math.cos(f) }); }
  const ys = [bandTop, goalH, 9, 12.5, H - RF].sort((p, q) => p - q);
  for (const y of ys) pts.push({ off: 0, y, nn: 1, ny: 0 });
  for (let i = 1; i <= n; i++) { const f = (i / n) * Math.PI / 2; pts.push({ off: RF * (1 - Math.cos(f)), y: H - RF + RF * Math.sin(f), nn: Math.cos(f), ny: -Math.sin(f) }); }
  return pts;
}

export interface ShellParts {
  lower: THREE.BufferGeometry;
  upper: THREE.BufferGeometry;
  top: THREE.BufferGeometry;
  floor: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  collision: { vertices: Float32Array; indices: Uint32Array };
  perim: PerimPoint[];
}

export function buildShell(): ShellParts {
  const perim = perimeter();
  const prof = profile();
  const total = perim[perim.length - 1].s + Math.hypot(perim[0].x - perim[perim.length - 1].x, perim[0].z - perim[perim.length - 1].z);
  const N = perim.length;

  const regions = { lower: new Builder(), upper: new Builder(), top: new Builder() };
  const col = new Builder();

  const vert = (pi: number, qi: number) => {
    const P = perim[pi % N], Q = prof[qi];
    return new THREE.Vector3(P.x - P.nx * Q.off, Q.y, P.z - P.nz * Q.off);
  };
  const nrm = (pi: number, qi: number) => {
    const P = perim[pi % N], Q = prof[qi];
    return new THREE.Vector3(-P.nx * Q.nn, Q.ny, -P.nz * Q.nn).normalize();
  };

  for (let i = 0; i < N; i++) {
    const i1 = i + 1;
    const P0 = perim[i], P1 = perim[i1 % N];
    const s0 = P0.s, s1 = i1 === N ? total : P1.s;
    for (let j = 0; j < prof.length - 1; j++) {
      const yMid = (prof[j].y + prof[j + 1].y) / 2;
      const xMid = (P0.x + P1.x) / 2;
      if (P0.end && P1.end && Math.abs(xMid) < goalW / 2 && yMid < goalH) continue; // goal mouth
      const v00 = vert(i, j), v10 = vert(i1, j), v01 = vert(i, j + 1), v11 = vert(i1, j + 1);
      const region = yMid < bandTop ? regions.lower : yMid < H - RF ? regions.upper : regions.top;
      const vScale = region === regions.lower ? bandTop : 6;
      region.quad(v00, v10, v11, v01, [s0 / 4, prof[j].y / vScale], [s1 / 4, prof[j].y / vScale], [s1 / 4, prof[j + 1].y / vScale], [s0 / 4, prof[j + 1].y / vScale]);
      region.nrm.push(...nrm(i, j).toArray(), ...nrm(i1, j).toArray(), ...nrm(i1, j + 1).toArray(), ...nrm(i, j + 1).toArray());
      col.quad(v00, v10, v11, v01);
    }
  }

  // Floor & ceiling: fan triangulation over the inner ring.
  const fan = (y: number, qi: number, flip: boolean) => {
    const bld = new Builder();
    const c = new THREE.Vector3(0, y, 0);
    for (let i = 0; i < N; i++) {
      const p0 = vert(i, qi), p1 = vert(i + 1, qi);
      const uv = (v: THREE.Vector3): [number, number] => [(v.x + hx) / W, (v.z + hz) / L];
      if (flip) bld.tri(c, p1, p0, uv(c), uv(p1), uv(p0)); else bld.tri(c, p0, p1, uv(c), uv(p0), uv(p1));
      if (flip) col.tri(c, p1, p0); else col.tri(c, p0, p1);
    }
    return bld;
  };
  const floor = fan(0, 0, false);
  const ceiling = fan(H, prof.length - 1, true);

  // Goal floor extensions
  for (const sgn of [1, -1]) {
    const z0 = sgn * (hz - RF), z1 = sgn * (hz + ARENA.goalD);
    const g = goalW / 2;
    col.quad(new THREE.Vector3(-g, 0, z0), new THREE.Vector3(g, 0, z0), new THREE.Vector3(g, 0, z1), new THREE.Vector3(-g, 0, z1));
  }

  return {
    lower: regions.lower.geometry(), upper: regions.upper.geometry(), top: regions.top.geometry(),
    floor: floor.geometry(), ceiling: ceiling.geometry(), collision: col.raw(), perim,
  };
}

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number] = [0, 0], ub: [number, number] = [0, 0], uc: [number, number] = [0, 0]) {
    const base = this.pos.length / 3;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.uv.push(...ua, ...ub, ...uc);
    this.idx.push(base, base + 1, base + 2);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number] = [0, 0], ub: [number, number] = [0, 0], uc: [number, number] = [0, 0], ud: [number, number] = [0, 0]) {
    const base = this.pos.length / 3;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    this.uv.push(...ua, ...ub, ...uc, ...ud);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (this.nrm.length === this.pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    else g.computeVertexNormals();
    return g;
  }
  /** Collision data: welded vertices, every triangle oriented toward the arena interior. */
  raw() {
    const map = new Map<string, number>();
    const verts: number[] = [];
    const remap: number[] = [];
    for (let i = 0; i < this.pos.length / 3; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
      let id = map.get(k);
      if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(k, id); }
      remap.push(id);
    }
    const out: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), ctr = new THREE.Vector3();
    const C = new THREE.Vector3(0, ARENA.H / 2, 0);
    for (let t = 0; t < this.idx.length; t += 3) {
      const i0 = remap[this.idx[t]], i1 = remap[this.idx[t + 1]], i2 = remap[this.idx[t + 2]];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      a.fromArray(verts, i0 * 3); b.fromArray(verts, i1 * 3); c.fromArray(verts, i2 * 3);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      ctr.copy(a).add(b).add(c).divideScalar(3);
      if (n.dot(C.clone().sub(ctr)) < 0) out.push(i0, i2, i1); else out.push(i0, i1, i2);
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(out) };
  }
}
