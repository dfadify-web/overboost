import { useGame } from '../core/store';
import { Input } from '../input/InputManager';
import { Audio } from '../audio/AudioManager';

/** Gamepad / keyboard-arrow navigation for menus: focus moves across [data-nav] elements. */
let prev: Record<string, boolean> = {};
let repeatT = 0;

function navigable(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetParent !== null && !(e as HTMLButtonElement).disabled);
}

function move(dir: 1 | -1) {
  const list = navigable();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  const n = list[(i + dir + list.length) % list.length] ?? list[0];
  n.focus(); Audio.click();
}

function adjust(dir: 1 | -1) {
  const el = document.activeElement as HTMLInputElement | null;
  if (el && el.type === 'range') {
    const step = parseFloat(el.step || '1');
    const v = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), parseFloat(el.value) + dir * step));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else move(dir);
}

export function startPadNav() {
  let last = performance.now();
  const tick = () => {
    requestAnimationFrame(tick);
    const now = performance.now(); const dt = (now - last) / 1000; last = now;
    const st = useGame.getState();
    if (st.screen === 'playing' && !st.paused && !st.trainingMenu) { prev = {}; return; }
    if (Input.captureKey || Input.capturePad) return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    if (!pad) return;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    const cur: Record<string, boolean> = {
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6,
      ok: b(0), back: b(1),
    };
    repeatT -= dt;
    const edge = (k: string) => cur[k] && (!prev[k] || repeatT <= 0);
    if (edge('up')) { move(-1); repeatT = prev.up ? 0.12 : 0.4; }
    else if (edge('down')) { move(1); repeatT = prev.down ? 0.12 : 0.4; }
    else if (edge('left')) { adjust(-1); repeatT = prev.left ? 0.08 : 0.35; }
    else if (edge('right')) { adjust(1); repeatT = prev.right ? 0.08 : 0.35; }
    if (cur.ok && !prev.ok) {
      const el = document.activeElement as HTMLElement | null;
      if (el && el.hasAttribute('data-nav')) el.click(); else move(1);
    }
    if (cur.back && !prev.back) window.dispatchEvent(new Event('nav-back'));
    prev = cur;
  };
  requestAnimationFrame(tick);
  window.addEventListener('keydown', (e) => {
    const st = useGame.getState();
    if ((st.screen === 'playing' && !st.trainingMenu && !st.paused) || Input.captureKey) return;
    if (st.screen === 'playing' && e.code === 'Escape') return; // handled by the game loop
    if (e.code === 'Escape') window.dispatchEvent(new Event('nav-back'));
    if (e.code === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.code === 'ArrowUp') { e.preventDefault(); move(-1); }
  });
}
