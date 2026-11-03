import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface WheelSpec { x: number; z: number; r: number; w: number; front: boolean }
export interface CarSpec {
  id: 0 | 1;
  name: string;
  model: string;
  tagline: string;
  half: [number, number, number]; // hitbox half extents (x fwd, y up, z right)
  attachY: number;
  suspRest: number;
  wheels: WheelSpec[];
  exhausts: [number, number, number][];
  stats: { speed: number; accel: number; handling: number; aerial: number; weight: number };
  turnMul: number;
  airMul: number;
  accent: number;
}

export const CAR_SPECS: CarSpec[] = [
  {
    id: 0, name: 'Car 1', model: 'HATCH-R', tagline: 'Hatchback de rally: alto, cuadrado y muy versátil. Domina suelo, pared y aire.',
    half: [0.63, 0.17, 0.37], attachY: -0.08, suspRest: 0.12,
    wheels: [
      { x: 0.41, z: -0.312, r: 0.129, w: 0.14, front: true }, { x: 0.41, z: 0.312, r: 0.129, w: 0.14, front: true },
      { x: -0.391, z: -0.312, r: 0.129, w: 0.14, front: false }, { x: -0.391, z: 0.312, r: 0.129, w: 0.14, front: false },
    ],
    exhausts: [[-0.7, -0.18, -0.12], [-0.7, -0.18, 0.12]],
    stats: { speed: 8, accel: 8, handling: 8, aerial: 8, weight: 7 },
    turnMul: 1.03, airMul: 1.04, accent: 0x111216,
  },
  {
    id: 1, name: 'Car 2', model: 'MAKO', tagline: 'Cuña larga y plana. Pegada a la pista, golpes demoledores.',
    half: [0.66, 0.15, 0.43], attachY: -0.04, suspRest: 0.12,
    wheels: [
      { x: 0.45, z: -0.41, r: 0.16, w: 0.15, front: true }, { x: 0.45, z: 0.41, r: 0.16, w: 0.15, front: true },
      { x: -0.43, z: -0.41, r: 0.185, w: 0.19, front: false }, { x: -0.43, z: 0.41, r: 0.185, w: 0.19, front: false },
    ],
    exhausts: [[-0.7, 0.04, 0]],
    stats: { speed: 9, accel: 7, handling: 7, aerial: 7, weight: 9 },
    turnMul: 0.97, airMul: 0.95, accent: 0xf2f2f2,
  },
];

export interface CarModel {
  group: THREE.Group;
  wheels: { spec: WheelSpec; mount: THREE.Group; steer: THREE.Group; spin: THREE.Group }[];
  paint: THREE.MeshPhysicalMaterial;
  brakeLights: THREE.MeshBasicMaterial;
  exhausts: THREE.Vector3[];
  setPaint: (hex: number) => void;
}

// ---------- shared materials ----------
let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1420, metalness: 0.9, roughness: 0.06, clearcoat: 1 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.4, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 1, roughness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.2, roughness: 0.8 });
  const headlight = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); headlight.color.setScalar(2);
  const lampBlue = new THREE.MeshBasicMaterial({ color: 0x7fdfff, toneMapped: false }); lampBlue.color.multiplyScalar(3);
  const tire = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.92, metalness: 0, map: treadTexture() });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 1, roughness: 0.22 });
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.9, roughness: 0.3 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x6b6f75, metalness: 0.9, roughness: 0.5 });
  const nozzle = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 1, roughness: 0.3, emissive: 0xff5a10, emissiveIntensity: 0.4 });
  return { glass, carbon, chrome, dark, headlight, lampBlue, tire, rim, rimDark, disc, nozzle };
}

function treadTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2b2f'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#111214';
  for (let i = 0; i < 16; i++) { g.save(); g.translate(i * 16 + 8, 32); g.rotate(0.5); g.fillRect(-2, -26, 4, 22); g.rotate(-1.0); g.fillRect(-2, 4, 4, 22); g.restore(); }
  g.fillRect(0, 30, 256, 4);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function extrudeProfile(pts: [number, number][], width: number, bevel = 0.03, curveSegs = 3) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: curveSegs, curveSegments: 12 });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  return geo;
}

