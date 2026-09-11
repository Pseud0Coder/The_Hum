import { fmtClock, loadJSON, saveJSON, clamp } from './utils.js';

const OPTS_KEY = 'the_hum_opts_v3';

export class UI {
  constructor() {
    this.el = {};
    const ids = [
      'scr-title', 'scr-cal', 'scr-brief', 'scr-pause', 'scr-options', 'scr-death', 'scr-hold', 'scr-end',
      'btn-start', 'btn-options', 'btn-brief', 'btn-cal-done', 'btn-cal-skip', 'btn-brief-go',
      'btn-resume', 'btn-opt2', 'btn-abandon', 'btn-opt-back', 'btn-retry', 'btn-death-opts',
      'btn-again', 'btn-end-opts', 'hud', 'objective', 'clock', 'frag-count', 'corr-pct', 'corr-bar',
      'reticle', 'prompt', 'subs',       'sta-pct', 'sta-bar', 'bat-pct', 'bat-bar', 'noise-state', 'noise-pct', 'wave', 'stim-line', 'stim-secs',
      'cal-wave', 'mic-status', 'cal-buttons', 'cal-hint', 'vignette', 'damage', 'hidefx', 'breath', 'blackout', 'taunt', 'death-cause',
      'd-time', 'd-frags', 'd-deaths', 'd-knowledge', 'd-learned', 'hold-wave', 'hold-timer',
      'end-title', 'taunt-end', 'e-time', 'e-deaths', 'e-mic', 'e-corr', 'end-note',
      'opt-sens', 'opt-pixel', 'opt-vol', 'opt-mic', 'opt-subs', 'opt-voice', 'opt-inv', 'opt-amb', 'opt-vvol',
      'val-sens', 'val-pixel', 'val-vol', 'val-mic', 'val-amb', 'val-vvol',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.opts = Object.assign({
      sens: 1, pixel: 3, vol: 0.45, micSens: 1, amb: 0.2, voiceVol: 0.9,
      subs: true, voice: true, invertY: false,
    }, loadJSON(OPTS_KEY, {}));
    this.onChange = null;
    this._subTimer = null;
    this._promptTimer = null;
    this._bindOptions();
    this._clockTimer = setInterval(() => { this.el.clock.textContent = fmtClock(); }, 1000);
  }

  screen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    if (id) this.el[id].classList.add('on');
  }

  hideAll() { this.screen(null); }

  _bindOptions() {
    const o = this.opts;
    const set = (k, v) => { this.opts[k] = v; saveJSON(OPTS_KEY, this.opts); this._syncOptions(); if (this.onChange) this.onChange(this.opts); };
    const bindRange = (id, valId, key, fn) => {
      const el = this.el[id];
      el.value = o[key];
      this.el[valId].textContent = fn ? fn(o[key]) : Number(o[key]).toFixed(1);
      el.addEventListener('input', () => set(key, parseFloat(el.value)), { passive: true });
    };
    bindRange('opt-sens', 'val-sens', 'sens', v => v.toFixed(1));
    bindRange('opt-pixel', 'val-pixel', 'pixel', v => String(v));
    bindRange('opt-vol', 'val-vol', 'vol', v => v.toFixed(2));
    bindRange('opt-amb', 'val-amb', 'amb', v => v.toFixed(2));
    bindRange('opt-vvol', 'val-vvol', 'voiceVol', v => v.toFixed(2));
    bindRange('opt-mic', 'val-mic', 'micSens', v => v.toFixed(1));
    const bindTog = (id, key) => {
      const el = this.el[id];
      el.classList.toggle('on', !!o[key]);
      el.textContent = o[key] ? 'ON' : 'OFF';
      el.addEventListener('click', () => set(key, !this.opts[key]));
    };
    bindTog('opt-subs', 'subs');
    bindTog('opt-voice', 'voice');
    bindTog('opt-inv', 'invertY');
    this._syncOptions();
  }

