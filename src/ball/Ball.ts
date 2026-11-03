import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL, PHYS, G_BALL, groups } from '../core/config';

/** Panel centers of a truncated icosahedron: 12 pentagons + 20 hexagons. */
function panelCenters() {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const p = ico.getAttribute('position');
  const verts: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const seen = new Set<string>();
  const faces: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    faces.push(a.clone().add(b).add(c).normalize());
    for (const v of [a, b, c]) { const k = key(v); if (!seen.has(k)) { seen.add(k); verts.push(v.clone().normalize()); } }
  }
  return { pent: verts, hex: faces };
}

export function createBallMesh(radius = BALL.radius) {
  const { pent, hex } = panelCenters();
  const geo = new THREE.SphereGeometry(radius, 96, 64);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25 });
  const uniforms = {
    uPent: { value: pent }, uHex: { value: hex },
    uGlow: { value: new THREE.Color(0x7fe9ff) }, uPulse: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vObjN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObjN = normalize(position);');
    sh.fragmentShader = `varying vec3 vObjN; uniform vec3 uPent[12]; uniform vec3 uHex[20]; uniform vec3 uGlow; uniform float uPulse;
      float gSeam; float gPent;
    ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vObjN);
          float d1 = -2.0, d2 = -2.0; int isPent = 0;
          for (int i = 0; i < 12; i++) { float d = dot(n, uPent[i]); if (d > d1) { d2 = d1; d1 = d; isPent = 1; } else if (d > d2) d2 = d; }
          for (int i = 0; i < 20; i++) { float d = dot(n, uHex[i]); if (d > d1) { d2 = d1; d1 = d; isPent = 0; } else if (d > d2) d2 = d; }
          float edge = d1 - d2;
          gSeam = 1.0 - smoothstep(0.004, 0.018, edge);
          gPent = float(isPent);
          vec3 white = vec3(0.92, 0.94, 0.97);
          vec3 graphite = vec3(0.07, 0.08, 0.11);
          // secondary inner bevel ring on hex panels
          float inner = smoothstep(0.045, 0.05, edge) * (1.0 - smoothstep(0.05, 0.058, edge));
          vec3 base = mix(white, graphite, gPent);
          base = mix(base, vec3(0.55,0.6,0.68), inner * (1.0 - gPent) * 0.6);
          diffuseColor.rgb = mix(base, vec3(0.03), gSeam);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * (gSeam * 0.6 + gPent * 0.12) * (0.6 + uPulse);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.7, gSeam);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return { mesh, uniforms };
}

export class Ball {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  uniforms: ReturnType<typeof createBallMesh>['uniforms'];
  prevPos = new THREE.Vector3();
  currPos = new THREE.Vector3();
  prevRot = new THREE.Quaternion();
  currRot = new THREE.Quaternion();
  prevVel = new THREE.Vector3();
  lastTouch = -10;
  shadow: THREE.Mesh;

  collider!: RAPIER.Collider;
  frozen = false;
  private builtRadius: number;

  constructor(scene: THREE.Scene, private world: RAPIER.World) {
    const m = createBallMesh(1);
    this.mesh = m.mesh; this.uniforms = m.uniforms;
    this.builtRadius = BALL.radius;
    this.mesh.scale.setScalar(BALL.radius);
    scene.add(this.mesh);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, BALL.radius + 2, 0).setCcdEnabled(true)
      .setLinearDamping(0).setAngularDamping(0.02).setCanSleep(false);
    this.body = world.createRigidBody(desc);
    this.buildCollider();
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    this.shadow = sh; scene.add(sh);
    this.snapshot(); this.snapshot();
  }

  private buildCollider() {
    if (this.collider) this.world.removeCollider(this.collider, true);
    const volume = (4 / 3) * Math.PI * BALL.radius ** 3;
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL.radius).setDensity(BALL.mass / volume).setRestitution(BALL.restitution).setFriction(BALL.friction)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setCollisionGroups(groups(G_BALL, 0xffff)),
      this.body,
    );
    this.builtRadius = BALL.radius;
    this.mesh.scale.setScalar(BALL.radius);
  }

  /** Re-apply live tuning (radius / mass / bounce / friction) without restarting. */
  applyTuning() {
    const c = this.collider;
    if (Math.abs(this.builtRadius - BALL.radius) > 1e-4 || Math.abs(c.mass() - BALL.mass) > 0.01) { this.buildCollider(); return; }
    c.setRestitution(BALL.restitution); c.setFriction(BALL.friction);
  }

  setFrozen(f: boolean) {
    this.frozen = f;
    this.body.setBodyType(f ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
    if (!f) { this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  }

  place(p: THREE.Vector3, v = new THREE.Vector3(), w = new THREE.Vector3()) {
    this.body.setTranslation(p, true);
    if (this.frozen) this.body.setNextKinematicTranslation(p);
    this.body.setLinvel(v, true);
    this.body.setAngvel(w, true);
    this.snapshot(); this.snapshot();
    this.prevVel.copy(v);
  }

  reset(mode: 'center' | 'random' | 'shot', target?: THREE.Vector3, height = PHYS.ballStartHeight, speed = PHYS.ballStartSpeed) {
    const p = new THREE.Vector3(0, BALL.radius + 0.02 + height, 0), v = new THREE.Vector3();
    if (speed > 0) v.set((Math.random() - 0.5) * 2, 0.3, (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed);
    if (mode === 'random') { p.set((Math.random() - 0.5) * 50, 2 + Math.random() * 8 + height, (Math.random() - 0.5) * 60); v.set((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8); }
    if (mode === 'shot' && target) {
      p.set((Math.random() - 0.5) * 40, 3, target.z > 0 ? -20 : 20);
      const to = target.clone().add(new THREE.Vector3(0, 4, 0)).sub(p);
      const t = 1.6;
      v.set(to.x / t, to.y / t + 0.5 * PHYS.gravity * t, to.z / t);
    }
    this.place(p, v);
  }

  /** Per physics step, before world.step */
  preStep(dt: number) {
    if (this.frozen) return;
    const v = this.body.linvel();
    const k = 1 - BALL.drag * dt;
    let vx = v.x * k, vy = v.y * k, vz = v.z * k;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > BALL.maxSpeed) { const s = BALL.maxSpeed / sp; vx *= s; vy *= s; vz *= s; }
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    const w = this.body.angvel();
    const ws = Math.hypot(w.x, w.y, w.z);
    if (ws > BALL.maxAngVel) { const s = BALL.maxAngVel / ws; this.body.setAngvel({ x: w.x * s, y: w.y * s, z: w.z * s }, true); }
  }

  snapshot() {
    this.prevPos.copy(this.currPos); this.prevRot.copy(this.currRot);
    const t = this.body.translation(), r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z); this.currRot.set(r.x, r.y, r.z, r.w);
  }

  render(alpha: number) {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    const h = this.mesh.position.y;
    this.shadow.position.set(this.mesh.position.x, 0.02, this.mesh.position.z);
    const s = Math.max(0.3, 1 - h / 14);
    this.shadow.scale.setScalar(s * BALL.radius);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * s;
  }
}