function smoothProfile(pts: [number, number][], segments = 60): [number, number][] {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal', 0.5);
  return curve.getPoints(segments).slice(0, -1).map((p) => [p.x, p.y]);
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true;
  parent?.add(m);
  return m;
}

function makeWheel(spec: WheelSpec, style: 'blade' | 'mesh' | 'gold', accent: THREE.Material) {
  if (style === 'gold') return makeGoldWheel(spec, accent);
  const S = shared!;
  const spin = new THREE.Group();
  const r = spec.r, w = spec.w;
  // Tire: lathe of a rounded-rect cross section around Y, then rotate so axle = Z
  const prof: THREE.Vector2[] = [];
  const inner = r * 0.62, rr = Math.min(0.045, w * 0.3);
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (Math.PI / 2); prof.push(new THREE.Vector2(cx + rr * Math.cos(a), cy + rr * Math.sin(a))); } };
  prof.push(new THREE.Vector2(inner, -w / 2));
  corner(r - rr, -w / 2 + rr, -Math.PI / 2);
  corner(r - rr, w / 2 - rr, 0);
  prof.push(new THREE.Vector2(inner, w / 2));
  const tireGeo = new THREE.LatheGeometry(prof, 40);
  tireGeo.rotateX(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, S.tire); tire.castShadow = true; spin.add(tire);

  // Rim: disc with spoke cut-outs
  const rimR = inner * 1.02;
  const sh = new THREE.Shape(); sh.absarc(0, 0, rimR, 0, Math.PI * 2, false);
  const holes = style === 'blade' ? 5 : 8;
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2;
    const hole = new THREE.Path();
    const r0 = rimR * 0.32, r1 = rimR * 0.84, span = style === 'blade' ? 0.75 : 0.42;
    const twist = style === 'blade' ? 0.35 : 0;
    hole.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    hole.lineTo(Math.cos(a + twist) * r1, Math.sin(a + twist) * r1);
    hole.absarc(0, 0, r1, a + twist, a + twist + span * (Math.PI * 2 / holes), false);
    hole.lineTo(Math.cos(a + span * (Math.PI * 2 / holes)) * r0, Math.sin(a + span * (Math.PI * 2 / holes)) * r0);
    sh.holes.push(hole);
  }
  const rimGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1, curveSegments: 24 });
  const rim = new THREE.Mesh(rimGeo, style === 'blade' ? S.rim : S.rimDark);
  rim.position.z = w / 2 - 0.045; rim.castShadow = true; spin.add(rim);
  // barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, w * 0.85, 28, 1, true), S.rimDark);
  barrel.rotation.x = Math.PI / 2; spin.add(barrel);
  // hub + lug nuts
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.26, rimR * 0.3, 0.03, 16), S.chrome);
  hub.rotation.x = Math.PI / 2; hub.position.z = w / 2 - 0.02; spin.add(hub);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 6), S.dark);
    nut.rotation.x = Math.PI / 2; nut.position.set(Math.cos(a) * rimR * 0.18, Math.sin(a) * rimR * 0.18, w / 2 - 0.01); spin.add(nut);
  }
  // brake disc + caliper (non-spinning parts live in steer group)
  const steer = new THREE.Group();
  const discM = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.8, 0.015, 24), S.disc);
  discM.rotation.x = Math.PI / 2; discM.position.z = w * 0.1; steer.add(discM);
  const cal = box(0.05, 0.07, 0.035, accent, -rimR * 0.62, rimR * 0.25, w * 0.12, steer);
  cal.rotation.z = 0.5;
  steer.add(spin);
  const mount = new THREE.Group();
  mount.add(steer);
  return { mount, steer, spin };
}

