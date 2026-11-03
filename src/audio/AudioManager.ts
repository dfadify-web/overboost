/** Fully synthesized audio (Web Audio API) — no external assets. */
class AudioManagerImpl {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private engineBus!: GainNode; private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private boostN: { g: GainNode; f: BiquadFilterNode } | null = null;
  private skid: { g: GainNode; f: BiquadFilterNode } | null = null;
  private crowd: { g: GainNode } | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private vols = { master: 0.8, sfx: 0.8, engine: 0.6, music: 0.35 };

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.engineBus = ctx.createGain(); this.engineBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startLoops();
    this.startMusic();
  }

  setVolumes(v: { master: number; sfx: number; engine: number; music: number }) { this.vols = { ...v }; this.applyVolumes(); }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vols.sfx, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.vols.engine, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vols.music * 0.5, t, 0.05);
  }

  private noise(loop = true) {
    const s = this.ctx!.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s;
  }

  private startLoops() {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const o3 = ctx.createOscillator(); o3.type = 'triangle';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2).connect(f); o3.connect(f); f.connect(g).connect(this.engineBus);
    o1.start(); o2.start(); o3.start();
    this.eng = { o1, o2, o3, f, g };

    const bn = this.noise(); const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.7;
    const bg = ctx.createGain(); bg.gain.value = 0; bn.connect(bf).connect(bg).connect(this.sfx); bn.start();
    this.boostN = { g: bg, f: bf };

    const sn = this.noise(); const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2400; sf.Q.value = 6;
    const sg = ctx.createGain(); sg.gain.value = 0; sn.connect(sf).connect(sg).connect(this.sfx); sn.start();
    this.skid = { g: sg, f: sf };

    const cn = this.noise(); const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 700; cf.Q.value = 0.4;
    const cg = ctx.createGain(); cg.gain.value = 0.03; cn.connect(cf).connect(cg).connect(this.sfx); cn.start();
    this.crowd = { g: cg };
  }

  /** Called each frame from the game loop. */
  updateCar(speed: number, throttle: number, boosting: boolean, slip: number, airborne: boolean, active: boolean) {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime;
    const rpm = Math.min(1, speed / 23);
    const base = 48 + rpm * 120 + Math.abs(throttle) * 18 + (airborne ? 10 : 0);
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.eng.o3.frequency.setTargetAtTime(base * 2.01, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(400 + rpm * 1600 + Math.abs(throttle) * 600, t, 0.06);
    this.eng.g.gain.setTargetAtTime(active ? 0.09 + Math.abs(throttle) * 0.07 + rpm * 0.05 : 0, t, 0.08);
    this.boostN!.g.gain.setTargetAtTime(active && boosting ? 0.35 : 0, t, 0.04);
    this.boostN!.f.frequency.setTargetAtTime(700 + rpm * 900, t, 0.1);
    const sk = active && !airborne ? Math.min(1, Math.max(0, slip - 3) / 8) : 0;
    this.skid!.g.gain.setTargetAtTime(sk * 0.22, t, 0.05);
  }

  crowdLevel(v: number) { if (this.ctx && this.crowd) this.crowd.g.gain.setTargetAtTime(0.03 + v * 0.25, this.ctx.currentTime, 0.3); }

  private env(node: AudioNode, gain: number, attack: number, decay: number, dest: AudioNode = this.sfx) {
    const g = this.ctx!.createGain(); const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(dest);
    return t + attack + decay + 0.05;
  }

  impact(strength: number, kind: 'ball' | 'wall' | 'car' = 'ball') {
    if (!this.ctx) return;
    const s = Math.min(1, strength);
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'ball' ? 160 : 90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const end = this.env(o, 0.6 * s + 0.1, 0.003, 0.25);
    o.start(t); o.stop(end);
    const n = this.noise(false); const f = ctx.createBiquadFilter(); f.type = kind === 'ball' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'ball' ? 1200 : 900;
    n.connect(f); const e2 = this.env(f, 0.45 * s, 0.002, kind === 'ball' ? 0.12 : 0.2); n.start(t); n.stop(e2);
  }

  jump() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.18);
    n.connect(f); const e = this.env(f, 0.35, 0.01, 0.2); n.start(t); n.stop(e);
  }

  pickup(big: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(big ? 520 : 880, t); o.frequency.exponentialRampToValueAtTime(big ? 1560 : 1320, t + 0.12);
    const e = this.env(o, big ? 0.25 : 0.12, 0.005, big ? 0.3 : 0.12); o.start(t); o.stop(e);
  }

  goal() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // explosion
    const n = this.noise(false); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    n.connect(f); const e = this.env(f, 1.0, 0.005, 1.6); n.start(t); n.stop(e);
    const boom = ctx.createOscillator(); boom.frequency.setValueAtTime(90, t); boom.frequency.exponentialRampToValueAtTime(30, t + 0.8);
    const eb = this.env(boom, 0.9, 0.005, 0.9); boom.start(t); boom.stop(eb);
    // horn chord
    for (const fr of [233, 294, 349]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; o.connect(lp);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + 0.15); g.gain.linearRampToValueAtTime(0.09, t + 0.25); g.gain.setValueAtTime(0.09, t + 1.4); g.gain.linearRampToValueAtTime(0, t + 1.9);
      lp.connect(g).connect(this.sfx); o.start(t + 0.15); o.stop(t + 2);
    }
    this.crowdLevel(1); setTimeout(() => this.crowdLevel(0), 3500);
  }

  click(high = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(high ? 1200 : 700, t); o.frequency.exponentialRampToValueAtTime(high ? 1800 : 500, t + 0.05);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; o.connect(lp);
    const e = this.env(lp, 0.08, 0.002, 0.07); o.start(t); o.stop(e);
  }

  // --- tiny procedural synthwave loop ---
  private startMusic() {
    const ctx = this.ctx!;
    const bpm = 112, stepDur = 60 / bpm / 4;
    const prog = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
    const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    let next = ctx.currentTime + 0.1;
    const tick = () => {
      while (next < ctx.currentTime + 0.25) {
        const s = this.musicStep % 64, bar = Math.floor(s / 16) % 4, chord = prog[bar];
        // kick on quarters
        if (s % 4 === 0) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, next); o.frequency.exponentialRampToValueAtTime(40, next + 0.15); const g = ctx.createGain(); g.gain.setValueAtTime(0.5, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.2); o.connect(g).connect(this.musicBus); o.start(next); o.stop(next + 0.22); }
        // hat
        if (s % 2 === 1) { const n = this.noise(false); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); g.gain.setValueAtTime(0.06, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.04); n.connect(f).connect(g).connect(this.musicBus); n.start(next); n.stop(next + 0.05); }
        // bass
        if (s % 2 === 0) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(chord[0] - 12); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = ctx.createGain(); g.gain.setValueAtTime(0.12, next); g.gain.exponentialRampToValueAtTime(0.001, next + stepDur * 1.8); o.connect(f).connect(g).connect(this.musicBus); o.start(next); o.stop(next + stepDur * 2); }
        // arp
        { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = midi(chord[s % 4] + 12 * (Math.floor(s / 4) % 2)); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800 + 800 * Math.sin(this.musicStep / 20); const g = ctx.createGain(); g.gain.setValueAtTime(0.035, next); g.gain.exponentialRampToValueAtTime(0.001, next + stepDur * 0.9); o.connect(f).connect(g).connect(this.musicBus); o.start(next); o.stop(next + stepDur); }
        next += stepDur; this.musicStep++;
      }
    };
    this.musicTimer = window.setInterval(tick, 60);
  }
}

export const Audio = new AudioManagerImpl();
