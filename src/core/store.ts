import { create } from 'zustand';
import { PhysTuning, STANDARD_PHYS } from './config';

export type Screen = 'menu' | 'garage' | 'settings' | 'training' | 'playing';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type BallSpawn = 'center' | 'random' | 'shot';

export type Action =
  | 'accelerate' | 'brake' | 'steerLeft' | 'steerRight' | 'jump' | 'boost' | 'powerslide'
  | 'airRollLeft' | 'airRollRight' | 'ballCam' | 'resetCar' | 'resetBall' | 'pause'
  | 'trainingMenu' | 'placeBall' | 'freezeBall' | 'resetBoost' | 'debug';

export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'accelerate', label: 'Acelerar' },
  { id: 'brake', label: 'Frenar / Marcha atrás' },
  { id: 'steerLeft', label: 'Girar izquierda' },
  { id: 'steerRight', label: 'Girar derecha' },
  { id: 'jump', label: 'Saltar' },
  { id: 'boost', label: 'Turbo' },
  { id: 'powerslide', label: 'Derrape / Air roll' },
  { id: 'airRollLeft', label: 'Air roll izquierda' },
  { id: 'airRollRight', label: 'Air roll derecha' },
  { id: 'ballCam', label: 'Cámara balón' },
  { id: 'resetCar', label: 'Reiniciar coche' },
  { id: 'resetBall', label: 'Reiniciar balón' },
  { id: 'pause', label: 'Pausa' },
  { id: 'trainingMenu', label: 'Menú de reinicio (entreno)' },
  { id: 'placeBall', label: 'Balón delante del coche' },
  { id: 'freezeBall', label: 'Congelar / soltar balón' },
  { id: 'resetBoost', label: 'Recargar turbo' },
  { id: 'debug', label: 'Depuración de física' },
];

export const DEFAULT_KEYS: Record<Action, string> = {
  accelerate: 'KeyW', brake: 'KeyS', steerLeft: 'KeyA', steerRight: 'KeyD', jump: 'Space',
  boost: 'ShiftLeft', powerslide: 'ControlLeft', airRollLeft: 'KeyQ', airRollRight: 'KeyE',
  ballCam: 'KeyC', resetCar: 'KeyR', resetBall: 'KeyB', pause: 'Escape',
  trainingMenu: 'KeyT', placeBall: 'KeyF', freezeBall: 'KeyG', resetBoost: 'KeyV', debug: 'F3',
};

// Standard Gamepad mapping (DualSense): 0 X, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 8 Create, 9 Options, 13 D-pad down. -1 = unbound
// L2 is analog: brake/reverse on the ground, FREE AIR ROLL while airborne.
export const DEFAULT_PAD: Record<Action, number> = {
  accelerate: 7, brake: 6, steerLeft: 14, steerRight: 15, jump: 0, boost: 1, powerslide: 2,
  airRollLeft: 4, airRollRight: -1, ballCam: 3, resetCar: 8, resetBall: -1, pause: 9,
  trainingMenu: 5, placeBall: 13, freezeBall: -1, resetBoost: -1, debug: -1,
};

export interface Settings {
  quality: Quality;
  showFps: boolean;
  debugPhysics: boolean;
  fov: number;
  camDistance: number;
  camHeight: number;
  camStiffness: number;
  shake: boolean;
  master: number;
  sfx: number;
  engine: number;
  music: number;
  deadzone: number;
  smoothing: number;
  keys: Record<Action, string>;
  pad: Record<Action, number>;
  unlimitedBoost: boolean;
  gameSpeed: number;
  ballSpawn: BallSpawn;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high', showFps: false, debugPhysics: false, fov: 100, camDistance: 2.9, camHeight: 1.05, camStiffness: 0.45, shake: true,
  master: 0.8, sfx: 0.8, engine: 0.6, music: 0.35, deadzone: 0.12, smoothing: 0.35,
  keys: { ...DEFAULT_KEYS }, pad: { ...DEFAULT_PAD }, unlimitedBoost: false, gameSpeed: 1, ballSpawn: 'center',
};