  _syncOptions() {
    const o = this.opts;
    this.el['opt-sens'].value = o.sens;
    this.el['val-sens'].textContent = Number(o.sens).toFixed(1);
    this.el['opt-pixel'].value = o.pixel;
    this.el['val-pixel'].textContent = String(o.pixel);
    this.el['opt-vol'].value = o.vol;
    this.el['val-vol'].textContent = Number(o.vol).toFixed(2);
    this.el['opt-amb'].value = o.amb;
    this.el['val-amb'].textContent = Number(o.amb).toFixed(2);
    this.el['opt-vvol'].value = o.voiceVol;
    this.el['val-vvol'].textContent = Number(o.voiceVol).toFixed(2);
    this.el['opt-mic'].value = o.micSens;
    this.el['val-mic'].textContent = Number(o.micSens).toFixed(1);
    for (const [id, key] of [['opt-subs', 'subs'], ['opt-voice', 'voice'], ['opt-inv', 'invertY']]) {
      this.el[id].classList.toggle('on', !!o[key]);
      this.el[id].textContent = o[key] ? 'ON' : 'OFF';
    }
  }

  setHudVisible(v) { this.el.hud.classList.toggle('on', v); }

  setObjective(text) { this.el.objective.textContent = text; }

  setFrags(n, total = 4) { this.el['frag-count'].textContent = `CORES ${n}/${total}`; }

  setBars(stamina, battery, corruption) {
    const staCol = stamina < 25 ? '#ff5a4a' : stamina < 55 ? '#e8b04b' : '#6fe38f';
    const batCol = battery < 20 ? '#ff5a4a' : battery < 45 ? '#e8b04b' : '#7fd1ff';
    const corCol = corruption > 66 ? '#ff4a7a' : corruption > 33 ? '#c46bff' : '#a78bff';
    this.el['sta-pct'].textContent = Math.round(stamina);
    this.el['sta-pct'].style.color = staCol;
    this.el['sta-bar'].style.transform = `scaleX(${clamp(stamina / 100, 0, 1)})`;
    this.el['sta-bar'].style.background = staCol;
    this.el['bat-pct'].textContent = Math.round(battery);
    this.el['bat-pct'].style.color = batCol;
    this.el['bat-bar'].style.transform = `scaleX(${clamp(battery / 100, 0, 1)})`;
    this.el['bat-bar'].style.background = batCol;
    this.el['corr-pct'].textContent = `${Math.round(corruption)}%`;
    this.el['corr-pct'].style.color = corCol;
    this.el['corr-bar'].style.transform = `scaleX(${clamp(corruption / 100, 0, 1)})`;
    this.el['corr-bar'].style.background = corCol;
    this.el.vignette.style.opacity = corruption > 55 ? String((corruption - 55) / 90) : '0';
  }

  setDamage(v) { this.el.damage.style.opacity = String(v); }
  setHideFx(v) { this.el.hidefx.style.opacity = String(v); }
  setBreathFx(v) { this.el.breath.style.opacity = String(v); }

  setStim(sec) {
    const el = this.el['stim-line'];
    if (!el) return;
    const on = sec > 0;
    el.classList.toggle('hidden', !on);
    if (on) this.el['stim-secs'].textContent = Math.ceil(sec);
  }

  setNoiseState(level, threshold, deaf) {
    const ratio = level / Math.max(0.001, threshold);
    const pctEl = this.el['noise-pct'];
    if (pctEl) pctEl.textContent = deaf ? '--' : `${Math.min(999, Math.round(ratio * 100))}%`;
    if (deaf) { this.el['noise-state'].textContent = 'DEAF'; this.el['noise-state'].className = 'warn'; return; }
    let state = 'SILENT';
    this.el['noise-state'].className = 'ok';
    if (ratio > 0.7) { state = 'AUDIBLE'; this.el['noise-state'].className = 'warn'; }
    if (ratio > 1.0) { state = 'LOUD'; this.el['noise-state'].className = 'bad'; }
    this.el['noise-state'].textContent = state;
  }

