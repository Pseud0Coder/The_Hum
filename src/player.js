import * as THREE from 'three';
import { clamp, damp, lerp, rand } from './utils.js';

const EYE = 1.66;
const EYE_CROUCH = 1.02;

export class Player {
  constructor(camera, world, audio, opts) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.opts = opts;
    this.position = new THREE.Vector3(0, EYE, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eyeY = EYE;
    this.stamina = 100;
    this.battery = 100;
    this.bottles = 4;
    this.sprinting = false;
    this.crouching = false;
    this.flashlight = false;
    this.lightOn = false;
    this.dead = false;
    this.hidden = false;
    this.hideSpot = null;
    this.holdBreath = false;
    this.noise = 0;
    this.keys = {};
    this.footTimer = 0;
    this.bobPhase = 0;
    this.bob = 0;
    this.stepNoise = 0;
    this.breathTimer = rand(2, 4);
    this.throwables = [];
    this.lastGasp = 0;
    this.stimTimer = 0;
    this.interactTarget = null;
    this.enabled = false;
    this.mouseSens = 1;
    this.invertY = false;

    this._buildLights();
    this._bindInput();
  }

  _buildLights() {
    this.spot = new THREE.SpotLight(0xe9f1ff, 0, 30, 0.48, 0.55, 1.35);
    this.spot.castShadow = false;
    this.spotTarget = new THREE.Object3D();
    this.spotTarget.position.set(0, 0, -1);
    this.spot.target = this.spotTarget;
    this.camera.add(this.spot, this.spotTarget);
    this.nearLight = new THREE.PointLight(0xb4c2d8, 4.6, 10, 1.45);
    this.camera.add(this.nearLight);
  }

  _bindInput() {
    this._onKey = (e) => {
      const down = e.type === 'keydown';
      this.keys[e.code] = down;
      if (!this.enabled) return;
      if (down) {
        if (e.code === 'KeyF') this.toggleFlashlight();
        if (e.code === 'KeyQ') this.throwBottle();
        if (e.code === 'KeyE') this.interactKey = true;
      }
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKey);
    this._onMouse = (e) => {
      if (document.pointerLockElement == null) return;
      if (!this.enabled && !this.allowLookWhileDisabled) return;
      const s = 0.0022 * this.mouseSens;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s * (this.invertY ? -1 : 1);
      if (this.hidden) {
        this.pitch = clamp(this.pitch, -0.7, 0.5);
        const yawDelta = ((this.yaw - this.hideYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
        this.yaw = this.hideYaw + clamp(yawDelta, -0.9, 0.9);
      } else {
        this.pitch = clamp(this.pitch, -1.45, 1.45);
      }
    };
    document.addEventListener('mousemove', this._onMouse);
  }

  setEnabled(v) { this.enabled = v; }

  toggleFlashlight() {
    if (this.battery <= 0) return;
    this.flashlight = !this.flashlight;
    if (!this.flashlight) this.lightOffCount = (this.lightOffCount || 0) + 1;
    this.audio.glitchBurst(0.05);
  }

  spawnAt(x, z, yaw = 0) {
    this.position.set(x, EYE, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.dead = false; this.hidden = false; this.hideSpot = null;
    this.stamina = 100; this.battery = 100; this.bottles = 4;
    this.stimTimer = 0;
    this.flashlight = false;
  }

  hide(spot) {
    this.hidden = true;
    this.hideSpot = spot;
    this.hideYaw = spot.yaw + Math.PI;
    this.yaw = this.hideYaw;
    this.hideEntry = this.position.clone();
    this.position.set(spot.pos.x, EYE_CROUCH + 0.5, spot.pos.z);
    spot.used = (spot.used || 0) + 1;
    this.audio.footstep('metal', 0.7, spot.pos);
  }

  unhide() {
    if (!this.hidden) return;
    this.hidden = false;
    const s = this.hideSpot;
    this.hideSpot = null;
    this.position.set(s.pos.x + Math.sin(s.yaw) * 1.15, EYE, s.pos.z + Math.cos(s.yaw) * 1.15);
    this.audio.footstep('metal', 0.6, s.pos);
  }

  throwBottle() {
    if (this.bottles <= 0 || this.throwCooldown > 0 || this.hidden) return;
    this.bottles--;
    this.throwCooldown = 0.5;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const geo = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a7a5f });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.position).addScaledVector(dir, 0.5);
    mesh.position.y -= 0.25;
    this.world.group.add(mesh);
    const vel = dir.clone().multiplyScalar(14);
    vel.y += 2.2;
    this.throwables.push({ mesh, vel, alive: true });
    this.audio.glitchBurst(0.03);
  }