// -------------------------------------------------- gold multi-spoke wheel (HATCH-R)
let goldMats: { gold: THREE.MeshStandardMaterial; goldDeep: THREE.MeshStandardMaterial } | null = null;
function ensureGold() {
  if (!goldMats) goldMats = {
    gold: new THREE.MeshStandardMaterial({ color: 0xc99a2e, metalness: 1, roughness: 0.28 }),
    goldDeep: new THREE.MeshStandardMaterial({ color: 0x8a6418, metalness: 1, roughness: 0.4 }),
  };
  return goldMats;
}
function makeGoldWheel(spec: WheelSpec, accent: THREE.Material) {
  const S = shared!;
  goldMats = ensureGold();
  const spin = new THREE.Group();
  const r = spec.r, w = spec.w;
  const inner = r * 0.74, rr = Math.min(0.03, w * 0.28);
  const prof: THREE.Vector2[] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(cx + rr * Math.cos(a), cy + rr * Math.sin(a))); } };
  prof.push(new THREE.Vector2(inner, -w / 2));
  corner(r - rr, -w / 2 + rr, -Math.PI / 2);
  corner(r - rr, w / 2 - rr, 0);
  prof.push(new THREE.Vector2(inner, w / 2));
  const tireGeo = new THREE.LatheGeometry(prof, 48); tireGeo.rotateX(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, S.tire); tire.castShadow = true; spin.add(tire);
  const rimR = inner * 1.01;
  // outer lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.97, 0.006, 6, 40), goldMats.gold); lip.position.z = w / 2 - 0.012; spin.add(lip);
  // dish face with 16 slim spokes
  const sh = new THREE.Shape(); sh.absarc(0, 0, rimR * 0.96, 0, Math.PI * 2, false);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, span = (Math.PI * 2 / n) * 0.55;
    const r0 = rimR * 0.36, r1 = rimR * 0.86;
    const hole = new THREE.Path();
    hole.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    hole.absarc(0, 0, r1, a, a + span, false);
    hole.lineTo(Math.cos(a + span) * r0, Math.sin(a + span) * r0);
    sh.holes.push(hole);
  }
  const face = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 32 }), goldMats.gold);
  face.position.z = w / 2 - 0.03; face.castShadow = true; spin.add(face);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.97, rimR * 0.97, w * 0.8, 32, 1, true), goldMats.goldDeep);
  barrel.rotation.x = Math.PI / 2; spin.add(barrel);
  const back = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.95, 32), S.dark); back.position.z = -w * 0.2; spin.add(back);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.36, 0.022, 24), goldMats.gold);
  hub.rotation.x = Math.PI / 2; hub.position.z = w / 2 - 0.02; spin.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.13, rimR * 0.13, 0.026, 6), S.dark);
  cap.rotation.x = Math.PI / 2; cap.position.z = w / 2 - 0.016; spin.add(cap);
  const steer = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.012, 24), S.disc);
  disc.rotation.x = Math.PI / 2; disc.position.z = -w * 0.05; steer.add(disc);
  const cal = box(0.035, 0.05, 0.03, accent, -rimR * 0.6, rimR * 0.25, 0, steer); cal.rotation.z = 0.5;
  steer.add(spin);
  const mount = new THREE.Group(); mount.add(steer);
  return { mount, steer, spin };
}

// -------------------------------------------------- CAR 1: HATCH-R scanned mesh (image→3D + projected texture)
let hatchGeo: THREE.BufferGeometry | null = null;
export async function preloadCarAssets() {
  try {
    const gltf = await new GLTFLoader().loadAsync('/models/hatch-r.glb?v=' + Date.now());
    gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) hatchGeo = m.geometry; });
  } catch (e) { console.warn('HATCH-R mesh not loaded, using procedural fallback', e); }
}
function buildHatchMesh(paint: THREE.MeshPhysicalMaterial, root: THREE.Group) {
  paint.vertexColors = true;
  paint.metalness = 0.0; paint.roughness = 0.45; paint.clearcoat = 0.35; paint.clearcoatRoughness = 0.2;
  const mesh = new THREE.Mesh(hatchGeo!, paint);
  mesh.position.y = -0.249; // ground → hitbox-centre coordinates
  mesh.castShadow = true; mesh.receiveShadow = true;
  root.add(mesh);
  const brake = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false });
  return brake; // taillights come from the projected texture
}

