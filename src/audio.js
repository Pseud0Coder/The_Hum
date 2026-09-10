import * as THREE from 'three';
import { clamp, lerp, rand } from './utils.js';

function makeIR(ctx, seconds = 3.2, decay = 2.6) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
    }
  }
  return buf;
}

function makeNoiseBuffer(ctx, seconds, brown = false) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    else d[i] = w;
  }
  return buf;
}

function makeDistortion(ctx, amount = 40) {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = 0.45;
    this.tension = 0;
    this.beatTime = 0;
    this.bpm = 52;
    this.micEnabled = false;
    this.micRaw = 0;
    this.micLevel = 0;
    this.micFloor = 0.004;
    this.micThreshold = 0.02;
    this.micSens = 1;
    this.lastMicSpike = 0;
    this.micSamples = [];
    this._whisperTimer = 4;
    this._driftTimer = 6;
    this._listener = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.32;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeIR(ctx);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.07;
    this.ambBus.connect(this.master);
    this.ambBus.connect(this.reverbIn);

    this.noiseBuf = makeNoiseBuffer(ctx, 4, false);
    this.brownBuf = makeNoiseBuffer(ctx, 6, true);

    this._buildAmbient();
    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _buildAmbient() {
    const ctx = this.ctx;
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.0;
    this.ambient.connect(this.ambBus);

    const droneGain = ctx.createGain(); droneGain.gain.value = 0.02;
    const droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 120; droneFilter.Q.value = 0.9;
    this.droneFilter = droneFilter;
    droneGain.connect(droneFilter); droneFilter.connect(this.ambient);

    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 48;
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 96;
    const o3g = ctx.createGain(); o3g.gain.value = 0.22;
    o1.connect(droneGain); o3.connect(o3g); o3g.connect(droneGain);
    o1.start(); o3.start();
    this.droneOscs = [o1, o3];
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.04;
    const lfoG = ctx.createGain(); lfoG.gain.value = 14;
    lfo.connect(lfoG); lfoG.connect(droneFilter.frequency); lfo.start();
    this.droneLfo = lfo;

    const air = ctx.createBufferSource(); air.buffer = this.brownBuf; air.loop = true;
    const airF = ctx.createBiquadFilter(); airF.type = 'bandpass'; airF.frequency.value = 260; airF.Q.value = 0.6;
    const airG = ctx.createGain(); airG.gain.value = 0.045;
    air.connect(airF); airF.connect(airG); airG.connect(this.ambient);
    air.start();
    this.airFilter = airF;

    const hiss = ctx.createBufferSource(); hiss.buffer = this.noiseBuf; hiss.loop = true;
    const hissF = ctx.createBiquadFilter(); hissF.type = 'highpass'; hissF.frequency.value = 6000;
    const hissG = ctx.createGain(); hissG.gain.value = 0.004;
    hiss.connect(hissF); hissF.connect(hissG); hissG.connect(this.ambient);
    hiss.start();

    const tensionOsc = ctx.createOscillator(); tensionOsc.type = 'sine'; tensionOsc.frequency.value = 1420; tensionOsc.detune.value = -30;
    const tensionOsc2 = ctx.createOscillator(); tensionOsc2.type = 'sine'; tensionOsc2.frequency.value = 2130;
    const tG = ctx.createGain(); tG.gain.value = 0;
    const trem = ctx.createOscillator(); trem.frequency.value = 7.3;
    const tremG = ctx.createGain(); tremG.gain.value = 0.5;
    trem.connect(tremG); tremG.connect(tG.gain);
    tensionOsc.connect(tG); tensionOsc2.connect(tG);
    tG.connect(this.ambient); tG.connect(this.reverbIn);
    tensionOsc.start(); tensionOsc2.start(); trem.start();
    this.tensionGain = tG;
    this._tTarget = 0;
    this._fadeTimer = 0;
  }

  fadeAmbient(target, seconds = 3) {
    this._fadeTarget = target;
    this._fadeDur = seconds;
    this._fadeFrom = this.ambient.gain.value;
    this._fadeTimer = 0;
  }

  // Localized machinery hum for server rooms
  addRoomHum(pos, { freq = 55, gain = 0.085, radius = 16 } = {}) {
    if (!this.ready || !this.ctx) return null;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(pos.x, 1.5, pos.z);
    p.refDistance = 1.2;
    p.maxDistance = radius;
    p.rolloffFactor = 1.6;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 150; f.Q.value = 1.1;
    const g = ctx.createGain(); g.gain.value = 0;
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const o2g = ctx.createGain(); o2g.gain.value = 0.25;
    const o3 = ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = freq * 3;
    const o3g = ctx.createGain(); o3g.gain.value = 0.06;
    const am = ctx.createOscillator(); am.frequency.value = 5.7;
    const amg = ctx.createGain(); amg.gain.value = 0.12;
    am.connect(amg); amg.connect(g.gain);
    o1.connect(f); o2.connect(o2g); o2g.connect(f); o3.connect(o3g); o3g.connect(f);
    f.connect(g); g.connect(p);
    p.connect(this.ambBus);
    o1.start(t); o2.start(t); o3.start(t); am.start(t);
    g.gain.setTargetAtTime(gain, t, 1.4);
    const hum = { o1, o2, o3, am, g, p, f };
    (this.roomHums = this.roomHums || []).push(hum);
    return hum;
  }

  clearRoomHums() {
    if (!this.roomHums || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const h of this.roomHums) {
      try {
        h.g.gain.setTargetAtTime(0, t, 0.3);
        h.o1.stop(t + 1.1); h.o2.stop(t + 1.1); h.o3.stop(t + 1.1); h.am.stop(t + 1.1);
      } catch (e) { /* already stopped */ }
    }
    this.roomHums = [];
  }

  setMasterVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.value = v;
  }

  setAmbience(v) {
    this.ambience = v;
    if (this.ambBus) this.ambBus.gain.value = v;
  }

  // ---------- Microphone ----------
  async enableMic() {
    if (this.micEnabled) return true;
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channels: 1 }
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('MIC_TIMEOUT')), 8000)),
      ]);
      this.micStream = stream;
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.micAnalyser = this.ctx.createAnalyser();
      this.micAnalyser.fftSize = 1024;
      this.micAnalyser.smoothingTimeConstant = 0.55;
      this.micSilentGain = this.ctx.createGain();
      this.micSilentGain.gain.value = 0;
      this.micSource.connect(this.micAnalyser);
      this.micAnalyser.connect(this.micSilentGain);
      this.micSilentGain.connect(this.ctx.destination);
      this._micBuf = new Float32Array(this.micAnalyser.fftSize);
      this.micEnabled = true;
      return true;
    } catch (e) {
      this.micEnabled = false;
      return false;
    }
  }

  calibrateMicFloor() {
    this._calSamples = [];
    this._calActive = true;
    setTimeout(() => { this._calActive = false; }, 2500);
  }

  updateMic(dt) {
    if (!this.micEnabled) { this.micLevel = 0; this.micRaw = 0; return; }
    this.micAnalyser.getFloatTimeDomainData(this._micBuf);
    let sum = 0, peak = 0;
    for (let i = 0; i < this._micBuf.length; i++) {
      const s = this._micBuf[i];
      sum += s * s;
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / this._micBuf.length);
    this.micRaw = rms;
    if (this._calActive) {
      this._calSamples.push(rms);
      const sorted = [...this._calSamples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0.003;
      this.micFloor = Math.max(0.0015, median);
    }
    this.micThreshold = (this.micFloor * 3.2 + 0.006) / this.micSens;
    const above = Math.max(0, rms - this.micFloor * 1.15);
    const target = clamp(above * 9, 0, 1);
    this.micLevel = lerp(this.micLevel, target, 1 - Math.exp(-dt * (target > this.micLevel ? 22 : 5)));
    if (rms > this.micThreshold * 1.6 && performance.now() - this.lastMicSpike > 500) {
      this.lastMicSpike = performance.now();
      this._spikeFlag = true;
    }
  }

  consumeMicSpike() {
    if (this._spikeFlag) { this._spikeFlag = false; return true; }
    return false;
  }

  // ---------- listener ----------
  setListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = cam.position;
    const dir = this._dirV || (this._dirV = new THREE.Vector3());
    cam.getWorldDirection(dir);
    const up = this._upV || (this._upV = new THREE.Vector3(0, 1, 0));
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02);
      L.positionY.setTargetAtTime(p.y, t, 0.02);
      L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(dir.x, t, 0.02);
      L.forwardY.setTargetAtTime(dir.y, t, 0.02);
      L.forwardZ.setTargetAtTime(dir.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02);
      L.upY.setTargetAtTime(up.y, t, 0.02);
      L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(dir.x, dir.y, dir.z, up.x, up.y, up.z);
    }
  }

  panner(x, y, z) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'exponential';
    p.refDistance = 1.5;
    p.maxDistance = 60;
    p.rolloffFactor = 1.5;
    p.positionX ? (p.positionX.value = x, p.positionY.value = y, p.positionZ.value = z) : p.setPosition(x, y, z);
    return p;
  }

  // ---------- one-shots ----------
  footstep(surface = 'concrete', intensity = 1, pos = null) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = rand(0.8, 1.2);
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const cfg = {
      concrete: { type: 'bandpass', freq: 900, q: 1.2, dur: 0.09, gain: 0.16 },
      metal: { type: 'highpass', freq: 1800, q: 2, dur: 0.14, gain: 0.13 },
      carpet: { type: 'lowpass', freq: 320, q: 0.7, dur: 0.12, gain: 0.09 },
      water: { type: 'bandpass', freq: 2600, q: 1.6, dur: 0.16, gain: 0.1 },
    }[surface] || { type: 'bandpass', freq: 900, q: 1.2, dur: 0.09, gain: 0.14 };
    f.type = cfg.type; f.frequency.value = cfg.freq * rand(0.9, 1.1); f.Q.value = cfg.q;
    src.connect(f); f.connect(g);
    if (pos) { const p = this.panner(pos.x, pos.y, pos.z); g.connect(p); p.connect(this.master); p.connect(this.reverbIn); }
    else { g.connect(this.master); g.connect(this.reverbIn); }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(cfg.gain * intensity, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
    src.start(t); src.stop(t + cfg.dur + 0.05);
    if (surface === 'metal' && Math.random() < 0.4) this.clang(pos, 0.4 * intensity);
  }

  clang(pos = null, vol = 0.3) {
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = rand(220, 780);
    const osc2 = ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = osc.frequency.value * rand(2.7, 3.6);
    const g = ctx.createGain(); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 6;
    osc.connect(g); osc2.connect(g); g.connect(f);
    if (pos) { const p = this.panner(pos.x, pos.y, pos.z); f.connect(p); p.connect(this.reverbIn); p.connect(this.master); }
    else { f.connect(this.reverbIn); f.connect(this.master); }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    osc.frequency.exponentialRampToValueAtTime(60, t + 1.4);
    osc.start(t); osc2.start(t); osc.stop(t + 1.7); osc2.stop(t + 1.7);
  }

  impact(pos, vol = 0.5) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    const g = ctx.createGain();
    src.connect(f); f.connect(g);
    const p = this.panner(pos.x, pos.y, pos.z); g.connect(p); p.connect(this.master); p.connect(this.reverbIn);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.start(t); src.stop(t + 0.4);
  }

  pickup() {
    const ctx = this.ctx, t = ctx.currentTime;
    [523.25, 784, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      o.connect(g); g.connect(this.master); g.connect(this.reverbIn);
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.09, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 1.4);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 1.5);
    });
  }

  heartbeat(intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [off, amp, freq] of [[0, 0.5, 58], [0.16, 0.34, 46]]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq, t + off);
      o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + off + 0.14);
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      o.connect(g); g.connect(lp); lp.connect(this.master);
      g.gain.setValueAtTime(0, t + off);
      g.gain.linearRampToValueAtTime(0.34 * amp * intensity, t + off + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.22);
      o.start(t + off); o.stop(t + off + 0.3);
    }
  }

  breath(pos = null, intensity = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 1.4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const g = ctx.createGain();
    src.connect(f); f.connect(hp); hp.connect(g);
    if (pos) { const p = this.panner(pos.x, pos.y, pos.z); g.connect(p); p.connect(this.master); p.connect(this.reverbIn); }
    else { g.connect(this.master); g.connect(this.reverbIn); }
    const t0 = t + 0.02;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.07 * intensity, t0 + 0.35);
    g.gain.linearRampToValueAtTime(0.0005, t0 + 0.8);
    g.gain.linearRampToValueAtTime(0.05 * intensity, t0 + 1.15);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 1.6);
    f.frequency.setValueAtTime(500, t0);
    f.frequency.linearRampToValueAtTime(900, t0 + 0.4);
    f.frequency.linearRampToValueAtTime(420, t0 + 0.9);
    src.start(t0); src.stop(t0 + 1.7);
    src.onended = () => { try { src.disconnect(); } catch (e) {} };
  }

  whisper(pos = null) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.loop = true;
    const dur = rand(0.5, 1.4);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = rand(7, 14);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = rand(8, 16);
    const g = ctx.createGain(); g.gain.value = 0;
    const syllables = 3 + (Math.random() * 5 | 0);
    for (let i = 0; i < syllables; i++) {
      const st = t + (i / syllables) * dur;
      const amp = rand(0.02, 0.075);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(amp, st + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur / syllables * 0.92);
      f1.frequency.setValueAtTime(rand(700, 2400), st);
      f2.frequency.setValueAtTime(rand(1400, 3800), st);
    }
    src.connect(f1); f1.connect(f2); f2.connect(g);
    if (pos) { const p = this.panner(pos.x, pos.y, pos.z); g.connect(p); p.connect(this.master); p.connect(this.reverbIn); }
    else { g.connect(this.master); g.connect(this.reverbIn); }
    src.start(t); src.stop(t + dur + 0.1);
    src.onended = () => { try { src.disconnect(); } catch (e) {} };
  }

  alert(pos) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(68, 96), t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.55);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 1.4;
    const g = ctx.createGain();
    const p = this.panner(pos.x, 1.8, pos.z);
    o.connect(f); f.connect(g); g.connect(p);
    p.connect(this.master); p.connect(this.reverbIn);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    o.start(t); o.stop(t + 0.7);
  }

  screech(vol = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(600, 1100), t);
    o.frequency.exponentialRampToValueAtTime(rand(90, 160), t + 1.1);
    const vib = ctx.createOscillator(); vib.frequency.value = 23;
    const vibG = ctx.createGain(); vibG.gain.value = 90;
    vib.connect(vibG); vibG.connect(o.frequency); vib.start(t); vib.stop(t + 1.3);
    const dist = makeDistortion(ctx, 30);
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    o.connect(dist); dist.connect(hp); hp.connect(g);
    g.connect(this.master); g.connect(this.reverbIn);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.24 * vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    o.start(t); o.stop(t + 1.3);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 900;
    const ng = ctx.createGain();
    n.connect(nf); nf.connect(ng); ng.connect(this.master); ng.connect(this.reverbIn);
    ng.gain.setValueAtTime(0.12 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.start(t); n.stop(t + 1);
  }

  deathScream() {
    this.screech(1.6);
    this.heartbeat(1.6);
    setTimeout(() => this.screech(1.2), 130);
  }

  glitchBurst(vol = 0.12) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rand(300, 3000); f.Q.value = 3;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.start(t); src.stop(t + 0.12);
  }

  whisperBurstAround(pos, radius = 3.5) {
    const a = Math.random() * Math.PI * 2;
    this.whisper({ x: pos.x + Math.cos(a) * radius, y: 1.6 + rand(-0.4, 0.9), z: pos.z + Math.sin(a) * radius });
  }

  update(dt, state) {
    if (!this.ready) return;
    this.updateMic(dt);
    if (this._fadeTarget !== undefined) {
      this._fadeTimer += dt;
      const k = clamp(this._fadeTimer / (this._fadeDur || 1), 0, 1);
      this.ambient.gain.value = lerp(this._fadeFrom, this._fadeTarget, k * k * (3 - 2 * k));
      if (k >= 1) this._fadeTarget = undefined;
    }

    const tension = clamp(state.tension || 0, 0, 1);
    this.tension = tension;
    this.tensionGain.gain.setTargetAtTime(tension * 0.012, this.ctx.currentTime, 0.4);
    this.airFilter.frequency.setTargetAtTime(320 + tension * 900, this.ctx.currentTime, 0.8);
    this.droneFilter.frequency.setTargetAtTime(170 + tension * 320, this.ctx.currentTime, 0.6);

    const proximity = clamp(state.proximity ?? 1, 0, 1);
    this.bpm = lerp(48, 138, proximity * proximity);
    this.beatTime -= dt;
    if (this.beatTime <= 0 && proximity > 0.12) {
      this.beatTime = 60 / this.bpm;
      this.heartbeat(0.5 + proximity);
    }

    this._whisperTimer -= dt * (1 + tension * 2.4);
    if (this._whisperTimer <= 0) {
      this._whisperTimer = rand(6, 17) / (1 + tension * 2);
      if (state.playerPos) this.whisperBurstAround(state.playerPos, rand(2.5, 7));
    }
  }
}
