import { useEffect, useRef, useState } from 'react';
import { useGame } from '../core/store';
import { getGame } from './App';
import { Settings } from './Settings';
import { TuningPanel } from './TrainingSetup';
import { Audio } from '../audio/AudioManager';

export function PauseMenu() {
  const { setPaused, setScreen } = useGame();
  const [settings, setSettingsOpen] = useState(false);
  const [physics, setPhysics] = useState(false);
  const mode = useGame((s) => s.mode);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (settings || physics) return;
    first.current?.focus();
    const back = () => setPaused(false);
    window.addEventListener('nav-back', back);
    return () => window.removeEventListener('nav-back', back);
  }, [settings, physics, setPaused]);
  const act = (fn: () => void) => () => { Audio.click(true); fn(); };
  if (settings) return <Settings onBack={() => setSettingsOpen(false)} />;
  if (physics) return (
    <div className="screen" style={{ zIndex: 5 }}>
      <div className="head"><h2>FÍSICA DE ENTRENAMIENTO</h2><button data-nav className="back" onClick={() => setPhysics(false)}>← VOLVER</button></div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}><TuningPanel /></div>
    </div>
  );
  return (
    <div className="pause">
      <div className="box">
        <h2>PAUSA</h2>
        <button ref={first} data-nav className="mbtn primary" onClick={act(() => setPaused(false))}>CONTINUAR</button>
        <button data-nav className="mbtn" onClick={act(() => { getGame()?.restartTraining(); setPaused(false); })}>REINICIAR ENTRENAMIENTO</button>
        <button data-nav className="mbtn" onClick={act(() => { getGame()?.resetCar(); setPaused(false); })}>REINICIAR COCHE</button>
        <button data-nav className="mbtn" onClick={act(() => { getGame()?.resetBall(); setPaused(false); })}>REINICIAR BALÓN</button>
        <button data-nav className="mbtn" onClick={act(() => getGame()?.cams.toggle())}>CAMBIAR CÁMARA</button>
        {mode === 'training' && <button data-nav className="mbtn" onClick={act(() => setPhysics(true))}>FÍSICA Y PRESETS</button>}
        <button data-nav className="mbtn" onClick={act(() => setSettingsOpen(true))}>AJUSTES</button>
        <button data-nav className="mbtn" onClick={act(() => setScreen('menu'))}>SALIR AL MENÚ</button>
      </div>
    </div>
  );
}
