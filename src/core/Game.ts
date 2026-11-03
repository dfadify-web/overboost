import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ARENA, BALL, PHYS, PHYS_DT, TEAM_A, TEAM_B, applyTuning } from './config';
import { PhysicsDebug } from '../effects/PhysicsDebug';
import { useGame, paintColor, Quality } from './store';
import { Arena } from '../arena/Arena';
import { Ball } from '../ball/Ball';
import { Vehicle } from '../vehicles/Vehicle';
import { CAR_SPECS } from '../vehicles/VehicleModels';
import { CameraManager } from '../camera/CameraManager';
import { Input, InputState } from '../input/InputManager';
import { ParticleSystem } from '../effects/Particles';
import { Audio } from '../audio/AudioManager';
import { BoostPads } from './BoostPads';

export interface HudData {
  speed: number; boost: number; surface: string; cam: string; fps: number;
  scoreA: number; scoreB: number; goalAt: number; goalTeam: 0 | 1; device: string; pad: string | null;
  supersonic: boolean; flip: boolean; touches: number; lastShot: number;
  ballSpeed: number; jumpState: string; canDodge: boolean; flipFromReset: boolean; flipResetAt: number; wheelsOnBall: number;
  angVel: number; frozen: boolean; debug: boolean; freeRoll: boolean; dodging: boolean; flipCancelled: boolean; physHz: number;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  world!: RAPIER.World;
  arena!: Arena;
  ball!: Ball;
  car!: Vehicle;
  cams = new CameraManager(this.camera);
  fx!: ParticleSystem;
  smoke!: ParticleSystem;
  pads!: BoostPads;
  sun!: THREE.DirectionalLight;
  private flames: THREE.Mesh[] = [];
  private shock!: THREE.Mesh;
  private shockT = 10;
  private acc = 0;
  private last = performance.now();
  time = 0;
  private fpsAcc = 0; private fpsFrames = 0;
  private goalPending = -1;
  private excite = 0;
  private fireworkT = 0;
  private ballHitCooldown = 0;
  hud: HudData = { speed: 0, boost: 0, surface: 'air', cam: 'ball', fps: 0, scoreA: 0, scoreB: 0, goalAt: -10, goalTeam: 0, device: 'keyboard', pad: null, supersonic: false, flip: false, touches: 0, lastShot: 0,
    ballSpeed: 0, jumpState: 'grounded', canDodge: false, flipFromReset: false, flipResetAt: -10, wheelsOnBall: 0, angVel: 0, frozen: false, debug: false, freeRoll: false, dodging: false, flipCancelled: false, physHz: 120 };
  debugView!: PhysicsDebug;
  private physSteps = 0; private physStepAcc = 0;
  private savedSetup: { carPos: THREE.Vector3; carRot: THREE.Quaternion; carVel: THREE.Vector3; ballPos: THREE.Vector3; ballVel: THREE.Vector3; boost: number } | null = null;
  ready = false;
  private quality: Quality = 'high';
  private raf = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -PHYS.gravity, z: 0 });
    this.world.timestep = PHYS_DT;
    this.world.integrationParameters.numSolverIterations = 8;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.Fog(0x080a16, 140, 420);

    // Lights
    this.scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a2a18, 0.9));
    this.sun = new THREE.DirectionalLight(0xfff1de, 2.2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    for (const [sgn, col] of [[-1, TEAM_A], [1, TEAM_B]] as const) {
      const pl = new THREE.PointLight(col, 60, 30, 1.6); pl.position.set(0, 4, sgn * (ARENA.L / 2 + 3)); this.scene.add(pl);
      const fl = new THREE.PointLight(col, 40, 45, 1.4); fl.position.set(0, 12, sgn * (ARENA.L / 2 - 14)); this.scene.add(fl);
    }

    const st = useGame.getState();
    this.quality = st.settings.quality;
    this.arena = new Arena(this.scene, this.world, this.quality);
    this.ball = new Ball(this.scene, this.world);
    this.pads = new BoostPads(this.scene);
    this.fx = new ParticleSystem(this.scene, 6000, true);
    this.smoke = new ParticleSystem(this.scene, 1500, false);
    this.shock = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.scene.add(this.shock);
    this.spawnCar(st.car, paintColor(st.paints[st.car]));
    this.debugView = new PhysicsDebug(this.scene, () => this.car, this.ball);
    this.debugView.buildStatic(this.world);
    this.debugView.visible = st.settings.debugPhysics;

    // Post
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyQuality(this.quality);
    window.addEventListener('resize', this.onResize);
    this.onResize();
    useGame.subscribe((s, prev) => {
      if (s.settings.quality !== prev.settings.quality) this.applyQuality(s.settings.quality);
      if (s.settings !== prev.settings) Audio.setVolumes(s.settings);
      if (s.car !== prev.car || s.paints !== prev.paints) {
        if (s.car !== this.car.spec.id) this.spawnCar(s.car, paintColor(s.paints[s.car]));
        else this.car.model.setPaint(paintColor(s.paints[s.car]));
      }
      if (s.settings.debugPhysics !== prev.settings.debugPhysics) this.debugView.visible = s.settings.debugPhysics;
      if ((s.tuning !== prev.tuning || s.mode !== prev.mode) && s.screen === 'playing') this.applyPhysicsMode();
      if (s.screen !== prev.screen && s.screen === 'playing') this.restartTraining();
      if (s.screen !== prev.screen && s.screen === 'menu') this.menuPose();
    });
    Audio.setVolumes(st.settings);
    this.menuPose();
    this.ready = true;
    this.loop();
  }

  private spawnCar(id: 0 | 1, paint: number) {
    const keep = this.car ? { p: this.car.currPos.clone(), r: this.car.currRot.clone() } : null;
    if (this.car) { this.car.dispose(this.scene); this.flames.forEach((f) => f.removeFromParent()); this.flames = []; }
    this.car = new Vehicle(this.scene, this.world, CAR_SPECS[id], paint);
    this.car.model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    if (keep) { this.car.body.setTranslation(keep.p, true); this.car.body.setRotation(keep.r, true); this.car.snapshot(); this.car.snapshot(); }
    this.car.events = {
      onJump: () => Audio.jump(),
      onDodge: () => { Audio.jump(); Input.rumble(0.2, 0.4, 80); },
      onLand: (imp) => { if (imp > 2) { Audio.impact(imp / 10, 'car'); this.cams.shake(imp / 25); } },
      onFlipReset: () => {
        this.hud.flipResetAt = this.time; Audio.pickup(true); Input.rumble(0.3, 0.8, 90);
        const p = this.car.currPos;
        for (let i = 0; i < 40; i++) this.fx.emit(p, new THREE.Vector3().randomDirection().multiplyScalar(3), new THREE.Color(0.6, 1.4, 2.4), 0.12, 0.5, { drag: 2 });
      },
    };
    // boost flames
    const flameGeo = new THREE.ConeGeometry(0.07, 0.6, 14, 1, true);
    flameGeo.rotateZ(Math.PI / 2); flameGeo.translate(-0.3, 0, 0);
    for (const e of this.car.model.exhausts) {
      const core = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const outer = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      outer.scale.set(1.5, 1.7, 1.7);
      core.position.copy(e); outer.position.copy(e);
      core.visible = outer.visible = false;
      this.car.model.group.add(core, outer);
      this.flames.push(core, outer);
    }
  }

  private menuPose() {
    this.car.reset(new THREE.Vector3(-3, 0.5, -6), Math.PI / 2 + 0.6);
    this.ball.reset('center');
    this.ball.mesh.visible = true;
    this.goalPending = -1;
  }

  /** Standard play uses the reference physics; training uses the (persisted) training tuning. */
  applyPhysicsMode() {
    const st = useGame.getState();
    applyTuning(st.mode === 'training' ? { ...st.tuning, unlimitedBoost: st.tuning.unlimitedBoost || st.settings.unlimitedBoost } : {});
    this.world.gravity = { x: 0, y: -PHYS.gravity, z: 0 };
    this.ball.applyTuning();
    this.pads.setEnabled(PHYS.boostPads);
  }

  restartTraining() {
    this.applyPhysicsMode();
    if (this.ball.frozen) this.ball.setFrozen(false);
    this.resetCar();
    this.resetBall();
    this.pads.resetAll();
    this.hud.scoreA = this.hud.scoreB = 0; this.hud.touches = 0;
    this.arena.setScreenText('0 — 0', 'ENTRENAMIENTO LIBRE');
    this.cams.mode = 'ball';
    this.fx.clear(); this.smoke.clear();
    this.cams.snap(this.car);
    Audio.init();
  }

  resetCar() {
    this.placeCar(new THREE.Vector3(PHYS.carStartX, 0.55, PHYS.carStartZ), PHYS.carStartYaw, PHYS.carStartSpeed);
  }

  resetBoost() { this.car.boost = PHYS.unlimitedBoost ? 100 : Math.max(PHYS.boostStart, 0); }

  /** D-pad down: ball on the ground, just ahead of the car's nose, at rest. */
  placeBallInFront(gap = 0.18) {
    const car = this.car;
    const f = car.fwd.clone().setY(0);
    if (f.lengthSq() < 1e-3) f.copy(car.up).multiplyScalar(-1).setY(0);
    if (f.lengthSq() < 1e-3) f.set(0, 0, 1);
    f.normalize();
    const r = BALL.radius;
    const p = car.currPos.clone().setY(0).addScaledVector(f, car.spec.half[0] + r + gap);
    p.y = r + 0.01;
    const lim = { x: ARENA.W / 2 - ARENA.curveR - r, z: ARENA.L / 2 - ARENA.curveR - r };
    p.x = THREE.MathUtils.clamp(p.x, -lim.x, lim.x); p.z = THREE.MathUtils.clamp(p.z, -lim.z, lim.z);
    this.ball.place(p);
    this.ball.mesh.visible = true;
    this.goalPending = -1;
  }

  toggleFreezeBall() { this.ball.setFrozen(!this.ball.frozen); }

  saveSetup() {
    const c = this.car, b = this.ball;
    const lv = c.body.linvel(), bv = b.body.linvel();
    this.savedSetup = { carPos: c.currPos.clone(), carRot: c.currRot.clone(), carVel: new THREE.Vector3(lv.x, lv.y, lv.z), ballPos: b.currPos.clone(), ballVel: new THREE.Vector3(bv.x, bv.y, bv.z), boost: c.boost };
  }
  get hasSavedSetup() { return !!this.savedSetup; }
  loadSetup() {
    const s = this.savedSetup; if (!s) return false;
    this.car.setPose(s.carPos, s.carRot, s.carVel, new THREE.Vector3());
    this.car.boost = s.boost;
    this.ball.place(s.ballPos, s.ballVel);
    this.ball.mesh.visible = true; this.goalPending = -1;
    this.cams.snap(this.car);
    return true;
  }

  /** Training: custom car start (position, yaw, speed). yaw 0 = facing +z */
  placeCar(pos: THREE.Vector3, yawDeg: number, speed: number) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.car.reset(pos, Math.PI / 2 - yaw + Math.PI / 2 - Math.PI / 2, f.multiplyScalar(speed));
    this.cams.snap(this.car);
  }

  resetBall() {
    const s = useGame.getState().settings;
    this.ball.reset(s.ballSpawn, this.car.currPos);
    this.ball.mesh.visible = true;
    this.goalPending = -1;
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const pr = { low: 0.75, medium: 1, high: Math.min(dpr, 1.5), ultra: Math.min(dpr, 2) }[q];
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    const size = { low: 512, medium: 1024, high: 2048, ultra: 4096 }[q];
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); (this.sun.shadow as unknown as { map: null }).map = null;
    }
    this.sun.castShadow = q !== 'low';
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.bloom.enabled = q !== 'low';
    this.fx.scale = this.smoke.scale = { low: 0.4, medium: 0.7, high: 1, ultra: 1 }[q];
    this.arena.setQuality(q);
    this.onResize();
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    const bloomScale = this.quality === 'medium' ? 0.5 : 1;
    this.bloom?.setSize(w * bloomScale, h * bloomScale);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fx?.setViewportHeight(h * pr); this.smoke?.setViewportHeight(h * pr);
  };

  // ---------------------------------------------------------------- loop
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc > 0.5) { this.hud.fps = Math.round(this.fpsFrames / this.fpsAcc); this.fpsAcc = 0; this.fpsFrames = 0; }

    const st = useGame.getState();
    Input.update(dt);
    const inp = Input.state;
    const playing = st.screen === 'playing';
    const edges = { cam: inp.ballCamPressed, rc: inp.resetCarPressed, rb: inp.resetBallPressed, pause: inp.pausePressed,
      tm: inp.trainingMenuPressed, pb: inp.placeBallPressed, fb: inp.freezeBallPressed, bo: inp.resetBoostPressed, dbg: inp.debugPressed };
    inp.ballCamPressed = inp.resetCarPressed = inp.resetBallPressed = inp.pausePressed = false;
    inp.trainingMenuPressed = inp.placeBallPressed = inp.freezeBallPressed = inp.resetBoostPressed = inp.debugPressed = false;
    if (edges.dbg) st.setSettings({ debugPhysics: !st.settings.debugPhysics });
    if (playing && edges.pause) { if (st.trainingMenu) st.setTrainingMenu(false); else st.setPaused(!st.paused); Audio.click(); }
    if (playing && edges.tm && !st.paused) { st.setTrainingMenu(!st.trainingMenu); Audio.click(true); }
    const running = !playing || (!st.paused && !st.trainingMenu);

    if (running) {
      const scaledDt = dt * (playing ? st.settings.gameSpeed : 1);
      this.acc += scaledDt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 12) {
        this.physicsStep(playing ? inp : idleInput, PHYS_DT, playing);
        if (playing) Input.consumeEdges();
        this.acc -= PHYS_DT; steps++;
      }
      if (steps >= 12) this.acc = 0;
      if (playing) {
        if (edges.cam) { this.cams.toggle(); Audio.click(true); }
        if (edges.rc) this.resetCar();
        if (edges.rb) this.resetBall();
        if (edges.pb) this.placeBallInFront();
        if (edges.fb) this.toggleFreezeBall();
        if (edges.bo) this.resetBoost();
      }
    }
    if (!playing || st.paused || st.trainingMenu) Input.consumeEdges();

    const alpha = this.acc / PHYS_DT;
    this.car.render(alpha, playing && inp.throttle < -0.1 && this.car.forwardSpeed > 0.5);
    this.ball.render(alpha);

    if (playing) this.cams.update(dt, this.car, this.ball.mesh.position, st.settings, inp.camX, inp.camY);
    else this.cams.orbit(dt, new THREE.Vector3(0, 1.5, 0));

    // shadow follows the action
    const focus = this.car.model.group.position;
    this.sun.position.set(focus.x + 18, focus.y + 45, focus.z + 12);
    this.sun.target.position.copy(focus);

    if (running) this.updateEffects(dt, playing);
    this.arena.update(this.time, this.excite);
    this.pads.update(this.time);
    Audio.updateCar(this.car.speed, playing ? inp.throttle : 0, this.car.boosting && playing, this.car.slip, this.car.surface === 'air', playing && !st.paused);

    // HUD
    const h = this.hud;
    h.speed = this.car.speed; h.boost = this.car.boost; h.surface = this.car.surface; h.cam = this.cams.mode;
    h.device = Input.lastDevice; h.pad = Input.padName; h.supersonic = this.car.supersonic;
    const bvv = this.ball.body.linvel();
    h.ballSpeed = Math.hypot(bvv.x, bvv.y, bvv.z); h.jumpState = this.car.jumpState; h.canDodge = this.car.canDodge; h.flipFromReset = this.car.flipFromReset;
    h.wheelsOnBall = this.car.wheelsOnBall; h.angVel = this.car.angVel.length(); h.frozen = this.ball.frozen; h.debug = this.debugView.visible;
    h.freeRoll = this.car.freeRollActive; h.dodging = this.car.dodging; h.flipCancelled = this.car.flipCancelled;
    this.physStepAcc += dt; if (this.physStepAcc >= 1) { h.physHz = Math.round(this.physSteps / this.physStepAcc); this.physSteps = 0; this.physStepAcc = 0; }
    this.debugView.update();

    if (st.screen === 'menu') return; // menu shows the Flow key art full-screen
    if (this.bloom.enabled) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  };

  physicsStep(inp: typeof Input.state, dt: number, playing: boolean) {
    const car = this.car, ball = this.ball;
    this.physSteps++;
    car.step(inp, dt);
    ball.preStep(dt);
    this.ballTouch(dt);
    const carVelSet = car.vel.clone();
    const ballV0 = _v2.copy(ball.prevVel);
    this.world.step();
    car.snapshot(); ball.snapshot();

    // impact detection (velocity change caused by contacts)
    const lv = car.body.linvel();
    const dCar = Math.hypot(lv.x - carVelSet.x, lv.y - carVelSet.y, lv.z - carVelSet.z);
    if (dCar > 4 && playing) { Audio.impact(dCar / 14, 'wall'); this.cams.shake(dCar / 30); this.sparks(car.currPos, 18); }
    const bv = ball.body.linvel();
    const dBall = Math.hypot(bv.x - ballV0.x, bv.y - ballV0.y, bv.z - ballV0.z);
    if (dBall > 3 && this.ballHitCooldown <= 0) { Audio.impact(dBall / 25, 'ball'); }
    ball.prevVel.set(bv.x, bv.y, bv.z);
    this.ballHitCooldown -= dt;

    // boost pads
    if (playing) {
      const got = PHYS.boostPads ? this.pads.check(car.currPos, car.boost) : null;
      if (got) { car.addBoost(got.amount); Audio.pickup(got.big); }
    }

    // goals
    const bp = ball.currPos;
    if (this.goalPending < 0 && Math.abs(bp.z) > ARENA.L / 2 + BALL.radius && Math.abs(bp.x) < ARENA.goalW / 2 && bp.y < ARENA.goalH) {
      this.scoreGoal(bp.z > 0 ? 0 : 1, bp.clone(), playing);
    }
    if (this.goalPending >= 0) {
      this.goalPending -= dt;
      if (this.goalPending < 0) { if (playing) this.resetBall(); else { this.ball.reset('center'); this.ball.mesh.visible = true; } }
    }
  }

  /** Extra hit impulse on car→ball contact, gives controllable, punchy touches. */
  private ballTouch(dt: number) {
    const car = this.car, ball = this.ball;
    const bt = ball.body.translation();
    const bpos = _v.set(bt.x, bt.y, bt.z);
    _q.copy(car.currRot).invert();
    const local = bpos.clone().sub(car.pos).applyQuaternion(_q);
    const [hx, hy, hz] = car.spec.half;
    const cl = new THREE.Vector3(THREE.MathUtils.clamp(local.x, -hx, hx), THREE.MathUtils.clamp(local.y, -hy, hy), THREE.MathUtils.clamp(local.z, -hz, hz));
    const dist = cl.distanceTo(local);
    if (dist > BALL.radius + 0.05 || this.ballHitCooldown > 0) return;
    const bvRaw = ball.body.linvel();
    const bv = new THREE.Vector3(bvRaw.x, bvRaw.y, bvRaw.z);
    const rel = car.vel.clone().sub(bv);
    const dirL = local.clone(); dirL.y *= 0.35; dirL.normalize();
    const dir = dirL.applyQuaternion(car.currRot);
    const approach = rel.dot(dir);
    if (approach <= 0.3) return;
    // impulse magnitude follows the closing speed along the contact normal, so glancing brushes stay soft
    const relS = Math.min(46, 0.7 * approach + 0.3 * rel.length());
    const scale = relS <= 5 ? 0.65 : relS <= 23 ? 0.65 - (relS - 5) / 18 * 0.1 : 0.55 - (relS - 23) / 23 * 0.25;
    const dv = dir.multiplyScalar(relS * scale * (car.spec.id === 1 ? 1.06 : 1));
    ball.body.applyImpulse({ x: dv.x * BALL.mass, y: dv.y * BALL.mass, z: dv.z * BALL.mass }, true);
    this.ballHitCooldown = 0.12;
    ball.lastTouch = this.time;
    this.hud.touches++;
    const nb = ball.body.linvel();
    this.hud.lastShot = Math.hypot(nb.x, nb.y, nb.z) * 3.6;
    const strength = relS / 23;
    Audio.impact(0.4 + strength, 'ball');
    this.cams.shake(strength * 0.5);
    Input.rumble(Math.min(1, strength), 0.5, 120);
    const contact = cl.applyQuaternion(car.currRot).add(car.pos);
    this.sparks(contact, Math.floor(10 + strength * 30), 0x9fefff);
    ball.uniforms.uPulse.value = 1.5;
    void dt;
  }

  private sparks(p: THREE.Vector3, n: number, color = 0xffc070) {
    const c = new THREE.Color(color).multiplyScalar(2);
    for (let i = 0; i < n; i++) {
      this.fx.emit(p, new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 8, (Math.random() - 0.5) * 12), c, 0.06 + Math.random() * 0.05, 0.3 + Math.random() * 0.4, { drag: 1.5, gravity: 12 });
    }
  }

  private scoreGoal(team: 0 | 1, p: THREE.Vector3, playing: boolean) {
    this.goalPending = 2.8;
    if (team === 0) this.hud.scoreA++; else this.hud.scoreB++;
    this.hud.goalAt = this.time; this.hud.goalTeam = team;
    const col = new THREE.Color(team === 0 ? TEAM_A : TEAM_B);
    // explosion
    for (let i = 0; i < 500; i++) {
      const d = new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 22);
      const c = Math.random() < 0.3 ? new THREE.Color(1, 1, 1).multiplyScalar(2.5) : col.clone().multiplyScalar(2 + Math.random() * 2);
      this.fx.emit(p, d, c, 0.25 + Math.random() * 0.4, 0.8 + Math.random() * 1.2, { drag: 1.8, gravity: 3 });
    }
    for (let i = 0; i < 40; i++) this.smoke.emit(p, new THREE.Vector3().randomDirection().multiplyScalar(4), new THREE.Color(0.35, 0.35, 0.4), 1.5, 2.5, { drag: 1.2, grow: 2 });
    (this.shock.material as THREE.MeshBasicMaterial).color.copy(col);
    this.shock.position.copy(p); this.shockT = 0;
    this.ball.mesh.visible = false;
    this.excite = 1;
    this.fireworkT = 0;
    if (playing) {
      Audio.goal();
      this.cams.shake(1.2);
      Input.rumble(1, 1, 600);
    }
    this.arena.setScreenText(`${this.hud.scoreA} — ${this.hud.scoreB}`, team === 0 ? '¡GOL CIAN!' : '¡GOL ÁMBAR!');
  }

  private updateEffects(dt: number, playing: boolean) {
    const car = this.car;
    // boost flames + particles
    const boosting = car.boosting && playing;
    this.flames.forEach((f, i) => {
      f.visible = boosting;
      if (boosting) { const k = 0.8 + Math.random() * 0.45; f.scale.x = (i % 2 ? 1.7 : 1) * k; }
    });
    if (boosting) {
      for (const e of car.model.exhausts) {
        const wp = e.clone().applyQuaternion(car.model.group.quaternion).add(car.model.group.position);
        for (let k = 0; k < 3; k++) {
          const v = car.fwd.clone().multiplyScalar(-6 - Math.random() * 4).addScaledVector(car.vel, 0.7).add(new THREE.Vector3().randomDirection().multiplyScalar(0.8));
          const hot = Math.random();
          this.fx.emit(wp, v, new THREE.Color(1.6, 0.5 + hot * 0.8, 0.12 + hot * 0.3).multiplyScalar(1.4), 0.13 + Math.random() * 0.1, 0.18 + Math.random() * 0.15, { drag: 3 });
        }
        if (Math.random() < 0.4) this.smoke.emit(wp, car.fwd.clone().multiplyScalar(-2).addScaledVector(car.vel, 0.3), new THREE.Color(0.3, 0.3, 0.33), 0.35, 0.9, { drag: 2, grow: 1.2 });
      }
    }
    // supersonic trail
    if (car.supersonic && playing) {
      const [hx, , hz] = car.spec.half;
      for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(-hx, 0.05, sz * hz * 0.9).applyQuaternion(car.model.group.quaternion).add(car.model.group.position);
        this.fx.emit(p, car.vel.clone().multiplyScalar(0.15), new THREE.Color(1.4, 1.6, 2.2), 0.09, 0.4, { drag: 1 });
      }
    }
    // tire smoke when drifting
    if (car.surface !== 'air' && car.slip > 4 && playing) {
      for (const w of car.spec.wheels) if (!w.front) {
        const p = new THREE.Vector3(w.x, car.spec.attachY - car.spec.suspRest - w.r + 0.05, w.z).applyQuaternion(car.model.group.quaternion).add(car.model.group.position);
        if (Math.random() < 0.6) this.smoke.emit(p, car.surfaceNormal.clone().multiplyScalar(0.6 + Math.random()), new THREE.Color(0.55, 0.55, 0.58), 0.3, 1.2, { drag: 1.5, grow: 1.4 });
      }
    }
    // ball glow pulse decay
    const u = this.ball.uniforms.uPulse; u.value = Math.max(0, u.value - dt * 3);
    // goal shockwave
    if (this.shockT < 1.2) {
      this.shockT += dt;
      const s = 1 + this.shockT * 28;
      this.shock.scale.setScalar(s);
      (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 * (1 - this.shockT / 1.2));
    }
    this.excite = Math.max(0, this.excite - dt * 0.25);
    // fireworks: ambient in menu, bursts after goals
    this.fireworkT -= dt;
    const goalBurst = this.excite > 0.5;
    if (this.fireworkT <= 0) {
      this.fireworkT = goalBurst ? 0.25 : (playing ? 3 + Math.random() * 4 : 1.2 + Math.random() * 1.5);
      this.firework();
    }
    this.fx.update(dt); this.smoke.update(dt);
  }

  private firework() {
    const a = Math.random() * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * (70 + Math.random() * 40), 45 + Math.random() * 30, Math.sin(a) * (80 + Math.random() * 40));
    const palette = [TEAM_A, TEAM_B, 0xffffff, 0xff3d7f, 0x8cff5a, 0xffe14d];
    const c = new THREE.Color(palette[(Math.random() * palette.length) | 0]).multiplyScalar(2.2);
    const n = 70 + ((Math.random() * 50) | 0);
    for (let i = 0; i < n; i++) this.fx.emit(p, new THREE.Vector3().randomDirection().multiplyScalar(12 + Math.random() * 3), c, 1.0, 1.6 + Math.random() * 0.6, { drag: 1.1, gravity: 2.5 });
  }

  dispose() { cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.onResize); this.renderer.dispose(); }
}

export const idleInput: InputState = {
  throttle: 0, steer: 0, pitch: 0, roll: 0, jump: false, boost: false, powerslide: false, camX: 0, camY: 0,
  jumpPressed: false, ballCamPressed: false, resetCarPressed: false, resetBallPressed: false, pausePressed: false,
  freeRoll: 0, trainingMenuPressed: false, placeBallPressed: false, freezeBallPressed: false, resetBoostPressed: false, debugPressed: false,
};
