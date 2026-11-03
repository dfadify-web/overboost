import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vehicle } from '../vehicles/Vehicle';
import type { Ball } from '../ball/Ball';
import { BALL } from '../core/config';

/** Development-only physics visualisation. Toggle with F3 (or Ajustes → Gráficos). */
export class PhysicsDebug {
  group = new THREE.Group();
  private hitbox: THREE.LineSegments;
  private ballWire: THREE.LineSegments;
  private rays: THREE.LineSegments;
  private rayPos: Float32Array;
  private rayCol: Float32Array;
  private contacts: THREE.Mesh[] = [];
  private carVel = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x37ff6b, 0.3, 0.15);
  private ballVel = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffd23a, 0.4, 0.2);
  private angVel = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xff45d2, 0.25, 0.12);
  private staticBuilt = false;

  constructor(scene: THREE.Scene, private car: () => Vehicle, private ball: Ball) {
    scene.add(this.group);
    this.group.visible = false;
    const lm = (c: number) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
    this.hitbox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), lm(0x00ffff));
    this.ballWire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 10)), lm(0xffaa00));
    this.rayPos = new Float32Array(4 * 4 * 3); this.rayCol = new Float32Array(4 * 4 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rayPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.rayCol, 3));
    this.rays = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.rays.frustumCulled = false;
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3355, depthTest: false }));
      this.contacts.push(m); this.group.add(m);
    }
    for (const o of [this.hitbox, this.ballWire, this.rays, this.carVel, this.angVel, this.ballVel]) { o.renderOrder = 999; this.group.add(o); }
  }

  set visible(v: boolean) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  /** Wireframes of every fixed cuboid collider (goal walls/roof/back) — built once. */
  buildStatic(world: RAPIER.World) {
    if (this.staticBuilt) return;
    this.staticBuilt = true;
    const mat = new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true, opacity: 0.8 });
    world.forEachCollider((c) => {
      if (c.shape.type !== RAPIER.ShapeType.Cuboid || !c.parent()?.isFixed()) return;
      const he = (c.shape as RAPIER.Cuboid).halfExtents, t = c.translation();
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2)), mat);
      box.position.set(t.x, t.y, t.z); box.renderOrder = 999;
      this.group.add(box);
    });
  }

  update() {
    if (!this.group.visible) return;
    const car = this.car();
    const g = car.model.group;
    const [hx, hy, hz] = car.spec.half;
    this.hitbox.position.copy(g.position); this.hitbox.quaternion.copy(g.quaternion); this.hitbox.scale.set(hx, hy, hz);
    this.ballWire.position.copy(this.ball.mesh.position); this.ballWire.quaternion.copy(this.ball.mesh.quaternion); this.ballWire.scale.setScalar(BALL.radius);
    // wheel rays: green = arena contact, grey = no contact, magenta = touching the ball; yellow = surface normal
    car.wheelDebug.forEach((w, i) => {
      const o = i * 12;
      const end = w.hit ?? w.origin.clone().addScaledVector(car.up, -(car.spec.suspRest + car.spec.wheels[i].r));
      this.rayPos.set([w.origin.x, w.origin.y, w.origin.z, end.x, end.y, end.z], o);
      const c = w.onBall ? [1, 0.2, 1] : w.hit ? [0.2, 1, 0.3] : [0.5, 0.5, 0.5];
      this.rayCol.set([...c, ...c], o);
      const nEnd = w.hit && w.normal ? w.hit.clone().addScaledVector(w.normal, 0.35) : end;
      this.rayPos.set([end.x, end.y, end.z, nEnd.x, nEnd.y, nEnd.z], o + 6);
      this.rayCol.set([1, 1, 0, 1, 1, 0], o + 6);
      this.contacts[i].visible = !!w.hit;
      if (w.hit) this.contacts[i].position.copy(w.hit);
    });
    (this.rays.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.rays.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    const arrow = (a: THREE.ArrowHelper, from: THREE.Vector3, v: THREE.Vector3, k: number) => {
      const l = v.length();
      a.visible = l > 0.05;
      if (!a.visible) return;
      a.position.copy(from); a.setDirection(v.clone().normalize()); a.setLength(Math.max(0.3, l * k), 0.25, 0.12);
    };
    arrow(this.carVel, g.position, car.vel, 0.15);
    arrow(this.angVel, g.position.clone().addScaledVector(car.up, 0.4), car.angVel, 0.3);
    const bv = this.ball.body.linvel();
    arrow(this.ballVel, this.ball.mesh.position, new THREE.Vector3(bv.x, bv.y, bv.z), 0.1);
  }
}
