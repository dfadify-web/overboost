import { useEffect, useRef, useState } from 'react';
import { useGame, BallSpawn } from '../core/store';
import { PRESETS, STANDARD_PHYS, PhysTuning } from '../core/config';
import { Audio } from '../audio/AudioManager';

type Num = { [K in keyof PhysTuning]: PhysTuning[K] extends number ? K : never }[keyof PhysTuning];
const SLIDERS: { group: string; items: [Num, string, number, number, number, (v: number) => string][] }[] = [
  { group: 'MUNDO', items: [
    ['gravity', 'Gravedad', 1, 15, 0.25, (v) => `${v.toFixed(2)} m/s²`],
  ] },
  { group: 'BALÓN', items: [
    ['ballRadius', 'Tamaño (radio)', 0.5, 1.8, 0.025, (v) => `${v.toFixed(3)} m`],
    ['ballMass', 'Masa', 10, 80, 1, (v) => `${v}`],
    ['ballRestitution', 'Rebote', 0.1, 0.95, 0.01, (v) => v.toFixed(2)],
    ['ballFriction', 'Fricción', 0, 1, 0.01, (v) => v.toFixed(2)],
    ['ballStartHeight', 'Altura inicial', 0, 15, 0.5, (v) => `${v} m`],
    ['ballStartSpeed', 'Velocidad inicial', 0, 30, 1, (v) => `${v} m/s`],
  ] },
  { group: 'COCHE', items: [
    ['carSpeedMul', 'Velocidad del coche', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`],
    ['boostAccel', 'Fuerza del turbo', 0, 20, 0.1, (v) => `${v.toFixed(1)} m/s²`],
    ['boostStart', 'Turbo inicial', 0, 100, 1, (v) => `${v}`],
    ['jumpImpulse', 'Fuerza de salto', 1, 6, 0.05, (v) => `${v.toFixed(2)} m/s`],
    ['dodgeImpulse', 'Fuerza del flip', 2, 10, 0.1, (v) => `${v.toFixed(1)} m/s`],
    ['airSens', 'Sensibilidad control aéreo', 0.5, 2, 0.05, (v) => `${Math.round(v * 100)}%`],
    ['airRollSens', 'Sensibilidad air roll', 0.5, 2, 0.05, (v) => `${Math.round(v * 100)}%`],
  ] },
  { group: 'SALIDA DEL COCHE', items: [
    ['carStartX', 'Posición X', -35, 35, 1, (v) => `${v} m`],
    ['carStartZ', 'Posición Z', -45, 45, 1, (v) => `${v} m`],
    ['carStartYaw', 'Orientación', -180, 180, 5, (v) => `${v}°`],
    ['carStartSpeed', 'Velocidad inicial', 0, 23, 0.5, (v) => `${v} m/s`],
  ] },
];

/** Shared physics panel (used in the training screen and the pause menu). */
export function TuningPanel() {
  const { tuning, preset, setTuning } = useGame();
  const seg = <T,>(val: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} data-nav className={val === v ? 'on' : ''} onClick={() => { Audio.click(); on(v); }}>{l}</button>)}</div>
  );
  return (
    <>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} data-nav className={`tab ${preset === p.id ? 'on' : ''}`} onClick={() => { Audio.click(true); setTuning({ ...STANDARD_PHYS, ...p.t }, p.id); }}>{p.name}</button>
        ))}
      </div>
      <div className="grid">
        <div className="row"><label>Turbo infinito</label>{seg(tuning.unlimitedBoost, [[false, 'NO'], [true, 'SÍ']], (v) => setTuning({ unlimitedBoost: v }))}</div>
        <div className="row"><label>Pads de turbo</label>{seg(tuning.boostPads, [[true, 'SÍ'], [false, 'NO']], (v) => setTuning({ boostPads: v }))}</div>
        {SLIDERS.map((g) => g.items.map(([k, label, min, max, step, fmt], i) => (
          <div className="row" key={k}>
            <label>{i === 0 && <em className="grp">{g.group}</em>}{label}</label>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input data-nav type="range" min={min} max={max} step={step} value={tuning[k] as number} onChange={(e) => setTuning({ [k]: parseFloat(e.target.value) } as Partial<PhysTuning>)} />
              <span className="val" style={{ width: 78 }}>{fmt(tuning[k] as number)}</span>
            </span>
          </div>
        )))}
      </div>
    </>
  );
}

export function TrainingSetup() {
  const { settings, setSettings, setScreen, setMode } = useGame();
  const first = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'rules' | 'physics'>('rules');
  useEffect(() => {
    first.current?.focus();
    const back = () => setScreen('menu');
    window.addEventListener('nav-back', back);
    return () => window.removeEventListener('nav-back', back);
  }, [setScreen]);
  const seg = <T,>(val: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} data-nav className={val === v ? 'on' : ''} onClick={() => { Audio.click(); on(v); }}>{l}</button>)}</div>
  );
  const enter = () => { Audio.init(); Audio.click(true); setMode('training'); setScreen('playing'); };
  return (
    <div className="screen">
      <div className="head"><h2>ENTRENAMIENTO LIBRE</h2><button data-nav className="back" onClick={() => setScreen('menu')}>← VOLVER</button></div>
      <div className="tabs">
        <button data-nav className={`tab ${tab === 'rules' ? 'on' : ''}`} onClick={() => setTab('rules')}>SESIÓN</button>
        <button data-nav className={`tab ${tab === 'physics' ? 'on' : ''}`} onClick={() => setTab('physics')}>FÍSICA Y PRESETS</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'rules' ? (
          <>
            <div className="grid" style={{ maxWidth: 760 }}>
              <div className="row"><label>Velocidad de juego</label>{seg(settings.gameSpeed, [[0.5, '50%'], [0.75, '75%'], [1, '100%']], (v) => setSettings({ gameSpeed: v }))}</div>
              <div className="row"><label>Saque de balón</label>{seg<BallSpawn>(settings.ballSpawn, [['center', 'CENTRO'], ['random', 'ALEATORIO'], ['shot', 'PASE A TI']], (v) => setSettings({ ballSpawn: v }))}</div>
            </div>
            <p className="note">
              <b>R1 / T</b> menú de reinicio rápido · <b>D-pad ↓ / F</b> balón quieto delante del coche · <b>G</b> congelar balón · <b>V</b> recargar turbo · <b>F3</b> depuración física.<br />
              <b>L2 en el aire</b> = free air roll (stick izq. ← → rueda, ↑ ↓ cabeceo). Flip reset: toca el balón con 3+ ruedas en el aire para recuperar el flip.
            </p>
          </>
        ) : <TuningPanel />}
      </div>
      <div style={{ marginTop: 14, maxWidth: 380 }}>
        <button ref={first} data-nav className="cta" style={{ width: '100%' }} onClick={enter}>ENTRAR A LA ARENA</button>
      </div>
    </div>
  );
}
