import { useGame, Action, ACTIONS } from '../core/store';

export interface InputState {
  throttle: number; // -1..1
  steer: number; // -1..1 (right +)
  pitch: number; // -1..1 (+ = nose up)
  roll: number; // -1..1 (+ = roll right)
  jump: boolean;
  boost: boolean;
  powerslide: boolean;
  camX: number;
  camY: number;
  jumpPressed: boolean;
  ballCamPressed: boolean;
  resetCarPressed: boolean;
  resetBallPressed: boolean;
  pausePressed: boolean;
  /** L2 analog (0..1): brake on ground, free air roll while airborne */
  freeRoll: number;
  trainingMenuPressed: boolean;
  placeBallPressed: boolean;
  freezeBallPressed: boolean;
  resetBoostPressed: boolean;
  debugPressed: boolean;
}

const emptyInput = (): InputState => ({
  throttle: 0, steer: 0, pitch: 0, roll: 0, jump: false, boost: false, powerslide: false, camX: 0, camY: 0,
  jumpPressed: false, ballCamPressed: false, resetCarPressed: false, resetBallPressed: false, pausePressed: false,
  freeRoll: 0, trainingMenuPressed: false, placeBallPressed: false, freezeBallPressed: false, resetBoostPressed: false, debugPressed: false,
});

const deadzone = (v: number, dz: number) => {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
};