export const PAINTS = [
  { id: 'cobalt', name: 'Cobalto', color: 0x1f5bff },
  { id: 'crimson', name: 'Carmesí', color: 0xd3122f },
  { id: 'lime', name: 'Lima ácida', color: 0x7ee21b },
  { id: 'ember', name: 'Ascua', color: 0xff6a00 },
  { id: 'graphite', name: 'Grafito', color: 0x2a2e36 },
  { id: 'pearl', name: 'Perla', color: 0xe9ecf2 },
  { id: 'violet', name: 'Violeta', color: 0x7a2cff },
];

interface PersistShape { settings: Settings; car: 0 | 1; paints: [string, string]; tuning: PhysTuning; preset: string }

function load(): PersistShape {
  const def: PersistShape = { settings: DEFAULT_SETTINGS, car: 0, paints: ['pearl', 'crimson'], tuning: { ...STANDARD_PHYS }, preset: 'standard' };
  try {
    const raw = localStorage.getItem('overboost.v3');
    if (!raw) return def;
    const p = JSON.parse(raw);
    return {
      settings: { ...DEFAULT_SETTINGS, ...p.settings, keys: { ...DEFAULT_KEYS, ...(p.settings?.keys || {}) }, pad: { ...DEFAULT_PAD, ...(p.settings?.pad || {}) } },
      car: p.car === 1 ? 1 : 0,
      paints: Array.isArray(p.paints) && p.paints.length === 2 ? p.paints : def.paints,
      tuning: { ...STANDARD_PHYS, ...(p.tuning || {}) },
      preset: p.preset || 'standard',
    };
  } catch { return def; }
}

interface State extends PersistShape {
  screen: Screen;
  paused: boolean;
  settingsFrom: Screen;
  padName: string | null;
  /** 'standard' = normal play with reference physics; 'training' = uses the training tuning */
  mode: 'standard' | 'training';
  trainingMenu: boolean;
  setMode: (m: 'standard' | 'training') => void;
  setTrainingMenu: (v: boolean) => void;
  setTuning: (t: Partial<PhysTuning>, preset?: string) => void;
  setScreen: (s: Screen) => void;
  setPaused: (p: boolean) => void;
  setCar: (c: 0 | 1) => void;
  setPaint: (car: 0 | 1, paint: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  openSettings: (from: Screen) => void;
  setPadName: (n: string | null) => void;
}

const initial = load();

export const useGame = create<State>((set, get) => ({
  ...initial,
  screen: 'menu',
  paused: false,
  settingsFrom: 'menu',
  padName: null,
  mode: 'standard',
  trainingMenu: false,
  setMode: (mode) => set({ mode }),
  setTrainingMenu: (trainingMenu) => set({ trainingMenu }),
  setTuning: (t, preset) => { set({ tuning: { ...get().tuning, ...t }, preset: preset ?? 'custom' }); save(); },
  setScreen: (screen) => set({ screen, paused: false, trainingMenu: false }),
  setPaused: (paused) => set({ paused }),
  setCar: (car) => { set({ car }); save(); },
  setPaint: (c, paint) => { const p = [...get().paints] as [string, string]; p[c] = paint; set({ paints: p }); save(); },
  setSettings: (s) => { set({ settings: { ...get().settings, ...s } }); save(); },
  openSettings: (from) => set({ settingsFrom: from, screen: from === 'playing' ? 'playing' : 'settings' }),
  setPadName: (padName) => set({ padName }),
}));

function save() {
  const { settings, car, paints, tuning, preset } = useGame.getState();
  try { localStorage.setItem('overboost.v3', JSON.stringify({ settings, car, paints, tuning, preset })); } catch { /* ignore */ }
}

export const paintColor = (id: string) => (PAINTS.find((p) => p.id === id) ?? PAINTS[0]).color;