// -------------------------------------------------- CAR 1: HATCH-R procedural fallback
function arch(cx: number, cy: number, R: number, steps = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) { const t = Math.PI - (i / steps) * Math.PI; out.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); }
  return out;
}
function taperZ(geo: THREE.BufferGeometry, y0: number, y1: number, k: number) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const t = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1); p.setZ(i, p.getZ(i) * (1 - (1 - k) * t)); }
  geo.computeVertexNormals();
  return geo;
}
function buildHatch(paint: THREE.MeshPhysicalMaterial, accent: THREE.Material, root: THREE.Group) {
  const S = shared!;
  const g = new THREE.Group(); g.position.y = -0.245; root.add(g); // modelled in ground coordinates
  const W = 0.56; // body extrude width (+2×bevel ≈ 0.65)
  const wR = 0.155;
  const lower: [number, number][] = [
    [-0.615, 0.15], [-0.6, 0.125], ...arch(-0.435, 0.125, wR), [-0.268, 0.085], [0.25, 0.085], ...arch(0.417, 0.125, wR),
    [0.6, 0.12], [0.635, 0.15], [0.645, 0.3], [0.635, 0.338], [0.45, 0.358], [0.26, 0.39], [-0.45, 0.396], [-0.6, 0.402], [-0.625, 0.37],
  ];
  const bodyGeo = extrudeProfile(lower, W - 0.02, 0.055, 5);
  {
    // sculpt: bulging sides, tucked shoulders/sills, rounded nose & tail in plan view
    const p = bodyGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const sh = THREE.MathUtils.smoothstep(y, 0.28, 0.41), sill = 1 - THREE.MathUtils.smoothstep(y, 0.06, 0.16);
      let k = 1 - 0.1 * sh - 0.05 * sill;
      k -= 0.07 * THREE.MathUtils.smoothstep(x, 0.5, 0.66) + 0.06 * THREE.MathUtils.smoothstep(-x, 0.52, 0.64);
      p.setZ(i, p.getZ(i) * k);
    }
    bodyGeo.computeVertexNormals();
  }
  const body = new THREE.Mesh(bodyGeo, paint); body.castShadow = true; body.receiveShadow = true; g.add(body);
  // inner wheel wells (hide the extrusion tunnel)
  for (const cx of [-0.435, 0.417]) {
    const well = new THREE.Mesh(new THREE.CylinderGeometry(wR - 0.004, wR - 0.004, W + 0.04, 24, 1, true, -Math.PI / 2, Math.PI), S.dark);
    well.rotation.x = Math.PI / 2; well.position.set(cx, 0.125, 0); g.add(well);
  }
  // greenhouse (dark glass) with tumblehome
  const gh = taperZ(extrudeProfile([[0.262, 0.386], [0.03, 0.505], [-0.44, 0.515], [-0.598, 0.457], [-0.62, 0.39]], 0.5, 0.02, 2), 0.39, 0.515, 0.8);
  g.add(new THREE.Mesh(gh, S.glass));
  // white roof slab + rear quarter pillars
  const roof = new THREE.Mesh(taperZ(extrudeProfile([[0.01, 0.532], [-0.45, 0.542], [-0.6, 0.478], [-0.585, 0.466], [-0.44, 0.528], [0.04, 0.52]], 0.34, 0.012, 2), 0.47, 0.545, 0.95), paint);
  roof.castShadow = true; g.add(roof);
  for (const sz of [-1, 1]) {
    const pil = new THREE.Mesh(extrudeProfile([[-0.47, 0.392], [-0.47, 0.5], [-0.585, 0.458], [-0.605, 0.392]], 0.008, 0.004, 1), paint);
    pil.position.z = sz * 0.222; pil.rotation.x = -sz * 0.24; g.add(pil);
    // roof edge trim (black line between roof and glass)
    const trim = box(0.47, 0.008, 0.012, accent, -0.215, 0.503, sz * 0.172, g); trim.rotation.x = -sz * 0.24;
  }
  // hood bulge + vents + gold pins
  const bulge = new THREE.Mesh(extrudeProfile([[0.27, 0.386], [0.6, 0.346], [0.605, 0.356], [0.27, 0.402]], 0.2, 0.025, 3), paint); g.add(bulge);
  for (const sz of [-1, 1]) {
    box(0.08, 0.008, 0.035, S.dark, 0.36, 0.38, sz * 0.2, g).rotation.z = -0.1;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8), ensureGold().gold); pin.position.set(0.5, 0.375, sz * 0.24); g.add(pin);
  }
  // FRONT: grille block, round headlights, bumper, fogs, splitter
  box(0.03, 0.16, 0.6, accent, 0.648, 0.248, 0, g);
  box(0.04, 0.09, 0.3, S.dark, 0.655, 0.25, 0, g);
  for (let i = 0; i < 6; i++) box(0.012, 0.007, 0.28, S.carbon, 0.677, 0.212 + i * 0.015, 0, g);
  box(0.03, 0.03, 0.2, accent, 0.66, 0.32, 0, g); // brow above grille
  const lens = new THREE.MeshStandardMaterial({ color: 0xbfcad3, metalness: 0.3, roughness: 0.15, emissive: 0xdfe8ff, emissiveIntensity: 0.6 });
  for (const sz of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 24), lens); hl.rotation.z = Math.PI / 2; hl.position.set(0.668, 0.252, sz * 0.205); g.add(hl);
    const bez = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.007, 6, 24), S.dark); bez.rotation.y = Math.PI / 2; bez.position.set(0.672, 0.252, sz * 0.205); g.add(bez);
    box(0.012, 0.022, 0.06, S.chrome, 0.668, 0.155, sz * 0.22, g);
  }
  box(0.07, 0.055, 0.66, accent, 0.64, 0.15, 0, g);
  box(0.06, 0.012, 0.62, S.carbon, 0.665, 0.11, 0, g);
  box(0.03, 0.018, 0.36, accent, 0.655, 0.188, 0, g);
  // SIDES: fender flares, lower line, diagonal slash
  const flareGeo = new THREE.TorusGeometry(wR + 0.012, 0.022, 8, 24, Math.PI);
  for (const cx of [-0.435, 0.417]) for (const sz of [-1, 1]) {
    const f = new THREE.Mesh(flareGeo, accent); f.position.set(cx, 0.125, sz * 0.318); f.scale.z = 1.8; f.castShadow = true; g.add(f);
  }
  for (const sz of [-1, 1]) {
    box(0.5, 0.022, 0.01, accent, -0.01, 0.165, sz * 0.326, g);
    const slash = box(0.024, 0.2, 0.01, accent, -0.305, 0.235, sz * 0.326, g); slash.rotation.z = 0.32;
    box(0.4, 0.018, 0.012, accent, 0.0, 0.088, sz * 0.31, g); // sill
  }
  // REAR: black band with taillights, bumper, diffuser, exhausts
  const brake = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }); brake.color.multiplyScalar(1.4);
  box(0.02, 0.075, 0.5, accent, -0.636, 0.305, 0, g);
  for (const sz of [-1, 1]) {
    box(0.02, 0.1, 0.13, S.dark, -0.64, 0.305, sz * 0.225, g);
    const tl = box(0.012, 0.07, 0.1, brake, -0.651, 0.305, sz * 0.225, g); tl.castShadow = false;
    box(0.012, 0.012, 0.11, brake, -0.649, 0.355, sz * 0.225, g).castShadow = false;
  }
  box(0.04, 0.03, 0.66, accent, -0.63, 0.19, 0, g);
  box(0.05, 0.06, 0.6, S.carbon, -0.62, 0.11, 0, g);
  for (const sz of [-1, 1]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.05, 12, 1, true), S.chrome); ex.rotation.z = Math.PI / 2; ex.position.set(-0.645, 0.065, sz * 0.12); g.add(ex); }
  // SPOILER on the roof
  const wing = new THREE.Mesh(extrudeProfile([[-0.1, 0], [0.04, 0.008], [0.05, 0.02], [-0.09, 0.026]], 0.5, 0.008, 1), accent);
  wing.position.set(-0.54, 0.575, 0); wing.castShadow = true; g.add(wing);
  for (const sz of [-1, 1]) {
    box(0.13, 0.07, 0.01, accent, -0.555, 0.565, sz * 0.265, g);
    const st = box(0.03, 0.06, 0.015, accent, -0.53, 0.54, sz * 0.13, g); st.rotation.z = -0.3;
  }
  // undertray
  box(1.1, 0.02, 0.5, S.dark, 0, 0.08, 0, g);
  // body bevel pushes the nose/tail ~5 cm outward: move face details onto the surface
  for (const ch of g.children) {
    if (ch.position.x > 0.6) ch.position.x += 0.052;
    else if (ch.position.x < -0.6) ch.position.x -= 0.05;
  }
  return brake;
}

