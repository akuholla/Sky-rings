// Tiny procedural audio: rain hiss loop + thunder rumbles (no audio files needed).
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.rainLevel = 0;
  }

  // Must be called from a user gesture (e.g. the Start button)
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.7 : 0;
    this.master.connect(ctx.destination);

    // rain: looping filtered white noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.4;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(bp).connect(this.rainGain).connect(this.master);
    src.start();
    this.setRain(this.rainLevel);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.1);
  }

  setRain(level) {
    this.rainLevel = level;
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.5);
  }

  pause() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _ready() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  // short descending "pew"
  laser() {
    if (!this._ready()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.11);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.13);
  }

  // metallic tick when a shot lands but doesn't destroy
  hit() {
    if (!this._ready()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.08);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.11);
  }

  // explosion: noise burst through a falling low-pass
  boom(strength = 1) {
    if (!this._ready()) return;
    const ctx = this.ctx, dur = 1.4;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const t0 = ctx.currentTime;
    lp.frequency.setValueAtTime(2200, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + dur);
    const g = ctx.createGain();
    g.gain.value = 0.55 * strength;
    src.connect(lp).connect(g).connect(this.master);
    src.start(t0);
  }

  thunder(delay, strength = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const dur = 3.5 + Math.random() * 2;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // brown noise with a crack at the start and rolling decay
    let last = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      const roll = 0.6 + 0.4 * Math.sin(t * 7 + Math.sin(t * 2.3) * 3);
      const env = Math.min(1, t * 30) * Math.exp(-t * 0.9) * roll;
      d[i] = last * 3.5 * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const t0 = ctx.currentTime + delay;
    lp.frequency.setValueAtTime(900 * strength + 150, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    const g = ctx.createGain();
    g.gain.value = 0.9 * strength;
    src.connect(lp).connect(g).connect(this.master);
    src.start(t0);
  }
}
