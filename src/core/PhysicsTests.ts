import * as THREE from 'three';
import type { Game } from './Game';
import { idleInput } from './Game';
import { ARENA, BALL, PHYS, PHYS_DT, applyTuning } from './config';
import type { InputState } from '../input/InputManager';

type R = { name: string; ok: boolean; detail: string };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Deterministic physics calibration suite. Run from the console: `await __tests.run()` */
export function makeTests(game: Game) {
  const g = game as unknown as { physicsStep: (i: InputState, dt: number, playing: boolean) => void; time: number };
  const step = (sec: number, inp: Partial<InputState> = {}, pressFirst = false) => {
    const n = Math.round(sec / PHYS_DT);
    for (let i = 0; i < n; i++) g.physicsStep({ ...idleInput, ...inp, jumpPressed: pressFirst && i === 0 }, PHYS_DT, true);
  };
  const car = () => game.car;
  const ball = () => game.ball;
  const clearGoal = () => { (game as unknown as { goalPending: number }).goalPending = -1; game.ball.mesh.visible = true; };
  const rest = (pos = V(0, 0.55, -30), yawDeg = 0, speed = 0) => { clearGoal(); game.placeCar(pos, yawDeg, speed); step(0.4); };
  const deg = (r: number) => (r * 180) / Math.PI;
  const upAngle = () => deg(car().up.angleTo(V(0, 1, 0)));

  const tests: [string, () => R][] = [
    ['1 aceleración desde parado', () => {
      rest(); step(1, { throttle: 1 }); const v1 = car().speed; step(2, { throttle: 1 }); const v3 = car().speed;
      return { name: '', ok: v1 > 8 && v3 > 13 && v3 <= 14.3, detail: `1 s: ${v1.toFixed(2)} m/s · 3 s: ${v3.toFixed(2)} m/s (máx sin turbo ${PHYS.throttleMax})` };
    }],
    ['2 frenada desde velocidad máx.', () => {
      rest(V(0, 0.55, -45)); PHYS.unlimitedBoost = true; step(4, { throttle: 1, boost: true }); PHYS.unlimitedBoost = false; const v0 = car().speed; const z0 = car().pos.z;
      let t = 0; while (car().speed > 0.3 && t < 4) { step(PHYS_DT, { throttle: -1 }); t += PHYS_DT; }
      return { name: '', ok: v0 > 20 && t < 1.2, detail: `de ${v0.toFixed(1)} m/s a 0 en ${t.toFixed(2)} s, ${(car().pos.z - z0).toFixed(1)} m` };
    }],
    ['3 giro baja vs alta velocidad', () => {
      rest(); step(0.6, { throttle: 0.5 }); const vLow = car().speed; step(0.4, { throttle: 0.4, steer: 1 }); const wLow = Math.abs(car().angVel.y);
      rest(V(0, 0.55, -45)); step(2.5, { throttle: 1, boost: true }); const vHi = car().speed; step(0.4, { throttle: 1, boost: true, steer: 1 }); const wHi = Math.abs(car().angVel.y);
      const rLow = vLow / Math.max(wLow, 1e-3), rHi = vHi / Math.max(wHi, 1e-3);
      return { name: '', ok: rHi > rLow * 3, detail: `radio a ${vLow.toFixed(1)} m/s ≈ ${rLow.toFixed(1)} m · a ${vHi.toFixed(1)} m/s ≈ ${rHi.toFixed(1)} m` };
    }],
    ['4 derrape (powerslide)', () => {
      rest(V(0, 0.55, -40)); step(2, { throttle: 1, boost: true }); const v0 = car().speed;
      step(0.5, { throttle: 1, steer: 1, powerslide: true }); const slip = car().slip, v1 = car().speed;
      return { name: '', ok: slip > 3 && v1 > v0 * 0.45, detail: `deslizamiento lateral ${slip.toFixed(1)} m/s, conserva ${Math.round((v1 / v0) * 100)}% de velocidad` };
    }],
    ['5 primer salto (mantenido / tocado)', () => {
      rest(); let h = 0; step(PHYS_DT, { jump: true }, true); for (let i = 0; i < 120; i++) { step(PHYS_DT, { jump: true }); h = Math.max(h, car().pos.y); }
      step(1.5); rest(); let h2 = 0; step(PHYS_DT, { jump: true }, true); for (let i = 0; i < 120; i++) { step(PHYS_DT); h2 = Math.max(h2, car().pos.y); }
      return { name: '', ok: h > h2 + 0.2 && h2 > 0.7, detail: `altura máx mantenido ${h.toFixed(2)} m · toque corto ${h2.toFixed(2)} m` };
    }],
    ['6 doble salto (dirección del techo)', () => {
      rest(); step(PHYS_DT, { jump: true }, true); step(0.2, { jump: true }); step(0.1);
      const vy0 = car().vel.y; step(PHYS_DT, {}, true); const dvy = car().vel.y - vy0; let h = 0; for (let i = 0; i < 120; i++) { step(PHYS_DT); h = Math.max(h, car().pos.y); }
      return { name: '', ok: dvy > 2.5 && h > 2.2, detail: `Δvy ${dvy.toFixed(2)} m/s, altura máx ${h.toFixed(2)} m` };
    }],
    ['7 front flip', () => flipTest(-1, 0, 'front')],
    ['8 backflip', () => flipTest(1, 0, 'back')],
    ['9 side flip', () => flipTest(0, 1, 'side')],
    ['10 flip cancel', () => {
      rest(); step(PHYS_DT, { jump: true }, true); step(0.1, { jump: true }); step(0.15);
      step(PHYS_DT, { pitch: -1 }, true); step(0.08, { pitch: -1 }); step(0.4, { pitch: 1 });
      const fwdVel = car().vel.clone().setY(0).length(); const nose = deg(Math.asin(THREE.MathUtils.clamp(car().fwd.y, -1, 1)));
      return { name: '', ok: car().flipCancelled && fwdVel > 4 && Math.abs(nose) < 70, detail: `cancelado=${car().flipCancelled}, velocidad horizontal ${fwdVel.toFixed(1)} m/s, morro ${nose.toFixed(0)}° (sin vuelta completa)` };
    }],
    ['11 free air roll (L2) continuo', () => {
      rest(); step(PHYS_DT, { jump: true }, true); step(0.2, { jump: true });
      let total = 0; const q0 = car().currRot.clone();
      for (let i = 0; i < 120; i++) { step(PHYS_DT, { freeRoll: 1, steer: 1 }); total += car().angVel.dot(car().fwd) * PHYS_DT; }
      const wRoll = car().angVel.dot(car().fwd); step(0.2, { freeRoll: 1 }); const wAfter = car().angVel.dot(car().fwd);
      void q0;
      return { name: '', ok: deg(total) > 250 && wAfter > 0.2 && wAfter < wRoll, detail: `rodado ${deg(total).toFixed(0)}° en 1 s, ω ${wRoll.toFixed(2)} → ${wAfter.toFixed(2)} rad/s al soltar (conserva momento)` };
    }],
    ['12 air roll + turbo + cabeceo', () => {
      rest(); step(PHYS_DT, { jump: true }, true); step(0.2, { jump: true }); step(0.3, { pitch: 1 });
      const v0 = car().vel.clone(); let fAvg = V(0, 0, 0);
      for (let i = 0; i < 72; i++) { step(PHYS_DT, { freeRoll: 1, steer: 0.6, pitch: 0.5, boost: true }); fAvg.add(car().fwd); }
      const dv = car().vel.clone().sub(v0).add(V(0, PHYS.gravity * 0.6, 0)); // remove gravity → boost-only Δv
      const align = dv.clone().normalize().dot(fAvg.normalize()); // boost follows the (rotating) nose
      return { name: '', ok: dv.length() > 4.5 && align > 0.9 && car().angVel.length() > 1, detail: `Δv ${dv.length().toFixed(2)} m/s (alineación con el morro ${align.toFixed(2)}), ω ${car().angVel.length().toFixed(2)} rad/s` };
    }],
    ['13 rotación aérea sin turbo + amortiguación', () => {
      rest(); step(PHYS_DT, { jump: true }, true); step(0.2, { jump: true }); step(0.3, { pitch: 1 });
      const w1 = car().angVel.length(); step(0.3); const w2 = car().angVel.length();
      return { name: '', ok: w1 > 2.5 && w2 < w1 && w2 > 0.2 && w1 <= PHYS.maxAngVel + 0.01, detail: `ω ${w1.toFixed(2)} → ${w2.toFixed(2)} rad/s tras soltar 0,3 s (máx ${PHYS.maxAngVel})` };
    }],
    ['14 conducción por pared', () => {
      game.placeCar(V(20, 0.5, 0), 90, 15); step(0.2);
      let maxY = 0, wall = 0; for (let i = 0; i < 300; i++) { step(PHYS_DT, { throttle: 1 }); maxY = Math.max(maxY, car().pos.y); if (car().surface === 'wall') wall++; }
      return { name: '', ok: maxY > 8 && wall > 100, detail: `altura máx ${maxY.toFixed(1)} m, ${(wall * PHYS_DT).toFixed(2)} s en pared` };
    }],
    ['15 conducción por techo', () => {
      game.placeCar(V(20, 0.5, 0), 90, 15); step(0.2);
      let ceil = 0; for (let i = 0; i < 480; i++) { step(PHYS_DT, { throttle: 1, boost: true }); if (car().surface === 'ceiling') ceil++; }
      return { name: '', ok: ceil > 10, detail: `${(ceil * PHYS_DT).toFixed(2)} s con ruedas en el techo` };
    }],
    ['16 balón rodando', () => {
      rest(V(-30, 0.55, -40)); ball().place(V(0, BALL.radius + 0.01, 0), V(0, 0, 10)); step(2);
      const v = ball().body.linvel(); const s = Math.hypot(v.x, v.y, v.z);
      return { name: '', ok: s > 5 && s < 10 && Math.abs(ball().currPos.y - BALL.radius) < 0.05, detail: `10 → ${s.toFixed(2)} m/s en 2 s, altura ${ball().currPos.y.toFixed(3)} (r ${BALL.radius})` };
    }],
    ['17 balón botando', () => {
      ball().place(V(0, 10, 0)); let peaks: number[] = [], prevVy = 0;
      for (let i = 0; i < 720; i++) { step(PHYS_DT); const vy = ball().body.linvel().y; if (prevVy > 0 && vy <= 0) peaks.push(ball().currPos.y); prevVy = vy; }
      const ratio = peaks.length >= 2 ? (peaks[1] - BALL.radius) / (peaks[0] - BALL.radius) : 0;
      return { name: '', ok: peaks.length >= 2 && ratio > 0.2 && ratio < 0.6, detail: `picos ${peaks.slice(0, 3).map((p) => p.toFixed(2)).join(' → ')} m (e≈${Math.sqrt(ratio).toFixed(2)})` };
    }],
    ['18 balón contra pared de fondo', () => {
      ball().place(V(15, 4, 40), V(0, 0, 25)); let minVz = 99, maxZ = 0;
      for (let i = 0; i < 180; i++) { step(PHYS_DT); const v = ball().body.linvel(); minVz = Math.min(minVz, v.z); maxZ = Math.max(maxZ, ball().currPos.z); }
      return { name: '', ok: minVz < -5 && maxZ < ARENA.L / 2, detail: `rebote vz ${minVz.toFixed(1)} m/s, z máx ${maxZ.toFixed(2)} (pared ${ARENA.L / 2})` };
    }],
    ['19 balón entra en la portería (balón entero)', () => {
      const s0 = game.hud.scoreA; ball().place(V(0, 2, 44), V(0, 0, 14));
      let zAtGoal = 0; for (let i = 0; i < 240; i++) { step(PHYS_DT); if (game.hud.scoreA > s0 && !zAtGoal) zAtGoal = ball().currPos.z; }
      return { name: '', ok: game.hud.scoreA === s0 + 1 && zAtGoal >= ARENA.L / 2 + BALL.radius - 0.2, detail: `gol detectado con el centro en z=${zAtGoal.toFixed(2)} (línea ${ARENA.L / 2} + r ${BALL.radius})` };
    }],
    ['20 golpes al balón en distintos ángulos', () => {
      const out: string[] = []; let ok = true; clearGoal();
      for (const [label, ox] of [['frontal', 0], ['lateral', 0.9], ['roce', 1.15]] as const) {
        clearGoal(); game.placeCar(V(ox, 0.55, -12), 0, 0); ball().place(V(0, BALL.radius + 0.01, 0)); step(0.3);
        game.hud.touches = 0; let t = 0; while (game.hud.touches === 0 && t < 3) { step(PHYS_DT, { throttle: 1, boost: true }); t += PHYS_DT; }
        const before = game.hud.touches; game.hud.touches = 0; step(0.3, { throttle: 1 });
        const v = ball().body.linvel(); const s = Math.hypot(v.x, v.y, v.z); out.push(`${label} ${s.toFixed(1)} m/s`);
        if (label === 'frontal' && s < 15) ok = false;
        if (label === 'roce' && s > 18) ok = false;
        void before;
      }
      return { name: '', ok, detail: out.join(' · ') };
    }],
    ['21 flip reset (4 ruedas sobre el balón)', () => resetTest(true)],
    ['22 sin reset con < 3 ruedas', () => resetTest(false)],
    ['23 D-pad ↓: balón delante del coche', () => {
      rest(V(5, 0.55, 5), 37); game.placeBallInFront(); step(PHYS_DT);
      const d = ball().currPos.clone().sub(car().currPos).setY(0); const along = d.dot(car().fwd.clone().setY(0).normalize());
      const v = ball().body.linvel(); const still = Math.hypot(v.x, v.y, v.z) < 0.2;
      return { name: '', ok: Math.abs(ball().currPos.y - BALL.radius) < 0.06 && along > car().spec.half[0] + BALL.radius && along < car().spec.half[0] + BALL.radius + 0.4 && still,
        detail: `distancia ${along.toFixed(2)} m por delante, altura ${ball().currPos.y.toFixed(3)}, quieto=${still}` };
    }],
    ['24 R1: guardar / volver a posición', () => {
      rest(V(10, 0.55, 10), 45); ball().place(V(12, 3, 14)); step(0.1); game.saveSetup(); const p0 = car().currPos.clone(), b0 = ball().currPos.clone();
      step(1, { throttle: 1 }); game.loadSetup(); step(PHYS_DT);
      return { name: '', ok: car().currPos.distanceTo(p0) < 0.1 && ball().currPos.distanceTo(b0) < 0.15, detail: `coche Δ${car().currPos.distanceTo(p0).toFixed(3)} m, balón Δ${ball().currPos.distanceTo(b0).toFixed(3)} m` };
    }],
  ];

  function flipTest(pitch: number, steer: number, kind: string): R {
    rest(); step(PHYS_DT, { jump: true }, true); step(0.1, { jump: true }); step(0.1);
    const v0 = car().vel.clone(); const f0 = car().fwd.clone(), r0 = car().right.clone();
    step(PHYS_DT, { pitch, steer }, true); const dv = car().vel.clone().sub(v0).setY(0);
    let rot = 0, rot07 = 0; for (let i = 0; i < 144; i++) { step(PHYS_DT); rot += car().angVel.length() * PHYS_DT; if (i === 83) rot07 = rot; }
    const dir = kind === 'side' ? dv.dot(r0) : dv.dot(f0) * -pitch;
    return { name: '', ok: dir > 4 && deg(rot) > 280, detail: `impulso ${dv.length().toFixed(2)} m/s en la dirección correcta=${dir > 4}, giro ${deg(rot07).toFixed(0)}° a 0,7 s · ${deg(rot).toFixed(0)}° a 1,2 s` };
  }

  function resetTest(valid: boolean): R {
    // ball hovering, car upside-down above it (or tilted so only 2 wheels can touch)
    clearGoal(); ball().setFrozen(true); ball().place(V(0, 6, 0));
    // car above the ball, wheels toward it (valid) — or rolled 50° so at most two wheels can reach it (invalid)
    // invalid: nose-down 75° so the bumper (and at most the two front wheels) meets the ball
    const q = new THREE.Quaternion();
    // valid: dropping onto the ball wheels-first · invalid: hitting it with the side of the car (wheels not facing it)
    const dir = valid ? V(0, 1, 0) : V(0, 0, 1);
    car().setPose(V(0, 6, 0).addScaledVector(dir, BALL.radius + (valid ? 0.3 : 0.5)), q, dir.clone().multiplyScalar(-1.5), V(0, 0, 0));
    // consume the flip the car "used" earlier
    (car() as unknown as { hasFlip: boolean; jumped: boolean }).hasFlip = false; (car() as unknown as { jumped: boolean }).jumped = true;
    let resets = 0; const t0 = game.hud.flipResetAt;
    let maxW = 0; for (let i = 0; i < (valid ? 60 : 24); i++) { step(PHYS_DT); maxW = Math.max(maxW, car().wheelsOnBall); if (game.hud.flipResetAt !== t0) resets++; }
    const has = car().hasFlip; const wheels = maxW;
    ball().setFrozen(false);
    return valid
      ? { name: '', ok: has && game.hud.flipResetAt !== t0, detail: `flip recuperado=${has}, ruedas sobre el balón ${wheels}` }
      : { name: '', ok: !has, detail: `flip recuperado=${has} (correcto: no), ruedas sobre el balón máx ${wheels}` };
  }

  return {
    async run() {
      const saved = { ...PHYS };
      applyTuning({});
      const res: R[] = [];
      for (const [name, fn] of tests) {
        try { const r = fn(); r.name = name; res.push(r); } catch (e) { res.push({ name, ok: false, detail: 'ERROR ' + (e as Error).message }); }
      }
      Object.assign(PHYS, saved);
      clearGoal(); game.hud.goalAt = -10; game.hud.scoreA = game.hud.scoreB = 0; game.hud.touches = 0; game.hud.flipResetAt = -10;
      game.resetCar(); game.resetBall();
      console.table(res);
      return res;
    },
  };
}