class InputManagerImpl {
  state: InputState = emptyInput();
  private keys = new Set<string>();
  private tapped = new Set<string>();
  private prevActive = new Set<Action>();
  private smooth = { steer: 0, pitch: 0, throttle: 0 };
  private mouse = { down: false, dx: 0, dy: 0, camX: 0, camY: 0 };
  padIndex: number | null = null;
  padName: string | null = null;
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';
  /** When set, next key/button press is delivered here (rebinding). */
  captureKey: ((code: string) => void) | null = null;
  capturePad: ((button: number) => void) | null = null;
  private padPrevButtons: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.captureKey) { e.preventDefault(); const cb = this.captureKey; this.captureKey = null; cb(e.code); return; }
      if (useGame.getState().screen === 'playing' && !['F5', 'F11', 'F12'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.tapped.add(e.code);
      this.keys.add(e.code); this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => this.onPad(e as GamepadEvent, true));
    window.addEventListener('gamepaddisconnected', (e) => this.onPad(e as GamepadEvent, false));
    window.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement)?.tagName === 'CANVAS') this.mouse.down = true; });
    window.addEventListener('mouseup', () => (this.mouse.down = false));
    window.addEventListener('mousemove', (e) => { if (this.mouse.down) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
  }

  private onPad(e: GamepadEvent, connected: boolean) {
    if (connected) { this.padIndex = e.gamepad.index; this.padName = prettyPad(e.gamepad.id); this.lastDevice = 'gamepad'; }
    else if (this.padIndex === e.gamepad.index) { this.padIndex = null; this.padName = null; }
    useGame.getState().setPadName(this.padName);
  }

  private getPad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; this.padName = prettyPad(p.id); useGame.getState().setPadName(this.padName); return p; }
    return null;
  }

  /** Call once per rendered frame. Edge flags accumulate until consumeEdges(). */
  update(dt: number) {
    const { settings } = useGame.getState();
    const k = settings.keys, pb = settings.pad, dz = settings.deadzone;
    const pad = this.getPad();
    const btn = (i: number) => (pad && pad.buttons[i] ? pad.buttons[i].value : 0);
    const btnOn = (i: number) => btn(i) > 0.35;

    if (pad && this.capturePad) {
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pad.buttons[i].pressed && !this.padPrevButtons[i]) { const cb = this.capturePad; this.capturePad = null; cb(i); break; }
      }
    }
    if (pad) this.padPrevButtons = pad.buttons.map((b) => b.pressed);

    const active = new Set<Action>();
    for (const a of ACTIONS) {
      if (this.keys.has(k[a.id]) || this.tapped.has(k[a.id])) active.add(a.id);
      if (pad && pb[a.id] >= 0 && btnOn(pb[a.id])) { active.add(a.id); this.lastDevice = 'gamepad'; }
    }

    // Analog
    let lx = 0, ly = 0, rx = 0, ry = 0, r2 = 0, l2 = 0;
    if (pad) {
      lx = deadzone(pad.axes[0] ?? 0, dz); ly = deadzone(pad.axes[1] ?? 0, dz);
      rx = deadzone(pad.axes[2] ?? 0, dz); ry = deadzone(pad.axes[3] ?? 0, dz);
      r2 = btn(pb.accelerate); l2 = btn(pb.brake);
      if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + r2 + l2 > 0.05) this.lastDevice = 'gamepad';
    }
    const kb = (a: Action) => (this.keys.has(k[a]) ? 1 : 0);
    // digital sources (keyboard / d-pad) are smoothed; analog sticks & triggers pass through unfiltered (no input lag)
    const dSteer = kb('steerRight') - kb('steerLeft') + (pad && btnOn(pb.steerRight) ? 1 : 0) - (pad && btnOn(pb.steerLeft) ? 1 : 0);
    const dThrottle = kb('accelerate') - kb('brake');
    const dPitch = kb('brake') - kb('accelerate'); // S = nose up

    // smoothing (only matters for digital input; analog gets light filtering)
    const s = settings.smoothing;
    const rate = s <= 0.01 ? 1 : Math.min(1, dt * (4 + (1 - s) * 40));
    this.smooth.steer += (dSteer - this.smooth.steer) * rate;
    this.smooth.pitch += (dPitch - this.smooth.pitch) * rate;
    this.smooth.throttle += (dThrottle - this.smooth.throttle) * Math.min(1, rate * 1.5);
    const steer = clamp1(lx + this.smooth.steer), pitch = clamp1(ly + this.smooth.pitch), throttle = clamp1(r2 - l2 + this.smooth.throttle);

    const roll = (active.has('airRollRight') ? 1 : 0) - (active.has('airRollLeft') ? 1 : 0);

    // Camera: right stick + mouse drag
    this.mouse.camX = clamp1(this.mouse.camX + this.mouse.dx * 0.004);
    this.mouse.camY = clamp1(this.mouse.camY + this.mouse.dy * 0.004);
    this.mouse.dx = this.mouse.dy = 0;
    if (!this.mouse.down) { this.mouse.camX *= Math.max(0, 1 - dt * 5); this.mouse.camY *= Math.max(0, 1 - dt * 5); }

    const st = this.state;
    const pressed = (a: Action) => active.has(a) && !this.prevActive.has(a);
    st.throttle = throttle;
    st.steer = steer;
    st.pitch = pitch;
    st.freeRoll = l2;
    st.roll = roll;
    st.jump = active.has('jump');
    st.boost = active.has('boost');
    st.powerslide = active.has('powerslide');
    st.camX = clamp1(rx + this.mouse.camX);
    st.camY = clamp1(ry + this.mouse.camY);
    st.jumpPressed ||= pressed('jump');
    st.ballCamPressed ||= pressed('ballCam');
    st.resetCarPressed ||= pressed('resetCar');
    st.resetBallPressed ||= pressed('resetBall');
    st.pausePressed ||= pressed('pause');
    st.trainingMenuPressed ||= pressed('trainingMenu');
    st.placeBallPressed ||= pressed('placeBall');
    st.freezeBallPressed ||= pressed('freezeBall');
    st.resetBoostPressed ||= pressed('resetBoost');
    st.debugPressed ||= pressed('debug');
    this.prevActive = new Set([...active].filter((a) => this.keys.has(k[a]) || (pad && pb[a] >= 0 && btnOn(pb[a]))));
    this.tapped.clear();
  }

  consumeEdges() {
    const s = this.state;
    s.jumpPressed = s.ballCamPressed = s.resetCarPressed = s.resetBallPressed = s.pausePressed = false;
    s.trainingMenuPressed = s.placeBallPressed = s.freezeBallPressed = s.resetBoostPressed = s.debugPressed = false;
  }

  rumble(strong: number, weak: number, ms: number) {
    const pad = this.getPad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

function prettyPad(id: string) {
  if (/dualsense|0ce6/i.test(id)) return 'DualSense (PS5)';
  if (/dualshock|05c4|09cc/i.test(id)) return 'DualShock 4';
  if (/xbox|xinput/i.test(id)) return 'Mando Xbox';
  return id.replace(/\(.*?\)/g, '').trim().slice(0, 32) || 'Mando';
}

export const Input = new InputManagerImpl();

export const PAD_BUTTON_NAMES: Record<number, string> = {
  0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Create', 9: 'Options',
  10: 'L3', 11: 'R3', 12: 'D-pad ↑', 13: 'D-pad ↓', 14: 'D-pad ←', 15: 'D-pad →', 16: 'PS', 17: 'Touchpad',
};

export function keyName(code: string) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' Izq').replace('Right', ' Der')
    .replace('Space', 'Espacio').replace('Shift', 'Shift').replace('Control', 'Ctrl').replace('Escape', 'Esc');
}