// -------------------------------------------------- (legacy) VÓRTICE
function buildVortice(paint: THREE.MeshPhysicalMaterial, accent: THREE.Material, g: THREE.Group) {
  const S = shared!;
  const W = 0.78;
  const body = new THREE.Mesh(extrudeProfile(smoothProfile([
    [-0.62, -0.12], [-0.665, 0.0], [-0.63, 0.13], [-0.5, 0.175], [-0.1, 0.19], [0.28, 0.165], [0.52, 0.1], [0.655, 0.02], [0.66, -0.07], [0.6, -0.125], [0, -0.13],
  ]), W, 0.05, 4), paint);
  body.castShadow = true; g.add(body);
  // cabin glass
  const cabin = new THREE.Mesh(extrudeProfile(smoothProfile([
    [-0.44, 0.16], [-0.33, 0.33], [-0.12, 0.375], [0.06, 0.37], [0.27, 0.17], [-0.1, 0.16],
  ], 40), W - 0.2, 0.035, 3), S.glass);
  g.add(cabin);
  // roof shell in paint (slightly bigger than glass at the top)
  const roof = new THREE.Mesh(extrudeProfile(smoothProfile([
    [-0.3, 0.34], [-0.12, 0.395], [0.05, 0.39], [0.1, 0.36], [-0.1, 0.365], [-0.26, 0.33],
  ], 30), W - 0.16, 0.02, 2), paint);
  roof.castShadow = true; g.add(roof);
  // A/B pillars
  for (const sz of [-1, 1]) {
    const p = box(0.035, 0.2, 0.03, paint, 0.17, 0.27, sz * (W / 2 - 0.035), g); p.rotation.z = 0.95;
    const p2 = box(0.04, 0.17, 0.03, paint, -0.37, 0.25, sz * (W / 2 - 0.04), g); p2.rotation.z = -0.75;
  }
  // wheel arch flares
  const archGeo = new THREE.TorusGeometry(0.205, 0.038, 8, 20, Math.PI);
  for (const wx of [0.39, -0.37]) for (const sz of [-1, 1]) {
    const arch = new THREE.Mesh(archGeo, accent); arch.position.set(wx, -0.06, sz * (W / 2 + 0.03)); arch.scale.set(1, 1, 1.6); arch.castShadow = true; g.add(arch);
  }
  // side skirts with accent stripe
  for (const sz of [-1, 1]) {
    box(0.42, 0.05, 0.05, accent, 0.01, -0.1, sz * (W / 2 + 0.035), g);
    const stripe = box(0.9, 0.025, 0.01, S.lampBlue, -0.02, 0.06, sz * (W / 2 + 0.052), g); stripe.castShadow = false;
  }
  // hood stripes
  box(0.62, 0.006, 0.07, accent, 0.33, 0.165, -0.07, g).rotation.z = -0.16;
  box(0.62, 0.006, 0.07, accent, 0.33, 0.165, 0.07, g).rotation.z = -0.16;
  // hood vents
  for (const sz of [-1, 1]) { const v = box(0.14, 0.01, 0.05, S.dark, 0.36, 0.152, sz * 0.24, g); v.rotation.z = -0.25; }
  // front bumper + splitter + grille
  box(0.06, 0.08, W - 0.04, accent, 0.66, -0.07, 0, g);
  box(0.12, 0.015, W + 0.04, S.carbon, 0.63, -0.125, 0, g);
  const grille = box(0.02, 0.05, 0.36, S.dark, 0.685, -0.02, 0, g); grille.castShadow = false;
  // headlights (angular)
  for (const sz of [-1, 1]) {
    const hl = box(0.03, 0.03, 0.16, S.headlight, 0.655, 0.045, sz * 0.27, g); hl.rotation.x = sz * 0.2; hl.castShadow = false;
    const drl = box(0.012, 0.012, 0.2, S.lampBlue, 0.645, 0.02, sz * 0.25, g); drl.castShadow = false;
  }
  // rear: bumper, diffuser fins, light bar
  box(0.05, 0.09, W - 0.02, accent, -0.655, -0.07, 0, g);
  for (let i = -2; i <= 2; i++) box(0.12, 0.05, 0.012, S.carbon, -0.63, -0.12, i * 0.09, g);
  const brake = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }); brake.color.multiplyScalar(1.6);
  const bar = box(0.015, 0.025, W - 0.08, brake, -0.668, 0.1, 0, g); bar.castShadow = false;
  // spoiler
  const wing = new THREE.Mesh(extrudeProfile([[-0.1, 0], [0.06, 0.012], [0.07, 0.022], [-0.09, 0.03]], W + 0.04, 0.008, 1), accent);
  wing.position.set(-0.6, 0.27, 0); wing.castShadow = true; g.add(wing);
  for (const sz of [-1, 1]) { const st = box(0.05, 0.11, 0.018, S.carbon, -0.6, 0.215, sz * 0.25, g); st.rotation.z = 0.25; box(0.13, 0.08, 0.008, paint, -0.6, 0.29, sz * (W / 2 + 0.02), g); }
  // undercarriage
  box(1.12, 0.03, W - 0.1, S.dark, 0, -0.14, 0, g);
  box(0.5, 0.05, 0.08, S.carbon, -0.1, -0.15, 0, g);
  // mirrors
  for (const sz of [-1, 1]) box(0.05, 0.035, 0.07, paint, 0.2, 0.2, sz * (W / 2 + 0.06), g);
  // exhaust nozzles
  for (const e of [[-0.66, 0.02, -0.16], [-0.66, 0.02, 0.16]]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 16, 1, true), S.nozzle); n.rotation.z = Math.PI / 2; n.position.set(e[0], e[1], e[2]); g.add(n);
  }
  return brake;
}

