import { useEffect, useRef, useState } from 'react';
import { Game } from '../core/Game';
import { useGame } from '../core/store';
import { MainMenu } from './MainMenu';
import { Garage } from './Garage';
import { Settings } from './Settings';
import { TrainingSetup } from './TrainingSetup';
import { HUD } from './HUD';
import { PauseMenu } from './PauseMenu';
import { TrainingMenu } from './TrainingMenu';
import { startPadNav } from './padNav';
import { Audio } from '../audio/AudioManager';
import { preloadCarAssets } from '../vehicles/VehicleModels';

let game: Game | null = null;
export const getGame = () => game;

export default function App() {
  const stage = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screen = useGame((s) => s.screen);
  const paused = useGame((s) => s.paused);
  const trainingMenu = useGame((s) => s.trainingMenu);

  useEffect(() => {
    if (game || !stage.current) return;
    game = new Game(stage.current);
    (window as unknown as { __game: Game }).__game = game;
    import('../core/PhysicsTests').then((m) => { (window as unknown as { __tests: unknown }).__tests = m.makeTests(game!); });
    preloadCarAssets().then(() => game!.init()).then(() => setReady(true)).catch((e) => { console.error(e); setError(String(e?.message ?? e)); });
    startPadNav();
    const unlock = () => Audio.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }, []);

  return (
    <>
      <div className="stage" ref={stage} />
      {!ready && (
        <div className="loading">
          <div style={{ textAlign: 'center' }}><b>OVERBOOST</b>{error ? `ERROR: ${error}` : 'CARGANDO ARENA…'}</div>
        </div>
      )}
      {ready && (
        <div className="overlay">
          {screen === 'menu' && <MainMenu />}
          {screen === 'garage' && <Garage />}
          {screen === 'settings' && <Settings onBack={() => useGame.getState().setScreen('menu')} />}
          {screen === 'training' && <TrainingSetup />}
          {screen === 'playing' && <HUD />}
          {screen === 'playing' && paused && <PauseMenu />}
          {screen === 'playing' && trainingMenu && !paused && <TrainingMenu />}
        </div>
      )}
    </>
  );
}
