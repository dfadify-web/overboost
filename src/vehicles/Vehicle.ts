import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYS, G_ARENA, G_BALL, G_CAR, groups } from '../core/config';
import { CarSpec, buildCarModel, CarModel } from './VehicleModels';
import type { InputState } from '../input/InputManager';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export type SurfaceState = 'ground' | 'wall' | 'ceiling' | 'air';
/** Jump state machine. */
export type JumpState = 'grounded' | 'jumping' | 'airborne' | 'dodging';

/** Throttle acceleration (m/s²) vs forward speed: strong from rest, fades to 0 at throttleMax. */
function throttleAccel(speed: number) {
  const s = Math.abs(speed), a0 = PHYS.throttleAccel0, vmax = PHYS.throttleMax * PHYS.carSpeedMul;
  const knee = vmax * 0.993;
  if (s < knee) return a0 - (s / knee) * (a0 * 0.9);
  if (s < vmax) return a0 * 0.1 * (1 - (s - knee) / (vmax - knee));
  return 0;
}
/** Turning curvature (1/m) vs speed — tight at low speed, wide at high speed. */
function curvature(speed: number) {
  const t = [[0, 0.69], [5, 0.398], [10, 0.235], [15, 0.1375], [17.5, 0.11], [23, 0.088]];
  const s = Math.min(Math.abs(speed), 23);
  for (let i = 1; i < t.length; i++) if (s <= t[i][0]) { const k = (s - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k; }
  return 0.088;
}

export interface VehicleEvents {
  onJump?: () => void;
  onDodge?: () => void;
  onLand?: (impact: number) => void;
  onFlipReset?: () => void;
}

export interface WheelDebug { origin: THREE.Vector3; hit: THREE.Vector3 | null; normal: THREE.Vector3 | null; onBall: boolean }

export class Vehicle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  model: CarModel;
  mass = 180;

  // public state
  boost = 33;
  boosting = false;
  surface: SurfaceState = 'air';
  jumpState: JumpState = 'airborne';
  wheelsOnGround = 0;
  wheelsOnBall = 0;
  surfaceNormal = new THREE.Vector3(0, 1, 0);
  forwardSpeed = 0;
  speed = 0;
  slip = 0;
  supersonic = false;
  /** true while a dodge / double jump is still available */
  hasFlip = false;
  /** flip availability came from a flip reset (no time limit) */
  flipFromReset = false;
  dodging = false;
  flipCancelled = false;
  freeRollActive = false;
  wheelDebug: WheelDebug[] = [];

  // jump internals
  private jumped = false;
  private jumpTimer = 0;
  private jumpHold = 0;
  private jumpGrace = 0;
  private jumpBuffer = 0;
  private groundedSteps = 0;
  private dodgeTimer = 0;
  private dodgeAxis = new THREE.Vector2(); // x = forward component (+ = front flip), y = side (+ = right)
  private airTime = 0;
  private stuckTime = 0;
  private recoverSpin = 0;
  private resetBlock = 0; // prevents repeated flip resets while wheels stay on the ball
  private wheelCompression: number[] = [0, 0, 0, 0];
  private wheelSpin = 0;
  private steerVis = 0;

  // interpolation
  prevPos = new THREE.Vector3(); currPos = new THREE.Vector3();
  prevRot = new THREE.Quaternion(); currRot = new THREE.Quaternion();

  // cached axes (world)
  fwd = new THREE.Vector3(); up = new THREE.Vector3(); right = new THREE.Vector3();
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); angVel = new THREE.Vector3();

  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  events: VehicleEvents = {};

  constructor(scene: THREE.Scene, private world: RAPIER.World, public spec: CarSpec, paint: number) {
    this.model = buildCarModel(spec, paint);
    scene.add(this.model.group);
    const [hx, hy, hz] = spec.half;
    const vol = 8 * hx * hy * hz;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.6, -30).setCcdEnabled(true).setCanSleep(false)
        .setGravityScale(0).setLinearDamping(0).setAngularDamping(0),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(this.mass / vol).setFriction(0.25).setRestitution(0.1)
        .setCollisionGroups(groups(G_CAR, 0xffff)),
      this.body,
    );
    for (let i = 0; i < 4; i++) this.wheelDebug.push({ origin: new THREE.Vector3(), hit: null, normal: null, onBall: false });
    this.reset();
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.model.group);
    this.world.removeRigidBody(this.body);
  }

  get unlimitedBoost() { return PHYS.unlimitedBoost; }

  reset(pos = new THREE.Vector3(0, 0.55, -32), yaw = Math.PI / 2, vel?: THREE.Vector3, boost = PHYS.boostStart) {
    _q.setFromAxisAngle(WORLD_UP, -yaw); // yaw π/2 => forward (+x local) points toward +z
    this.setPose(pos, _q, vel ?? new THREE.Vector3(), new THREE.Vector3());
    this.boost = PHYS.unlimitedBoost ? 100 : boost;
  }

  setPose(pos: THREE.Vector3, rot: THREE.Quaternion, vel: THREE.Vector3, ang: THREE.Vector3) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel(vel, true);
    this.body.setAngvel(ang, true);
    this.jumped = false; this.hasFlip = false; this.flipFromReset = false; this.dodgeTimer = 0; this.dodging = false;
    this.jumpBuffer = 0; this.jumpHold = 0; this.groundedSteps = 0; this.resetBlock = 0;
    this.snapshot(); this.snapshot();
  }

  private readState() {
    const t = this.body.translation(), r = this.body.rotation(), lv = this.body.linvel(), av = this.body.angvel();
    this.pos.set(t.x, t.y, t.z);
    _q.set(r.x, r.y, r.z, r.w);
    this.fwd.set(1, 0, 0).applyQuaternion(_q);
    this.up.set(0, 1, 0).applyQuaternion(_q);
    this.right.set(0, 0, 1).applyQuaternion(_q);
    this.vel.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
  }

  step(input: InputState, dt: number) {
    this.readState();
    const spec = this.spec;

    // ================= Wheel rays: arena (suspension) + ball (flip reset sensors) =================
    let contacts = 0;
    let ballWheels = 0;
    const nSum = _v3.set(0, 0, 0);
    const canTouch = this.jumpGrace <= 0;
    if (this.jumpGrace > 0) this.jumpGrace -= dt;
    const down = { x: -this.up.x, y: -this.up.y, z: -this.up.z };
    for (let i = 0; i < spec.wheels.length; i++) {
      const w = spec.wheels[i];
      const origin = _v.set(w.x, spec.attachY, w.z).applyQuaternion(_q).add(this.pos);
      const maxLen = spec.suspRest + w.r;
      this.ray.origin = origin;
      this.ray.dir = down;
      const dbg = this.wheelDebug[i];
      dbg.origin.copy(origin); dbg.hit = null; dbg.normal = null; dbg.onBall = false;
      // flip-reset sensor: the wheel itself touching the ball (any time while airborne)
      const bhit = this.world.castRay(this.ray, maxLen + 0.04, true, undefined, groups(0xffff, G_BALL), undefined, this.body);
      if (bhit) { ballWheels++; dbg.onBall = true; }
      const hit = canTouch ? this.world.castRayAndGetNormal(this.ray, maxLen + 0.05, true, undefined, groups(0xffff, G_ARENA), undefined, this.body) : null;
      if (hit && hit.timeOfImpact <= maxLen + 0.05) {
        const len = Math.max(0, hit.timeOfImpact - w.r);
        const compression = Math.max(0, spec.suspRest - len);
        this.wheelCompression[i] = compression;
        const rel = _v2.copy(origin).sub(this.pos);
        const pv = new THREE.Vector3().crossVectors(this.angVel, rel).add(this.vel);
        const vUp = pv.dot(this.up);
        let f = 5200 * compression - 420 * vUp;
        f = THREE.MathUtils.clamp(f, 0, 6000);
        this.body.applyImpulseAtPoint(this.up.clone().multiplyScalar(f * dt), origin, true);
        const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        if (n.dot(this.up) < 0) n.negate();
        nSum.add(n);
        contacts++;
        dbg.hit = origin.clone().addScaledVector(this.up, -hit.timeOfImpact); dbg.normal = n;
      } else {
        this.wheelCompression[i] = Math.max(0, this.wheelCompression[i] - dt * 0.8);
      }
    }
    this.wheelsOnGround = contacts;
    this.wheelsOnBall = ballWheels;
    const grounded = contacts >= 2;
    if (grounded) {
      this.surfaceNormal.copy(nSum.normalize());
      const ny = this.surfaceNormal.y;
      this.surface = ny > 0.7 ? 'ground' : ny < -0.7 ? 'ceiling' : 'wall';
    } else this.surface = 'air';

    // Jump availability is restored only after a *stable* landing (≥3 wheels for 3 consecutive steps),
    // so grazing a wall/ramp for one tick does not refresh the second jump.
    const prevSteps = this.groundedSteps;
    this.groundedSteps = contacts >= 3 ? this.groundedSteps + 1 : contacts >= 2 ? this.groundedSteps + 0.5 : 0;
    if (prevSteps < 3 && this.groundedSteps >= 3) {
      if (this.airTime > 0.15) this.events.onLand?.(Math.abs(this.vel.dot(this.surfaceNormal)));
      this.airTime = 0;
      this.jumped = false; this.hasFlip = false; this.flipFromReset = false; this.dodgeTimer = 0; this.dodging = false; this.flipCancelled = false;
    }
    if (!grounded) this.airTime += dt;
    if (!grounded && !this.jumped && !this.hasFlip && this.airTime > 0.05 && this.airTime <= 0.05 + dt * 1.01) {
      // drove off a ledge / wall without jumping: you keep a flip (time-unlimited)
      this.hasFlip = true; this.flipFromReset = true;
    }

    // ================= Flip reset =================
    // latched after a reset: wheels must fully leave the ball for 0.1 s before another reset can occur
    if (this.resetBlock > 0) { if (ballWheels > 0) this.resetBlock = 0.1; else this.resetBlock -= dt; }
    if (!grounded && ballWheels >= PHYS.flipResetWheels && this.resetBlock <= 0) {
      this.hasFlip = true; this.flipFromReset = true; this.jumped = true; this.dodging = false; this.dodgeTimer = 0;
      this.resetBlock = 0.1;
      this.events.onFlipReset?.();
    }

    // re-read velocity after suspension impulses
    const lv = this.body.linvel(); this.vel.set(lv.x, lv.y, lv.z);
    const av = this.body.angvel(); this.angVel.set(av.x, av.y, av.z);

    // ================= Gravity (surface adaptive) =================
    const G = PHYS.gravity;
    const gAcc = new THREE.Vector3(0, -G, 0);
    if (grounded) {
      const n = this.surfaceNormal;
      const wallness = 1 - Math.max(0, n.y);
      gAcc.lerp(n.clone().multiplyScalar(-G), Math.min(1, wallness * 1.15));
      gAcc.addScaledVector(n, -PHYS.stickyAccel);
    }
    const dv = gAcc.multiplyScalar(dt);

    // ================= Boost (always along the car's nose, any orientation) =================
    const wantBoost = input.boost && (this.boost > 0 || PHYS.unlimitedBoost);
    this.boosting = wantBoost;
    if (wantBoost) {
      if (!PHYS.unlimitedBoost) this.boost = Math.max(0, this.boost - PHYS.boostUsePerSec * dt);
      dv.addScaledVector(this.fwd, PHYS.boostAccel * dt);
    }
    if (PHYS.unlimitedBoost) this.boost = 100;

    // ================= Free air roll (L2 analog / powerslide key while airborne) =================
    this.freeRollActive = !grounded && (input.freeRoll > 0.3 || input.powerslide);
    const throttle = this.freeRollActive && input.freeRoll > 0.3 ? Math.max(0, input.throttle + input.freeRoll) : input.throttle;

    // ================= Ground driving =================
    this.slip = 0;
    if (grounded) {
      const n = this.surfaceNormal;
      const fwdS = _v.copy(this.fwd).addScaledVector(n, -this.fwd.dot(n)).normalize();
      const rightS = _v2.copy(this.right).addScaledVector(n, -this.right.dot(n)).normalize();
      const vF = this.vel.dot(fwdS);
      this.forwardSpeed = vF;
      let a = 0;
      if (throttle > 0.02) a = vF < -0.2 ? PHYS.brakeAccel * throttle : throttleAccel(vF) * throttle;
      else if (throttle < -0.02) a = vF > 0.2 ? -PHYS.brakeAccel * -throttle : -throttleAccel(vF) * -throttle;
      else if (!wantBoost) a = Math.abs(vF) < PHYS.coastDecel * dt ? -vF / dt : -Math.sign(vF) * PHYS.coastDecel; // rolling resistance
      dv.addScaledVector(fwdS, a * dt);

      // lateral grip; powerslide keeps momentum but lets the car rotate
      const vLat = this.vel.dot(rightS);
      const slide = input.powerslide;
      const grip = slide ? PHYS.gripPowerslide : PHYS.gripNormal;
      dv.addScaledVector(rightS, -vLat * Math.min(1, grip * dt));
      this.slip = Math.abs(vLat);

      // speed-dependent steering: drive yaw rate about the surface normal
      const target = -input.steer * curvature(vF) * vF * spec.turnMul * (slide ? PHYS.powerslideTurn : 1);
      const wn = this.angVel.dot(n);
      this.angVel.addScaledVector(n, (target - wn) * Math.min(1, (slide ? 7 : 14) * dt));
      // light surface alignment (floor→wall transitions) and suspension damping of pitch/roll
      this.angVel.add(new THREE.Vector3().crossVectors(this.up, n).multiplyScalar(6 * dt));
      const wp = this.angVel.dot(this.right), wr = this.angVel.dot(this.fwd);
      this.angVel.addScaledVector(this.right, -wp * Math.min(1, 4 * dt));
      this.angVel.addScaledVector(this.fwd, -wr * Math.min(1, 4 * dt));
      if (this.jumpState !== 'jumping') this.jumpState = 'grounded';
    } else {
      this.forwardSpeed = this.vel.dot(this.fwd);
      dv.addScaledVector(this.fwd, PHYS.airThrottle * THREE.MathUtils.clamp(throttle, -1, 1) * dt);
    }

    // ================= Jump state machine (with input buffering) =================
    if (input.jumpPressed) this.jumpBuffer = PHYS.jumpBuffer;
    else if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.jumped) this.jumpTimer += dt;
    if (!this.flipFromReset && this.jumped && this.jumpTimer > PHYS.flipWindow) this.hasFlip = false; // flip window expired

    if (this.jumpBuffer > 0) {
      if (grounded && !this.jumped) {
        // FIRST JUMP: impulse along the roof normal, variable height while held
        dv.addScaledVector(this.up, PHYS.jumpImpulse);
        this.jumped = true; this.hasFlip = true; this.flipFromReset = false;
        this.jumpTimer = 0; this.jumpHold = PHYS.jumpHoldTime; this.jumpGrace = 0.12; this.groundedSteps = 0;
        this.surface = 'air'; this.jumpState = 'jumping'; this.jumpBuffer = 0;
        this.events.onJump?.();
      } else if (!grounded && this.stuckTime > 0.35) {
        dv.y += 3.2; this.recoverSpin = 0.7; this.jumpBuffer = 0; // turtle recovery
      } else if (!grounded && this.hasFlip) {
        const sx = input.steer, sy = input.pitch;
        const mag = Math.hypot(sx, sy);
        if (mag > PHYS.dodgeDeadzone) {
          // DODGE: directional impulse in the car's horizontal frame + torque phase
          const fwdComp = -sy / Math.max(1, mag), sideComp = sx / Math.max(1, mag);
          const fH = _v.copy(this.fwd).setY(0); if (fH.lengthSq() < 1e-4) fH.copy(this.up).multiplyScalar(-1).setY(0); fH.normalize();
          const rH = _v2.set(-fH.z, 0, fH.x);
          const speedF = Math.abs(this.vel.dot(fH));
          const fImp = fwdComp >= 0 ? PHYS.dodgeImpulse : PHYS.backflipImpulse;
          const imp = fH.multiplyScalar(fwdComp * fImp).addScaledVector(rH, sideComp * PHYS.dodgeImpulse * (1 + 0.9 * speedF / PHYS.maxSpeed));
          dv.add(imp);
          if (this.vel.y + dv.y < 0) dv.y -= this.vel.y + dv.y; // dodge cancels downward momentum
          this.dodgeTimer = PHYS.dodgeTime; this.dodging = true; this.flipCancelled = false;
          this.dodgeAxis.set(fwdComp, sideComp);
          this.jumpState = 'dodging';
          this.events.onDodge?.();
        } else {
          // DOUBLE JUMP: along the roof (respects current orientation)
          dv.addScaledVector(this.up, PHYS.jumpImpulse);
          this.events.onJump?.();
          this.jumpState = 'airborne';
        }
        this.hasFlip = false; this.flipFromReset = false; this.jumpHold = 0; this.jumpBuffer = 0;
      }
    }
    if (this.jumpHold > 0) {
      if (input.jump) dv.addScaledVector(this.up, PHYS.jumpHoldAccel * dt);
      else this.jumpHold = 0;
      this.jumpHold -= dt;
      if (this.jumpHold <= 0 && this.jumpState === 'jumping') this.jumpState = 'airborne';
    }
    if (!grounded && this.jumpState === 'grounded') this.jumpState = 'airborne';

    // ================= Air control: angular acceleration + damping (no auto-levelling) =================
    _qi.copy(_q).invert();
    const wl = this.angVel.clone().applyQuaternion(_qi); // local: x roll, y yaw, z pitch
    if (!grounded) {
      const am = spec.airMul * PHYS.airSens;
      const rollIn = input.roll !== 0 ? input.roll * PHYS.airRollSens : this.freeRollActive ? input.steer * PHYS.airRollSens : 0;
      const yawIn = this.freeRollActive && input.roll === 0 ? 0 : input.steer;
      const pitchIn = input.pitch;
      if (this.dodgeTimer > 0) {
        this.dodgeTimer -= dt;
        // Flip torque phase. Flip cancel: pulling the stick against the flip direction stops the pitch torque
        // and lets regular pitch control counter-rotate — translation from the dodge impulse is kept.
        const pitchDir = -this.dodgeAxis.x; // local z angular sign
        const cancel = this.dodgeAxis.x !== 0 && pitchIn * this.dodgeAxis.x > 0.25;
        if (cancel) this.flipCancelled = true;
        if (!this.flipCancelled && Math.abs(this.dodgeAxis.x) > 0.05) wl.z += pitchDir * PHYS.dodgeTorque * dt;
        else wl.z += PHYS.airPitch * 1.6 * pitchIn * am * dt;
        if (Math.abs(this.dodgeAxis.y) > 0.05) wl.x += this.dodgeAxis.y * PHYS.dodgeTorque * dt;
        wl.x += PHYS.airRoll * rollIn * 0.3 * dt; // limited roll authority during the flip
        wl.y -= wl.y * Math.min(1, 3 * dt);
        if (this.dodgeTimer <= 0) { this.dodging = false; this.jumpState = 'airborne'; }
      } else if (this.recoverSpin > 0) {
        this.recoverSpin -= dt;
        const wantL = new THREE.Vector3().crossVectors(this.up, WORLD_UP).applyQuaternion(_qi).multiplyScalar(9);
        wl.lerp(wantL, 0.3);
      } else {
        wl.x += (PHYS.airRoll * rollIn * am - PHYS.airDampRoll * wl.x) * dt;
        wl.z += (PHYS.airPitch * pitchIn * am - PHYS.airDampPitch * wl.z * (1 - Math.abs(pitchIn))) * dt;
        wl.y += (-PHYS.airYaw * yawIn * am - PHYS.airDampYaw * wl.y * (1 - Math.abs(yawIn))) * dt;
      }
      const ws = wl.length();
      if (ws > PHYS.maxAngVel) wl.multiplyScalar(PHYS.maxAngVel / ws);
      this.angVel.copy(wl.applyQuaternion(_q));
    }

    // stuck on roof/side → turtle recovery
    const stuck = !grounded && this.speed < 1.2 && this.angVel.length() < 1.5 && this.pos.y < 1.2;
    this.stuckTime = stuck ? this.stuckTime + dt : 0;
    if (this.stuckTime > 2.2) { this.stuckTime = 0; dv.y += 3; this.recoverSpin = 0.7; }

    // ================= Integrate =================
    this.vel.add(dv);
    const vmax = PHYS.maxSpeed * PHYS.carSpeedMul;
    const sp = this.vel.length();
    if (sp > vmax) this.vel.multiplyScalar(vmax / sp);
    this.speed = Math.min(sp, vmax);
    this.supersonic = this.speed > PHYS.supersonic;
    this.body.setLinvel(this.vel, true);
    this.body.setAngvel(this.angVel, true);

    this.wheelSpin += (this.forwardSpeed / 0.17) * dt;
    this.steerVis += (input.steer * (grounded ? 0.5 * (1 - Math.min(1, this.speed / 30)) : 0.25) - this.steerVis) * Math.min(1, dt * 12);
  }

  /** Can the player dodge right now? (for HUD/debug) */
  get canDodge() { return this.hasFlip && this.surface === 'air'; }

  addBoost(n: number) { this.boost = Math.min(100, this.boost + n); }

  snapshot() {
    this.prevPos.copy(this.currPos); this.prevRot.copy(this.currRot);
    const t = this.body.translation(), r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z); this.currRot.set(r.x, r.y, r.z, r.w);
  }

  render(alpha: number, brake: boolean) {
    const g = this.model.group;
    g.position.lerpVectors(this.prevPos, this.currPos, alpha);
    g.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    this.model.wheels.forEach((w, i) => {
      const comp = this.wheelCompression[i];
      w.mount.position.y = this.spec.attachY - (this.spec.suspRest - comp);
      w.steer.rotation.y = w.spec.front ? -this.steerVis * (w.spec.z < 0 ? -1 : 1) : 0;
      w.spin.rotation.z = -this.wheelSpin * (0.17 / w.spec.r);
    });
    this.model.brakeLights.color.setRGB(brake ? 4 : 1.4, brake ? 0.3 : 0.12, brake ? 0.3 : 0.15);
  }
}