  update(dt, hooks) {
    if (this.dead) return;
    this.throwCooldown = Math.max(0, (this.throwCooldown || 0) - dt);
    const world = this.world;
    let ix = 0, iz = 0;
    const K = this.keys;
    const locked = this.hidden || !this.enabled;
    if (!locked) {
      if (K.KeyW) iz -= 1;
      if (K.KeyS) iz += 1;
      if (K.KeyA) ix -= 1;
      if (K.KeyD) ix += 1;
    }
    const moving = ix !== 0 || iz !== 0;
    const wantCrouch = !!(K.ControlLeft || K.ControlRight || K.KeyC) && !this.hidden;
    this.crouching = wantCrouch;
    const canSprint = this.stamina > 3 && !this.crouching && (K.ShiftLeft || K.ShiftRight) && iz < 0 && !this.hidden;
    this.sprinting = canSprint;
    let speed = this.crouching ? 1.55 : 3.1;
    if (this.sprinting) {
      speed = this.stimTimer > 0 ? 6.4 : 5.0;
      this.stamina = Math.max(0, this.stamina - (this.stimTimer > 0 ? 8 : 22) * dt);
      this.regenDelay = 1.0;
    } else {
      this.regenDelay = Math.max(0, (this.regenDelay || 0) - dt);
      if (this.regenDelay <= 0) this.stamina = Math.min(100, this.stamina + (this.holdBreath ? 4 : 11) * dt);
    }
    if (this.stimTimer > 0) this.stimTimer = Math.max(0, this.stimTimer - dt);
    this.holdBreath = !!K.Space && !this.hidden;
    if (this.holdBreath) {
      this.stamina = Math.max(0, this.stamina - 5.5 * dt);
      if (this.stamina <= 0 && performance.now() - this.lastGasp > 2500) {
        this.lastGasp = performance.now();
        hooks.onGasp(this.position);
        this.audio.screech(0.15);
      }
    }
    const len = Math.hypot(ix, iz) || 1;
    const dirX = (ix * Math.cos(this.yaw) + iz * Math.sin(this.yaw)) / len;
    const dirZ = (-ix * Math.sin(this.yaw) + iz * Math.cos(this.yaw)) / len;
    const target = new THREE.Vector3(dirX * speed, 0, dirZ * speed);
    this.velocity.x = damp(this.velocity.x, target.x, moving ? 12 : 9, dt);
    this.velocity.z = damp(this.velocity.z, target.z, moving ? 12 : 9, dt);

    this._moveCollide(dt);

    const eyeTarget = this.hidden ? EYE_CROUCH + 0.5 : (this.crouching ? EYE_CROUCH : EYE);
    this.eyeY = damp(this.eyeY, eyeTarget, 8, dt);
    this.bobPhase += dt * (1.8 + Math.hypot(this.velocity.x, this.velocity.z) * 1.6);
    const bobAmt = this.hidden ? 0 : clamp(Math.hypot(this.velocity.x, this.velocity.z) * 0.012, 0, 0.05);
    this.bob = damp(this.bob, Math.sin(this.bobPhase * 2) * bobAmt, 10, dt);
    this.camera.position.set(this.position.x, this.eyeY + this.bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.004 + (this.sprinting ? 0.008 : 0), 'YXZ');

    // flashlight
    if (this.flashlight && this.battery > 0) {
      this.battery = Math.max(0, this.battery - 0.42 * dt);
      const dying = this.battery < 12;
      let inten = 30;
      if (dying) inten *= (0.4 + 0.6 * (Math.sin(performance.now() / 90) > -0.4 ? 1 : 0.15));
      this.spot.intensity = damp(this.spot.intensity, inten, 12, dt);
      if (Math.random() < dt * (dying ? 2.5 : 0.12)) this.audio.glitchBurst(0.03);
    } else {
      this.spot.intensity = damp(this.spot.intensity, 0, 10, dt);
    }
    this.lightOn = this.spot.intensity > 2;
    this.nearLight.intensity = 4.6 + Math.sin(performance.now() / 1700) * 0.3;

    // footsteps
    const spd = Math.hypot(this.velocity.x, this.velocity.z);
    this.noise = damp(this.noise, spd / 5.0, 6, dt);
    if (spd > 0.4 && this.eyeY > 0.9 && !this.hidden) {
      this.footTimer -= dt * (spd * (this.crouching ? 0.85 : 1.15));
      if (this.footTimer <= 0) {
        this.footTimer = this.crouching ? 1.35 : 0.86;
        const inten = this.crouching ? 0.5 : (this.sprinting ? 1.2 : 0.85);
        this.audio.footstep(this.sprinting ? 'metal' : 'concrete', inten, null);
        hooks.onFootstep(this.position, this.crouching ? 7 : (this.sprinting ? 28 : 16));
      }
    }
    if (this.stamina < 38 && !this.holdBreath && !this.hidden) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = rand(1.6, 3.4) * (this.stamina / 40 + 0.4);
        this.audio.breath(null, 0.7 + (38 - this.stamina) / 60);
        hooks.onBreath(this.position, 9);
      }
    }
    if (this.hidden) {
      this.noise *= 0.3;
      const s = this.hideSpot;
      const yawDelta = ((this.yaw - this.hideYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.camera.position.set(s.pos.x, EYE_CROUCH + 0.5, s.pos.z);
      this.camera.rotation.set(this.pitch, s.yaw + Math.PI + yawDelta, 0, 'YXZ');
    }

    this._updateThrowables(dt, hooks);
    return { spd, moving };
  }

  consumeInteract() {
    if (!this.interactKey) return false;
    this.interactKey = false;
    return true;
  }

  _moveCollide(dt) {
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const r = 0.42;
    const cols = this.world.collidersNear(nx, nz);
    let px = nx, pz = nz;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of cols) {
        const cx = clamp(px, c.x0, c.x1);
        const cz = clamp(pz, c.z0, c.z1);
        const dx = px - cx, dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          const d = Math.sqrt(d2) || 0.0001;
          if (d > 0.0001) {
            px = cx + (dx / d) * r;
            pz = cz + (dz / d) * r;
          } else {
            const left = px - c.x0, right = c.x1 - px, top = pz - c.z0, bot = c.z1 - pz;
            const m = Math.min(left, right, top, bot);
            if (m === left) px = c.x0 - r;
            else if (m === right) px = c.x1 + r;
            else if (m === top) pz = c.z0 - r;
            else pz = c.z1 + r;
          }
        }
      }
    }
    const lim = (5 * 14) / 2 - 0.5;
    px = clamp(px, -lim, lim);
    pz = clamp(pz, -lim, lim);
    this.position.x = px;
    this.position.z = pz;
    this.position.y = EYE;
  }

  _updateThrowables(dt, hooks) {
    for (const t of this.throwables) {
      if (!t.alive) continue;
      t.vel.y -= 16 * dt;
      const nx = t.mesh.position.x + t.vel.x * dt;
      const ny = t.mesh.position.y + t.vel.y * dt;
      const nz = t.mesh.position.z + t.vel.z * dt;
      let hit = ny <= 0.06;
      if (!hit) {
        for (const c of this.world.collidersNear(nx, nz)) {
          if (nx > c.x0 && nx < c.x1 && nz > c.z0 && nz < c.z1 && ny < 2.6) { hit = true; break; }
        }
      }
      t.mesh.position.set(nx, ny, nz);
      if (hit) {
        t.alive = false;
        this.world.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.audio.impact(t.mesh.position, 0.7);
        hooks.onNoise(new THREE.Vector3(t.mesh.position.x, 0, t.mesh.position.z), 20, 'bottle');
        continue;
      }
      t.mesh.rotation.x += dt * 9;
      t.mesh.rotation.z += dt * 5;
      t.mesh.updateMatrixWorld();
    }
    this.throwables = this.throwables.filter(t => t.alive);
  }

  addBattery() {
    this.battery = Math.min(100, this.battery + 34);
    if (this.battery > 0 && !this.flashlight) this.flashlight = true;
    this.audio.pickup();
  }

  addStim() {
    this.stamina = 100;
    this.stimTimer = 20;
    this.audio.stim();
  }

  addBottle() {
    this.bottles = Math.min(9, this.bottles + 1);
    this.audio.pickup();
  }

  applyOptions(o) {
    this.mouseSens = o.sens;
    this.invertY = o.invertY;
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('keyup', this._onKey);
    document.removeEventListener('mousemove', this._onMouse);
    this.camera.remove(this.spot, this.spotTarget, this.nearLight);
    this.spot.dispose?.();
    this.nearLight.dispose?.();
  }
}