// -------------------------------------------------- CAR 2: MAKO
function buildMako(paint: THREE.MeshPhysicalMaterial, accent: THREE.Material, g: THREE.Group) {
  const S = shared!;
  const W = 0.8;
  const body = new THREE.Mesh(extrudeProfile(smoothProfile([
    [-0.68, -0.1], [-0.71, 0.03], [-0.66, 0.15], [-0.4, 0.17], [-0.05, 0.13], [0.3, 0.075], [0.6, 0.0], [0.735, -0.045], [0.7, -0.1], [0, -0.115],
  ], 70), W, 0.045, 4), paint);
  body.castShadow = true; g.add(body);
  // bubble canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), S.glass);
  canopy.scale.set(0.36, 0.17, 0.25); canopy.position.set(0.0, 0.125, 0); g.add(canopy);
  const canopyFrame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 40), accent);
  canopyFrame.scale.set(0.36, 0.25, 1); canopyFrame.rotation.x = Math.PI / 2; canopyFrame.position.set(0, 0.127, 0); g.add(canopyFrame);
  // rear haunches (wide fenders)
  for (const sz of [-1, 1]) {
    const fender = new THREE.Mesh(extrudeProfile(smoothProfile([[-0.7, -0.04], [-0.66, 0.15], [-0.42, 0.19], [-0.18, 0.12], [-0.15, -0.02], [-0.42, 0.06]], 40), 0.09, 0.03, 3), paint);
    fender.position.z = sz * (W / 2 + 0.02); fender.castShadow = true; g.add(fender);
    const ffront = new THREE.Mesh(extrudeProfile(smoothProfile([[0.25, 0.0], [0.33, 0.12], [0.5, 0.1], [0.66, 0.0], [0.55, 0.02], [0.45, 0.08], [0.35, 0.06]], 40), 0.07, 0.025, 3), paint);
    ffront.position.z = sz * (W / 2 + 0.01); ffront.castShadow = true; g.add(ffront);
    // side intake
    const intake = box(0.16, 0.06, 0.02, S.dark, -0.12, 0.03, sz * (W / 2 + 0.025), g); intake.rotation.z = -0.3;
    box(0.5, 0.02, 0.012, accent, 0.05, -0.065, sz * (W / 2 + 0.03), g);
  }
  // dorsal fin
  const fin = new THREE.Mesh(extrudeProfile([[-0.15, 0.13], [-0.62, 0.15], [-0.64, 0.33], [-0.5, 0.31]], 0.02, 0.006, 1), accent);
  fin.castShadow = true; g.add(fin);
  // big rear wing with swan-neck struts and endplates
  const wing = new THREE.Mesh(extrudeProfile([[-0.13, 0], [0.08, 0.015], [0.09, 0.03], [-0.12, 0.04]], W + 0.12, 0.01, 1), S.carbon);
  wing.position.set(-0.6, 0.36, 0); wing.castShadow = true; g.add(wing);
  for (const sz of [-1, 1]) {
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 16, Math.PI * 0.8), S.carbon); neck.position.set(-0.6, 0.25, sz * 0.18); neck.rotation.z = 0.4; g.add(neck);
    const plate = box(0.24, 0.12, 0.01, paint, -0.62, 0.36, sz * ((W + 0.12) / 2 + 0.01), g); plate.rotation.z = 0.1;
  }
  // splitter + nose blade
  box(0.2, 0.014, W + 0.1, S.carbon, 0.65, -0.11, 0, g);
  box(0.16, 0.01, 0.06, accent, 0.62, 0.025, 0, g).rotation.z = -0.3;
  // headlight blades
  for (const sz of [-1, 1]) {
    const hl = box(0.14, 0.012, 0.03, S.headlight, 0.63, -0.01, sz * 0.27, g); hl.rotation.y = sz * 0.35; hl.rotation.z = -0.3; hl.castShadow = false;
  }
  // rear: twin round lamps each side + diffuser
  const brake = new THREE.MeshBasicMaterial({ color: 0xff2a20, toneMapped: false }); brake.color.multiplyScalar(1.6);
  for (const sz of [-1, 1]) for (const k of [0.2, 0.32]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), brake); l.rotation.z = Math.PI / 2; l.position.set(-0.712, 0.07, sz * k); g.add(l);
  }
  for (let i = -3; i <= 3; i++) box(0.14, 0.06, 0.01, S.carbon, -0.66, -0.11, i * 0.08, g);
  box(1.25, 0.03, W - 0.08, S.dark, 0, -0.13, 0, g);
  const n = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 18, 1, true), S.nozzle); n.rotation.z = Math.PI / 2; n.position.set(-0.7, 0.04, 0); g.add(n);
  return brake;
}

export function buildCarModel(spec: CarSpec, paintHex: number): CarModel {
  if (!shared) shared = makeShared();
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  const accent = new THREE.MeshPhysicalMaterial({ color: spec.accent, metalness: 0.5, roughness: 0.35, clearcoat: 0.6 });
  const brakeLights = spec.id === 0 ? (hatchGeo ? buildHatchMesh(paint, group) : buildHatch(paint, accent, group)) : buildMako(paint, accent, group);
  void buildVortice;
  const wheels = spec.wheels.map((ws) => {
    const w = makeWheel(ws, spec.id === 0 ? 'gold' : 'mesh', accent);
    w.mount.position.set(ws.x, spec.attachY - spec.suspRest * 0.6, ws.z);
    if (ws.z < 0) w.mount.scale.z = -1;
    group.add(w.mount);
    return { spec: ws, ...w };
  });
  return {
    group, wheels, paint, brakeLights,
    exhausts: spec.exhausts.map((e) => new THREE.Vector3(...e)),
    setPaint: (hex) => paint.color.setHex(hex),
  };
}