  drawWave(canvas, level, threshold = 0.05, color = '#6fe38f') {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    this._waves = this._waves || {};
    const hist = this._waves[canvas.id] || (this._waves[canvas.id] = []);
    hist.push(clamp(level, 0, 1.4));
    while (hist.length > 72) hist.shift();
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    const thRatio = clamp(threshold, 0.02, 1);
    ctx.strokeStyle = 'rgba(255,59,48,0.55)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, h - thRatio * h * 0.9); ctx.lineTo(w, h - thRatio * h * 0.9); ctx.stroke();
    ctx.setLineDash([]);
    const bw = w / 72;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, h / 2 - 1, w, 2);
    ctx.globalAlpha = 1;
    for (let i = 0; i < hist.length; i++) {
      const v = hist[i];
      const bh = clamp(v / 1.2, 0.05, 1) * (h * 0.88);
      ctx.globalAlpha = 0.4 + Math.min(0.6, v * 2.5);
      ctx.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1.5), bh);
    }
    ctx.globalAlpha = 1;
  }

  prompt(text) {
    const p = this.el.prompt;
    if (!text) { p.classList.remove('on'); return; }
    p.innerHTML = text;
    p.classList.add('on');
  }

  subtitle(who, text, duration = 4500) {
    if (!this.opts.subs) return;
    const s = this.el.subs;
    s.innerHTML = `<span class="who">${who}</span>${text}`;
    s.classList.add('on');
    clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => s.classList.remove('on'), duration);
  }

  clearSubtitle() {
    clearTimeout(this._subTimer);
    this.el.subs.classList.remove('on');
  }

  fadeToBlack(v, instant = false) {
    const b = this.el.blackout;
    if (instant) { b.style.transition = 'none'; b.style.opacity = String(v); void b.offsetWidth; b.style.transition = 'opacity 1.4s'; }
    else b.style.opacity = String(v);
  }

  flashDamage(amount = 0.9) {
    this.el.damage.style.opacity = String(amount);
    setTimeout(() => { this.el.damage.style.opacity = '0'; }, 240);
  }

  showDeath(stats, causeLabel, taunt) {
    this.el['death-cause'].textContent = `CAUSE: ${causeLabel}`;
    this.el.taunt.textContent = taunt;
    this.el['d-time'].textContent = stats.time;
    this.el['d-frags'].textContent = `${stats.frags} / 4`;
    this.el['d-deaths'].textContent = String(stats.deaths);
    this.el['d-knowledge'].textContent = `${stats.knowledge}%`;
    this.el['d-learned'].textContent = stats.learned;
    this.screen('scr-death');
  }

  showEnd(stats, title, taunt, note) {
    this.el['end-title'].textContent = title;
    this.el['end-title'].className = 'ending-title ' + (stats.good ? 'green-t' : 'red-t');
    this.el['taunt-end'].textContent = taunt;
    this.el['e-time'].textContent = stats.time;
    this.el['e-deaths'].textContent = String(stats.deaths);
    this.el['e-mic'].textContent = String(stats.micNoise);
    this.el['e-corr'].textContent = `${stats.corr}%`;
    this.el['end-note'].textContent = note || '';
    this.screen('scr-end');
  }

  setHoldTimer(t) { this.el['hold-timer'].textContent = t.toFixed(1); }

  bindButtons(handlers) {
    for (const [id, fn] of Object.entries(handlers)) {
      const el = this.el[id];
      if (el) el.addEventListener('click', fn);
    }
    const wipe = document.getElementById('opt-wipe');
    if (wipe) wipe.addEventListener('click', () => {
      try { localStorage.removeItem('the_hum_save_v1'); localStorage.removeItem('the_hum_opts_v1'); } catch (e) {}
      location.reload();
    });
  }

  setMicStatus(text, cls = '') {
    this.el['mic-status'].innerHTML = text;
    this.el['mic-status'].className = cls;
  }

  enableCalDone() { this.el['btn-cal-done'].disabled = false; }

  showCalButtons(v = true) {
    const el = this.el['cal-buttons'];
    if (el) el.style.display = v ? 'flex' : 'none';
    const hint = this.el['cal-hint'];
    if (hint && v) hint.style.display = 'none';
  }

  hideCalButtons() {
    this.showCalButtons(false);
    const hint = this.el['cal-hint'];
    if (hint) hint.style.display = '';
  }
}
