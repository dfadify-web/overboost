import { useEffect, useRef, useState } from 'react';
import { useGame } from '../core/store';
import { getGame } from './App';
import { Audio } from '../audio/AudioManager';

/** R1 quick reset menu (training). Navigable with D-pad + ✕, closes with ○ / R1 / Esc. */
export function TrainingMenu() {
  const setTrainingMenu = useGame((s) => s.setTrainingMenu);
  const first = useRef<HTMLButtonElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    first.current?.focus();
    const back = () => setTrainingMenu(false);
    window.addEventListener('nav-back', back);
    return () => window.removeEventListener('nav-back', back);
  }, [setTrainingMenu]);
  const g = getGame();
  const run = (fn: () => void, close = true) => () => { Audio.click(true); fn(); if (close) setTrainingMenu(false); else force((n) => n + 1); };
  const items: [string, () => void, boolean?][] = [
    ['Reiniciar coche', () => g?.resetCar()],
    ['Reiniciar balón', () => g?.resetBall()],
    ['Reiniciar coche y balón', () => { g?.resetCar(); g?.resetBall(); }],
    ['Volver a la posición guardada', () => g?.loadSetup()],
    ['Guardar posición actual', () => g?.saveSetup(), false],
    ['Recargar turbo', () => g?.resetBoost()],
    ['Balón delante del coche', () => g?.placeBallInFront()],
    [g?.ball.frozen ? 'Soltar balón' : 'Congelar balón', () => g?.toggleFreezeBall()],
  ];
  return (
    <div className="tmenu">
      <div className="tmenu-box">
        <div className="tmenu-title">REINICIO RÁPIDO <span>R1 / T</span></div>
        {items.map(([label, fn, close], i) => (
          <button key={label} ref={i === 0 ? first : undefined} data-nav className={`tbtn ${label.startsWith('Volver') && !g?.hasSavedSetup ? 'dim' : ''}`} onClick={run(fn, close !== false)}>
            <b>{i + 1}</b>{label}
          </button>
        ))}
        <button data-nav className="tbtn close" onClick={() => setTrainingMenu(false)}>Cerrar <small>○ / Esc</small></button>
      </div>
    </div>
  );
}
