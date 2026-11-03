import { useEffect, useRef, useState } from 'react';
import { useGame, ACTIONS, Action, Quality, DEFAULT_KEYS, DEFAULT_PAD } from '../core/store';
import { Input, keyName, PAD_BUTTON_NAMES } from '../input/InputManager';
import { Audio } from '../audio/AudioManager';

type Tab = 'graphics' | 'audio' | 'controls' | 'camera';

export function Settings({ onBack }: { onBack: () => void }) {
  const { settings: s, setSettings, padName } = useGame();
  const [tab, setTab] = useState<Tab>('graphics');
  const [waiting, setWaiting] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const back = () => { if (!Input.captureKey && !Input.capturePad) onBack(); };
    window.addEventListener('nav-back', back);
    return () => { window.removeEventListener('nav-back', back); Input.captureKey = null; Input.capturePad = null; };
  }, [onBack]);
  useEffect(() => { Audio.setVolumes(s); }, [s.master, s.sfx, s.engine, s.music]); // eslint-disable-line react-hooks/exhaustive-deps

  const slider = (label: string, key: keyof typeof s, min: number, max: number, step: number, fmt: (v: number) => string = (v) => `${Math.round(v * 100)}%`) => (
    <div className="row"><label>{label}</label>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input data-nav type="range" min={min} max={max} step={step} value={s[key] as number} onChange={(e) => setSettings({ [key]: parseFloat(e.target.value) } as never)} />
        <span className="val">{fmt(s[key] as number)}</span>
      </span>
    </div>
  );
  const seg = <T,>(label: string, val: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="row"><label>{label}</label><div className="seg">{opts.map(([v, l]) => <button key={String(v)} data-nav className={val === v ? 'on' : ''} onClick={() => { Audio.click(); on(v); }}>{l}</button>)}</div></div>
  );

  const bindKey = (a: Action) => {
    setWaiting('k' + a);
    Input.captureKey = (code) => { setWaiting(null); if (code !== 'Escape') setSettings({ keys: { ...useGame.getState().settings.keys, [a]: code } }); };
  };
  const bindPad = (a: Action) => {
    setWaiting('p' + a);
    Input.capturePad = (btn) => { setWaiting(null); setSettings({ pad: { ...useGame.getState().settings.pad, [a]: btn } }); };
  };

  return (
    <div className="screen" style={{ zIndex: 5 }}>
      <div className="head"><h2>AJUSTES</h2><button data-nav className="back" onClick={onBack}>← VOLVER</button></div>
      <div className="tabs">
        {([['graphics', 'GRÁFICOS'], ['audio', 'AUDIO'], ['controls', 'CONTROLES'], ['camera', 'CÁMARA']] as [Tab, string][]).map(([t, l], i) => (
          <button key={t} ref={i === 0 ? first : undefined} data-nav className={`tab ${tab === t ? 'on' : ''}`} onClick={() => { Audio.click(); setTab(t); }}>{l}</button>
        ))}
      </div>
      {tab === 'graphics' && (
        <div className="grid">
          {seg<Quality>('Calidad', s.quality, [['low', 'BAJA'], ['medium', 'MEDIA'], ['high', 'ALTA'], ['ultra', 'ULTRA']], (v) => setSettings({ quality: v }))}
          {seg('Mostrar FPS', s.showFps, [[false, 'NO'], [true, 'SÍ']], (v) => setSettings({ showFps: v }))}
          {seg('Depuración de física (F3)', s.debugPhysics, [[false, 'NO'], [true, 'SÍ']], (v) => setSettings({ debugPhysics: v }))}
          <p className="note" style={{ gridColumn: '1/-1' }}>BAJA: sin sombras ni bloom, resolución 75 %, público reducido. MEDIA: sombras 1K y bloom a media resolución.
            ALTA: sombras 2K, bloom completo. ULTRA: sombras 4K, resolución nativa completa (hasta 2×) y público al 100 %.</p>
        </div>
      )}
      {tab === 'audio' && (
        <div className="grid">
          {slider('Volumen general', 'master', 0, 1, 0.05)}
          {slider('Efectos', 'sfx', 0, 1, 0.05)}
          {slider('Motor', 'engine', 0, 1, 0.05)}
          {slider('Música', 'music', 0, 1, 0.05)}
        </div>
      )}
      {tab === 'camera' && (
        <div className="grid">
          {slider('Campo de visión', 'fov', 60, 120, 1, (v) => `${v}°`)}
          {slider('Distancia', 'camDistance', 2, 5, 0.1, (v) => v.toFixed(1))}
          {slider('Altura', 'camHeight', 0.4, 2.2, 0.05, (v) => v.toFixed(2))}
          {slider('Rigidez', 'camStiffness', 0, 1, 0.05)}
          {seg('Vibración de cámara', s.shake, [[true, 'SÍ'], [false, 'NO']], (v) => setSettings({ shake: v }))}
        </div>
      )}
      {tab === 'controls' && (
        <>
          <div className="row" style={{ marginBottom: 10, maxWidth: 680 }}>
            <label>Mando detectado</label><span className="chip"><span className={`dot ${padName ? 'on' : ''}`} />{padName ?? 'Ninguno — pulsa cualquier botón del mando'}</span>
          </div>
          <div className="grid" style={{ marginBottom: 12 }}>
            {slider('Zona muerta sticks', 'deadzone', 0, 0.4, 0.01)}
            {slider('Suavizado de entrada', 'smoothing', 0, 1, 0.05)}
          </div>
          <div className="grid" style={{ flex: 1 }}>
            {ACTIONS.map((a) => (
              <div className="row" key={a.id}><label>{a.label}</label>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button data-nav className={`bind ${waiting === 'k' + a.id ? 'wait' : ''}`} onClick={() => bindKey(a.id)}>{waiting === 'k' + a.id ? 'Pulsa tecla…' : keyName(s.keys[a.id])}</button>
                  <button data-nav className={`bind ${waiting === 'p' + a.id ? 'wait' : ''}`} onClick={() => bindPad(a.id)}>{waiting === 'p' + a.id ? 'Pulsa botón…' : PAD_BUTTON_NAMES[s.pad[a.id]] ?? `B${s.pad[a.id]}`}</button>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <button data-nav className="back" onClick={() => setSettings({ keys: { ...DEFAULT_KEYS }, pad: { ...DEFAULT_PAD } })}>RESTABLECER CONTROLES</button>
            <span className="note" style={{ margin: 0 }}>Analógicos fijos: stick izq. = dirección / cabeceo · stick der. o arrastrar ratón = cámara · R2/L2 analógicos. En el aire: W/S cabeceo, A/D guiñada, Q/E air roll.</span>
          </div>
        </>
      )}
    </div>
  );
}
