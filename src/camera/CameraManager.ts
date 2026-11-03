import * as THREE from 'three';
import { ARENA } from '../core/config';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Settings } from '../core/store';

export type CamMode = 'car' | 'ball';
const UP = new THREE.Vector3(0, 1, 0);

/** Follow camera + ball camera with smooth transitions, orbit input, shake and arena collision. */
export class CameraManager {
  mode: CamMode = 'ball';
  private pos = new THREE.Vector3(0, 5, -40);
  private look = new THREE.Vector3();
  private dir = new THREE.Vector3(0, 0, 1);
  private shakeAmt = 0;
  private fovBoost = 0;
  orbitT = 0;

  constructor(public cam: THREE.PerspectiveCamera) {}

  toggle() { this.mode = this.mode === 'car' ? 'ball' : 'car'; }
  shake(a: number) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  snap(car: Vehicle) {
    this.dir.copy(car.fwd).setY(0).normalize();
    this.pos.copy(car.model.group.position).addScaledVector(this.dir, -4).add(new THREE.Vector3(0, 1.5, 0));
  }

  update(dt: number, car: Vehicle, ballPos: THREE.Vector3, s: Settings, camX: number, camY: number) {
    const carPos = car.model.group.position;
    // Desired forward direction
    const want = new THREE.Vector3();
    if (this.mode === 'ball') {
      want.copy(ballPos).sub(carPos);
      want.y *= 0.35;
      if (want.lengthSq() < 0.5) want.copy(this.dir);
    } else {
      // follow velocity when moving fast, chassis forward otherwise; flatten for walls
      const f = car.fwd.clone();
      if (car.surface === 'wall' || car.surface === 'ceiling') f.copy(car.vel.lengthSq() > 4 ? car.vel : car.fwd);
      f.y *= 0.25;
      want.copy(f);
      if (want.lengthSq() < 1e-3) want.copy(this.dir);
    }
    want.normalize();
    // orbit (right stick / mouse)
    if (Math.abs(camX) > 0.01) want.applyAxisAngle(UP, -camX * Math.PI);
    const stiff = 2 + s.camStiffness * 10;
    this.dir.lerp(want, 1 - Math.exp(-stiff * dt)).normalize();

    const speedK = Math.min(1, car.speed / 23);
    const dist = s.camDistance * (1 + speedK * 0.12);
    const height = s.camHeight * (1 - camY * 0.6);
    const flat = this.dir.clone().setY(0);
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, 1);
    flat.normalize();
    const pitchUp = this.mode === 'ball' ? THREE.MathUtils.clamp(this.dir.y, -0.25, 0.6) : 0;
    const desired = carPos.clone().addScaledVector(flat, -dist * (1 - pitchUp * 0.3)).addScaledVector(UP, height + Math.max(0, -this.dir.y) * 1.5 - pitchUp * 0.6);

    // collision with arena bounds (rounded-box approximation)
    this.clampInside(desired);
    this.pos.lerp(desired, 1 - Math.exp(-(10 + s.camStiffness * 14) * dt));

    const lookTarget = this.mode === 'ball'
      ? carPos.clone().lerp(ballPos, 0.35).add(new THREE.Vector3(0, 0.5, 0))
      : carPos.clone().addScaledVector(flat, 2.0).add(new THREE.Vector3(0, 0.55 - camY * 0.4, 0));
    this.look.lerp(lookTarget, 1 - Math.exp(-14 * dt));
    if (this.look.distanceToSquared(lookTarget) > 400) this.look.copy(lookTarget);
    if (this.pos.distanceToSquared(desired) > 900) this.pos.copy(desired);

    // shake
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sh = s.shake ? this.shakeAmt * this.shakeAmt * 0.25 : 0;
    this.cam.position.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    this.cam.lookAt(this.look);

    // speed FOV
    const targetBoost = car.supersonic ? 6 : car.boosting ? 3 : 0;
    this.fovBoost += (targetBoost - this.fovBoost) * Math.min(1, dt * 3);
    const vfov = hfovToV(s.fov + this.fovBoost, this.cam.aspect);
    if (Math.abs(this.cam.fov - vfov) > 0.01) { this.cam.fov = vfov; this.cam.updateProjectionMatrix(); }
  }

  private clampInside(p: THREE.Vector3) {
    const m = 0.6;
    p.y = THREE.MathUtils.clamp(p.y, 0.35, ARENA.H - m);
    const hx = ARENA.W / 2 - m, hz = ARENA.L / 2 - m;
    const inGoal = Math.abs(p.x) < ARENA.goalW / 2 - m && p.y < ARENA.goalH - m;
    p.x = THREE.MathUtils.clamp(p.x, -hx, hx);
    p.z = THREE.MathUtils.clamp(p.z, -(inGoal ? hz + ARENA.goalD - 0.5 : hz), inGoal ? hz + ARENA.goalD - 0.5 : hz);
    // rounded corners
    const cx = ARENA.W / 2 - ARENA.cornerR, cz = ARENA.L / 2 - ARENA.cornerR;
    const dx = Math.abs(p.x) - cx, dz = Math.abs(p.z) - cz;
    if (dx > 0 && dz > 0) {
      const d = Math.hypot(dx, dz), r = ARENA.cornerR - m;
      if (d > r) { p.x = Math.sign(p.x) * (cx + (dx / d) * r); p.z = Math.sign(p.z) * (cz + (dz / d) * r); }
    }
  }

  /** Menu / showcase orbit */
  orbit(dt: number, center: THREE.Vector3) {
    this.orbitT += dt * 0.06;
    const r = 38;
    this.cam.position.set(Math.cos(this.orbitT) * r, 9 + Math.sin(this.orbitT * 0.7) * 3, Math.sin(this.orbitT) * r * 1.15);
    this.cam.lookAt(center);
    const vfov = hfovToV(80, this.cam.aspect);
    if (Math.abs(this.cam.fov - vfov) > 0.01) { this.cam.fov = vfov; this.cam.updateProjectionMatrix(); }
  }
}

export function hfovToV(h: number, aspect: number) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) / aspect));
}
