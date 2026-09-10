import * as THREE from 'three';
import { World, cellCenter } from './world.js';
import { Player } from './player.js';
import { Entity } from './entity.js';
import { AudioEngine } from './audio.js';
import { PostFX } from './postfx.js';
import { UI } from './ui.js';
import { Taunts } from './taunts.js';
import { GameState } from './state.js';
import { clamp, rand, fmtTime } from './utils.js';

const WORLD_SEED = 0x5e4f58;

window.addEventListener('error', (e) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99;background:#300;color:#fbb;font:11px monospace;padding:8px 12px;white-space:pre-wrap';
  el.textContent = `ERROR: ${e.message} @ ${e.filename?.split('/').pop()}:${e.lineno}`;
  document.body.appendChild(el);
});

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.autoMode = new URLSearchParams(location.search).get('auto');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!this.autoMode });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030408);
    this.scene.fog = new THREE.FogExp2(0x04050a, 0.038);

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.06, 140);
    this.camera.rotation.order = 'YXZ';

    this.audio = new AudioEngine();
    this.ui = new UI();
    this.taunts = new Taunts({
      onSubtitle: (who, text, dur) => this.ui.subtitle(who, text, dur),
      onSpeak: () => {
        if (!this.player || !this.audio.ready) return;
        this.audio.whisperBurstAround(this.player.position, 2.4);
      },
    });
    this.state = new GameState();
    this.postfx = new PostFX(this.renderer, this.ui.opts.pixel);

    this.ambient = new THREE.AmbientLight(0x3a4256, 0.55);
    this.hemi = new THREE.HemisphereLight(0x27334a, 0x080a10, 0.4);
    this.scene.add(this.ambient, this.hemi);

    this.lightPool = [];
    for (let i = 0; i < 6; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 17, 1.45);
      this.scene.add(pl);
      this.lightPool.push(pl);
    }

    this.mode = 'title';
    this.frags = 0;
    this.corruption = 0;
    this.tension = 0;
    this.deathTimer = 0;
    this.tauntTimer = rand(50, 80);
    this.lastNoiseSource = 'unknown';
    this.holdTimer = 0;
    this.holdNoise = 0;
    this.doorCount = 0;
    this.lightOffCount = 0;
    this.micCalibrated = false;
    this.clock3 = new THREE.Clock();

    this._buildTitleScene();
    this._bindUI();
    this._bindPointer();
    this.ui.fadeToBlack(0, true);
    window.addEventListener('resize', () => this._resize());
    this._resize();
    this._autopilot();
    this._loop();
  }

  _autopilot() {
    const p = new URLSearchParams(location.search);
    const auto = p.get('auto');
    if (!auto) return;
    const dbg = document.createElement('div');
    dbg.id = 'autodbg';
    dbg.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:60;font:11px monospace;color:#6fe38f;background:rgba(0,0,0,.6);padding:6px 8px;white-space:pre';
    document.body.appendChild(dbg);
    this._autodbg = dbg;
    window.__shot = (name) => {
      this.postfx.render(this.scene, this.camera, 0.016, {});
      const data = this.canvas.toDataURL('image/png');
      return fetch('/__shot/' + (name || 'shot'), { method: 'POST', body: data }).then(r => r.text());
    };
    window.__key = (code, down = true) => {
      this.player.keys[code] = down;
    };
    setTimeout(async () => {
      await this._ensureAudio();
      window.__auto = auto;
      if (auto === 'ghost') {
        const path = [];
        for (let k = 0; k < 60; k++) {
          const a = (k / 60) * Math.PI * 2;
          path.push({ x: -28 + Math.cos(a) * 6, z: -28 + Math.sin(a) * 6 });
        }
        this.state.data.paths = [path];
      }
      this._startRun();
      if (auto === 'hold') setTimeout(() => { this.frags = 4; this._beginHold(); }, 1400);
      if (auto === 'death') setTimeout(() => { this._beginDeath('mic'); }, 1600);
      if (auto === 'escape') setTimeout(() => {
        this.frags = 4;
        this.world.elevator.doorsOpen = true;
        this.world.coresHeld = 4;
        const g = this.world.elevator.group.position;
        this.player.position.set(g.x, 1.66, g.z + 1.4);
      }, 1600);
      if (auto === 'hunt') setTimeout(() => {
        const e = this.entity;
        e.grace = 0;
        e.state = 'hunt';
        e.setPosition(this.player.position.x + 6, this.player.position.z + 6);
        e.lastSeen.set(this.player.position.x, 0, this.player.position.z);
        e._repath(this.player.position);
      }, 1400);
      if (auto === 'view') {
        setTimeout(() => {
          this.entity.grace = 999999;
          this.entity.setPosition(60, 60);
          this.player.flashlight = true;
          this.player.battery = 100;
          this.corruption = 0;
        }, 1000);
      }
      if (auto === 'flash') setTimeout(() => { this.player.flashlight = true; }, 1200);
    }, 700);
  }

  _buildTitleScene() {
    this.scene.add(this.camera);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0x0a0b0e });
    const dummy = new THREE.Mesh(geo, mat);
    dummy.position.set(0, -40, 0);
    this.scene.add(dummy);
    const l = new THREE.PointLight(0x334, 0.2, 10);
    this.scene.add(l);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
  }

  _bindPointer() {
    this.canvas.addEventListener('click', () => {
      if ((this.mode === 'playing' || this.mode === 'hold') && !document.pointerLockElement) {
        this._requestLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) {
        if (this.mode === 'paused') this._setPaused(false);
      } else if (this.mode === 'playing' || this.mode === 'hold') {
        this._setPaused(true);
      }
    });
  }

  _requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* cooldown */ }
  }

  _bindUI() {
    const ui = this.ui;
    const kick = () => { this.audio.resume(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    ui.bindButtons({
      'btn-start': () => this._toCalibration(),
      'btn-options': () => { this._prevScreen = 'scr-title'; ui.screen('scr-options'); },
      'btn-brief': () => { ui.screen('scr-brief'); this._crawlReveal(); },
      'btn-brief-go': () => this._runFromMenu(),
      'btn-cal-skip': () => {
        if (this.audio.micEnabled && this.audio.micStream) {
          this.audio.micStream.getTracks().forEach(t => t.stop());
          this.audio.micEnabled = false;
        }
        this._toBrief();
      },
      'btn-cal-done': () => this._toBrief(),
      'btn-resume': () => this._requestLock(),
      'btn-opt2': () => { this._prevScreen = 'scr-pause'; ui.screen('scr-options'); },
      'btn-abandon': () => this._abandon(),
      'btn-opt-back': () => {
        const back = this._prevScreen || 'scr-title';
        this._prevScreen = null;
        if (back === 'scr-title' && this.mode === 'title') ui.screen('scr-title');
        else ui.screen(back);
      },
      'btn-retry': () => this._startRun(),
      'btn-death-opts': () => { this._prevScreen = 'scr-death'; ui.screen('scr-options'); },
      'btn-again': () => this._startRun(),
      'btn-end-opts': () => { this._prevScreen = 'scr-end'; ui.screen('scr-options'); },
    });
    ui.onChange = (opts) => {
      this.audio.setMasterVolume(opts.vol);
      this.audio.setAmbience(opts.amb);
      this.audio.micSens = opts.micSens;
      if (this.player) this.player.applyOptions(opts);
      this.postfx.setPixelScale(opts.pixel);
      this.taunts.voiceEnabled = opts.voice;
      this.taunts.voiceVolume = opts.voiceVol;
    };
  }

  _crawlReveal() {
    const ps = document.querySelectorAll('#crawl p');
    ps.forEach((p, i) => {
      p.classList.remove('on');
      setTimeout(() => p.classList.add('on'), 260 + i * 640);
    });
  }

  async _toCalibration() {
    await this._ensureAudio();
    if (this.micCalibrated && this.audio.micEnabled) {
      this._toBrief();
      return;
    }
    this.ui.screen('scr-cal');
    this.ui.hideCalButtons();
    this.ui.setMicStatus('REQUESTING MICROPHONE&hellip;');
    let done = false;
    const succeed = () => {
      if (done) return;
      done = true;
      this.ui.setMicStatus('CALIBRATING ROOM TONE &middot; STAY QUIET FOR 2 SECONDS&hellip;', 'warn');
      this.audio.calibrateMicFloor();
      setTimeout(() => {
        this.micCalibrated = true;
        this.ui.setMicStatus(`ROOM TONE LOCKED (floor ${Math.round(this.audio.micFloor * 10000) / 10000}) &middot; MICROPHONE ACTIVE`, 'ok');
        this.ui.enableCalDone();
        this.ui.showCalButtons(true);
      }, 2000);
    };
    setTimeout(() => {
      if (done) return;
      if (this.audio.micEnabled) { succeed(); return; }
      done = true;
      this._runDeafFromCalibration();
    }, 8500);
    const ok = await this.audio.enableMic();
    if (ok) {
      succeed();
    } else if (!done) {
      done = true;
      this._runDeafFromCalibration();
    }
  }

  _runDeafFromCalibration() {
    if (this.audio.micEnabled && this.audio.micStream) {
      this.audio.micStream.getTracks().forEach(t => t.stop());
    }
    this.audio.micEnabled = false;
    this.ui.setMicStatus('MICROPHONE NOT PROVIDED &middot; RUNNING DEAF &middot; THE HUM HUNTS YOUR FOOTSTEPS ONLY', 'bad');
    setTimeout(() => this._toBrief(), 1600);
  }

  _toBrief() {
    this.ui.fadeToBlack(0);
    this.ui.screen('scr-brief');
    this._crawlReveal();
  }

  async _ensureAudio() {
    await this.audio.init();
    this.audio.setMasterVolume(this.ui.opts.vol);
    this.audio.setAmbience(this.ui.opts.amb);
    this.audio.micSens = this.ui.opts.micSens;
    this.taunts.voiceEnabled = this.ui.opts.voice;
    this.taunts.voiceVolume = this.ui.opts.voiceVol;
  }

  _runFromMenu() {
    if (!this.audio.ready) {
      this._ensureAudio().then(() => this._startRun());
    } else {
      this._startRun();
    }
  }

  _abandon() {
    this.state.recordDeath('abandoned');
    document.exitPointerLock?.();
    this.mode = 'title';
    this.ui.setHudVisible(false);
    this.ui.fadeToBlack(0);
    this.ui.screen('scr-title');
  }

  _disposeRun() {
    if (this.audio) this.audio.clearRoomHums();
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !Array.isArray(o.material)) o.material.dispose();
      });
    }
    if (this.entity) {
      this.scene.remove(this.entity.root);
      this.entity.root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
      });
      this.entity.mat.dispose();
      this.entity.ghostMat.dispose();
    }
    if (this.player) {
      this.player.dispose();
      this.scene.remove(this.camera);
    }
  }

  _startRun() {
    this._disposeRun();
    this.state.startRun();
    this.scene.add(this.camera);

    this.world = new World(this.scene, WORLD_SEED).build();
    this.audio.world = this.world;
    if (this.audio.ready) {
      this.audio.clearRoomHums();
      for (const [key, type] of Object.entries(this.world.roomType)) {
        if (type !== 'server') continue;
        const [i, j] = key.split(',').map(Number);
        const c = cellCenter(i, j);
        this.audio.addRoomHum(new THREE.Vector3(c.x, 0, c.z), { freq: 54, gain: 0.075 });
      }
    }

    this.player = new Player(this.camera, this.world, this.audio, this.ui.opts);
    this.player.applyOptions(this.ui.opts);
    const spawn = cellCenter(0, 0);
    this.player.spawnAt(spawn.x, spawn.z, Math.PI * 0.25);
    this.player.setEnabled(true);

    this.entity = new Entity(this.scene, this.world);
    this.entity.grace = 3.5;
    this.entity.onAlert = (d, source) => {
      if (performance.now() - (this._lastAlertCue || 0) < 3200) return;
      this._lastAlertCue = performance.now();
      if (d < 30) this.audio.alert(this.entity.pos);
      if (d < 12 && source === 'mic') {
        this.ui.subtitle('THE HUM', 'It heard your room.', 2600);
      }
    };
    const ghost = this.state.lastPath;
    if (ghost && ghost.length > 12) {
      this.entity.setGhostPath(ghost.map(p => ({ x: p.x, z: p.z })));
      this.entity.grace = 6;
      this.ui.subtitle('THE HUM', 'Your last route is walking again.', 5200);
    } else {
      this.entity.spawnFarFrom(this.player.position);
    }
    for (const kid of this.state.data.knowledge) {
      const spot = this.world.hidingSpots.find(s => s.id === kid);
      if (spot) this.entity.markKnown(spot);
    }

    this.frags = 0;
    this.corruption = 0;
    this.tension = 0;
    this.deathTimer = 0;
    this.tauntTimer = rand(40, 70);
    this.lastNoiseSource = 'unknown';
    this.micNoiseFlash = 0;
    this.doorCount = 0;
    this.lightOffCount = 0;
    if (this.deathLight) this.deathLight.visible = false;
    this.mode = 'playing';
    this.ui.screen(null);
    this.ui.setHudVisible(true);
    this.ui.setFrags(0);
    this.ui.setDamage(0);
    this.ui.setBreathFx(0);
    this.ui.fadeToBlack(0);
    this.ui.setObjective('OBJECTIVE: RECOVER RESONANCE CORES [0/4]');
    this.audio.fadeAmbient(0.5, 4);
    this.audio.calibrateMicFloor();
    this._requestLock();
    const intros = [
      'Do not run in the halls. Running sounds like food.',
      'Welcome back. Or welcome. I do not remember which.',
      'Four cores hold this place together. Take them and I will notice.',
    ];
    const intro = intros[Math.floor(rand(0, intros.length))];
    setTimeout(() => {
      if (this.mode === 'playing') this.taunts.speak(intro, { duration: 5200 });
    }, 2600);
  }

  _setPaused(v) {
    if (v && (this.mode === 'playing' || this.mode === 'hold')) {
      this._resumeMode = this.mode;
      this.mode = 'paused';
      this.player.setEnabled(false);
      this.ui.screen('scr-pause');
    } else if (!v && this.mode === 'paused') {
      this.mode = this._resumeMode || 'playing';
      this.player.setEnabled(this.mode === 'playing');
      this.ui.screen(null);
      this._requestLock();
    }
  }

  noiseEvent(pos, radius, source) {
    if (this.mode !== 'playing' || !this.entity) return;
    const heard = this.entity.hearNoise(pos, radius, source);
    if (heard) {
      this.lastNoiseSource = source;
      if (source === 'mic') {
        this.ui.flashDamage(0.18);
        this.micNoiseFlash = 0.6;
      }
    }
  }

  update(dt) {
    const t = performance.now() / 1000;
    this.audio.update(dt, {
      tension: this.mode === 'playing' || this.mode === 'dying' ? this.tension : 0.15,
      proximity: this.proximity || 0,
      playerPos: this.player ? this.player.position : new THREE.Vector3(),
    });
    if (this.player) this.audio.setListener(this.camera);

    if (this.mode === 'hold') { this._updateHold(dt); }
    else if (this.mode === 'playing') { this._updatePlaying(dt); }
    else if (this.mode === 'dying') { this._updateDying(dt); }

    if (this.world && this.player) {
      this.world.update(dt, this.player.position, this.lightPool);
    }

    const corr = this.corruption / 100;
    this.postfx.render(this.scene, this.camera, dt, {
      corrupt: corr,
      tension: this.mode === 'playing' || this.mode === 'hold' ? this.tension : 0,
      damage: this._damageFx || 0,
      glitch: corr * 0.5 + (this.micNoiseFlash > 0 ? this.micNoiseFlash : 0),
    });
    if (this.micNoiseFlash > 0) this.micNoiseFlash = Math.max(0, this.micNoiseFlash - dt * 1.4);
    if (this._damageFx > 0) this._damageFx = Math.max(0, this._damageFx - dt * 2.2);
    if (t % 1 < 0.05) this.ui.setDamage(this._damageFx > 0 ? Math.min(0.85, this._damageFx) : 0);
    if (this._autodbg) {
      const e = this.entity, pl = this.player;
      this._autodbg.textContent =
        `mode=${this.mode} frags=${this.frags} corr=${this.corruption | 0}\n` +
        `entity=${e ? e.state : '-'} dist=${e && pl ? e.distanceTo(pl.position).toFixed(1) : '-'} known=${e ? e.knowledge.size : 0}\n` +
        `player=(${pl ? pl.position.x.toFixed(1) : '-'},${pl ? pl.position.z.toFixed(1) : '-'}) hidden=${pl ? pl.hidden : '-'}\n` +
        `errs=${document.querySelectorAll('div[style*="z-index:99"]').length} calls=${this.renderer.info.render.calls}`;
    }
  }

  _updatePlaying(dt) {
    const player = this.player;
    const world = this.world;
    const entity = this.entity;

    player.update(dt, {
      onFootstep: (pos, radius) => this.noiseEvent(pos, radius, 'footsteps'),
      onBreath: (pos, radius) => this.noiseEvent(pos, radius, 'breath'),
      onGasp: (pos) => { this.noiseEvent(pos, 30, 'gasp'); this.audio.screech(0.2); },
      onNoise: (pos, radius, source) => this.noiseEvent(pos, radius, source),
    });

    if (this.audio.micEnabled) {
      if (this.audio.consumeMicSpike()) {
        this.noiseEvent(player.position, 30 + this.audio.micLevel * 18, 'mic');
        this.state.recordMicNoise();
        this.audio.glitchBurst(0.09);
      }
      const loud = this.audio.micRaw > this.audio.micThreshold * 1.35;
      this._micSustain = clamp((this._micSustain || 0) + (loud ? dt : -dt * 1.5), 0, 3);
      if (this._micSustain > 1.6) {
        this._micSustain = 0.35;
        this.noiseEvent(player.position, 18, 'mic');
        this.state.recordMicNoise();
      }
      this.ui.setNoiseState(this.audio.micRaw, this.audio.micThreshold, false);
    } else {
      this.ui.setNoiseState(0, 1, true);
    }
    this.ui.drawWave(this.ui.el.wave, this.audio.micEnabled ? this.audio.micLevel : player.noise * 0.8,
      this.audio.micEnabled ? clamp(this.audio.micThreshold * 9, 0.05, 1) : 0.55,
      this.audio.micEnabled ? '#6fe38f' : '#e8b04b');

    if (entity) {
      entity.playerCores = this.frags;
      const res = entity.update(dt, {
        position: player.position,
        flashlight: player.flashlight && player.battery > 0,
        sprinting: player.sprinting,
        crouching: player.crouching,
        hidden: player.hidden,
        guardPoint: player.hideSpot ? player.hideSpot.pos : null,
      }, world, this.audio, {
        onSpot: (d) => {
          if (d < 14 && performance.now() - (this._lastSpotTaunt || 0) > 40000) {
            this._lastSpotTaunt = performance.now();
            this.taunts.speak('I can see you.', { duration: 2200, rate: 0.6 });
          }
        },
        onLearn: (spot) => {
          const ids = world.hidingSpots.filter(s => s.known).map(s => s.id);
          this.state.learn(ids);
          this.ui.subtitle('THE HUM', this.taunts.learnLine(ids.length), 4200);
        },
        onAttackWindup: () => {
          this._damageFx = 0.35;
          this.audio.screech(1.1);
        },
        onMaterialize: () => {
          this.audio.screech(1.0);
          this.corruption = Math.min(100, this.corruption + 12);
          this.ui.subtitle('THE HUM', 'Your old route is mine now. I know where you hid.', 5000);
        },
        onKill: () => this._beginDeath(this._causeFor()),
        onLockerAttack: (spot) => this._beginDeath('locker'),
      });
      this.tension = res.tension;
      const prox = clamp(1 - res.distToPlayer / 26, 0, 1);
      this.proximity = prox;
      if (res.sawPlayer || entity.state === 'hunt') {
        this.corruption = Math.min(100, this.corruption + dt * (6 + prox * 10));
      } else if (entity.state === 'ghost') {
        this.corruption = Math.min(100, this.corruption + dt * 1.2);
      } else {
        this.corruption = Math.max(0, this.corruption - dt * (3 - prox * 2));
      }
      this.ui.setDamage(this._damageFx > 0 ? Math.min(0.85, this._damageFx) : clamp((prox - 0.7) * 1.4, 0, 0.5));
    }

    // items
    for (const item of world.items) {
      if (item.taken) continue;
      const d = Math.hypot(item.mesh.position.x - player.position.x, item.mesh.position.z - player.position.z);
      const dy = Math.abs(item.mesh.position.y - (player.eyeY - 0.5));
      if (d < 1.25 && dy < 1.4) {
        item.taken = true;
        world.group.remove(item.mesh);
        if (item.type === 'core') {
          this.frags++;
          this.ui.setFrags(this.frags);
          this.ui.setObjective(this.frags >= 4
            ? 'OBJECTIVE: RETURN TO THE EXTRACTION ELEVATOR'
            : `OBJECTIVE: RECOVER RESONANCE CORES [${this.frags}/4]`);
          this.audio.pickup();
          this.audio.fadeAmbient(0.5, 0.5);
          if (this.frags === 1) this.ui.subtitle('THE HUM', 'That hum. I can hear it through you now.', 4200);
          if (this.frags === 4) {
            this.taunts.speak('All four. The elevator will want silence from you.', { duration: 5000 });
            this.audio.screech(0.5);
            this.corruption = Math.min(100, this.corruption + 18);
          }
        } else if (item.type === 'battery') player.addBattery();
        else player.addBottle();
      }
    }

    // signal strength objective
    const curCellI = Math.round(player.position.x / 14 + 2), curCellJ = Math.round(player.position.z / 14 + 2);
    const curCellKey = `${curCellI},${curCellJ}`;
    if (curCellKey !== this._lastCellKey) {
      if (this._lastCellKey !== undefined) this.doorCount++;
      this._lastCellKey = curCellKey;
    }
    if (this.frags < 4) {
      let best = 1e9;
      for (const item of world.items) {
        if (!item.taken && item.type === 'core') {
          best = Math.min(best, Math.hypot(item.mesh.position.x - player.position.x, item.mesh.position.z - player.position.z));
        }
      }
      const strength = clamp(1 - best / 55, 0, 1);
      const bars = '▁▂▃▄▅▆▇'[Math.min(6, Math.floor(strength * 7))];
      this.ui.setObjective(`OBJECTIVE: RESONANCE [${'▁▂▃▄▅▆▇'.slice(0, Math.floor(strength * 7) + 1)}] · CORES [${this.frags}/4]`);
    }

    if (this.frags > 0) {
      this._corePingT = (this._corePingT === undefined ? 12 : this._corePingT) - dt;
      if (this._corePingT <= 0) {
        this._corePingT = Math.max(9, 22 - this.frags * 3.2);
        this.noiseEvent(player.position, 34, 'core');
        this.audio.glitchBurst(0.05);
        if (this.frags >= 2 && performance.now() - (this._corePingLine || 0) > 26000) {
          this._corePingLine = performance.now();
          this.ui.subtitle('THE HUM', 'The cores are singing to me.', 2400);
        }
      }
    } else {
      this._corePingT = 12;
    }

    // interaction prompt
    let prompt = null;
    let target = null;
    if (!player.hidden) {
      for (const spot of world.hidingSpots) {
        const d = spot.pos.distanceTo(player.position);
        if (d < 2.3) {
          const dx = spot.pos.x - player.position.x, dz = spot.pos.z - player.position.z;
          const dot = (dx * -Math.sin(player.yaw) + dz * -Math.cos(player.yaw)) / (Math.hypot(dx, dz) || 1);
          if (dot > 0.25) { target = spot; break; }
        }
      }
      if (target) prompt = '<b>E</b> &middot; HIDE INSIDE';
      if (world.elevator && this.frags >= 4) {
        const e = world.elevator;
        const g = e.group.position;
        const dPanel = Math.hypot(e.x - player.position.x, e.z - player.position.z);
        const dDoors = Math.hypot(g.x - player.position.x, g.z - player.position.z);
        if (Math.min(dPanel, dDoors) < 3.4) {
          prompt = '<b>E</b> &middot; RELEASE CONTAINMENT';
          this._elevatorPrompt = true;
        } else this._elevatorPrompt = false;
      } else this._elevatorPrompt = false;
    } else {
      prompt = '<b>E</b> &middot; LEAVE';
    }
    this.ui.prompt(prompt);
    this.ui.el.reticle.classList.toggle('hot', !!prompt);

    if (player.consumeInteract()) {
      if (player.hidden) player.unhide();
      else if (this._elevatorPrompt) this._beginHold();
      else if (target) {
        const seen = this.entity.canSeePlayer(player.position, {
          flashlight: player.flashlight && player.battery > 0,
          sprinting: player.sprinting,
          crouching: player.crouching,
        });
        player.hide(target);
        if (seen) {
          this.entity.witnessHide(target);
          this.audio.screech(0.5);
          this.ui.subtitle('THE HUM', 'I saw you get in.', 3200);
        } else if (this.entity.knowledge.has(target.id)) {
          this.ui.subtitle('THE HUM', 'You chose the same place again. Predictable.', 3600);
        }
      }
    }
    if (player.hidden) {
      this.ui.setHideFx(0.96);
    } else {
      this.ui.setHideFx(0);
    }

    // elevator entry
    if (world.elevator && world.elevator.doorsOpen) {
      const g = world.elevator.group.position;
      if (Math.hypot(g.x - player.position.x, g.z - player.position.z) < 3.0) this._escape();
    }

    // ambient taunts
    this.lightOffCount = this.player.lightOffCount || 0;
    this.tauntTimer -= dt;
    if (this.tauntTimer <= 0) {
      this.tauntTimer = rand(55, 105);
      const line = this.taunts.ambientLine(this.state, {
        micOn: this.audio.micEnabled,
        minutes: this.state.runTime / 60,
      }, { doorCount: this.doorCount, lightOff: this.lightOffCount });
      this.taunts.speak(line, { duration: 5600 });
    }

    // hud
    this.ui.setBars(player.stamina, player.battery, this.corruption);
    this.state.recordTick(dt, player.position, player.flashlight);
    world.coresHeld = this.frags;
  }

  _causeFor() {
    const e = this.entity;
    if (e && (e.state === 'hunt' && e.sightMemory < 0.1)) return 'sighted';
    const map = { mic: 'mic', footsteps: 'footsteps', breath: 'breath', gasp: 'gasp', bottle: 'bottle', core: 'core', sigh: 'sigh' };
    return map[this.lastNoiseSource] || 'unknown';
  }

  _beginHold() {
    this.mode = 'hold';
    this.player.setEnabled(false);
    this.player.allowLookWhileDisabled = true;
    this.player.unhide();
    this.ui.prompt(null);
    this.ui.setHudVisible(false);
    this.ui.screen('scr-hold');
    this.holdTimer = 8.0;
    this.holdNoise = 0;
    this.entity.beginHold(this.player.position, this.player.yaw);
    this.audio.fadeAmbient(0.04, 2.2);
    this.audio.screech(0.35);
    this.taunts.speak(this.taunts.holdStart(), { duration: 4200, rate: 0.58 });
  }

  _updateHold(dt) {
    const player = this.player;
    player.update(dt, { onFootstep: () => {}, onBreath: () => {}, onGasp: (p) => this._holdFail(), onNoise: () => {} });
    player.velocity.set(0, 0, 0);

    this.holdTimer -= dt;
    let noisy = false;
    if (this.audio.micEnabled) {
      const level = this.audio.micRaw;
      const threshold = this.audio.micThreshold * 1.2;
      noisy = level > threshold;
      this.ui.drawWave(this.ui.el['hold-wave'], this.audio.micLevel,
        clamp(this.audio.micThreshold * 9, 0.05, 1), noisy ? '#ff3b30' : '#e8b04b');
    } else {
      noisy = !player.holdBreath && player.stamina < 99;
      this.ui.drawWave(this.ui.el['hold-wave'], noisy ? 0.7 : 0.15, 0.5, noisy ? '#ff3b30' : '#e8b04b');
    }
    if (noisy) this.holdNoise += dt; else this.holdNoise = Math.max(0, this.holdNoise - dt * 1.6);
    this.ui.setHoldTimer(Math.max(0, this.holdTimer));
    this._damageFx = clamp(this.holdNoise * 2 + 0.1, 0, 0.8);
    this.tension = 0.85 + Math.sin(performance.now() / 700) * 0.15;
    this.proximity = 1;

    if (this.holdNoise > 0.34) { this._holdFail(); return; }
    if (this.holdTimer <= 0) {
      this.entity.endHold(false);
      this.world.elevator.doorsOpen = true;
      this.mode = 'playing';
      this.player.setEnabled(true);
      this.player.allowLookWhileDisabled = false;
      this.ui.screen(null);
      this.ui.setHudVisible(true);
      this.ui.setObjective('OBJECTIVE: ENTER THE ELEVATOR');
      this.audio.fadeAmbient(0.5, 3);
      this.taunts.speak(this.taunts.holdPass(), { duration: 4200, rate: 0.66 });
    }
  }

  _holdFail() {
    if (this.mode !== 'hold') return;
    this.entity.endHold(true);
    this.taunts.silence();
    this._beginDeath('hold');
  }

  _beginDeath(cause) {
    if (this.mode === 'dying' || this.mode === 'dead') return;
    this.mode = 'dying';
    this._cause = cause;
    this.state.recordDeath(cause);
    this.player.setEnabled(false);
    this.player.dead = true;
    this.deathTimer = 1.5;
    this.audio.deathScream();
    this.audio.fadeAmbient(0.08, 1);
    const entity = this.entity;
    if (entity) {
      entity.holdMode = false;
      entity._setMatGhost(false);
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const px = this.player.position.x + dir.x * 1.35;
      const pz = this.player.position.z + dir.z * 1.35;
      entity.setPosition(px, pz);
      entity.facing = Math.atan2(this.player.position.x - px, this.player.position.z - pz);
      entity.mat.uniforms.uMouth.value = 1;
      entity.mat.uniforms.uRim.value.setHex(0x6a2018);
      entity.awareness = 1;
      entity.corrupt = 1;
      entity.mat.uniforms.uCorrupt.value = 1;
      if (!this.deathLight) {
        this.deathLight = new THREE.PointLight(0xff2a20, 9, 7, 1.5);
        this.scene.add(this.deathLight);
      }
      this.deathLight.visible = true;
      this.deathLight.position.set(this.player.position.x + dir.x * 0.6, 2.35, this.player.position.z + dir.z * 0.6);
    }
    this.tauntLine = this.taunts.deathLine(this.state, cause, this.state.runTime);
  }

  _updateDying(dt) {
    this.tension = 1;
    this.corruption = 100;
    this.deathTimer -= dt;
    const entity = this.entity;
    if (entity) {
      const tilt = Math.sin(performance.now() / 60) * 0.03;
      this.camera.lookAt(entity.pos.x, 2.15 + Math.sin(performance.now() / 90) * 0.05, entity.pos.z);
      this.camera.rotation.z += tilt;
      entity._animate(dt, 0);
      entity.root.rotation.y = entity.facing;
    }
    this._damageFx = clamp((1.5 - this.deathTimer) * 0.9, 0, 0.95);
    if (this.deathTimer <= 0) {
      this.mode = 'dead';
      this.ui.fadeToBlack(1);
      setTimeout(() => {
        const d = this.state.data;
        this.ui.showDeath({
          time: fmtTime(this.state.runTime),
          frags: this.frags,
          deaths: d.deaths,
          knowledge: this.state.knowledgePct,
          learned: this.state.data.knowledge.length > 0
            ? `IT KNOWS ${this.state.data.knowledge.length} OF YOUR HIDING PLACES`
            : 'IT DID NOT LEARN A NEW PLACE THIS TIME',
        }, this._causeLabel(this._cause), this.tauntLine);
        this.taunts.speak(this.tauntLine, { duration: 6000 });
        this.ui.fadeToBlack(0);
      }, 1200);
    }
  }

  _causeLabel(cause) {
    return {
      mic: 'YOUR ROOM HEARD YOU',
      footsteps: 'YOUR FOOTSTEPS',
      sighted: 'IT SAW YOU',
      locker: 'IT CHECKED YOUR LOCKER',
      hold: 'YOU MADE A SOUND',
      bottle: 'THE BOTTLE BROKE',
      breath: 'YOUR BREATHING',
      gasp: 'YOU GASPED',
      core: 'THE CORES SANG',
      abandoned: 'YOU LEFT',
      unknown: 'UNKNOWN',
    }[cause] || 'UNKNOWN';
  }

  _escape() {
    if (this.mode === 'ended') return;
    this.mode = 'ended';
    this.state.recordEscape(this.state.runTime);
    document.exitPointerLock?.();
    this.ui.setHudVisible(false);
    this.ui.fadeToBlack(1);
    this.audio.fadeAmbient(0, 2);
    this.audio.pickup();
    setTimeout(() => {
      const d = this.state.data;
      this.ui.showEnd({
        time: fmtTime(this.state.runTime),
        deaths: d.deaths,
        micNoise: this.state.micNoiseThisRun,
        corr: Math.round(this.corruption),
        good: true,
      }, 'SIGNAL CONTAINED', this.taunts.escapeLine(d.deaths),
        d.escapes === 1
          ? 'The facility remembers you escaped. It will prepare next time.'
          : `Escapes: ${d.escapes}. Deaths: ${d.deaths}. It remembers both.`);
      this.taunts.speak(this.taunts.escapeLine(d.deaths), { duration: 6000 });
      this.ui.fadeToBlack(0);
    }, 2200);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.05, this.clock3.getDelta());
    try {
      this.update(dt);
    } catch (err) {
      console.error('LOOP ERROR', err);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__game = new Game();
});
