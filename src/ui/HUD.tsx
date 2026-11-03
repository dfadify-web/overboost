import { useEffect, useRef, useState } from 'react';
import { getGame } from './App';
import { useGame } from '../core/store';
import { keyName, PAD_BUTTON_NAMES } from '../input/InputManager';

const SURF: Record<string, string> = { ground: 'SUELO', wall: 'PARED', ceiling: 'TECHO', air: 'AIRE' };

/** HUD reads game.hud each frame and writes to DOM refs directly (no React re-render per frame). */
export function HUD() {
  const r = {
    speed: useRef<HTMLElement>(null), boost: useRef<HTMLElement>(null), arc: useRef<SVGCircleElement>(null),
    surf: useRef<HTMLSpanElement>(null), cam: useRef<HTMLSpanElement>(null), ss: useRef<HTMLSpanElement>(null),
    a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null), goal: useRef<HTMLDivElement>(null), goalT: useRef<HTMLSpanElement>(null),
    fps: useRef<HTMLDivElement>(null), shot: useRef<HTMLSpanElement>(null), touches: useRef<HTMLSpanElement>(null),
    flip: useRef<HTMLSpanElement>(null), reset: useRef<HTMLDivElement>(null), dbg: useRef<HTMLPreElement>(null), roll: useRef<HTMLSpanElement>(null),
  };
  const { settings, padName } = useGame();
  const [showKeys, setShowKeys] = useState(true);
  const [device, setDevice] = useState('keyboard');

  useEffect(() => {
    let raf = 0;
    const C = 2 * Math.PI * 84;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = getGame(); if (!g) return;
      const h = g.hud;
      if (r.speed.current) r.speed.current.textContent = String(Math.round(h.speed * 3.6));
      if (r.boost.current) r.boost.current.textContent = String(Math.round(h.boost));
      if (r.arc.current) r.arc.current.style.strokeDashoffset = String(C * 0.75 * (1 - h.boost / 100) + C * 0.25);
      if (r.surf.current) { r.surf.current.textContent = SURF[h.surface] ?? h.surface; r.surf.current.className = `tag ${h.surface === 'wall' || h.surface === 'ceiling' ? 'hot' : ''}`; }
      if (r.cam.current) r.cam.current.textContent = h.cam === 'ball' ? 'CÁM. BALÓN' : 'CÁM. COCHE';
      if (r.ss.current) r.ss.current.style.display = h.supersonic ? '' : 'none';
      if (r.a.current) r.a.current.textContent = String(h.scoreA);
      if (r.b.current) r.b.current.textContent = String(h.scoreB);
      if (r.fps.current) r.fps.current.textContent = `${h.fps} FPS`;
      if (r.shot.current) r.shot.current.textContent = `${Math.round(h.lastShot)} km/h`;
      if (r.touches.current) r.touches.current.textContent = String(h.touches);
      const since = performance.now() / 1000;
      void since;
      const T = (g as unknown as { time: number }).time;
      if (r.flip.current) {
        r.flip.current.style.display = h.canDodge ? '' : 'none';
        r.flip.current.textContent = h.flipFromReset ? 'FLIP ✓ (RESET)' : 'FLIP ✓';
        r.flip.current.className = 'tag ' + (h.flipFromReset ? 'hot' : '');
      }
      if (r.roll.current) r.roll.current.style.display = h.freeRoll ? '' : 'none';
      if (r.reset.current) r.reset.current.className = 'flipreset ' + (T - h.flipResetAt < 1.1 ? 'show' : '');
      if (r.dbg.current) {
        r.dbg.current.style.display = h.debug ? '' : 'none';
        if (h.debug) r.dbg.current.textContent =
          `FÍSICA      ${h.physHz} Hz  (dt 1/120)   FPS ${h.fps}
coche       ${(h.speed).toFixed(2)} m/s   ω ${h.angVel.toFixed(2)} rad/s
balón       ${h.ballSpeed.toFixed(2)} m/s${h.frozen ? '  [CONGELADO]' : ''}
turbo       ${Math.round(h.boost)}
estado      ${h.surface.toUpperCase()} · salto: ${h.jumpState}
flip        ${h.canDodge ? 'disponible' : 'no'}${h.flipFromReset ? ' (reset/sin límite)' : ''}${h.dodging ? ' · GIRANDO' : ''}${h.flipCancelled ? ' · CANCELADO' : ''}
ruedas/balón ${h.wheelsOnBall}/4   free roll ${h.freeRoll ? 'ON' : 'off'}`;
      }
      const showGoal = T - h.goalAt < 2.4;
      if (r.goal.current) {
        r.goal.current.className = `goal ${showGoal ? 'show' : ''}`;
        r.goal.current.style.color = h.goalTeam === 0 ? 'var(--cyan)' : 'var(--amber)';
        if (r.goalT.current) r.goalT.current.textContent = `${h.scoreA} — ${h.scoreB}`;
      }
      if (h.device !== device) setDevice(h.device);
    };
    tick();
    const t = setTimeout(() => setShowKeys(false), 14000);
    const toggle = (e: KeyboardEvent) => { if (e.code === 'KeyH') setShowKeys((v) => !v); };
    window.addEventListener('keydown', toggle);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('keydown', toggle); };
  }, [device]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = settings.keys, p = settings.pad;
  const pn = (a: keyof typeof p) => PAD_BUTTON_NAMES[p[a]] ?? p[a];
  const pad = device === 'gamepad';
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="s a" ref={r.a}>0</div>
        <div className="mid">ENTRENAMIENTO</div>
        <div className="s b" ref={r.b}>0</div>
      </div>
      <div className="keys" style={{ opacity: showKeys ? 1 : 0 }}>
        {pad ? (<>
          <div><kbd>R2</kbd>acelerar <kbd>L2</kbd>frenar <kbd>{pn('jump')}</kbd>saltar <kbd>{pn('boost')}</kbd>turbo</div>
          <div><kbd>{pn('powerslide')}</kbd>derrape / air roll <kbd>{pn('airRollLeft')}</kbd><kbd>{pn('airRollRight')}</kbd>air roll</div>
          <div><kbd>{pn('ballCam')}</kbd>cámara <kbd>{pn('resetCar')}</kbd>reset coche <kbd>{pn('resetBall')}</kbd>reset balón <kbd>{pn('pause')}</kbd>pausa</div>
          <div><kbd>L2</kbd>en el aire = free air roll <kbd>R1</kbd>menú reinicio <kbd>↓</kbd>balón delante</div>
        </>) : (<>
          <div><kbd>{keyName(k.accelerate)}</kbd><kbd>{keyName(k.brake)}</kbd>acelerar/frenar · cabeceo <kbd>{keyName(k.steerLeft)}</kbd><kbd>{keyName(k.steerRight)}</kbd>girar</div>
          <div><kbd>{keyName(k.jump)}</kbd>saltar (2× = doble / flip con dirección) <kbd>{keyName(k.boost)}</kbd>turbo</div>
          <div><kbd>{keyName(k.powerslide)}</kbd>derrape · air roll <kbd>{keyName(k.airRollLeft)}</kbd><kbd>{keyName(k.airRollRight)}</kbd>air roll</div>
          <div><kbd>{keyName(k.ballCam)}</kbd>cámara <kbd>{keyName(k.resetCar)}</kbd>coche <kbd>{keyName(k.resetBall)}</kbd>balón <kbd>{keyName(k.pause)}</kbd>pausa <kbd>H</kbd>ocultar ayuda · arrastra ratón = mirar</div>
          <div><kbd>T</kbd>menú reinicio <kbd>F</kbd>balón delante <kbd>G</kbd>congelar balón <kbd>V</kbd>turbo <kbd>F3</kbd>depuración</div>
        </>)}
      </div>
      <div className="hud-tr">
        <span className="chip"><span className={`dot ${padName ? 'on' : ''}`} />{padName ?? 'Teclado'}</span>
        <span className="tag">TOQUES <span ref={r.touches}>0</span> · ÚLTIMO TIRO <span ref={r.shot}>0</span></span>
        {settings.showFps && <div className="fps" ref={r.fps} />}
      </div>
      <div className="hud-bl">
        <div className="speed"><b ref={r.speed}>0</b><span>KM/H</span></div>
        <div className="tags"><span ref={r.surf} className="tag">SUELO</span><span ref={r.cam} className="tag">CÁM. BALÓN</span><span ref={r.ss} className="tag amb" style={{ display: 'none' }}>SUPERSÓNICO</span><span ref={r.flip} className="tag" style={{ display: 'none' }}>FLIP ✓</span><span ref={r.roll} className="tag amb" style={{ display: 'none' }}>FREE ROLL</span>
          {settings.unlimitedBoost && <span className="tag">∞ TURBO</span>}{settings.gameSpeed !== 1 && <span className="tag">{settings.gameSpeed * 100}% VEL</span>}</div>
      </div>
      <div className="hud-br">
        <svg viewBox="0 0 200 200">
          <defs><linearGradient id="bg1" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ff6a00" /><stop offset="1" stopColor="#ffd35a" /></linearGradient></defs>
          <circle cx="100" cy="100" r="84" fill="rgba(5,10,20,.65)" stroke="rgba(255,255,255,.08)" strokeWidth="14" strokeDasharray={`${2 * Math.PI * 84 * 0.75} ${2 * Math.PI * 84}`} transform="rotate(135 100 100)" />
          <circle ref={r.arc} cx="100" cy="100" r="84" fill="none" stroke="url(#bg1)" strokeWidth="14" strokeLinecap="butt"
            strokeDasharray={`${2 * Math.PI * 84} ${2 * Math.PI * 84}`} transform="rotate(135 100 100)" style={{ filter: 'drop-shadow(0 0 6px rgba(255,140,0,.7))', transition: 'stroke-dashoffset .08s' }} />
        </svg>
        <div className="boostnum"><div><b ref={r.boost}>0</b><span>TURBO</span></div></div>
      </div>
      <div className="flipreset" ref={r.reset}>FLIP RESET</div>
      <pre className="dbg" ref={r.dbg} style={{ display: 'none' }} />
      <div className="goal" ref={r.goal}>¡GOL!<small ref={r.goalT} /></div>
    </div>
  );
}
