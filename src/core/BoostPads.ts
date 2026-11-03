import * as THREE from 'three';

interface Pad { pos: THREE.Vector3; big: boolean; timer: number; core: THREE.Mesh; ring: THREE.Mesh; light: THREE.MeshBasicMaterial }

const BIG = [[-33, -40], [33, -40], [-33, 40], [33, 40], [-36, 0], [36, 0]];
const SMALL = [
  [0, -42], [0, 42], [-14, -34], [14, -34], [-14, 34], [14, 34], [-26, -22], [26, -22], [-26, 22], [26, 22],
  [-9, -18], [9, -18], [-9, 18], [9, 18], [0, -24], [0, 24], [-20, -8], [20, -8], [-20, 8], [20, 8],
  [-30, -10], [30, -10], [-30, 10], [30, 10], [-6, 0], [6, 0], [-16, 0], [16, 0],
];

export class BoostPads {
  pads: Pad[] = [];
  constructor(scene: THREE.Scene) {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.9, roughness: 0.35 });
    const baseSmall = new THREE.CylinderGeometry(0.55, 0.65, 0.05, 24);
    const baseBig = new THREE.CylinderGeometry(1.0, 1.15, 0.07, 32);
    const ringSmall = new THREE.TorusGeometry(0.45, 0.04, 6, 32);
    const ringBig = new THREE.TorusGeometry(0.85, 0.06, 6, 40);
    const coreSmall = new THREE.CylinderGeometry(0.22, 0.28, 0.08, 16);
    const coreBig = new THREE.IcosahedronGeometry(0.42, 1);
    const add = (x: number, z: number, big: boolean) => {
      const light = new THREE.MeshBasicMaterial({ color: 0xffa020, toneMapped: false });
      light.color.multiplyScalar(big ? 3 : 2.2);
      const base = new THREE.Mesh(big ? baseBig : baseSmall, baseMat); base.position.set(x, 0.025, z); base.receiveShadow = true;
      const ring = new THREE.Mesh(big ? ringBig : ringSmall, light); ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.07, z);
      const core = new THREE.Mesh(big ? coreBig : coreSmall, light); core.position.set(x, big ? 0.9 : 0.08, z);
      scene.add(base, ring, core);
      this.pads.push({ pos: new THREE.Vector3(x, 0, z), big, timer: 0, core, ring, light });
    };
    BIG.forEach(([x, z]) => add(x, z, true));
    SMALL.forEach(([x, z]) => add(x, z, false));
  }

  private group: THREE.Object3D[] = [];
  setEnabled(v: boolean) {
    for (const p of this.pads) { p.core.visible = v && p.timer <= 0; p.ring.visible = v; }
  }

  resetAll() { for (const p of this.pads) { p.timer = 0; p.core.visible = true; } }

  check(car: THREE.Vector3, boost: number): { amount: number; big: boolean } | null {
    if (boost >= 100) return null;
    for (const p of this.pads) {
      if (p.timer > 0 || car.y > 2.2) continue;
      const r = p.big ? 1.6 : 1.0;
      const dx = car.x - p.pos.x, dz = car.z - p.pos.z;
      if (dx * dx + dz * dz < r * r) {
        p.timer = p.big ? 10 : 4;
        p.core.visible = false;
        return { amount: p.big ? 100 : 12, big: p.big };
      }
    }
    return null;
  }

  private lastT = 0;
  update(t: number) {
    const dt = Math.min(0.1, t - this.lastT); this.lastT = t;
    for (const p of this.pads) {
      if (p.timer > 0) { p.timer -= dt; if (p.timer <= 0) p.core.visible = true; }
      p.ring.scale.setScalar(p.timer > 0 ? 0.6 : 1 + Math.sin(t * 4 + p.pos.x) * 0.05);
      if (p.big) { p.core.rotation.y = t * 1.5; p.core.position.y = 0.9 + Math.sin(t * 2 + p.pos.z) * 0.12; }
    }
  }
}
