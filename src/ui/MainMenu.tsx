import { useEffect, useRef } from 'react';
import { useGame } from '../core/store';
import { CAR_SPECS } from '../vehicles/VehicleModels';
import { Audio } from '../audio/AudioManager';

export function MainMenu() {
  const { setScreen, setSettings, setMode, car, padName } = useGame();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const go = (s: Parameters<typeof setScreen>[0]) => () => { Audio.init(); Audio.click(true); setScreen(s); };
  const spec = CAR_SPECS[car];
  return (
    <div className="menu">
      <div className="menu-art" aria-hidden />
      <h1 className="logo">OVERBOOST</h1>
      <div className="sub">FÚTBOL DE COCHES · ARENA</div>
      <div className="menu-list">
        <button ref={first} data-nav className="mbtn primary" onClick={() => { setSettings({ unlimitedBoost: false, gameSpeed: 1, ballSpawn: 'center' }); setMode('standard'); go('playing')(); }}>JUGAR<small>Entrar a la arena con {spec.name} · {spec.model}</small></button>
        <button data-nav className="mbtn" onClick={go('training')}>ENTRENAMIENTO LIBRE<small>Presets de física, flip reset, reinicio rápido R1</small></button>
        <button data-nav className="mbtn" onClick={go('garage')}>GARAJE<small>Vehículo y pintura</small></button>
        <button data-nav className="mbtn" onClick={go('settings')}>AJUSTES<small>Gráficos · Audio · Controles · Cámara</small></button>
      </div>
      <div className="menu-foot">
        <span className="chip"><span className={`dot ${padName ? 'on' : ''}`} />{padName ? `${padName} conectado` : 'Sin mando · pulsa un botón del mando para detectarlo'}</span>
        <span>v1.0 · un jugador</span>
      </div>
    </div>
  );
}
