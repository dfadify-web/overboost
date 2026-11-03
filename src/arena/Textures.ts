import * as THREE from 'three';
import { ARENA } from '../core/config';

const css = (hex: number, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, repeat = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

/** Field: maps x∈[-W/2,W/2] → canvas x, z∈[-L/2,L/2] → canvas y. */
export function fieldTexture(teamA: number, teamB: number, res = 2048) {
  const { W, L } = ARENA;
  const ppm = res / L; // pixels per meter
  const [c, g] = canvas(Math.round(W * ppm), res);
  const X = (x: number) => (x + W / 2) * ppm, Z = (z: number) => (z + L / 2) * ppm;

  // base grass with mowing bands
  g.fillStyle = '#1d4f2a'; g.fillRect(0, 0, c.width, c.height);
  const band = 5.1;
  for (let i = 0; i * band < L; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
    g.fillRect(0, i * band * ppm, c.width, band * ppm);
  }
  // radial checker diamonds for extra texture
  g.save(); g.globalAlpha = 0.04;
  for (let x = -W / 2; x < W / 2; x += 4) for (let z = -L / 2; z < L / 2; z += 4) {
    if (((x + z) / 4) % 2 === 0) { g.fillStyle = '#ffffff'; g.fillRect(X(x), Z(z), 4 * ppm, 4 * ppm); }
  }
  g.restore();
  // team half tints
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, css(teamA, 0.16)); grad.addColorStop(0.46, css(teamA, 0.02));
  grad.addColorStop(0.54, css(teamB, 0.02)); grad.addColorStop(1, css(teamB, 0.16));
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);

  // grain noise
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // team zones in front of goals: chevron rows
  for (const [sgn, col] of [[-1, teamA], [1, teamB]] as const) {
    const zEdge = sgn * (L / 2 - 3);
    g.save();
    g.beginPath();
    g.ellipse(X(0), Z(zEdge), 17 * ppm, 13 * ppm, 0, 0, Math.PI * 2);
    g.clip();
    for (let k = 0; k < 9; k++) {
      const zc = zEdge - sgn * (k * 1.6);
      g.fillStyle = css(col, k % 2 ? 0.18 : 0.42);
      g.beginPath();
      g.moveTo(X(-18), Z(zc)); g.lineTo(X(0), Z(zc - sgn * 2.2)); g.lineTo(X(18), Z(zc));
      g.lineTo(X(18), Z(zc - sgn * 0.8)); g.lineTo(X(0), Z(zc - sgn * 3.0)); g.lineTo(X(-18), Z(zc - sgn * 0.8));
      g.closePath(); g.fill();
    }
    g.restore();
    g.strokeStyle = css(col, 0.9); g.lineWidth = 0.22 * ppm;
    g.beginPath(); g.ellipse(X(0), Z(zEdge), 17 * ppm, 13 * ppm, 0, sgn > 0 ? Math.PI : 0, sgn > 0 ? Math.PI * 2 : Math.PI); g.stroke();
  }

  // lines
  g.strokeStyle = 'rgba(240,250,255,0.85)'; g.lineWidth = 0.18 * ppm;
  g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(c.width, Z(0)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 9 * ppm, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(240,250,255,0.9)'; g.beginPath(); g.arc(X(0), Z(0), 0.9 * ppm, 0, Math.PI * 2); g.fill();
  // dashed big arcs
  g.setLineDash([1.4 * ppm, 1.0 * ppm]); g.lineWidth = 0.14 * ppm; g.strokeStyle = 'rgba(240,250,255,0.55)';
  for (const sgn of [-1, 1]) { g.beginPath(); g.arc(X(0), Z(sgn * L / 2), 27 * ppm, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.arc(X(0), Z(0), 15 * ppm, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  // goal lines
  g.lineWidth = 0.3 * ppm; g.strokeStyle = 'rgba(255,255,255,0.9)';
  for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(X(-ARENA.goalW / 2), Z(sgn * (L / 2 - ARENA.curveR))); g.lineTo(X(ARENA.goalW / 2), Z(sgn * (L / 2 - ARENA.curveR))); g.stroke(); }
  // side touch-lines
  g.lineWidth = 0.12 * ppm; g.strokeStyle = 'rgba(240,250,255,0.4)';
  const inset = ARENA.curveR + 1.2;
  roundRect(g, X(-W / 2 + inset), Z(-L / 2 + inset), (W - inset * 2) * ppm, (L - inset * 2) * ppm, (ARENA.cornerR - ARENA.curveR) * ppm);
  g.stroke();
  // center logo ring
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 0.08 * ppm;
  for (let i = 0; i < 6; i++) { const a0 = (i / 6) * Math.PI * 2; g.beginPath(); g.arc(X(0), Z(0), 6 * ppm, a0 + 0.12, a0 + 0.9); g.stroke(); }
  const t = tex(c); t.flipY = false;
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Lower band: metal panels + LED rail + brand text. Returns color + emissive maps. */
export function bandTextures() {
  const [c, g] = canvas(1024, 512);
  const [e, ge] = canvas(1024, 512);
  const mg = g.createLinearGradient(0, 0, 0, 512);
  mg.addColorStop(0, '#2c3340'); mg.addColorStop(0.5, '#454e5e'); mg.addColorStop(1, '#1b2029');
  g.fillStyle = mg; g.fillRect(0, 0, 1024, 512);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 1024, 512);
  // panel seams (v=0 bottom => canvas bottom since flipY)
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 4;
  for (let x = 0; x <= 1024; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  g.beginPath(); g.moveTo(0, 300); g.lineTo(1024, 300); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
  for (let x = 2; x <= 1024; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  // rivets
  g.fillStyle = 'rgba(200,210,225,0.35)';
  for (let x = 20; x < 1024; x += 64) { g.beginPath(); g.arc(x, 318, 3, 0, 7); g.fill(); }
  // dark advert strip
  g.fillStyle = '#0d1118'; g.fillRect(0, 120, 1024, 140);
  ge.font = '700 92px "Chakra Petch", Rajdhani, sans-serif'; ge.textBaseline = 'middle';
  ge.fillStyle = '#d6f6ff'; ge.fillText('OVERBOOST', 40, 192);
  ge.fillStyle = '#5be7ff'; ge.fillText('▲▲', 640, 192);
  ge.font = '600 40px "Chakra Petch", sans-serif'; ge.fillStyle = '#9fb3c8'; ge.fillText('ARENA', 790, 194);
  g.drawImage(e, 0, 0);
  // LED rail at the top of the band
  ge.fillStyle = '#ffffff'; ge.fillRect(0, 14, 1024, 14);
  g.fillStyle = '#e8f6ff'; g.fillRect(0, 14, 1024, 14);
  // small lamps
  for (let x = 32; x < 1024; x += 128) { ge.fillStyle = '#ffffff'; ge.fillRect(x, 440, 26, 8); g.fillStyle = '#fff'; g.fillRect(x, 440, 26, 8); }
  const map = tex(c, true), emissive = tex(e, true);
  return { map, emissive };
}

/** Hex mesh with alpha — for upper glass walls and goal nets. */
export function hexTexture(size = 512, line = 3, fillAlpha = 0.06) {
  const [c, g] = canvas(size, size);
  g.clearRect(0, 0, size, size);
  const r = size / 8;
  const w = Math.sqrt(3) * r;
  g.lineWidth = line; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.fillStyle = `rgba(255,255,255,${fillAlpha})`;
  for (let row = -1; row < size / (1.5 * r) + 1; row++) {
    for (let col = -1; col < size / w + 1; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * 1.5 * r;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; g.lineTo(cx + r * 0.93 * Math.cos(a), cy + r * 0.93 * Math.sin(a)); }
      g.closePath(); g.fill(); g.stroke();
    }
  }
  return tex(c, true);
}

export function goalFloorTexture(team: number) {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#1a1f27'; g.fillRect(0, 0, 512, 512);
  for (let i = -8; i < 16; i++) { g.fillStyle = i % 2 ? '#232a35' : css(team, 0.35); g.beginPath(); g.moveTo(i * 48, 0); g.lineTo(i * 48 + 24, 0); g.lineTo(i * 48 + 24 + 200, 512); g.lineTo(i * 48 + 200, 512); g.fill(); }
  return tex(c, true);
}

export function screenTexture(lines: string[], accent: number) {
  const [c, g] = canvas(1024, 512);
  const grd = g.createLinearGradient(0, 0, 1024, 512);
  grd.addColorStop(0, '#05101d'); grd.addColorStop(1, '#0b1f33');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = css(accent, 0.9); g.lineWidth = 10; g.strokeRect(10, 10, 1004, 492);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.font = '700 150px "Chakra Petch", sans-serif'; g.fillText(lines[0] ?? '', 512, 210);
  g.fillStyle = css(accent); g.font = '600 64px "Chakra Petch", sans-serif'; g.fillText(lines[1] ?? '', 512, 370);
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < 512; y += 4) g.fillRect(0, y, 1024, 2);
  return tex(c);
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner); r.addColorStop(1, outer);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return tex(c, false, false);
}

/** Vertical fade for light beams (bright at top). */
export function beamTexture() {
  const [c, g] = canvas(64, 256);
  const lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lg; g.fillRect(0, 0, 64, 256);
  const hg = g.createLinearGradient(0, 0, 64, 0);
  hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = hg; g.fillRect(0, 0, 64, 256);
  return tex(c, false, false);
}

/** Ball surface: original pentagon-hex panel layout baked by spherical projection is done in geometry; this gives micro detail. */
export function carbonTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#16181d'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) for (let x = 0; x < 256; x += 8) {
    g.fillStyle = ((x + y) / 8) % 2 ? '#1f232a' : '#121418'; g.fillRect(x, y, 8, 8);
  }
  return tex(c, true);
}
