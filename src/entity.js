import * as THREE from 'three';
import { clamp, damp, lerp, rand, angleLerp } from './utils.js';

const ENTITY_VERT = `
  uniform float uTime;
  uniform float uCorrupt;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vLocal;
  void main(){
    vec3 pos = position;
    float w = sin(uTime * 2.3 + position.y * 3.7 + position.x * 2.1) * (0.012 + uCorrupt * 0.03);
    pos += normal * w;
    vLocal = pos;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const ENTITY_FRAG = `
  uniform float uTime;
  uniform float uCorrupt;
  uniform float uGhost;
  uniform vec3 uRim;
  uniform float uMouth;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vLocal;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2);
    float scan = 0.5 + 0.5 * sin(vLocal.y * 40.0 + uTime * 6.0);
    vec3 base = vec3(0.012, 0.013, 0.016);
    vec3 col = base + uRim * fres * (0.7 + 0.3 * scan) + uRim * uCorrupt * 0.15;
    float mouthZone = smoothstep(1.62, 1.75, vLocal.y) * smoothstep(1.95, 1.82, vLocal.y);
    float mouthMask = 1.0 - smoothstep(0.02, 0.12, abs(vLocal.x));
    col += vec3(1.0, 0.06, 0.03) * mouthZone * mouthMask * uMouth * (0.6 + 0.4 * sin(uTime * 12.0)) * 2.2;
    gl_FragColor = vec4(col, mix(1.0, 0.34, uGhost));
  }
`;

class Limb {
  constructor(len, radius, mat, taper = 0.75) {
    this.group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(radius * taper, radius, len, 6);
    geo.translate(0, -len / 2, 0);
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);
    this.len = len;
    this.end = new THREE.Group();
    this.end.position.y = -len;
    this.group.add(this.end);
  }
}

export class Entity {
  constructor(scene, world) {
    this.world = world;
    this.root = new THREE.Group();
    this.state = 'wander';
    this.stateTime = 0;
    this.path = [];
    this.pathIndex = 0;
    this.speed = 0;
    this.vel = new THREE.Vector3();
    this.lastSeen = new THREE.Vector3();
    this.lastNoise = null;
    this.target = new THREE.Vector3();
    this.waitTimer = 0;
    this.attackTimer = 0;
    this.grace = 0;
    this.ghostPath = null;
    this.ghostIndex = 0;
    this.ghostTimer = 0;
    this.isGhost = false;
    this.knowledge = new Set();
    this.sightMemory = 0;
    this.holdMode = false;
    this.holdPos = new THREE.Vector3();
    this.dead = false;
    this.corrupt = 0;
    this.awareness = 0;
    this.footstepPhase = 0;
    this.animPhase = 0;
    this.twitch = 0;
    this._build();
    scene.add(this.root);
  }

  _makeMat(ghost) {
    return new THREE.ShaderMaterial({
      vertexShader: ENTITY_VERT,
      fragmentShader: ENTITY_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCorrupt: { value: 0 },
        uGhost: { value: ghost ? 1 : 0 },
        uRim: { value: new THREE.Color(0x33475a) },
        uMouth: { value: 0 },
      },
      transparent: true,
      depthWrite: !ghost,
    });
  }

  _build() {
    this.mat = this._makeMat(false);
    this.root.visible = true;
    const mat = this.mat;
    this.hips = new THREE.Group();
    this.hips.position.y = 1.42;
    this.root.add(this.hips);

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.8, 6), mat);
    chest.position.y = 0.38;
    chest.scale.z = 0.72;
    this.torso.add(chest);
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.24), mat);
    shoulders.position.y = 0.76;
    this.torso.add(shoulders);

    this.head = new THREE.Group();
    this.head.position.y = 0.92;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat);
    skull.scale.set(0.82, 1.35, 0.86);
    skull.position.y = 0.12;
    this.head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.18), mat);
    jaw.position.set(0, -0.04, 0.02);
    this.head.add(jaw);
    this.jaw = jaw;

    this.armL = new Limb(0.62, 0.075, mat);
    this.armL.group.position.set(0.30, 0.72, 0);
    this.armR = new Limb(0.62, 0.075, mat);
    this.armR.group.position.set(-0.30, 0.72, 0);
    this.torso.add(this.armL.group, this.armR.group);
    this.foreL = new Limb(0.72, 0.06, mat);
    this.armL.end.add(this.foreL.group);
    this.foreR = new Limb(0.72, 0.06, mat);
    this.armR.end.add(this.foreR.group);
    for (const fore of [this.foreL, this.foreR]) {
      for (let f = 0; f < 3; f++) {
        const finger = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.30, 0.022), mat);
        finger.position.set((f - 1) * 0.05, -0.15, 0);
        fore.end.add(finger);
      }
    }

    this.thighL = new Limb(0.78, 0.105, mat, 0.8);
    this.thighL.group.position.set(0.14, 0, 0);
    this.thighR = new Limb(0.78, 0.105, mat, 0.8);
    this.thighR.group.position.set(-0.14, 0, 0);
    this.hips.add(this.thighL.group, this.thighR.group);
    this.shinL = new Limb(0.72, 0.085, mat, 0.8);
    this.thighL.end.add(this.shinL.group);
    this.shinR = new Limb(0.72, 0.085, mat, 0.8);
    this.thighR.end.add(this.shinR.group);
    for (const shin of [this.shinL, this.shinR]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.26), mat);
      foot.position.set(0, -0.03, 0.07);
      shin.end.add(foot);
    }

    this.ghostMat = this._makeMat(true);
    this.ghostMat.uniforms.uRim.value = new THREE.Color(0x2a4a5a);
  }

  setPosition(x, z) {
    this.root.position.set(x, 0, z);
  }

  get pos() { return this.root.position; }

  distanceTo(p) { return Math.hypot(this.pos.x - p.x, this.pos.z - p.z); }

  _setMatGhost(isGhost) {
    this.isGhost = isGhost;
    const m = isGhost ? this.ghostMat : this.mat;
    this.root.traverse(o => { if (o.isMesh) o.material = m; });
    this.mat.uniforms.uMouth.value = 0;
  }

  spawnFarFrom(playerPos) {
    const depth = this.world.depth;
    let best = null, bestD = -1;
    for (const k in depth) {
      if (k === '0,0') continue;
      const d = depth[k];
      const [i, j] = k.split(',').map(Number);
      const c = { x: (i - 2) * 14, z: (j - 2) * 14 };
      const dd = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
      if (d >= bestD - 1 && dd > 30) { bestD = d; best = [i, j]; }
    }
    if (best) {
      const c = this.world.randomPointInRoom(best[0], best[1]);
      this.setPosition(c.x, c.z);
      this.state = 'wander';
    }
  }

  setGhostPath(path) {
    if (path && path.length > 6) {
      this.ghostPath = path;
      this.ghostIndex = 0;
      this.ghostTimer = 0;
      this.state = 'ghost';
      this.stateTime = 0;
      this._setMatGhost(true);
      const p0 = path[0];
      this.setPosition(p0.x, p0.z);
    }
  }

  markKnown(spot) {
    this.knowledge.add(spot.id);
    spot.known = true;
  }

  // ---------- senses ----------
  canSeePlayer(playerPos, playerState) {
    const d = this.distanceTo(playerPos);
    let range = 13;
    if (playerState.flashlight) range += 9;
    if (playerState.sprinting) range += 5;
    if (playerState.crouching) range *= 0.5;
    if (this.state === 'hunt') range = 26;
    if (d > range) return false;
    const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
    const fwdX = Math.sin(this.facing || 0), fwdZ = Math.cos(this.facing || 0);
    const dot = (dx * fwdX + dz * fwdZ) / (Math.hypot(dx, dz) || 1);
    if (dot < (this.state === 'hunt' ? 0.1 : 0.22) && d > 3) return false;
    return !this.world.segmentBlocked(this.pos.x, this.pos.z, playerPos.x, playerPos.z);
  }

  hearNoise(pos, radius, source) {
    if (this.grace > 0 || this.state === 'ghost') return false;
    const d = this.world.approxDistance(this.pos.x, this.pos.z, pos.x, pos.z);
    if (d > radius) return false;
    const now = performance.now();
    const lead = this._leadTarget(pos, source, now);
    const target = lead || { x: pos.x, z: pos.z };
    this.lastNoise = { pos: new THREE.Vector3(pos.x, 0, pos.z), source, t: now, radius };
    if (this.state !== 'hunt') {
      const certain = d < radius * 0.65;
      this.state = certain ? 'hunt' : 'investigate';
      this.stateTime = 0;
      this.lastSeen.copy(this.lastNoise.pos);
      this._repath(certain ? this.lastNoise.pos : target);
    } else {
      this._repath(target);
    }
    if (this.onAlert) this.onAlert(d, source);
    return true;
  }

  _leadTarget(pos, source, now) {
    if (source !== 'footsteps') return null;
    const hist = (this.noiseHistory = this.noiseHistory || []);
    let lead = null;
    const prev = hist[hist.length - 1];
    if (prev) {
      const dt = (now - prev.t) / 1000;
      if (dt > 0.15 && dt < 3.5) {
        const vx = (pos.x - prev.x) / dt, vz = (pos.z - prev.z) / dt;
        const speed = Math.hypot(vx, vz);
        if (speed > 1.2) {
          const ahead = Math.min(2.8, dt * 1.5);
          const lx = pos.x + vx * ahead, lz = pos.z + vz * ahead;
          if (Math.hypot(lx - this.pos.x, lz - this.pos.z) < 26) lead = { x: lx, z: lz };
        }
      }
    }
    hist.push({ x: pos.x, z: pos.z, t: now });
    if (hist.length > 3) hist.shift();
    return lead;
  }

  witnessHide(spot) {
    spot.witnessed = true;
    this.state = 'hunt';
    this.stateTime = 0;
    this.sightMemory = 0;
    this.lastSeen.copy(spot.pos);
    this._repath(spot.pos);
  }

  _enterSearch() {
    this.state = 'search';
    this.stateTime = 0;
    this.searchCenter = new THREE.Vector3(
      this.lastSeen.x !== 0 || this.lastSeen.z !== 0 ? this.lastSeen.x : this.pos.x, 0,
      this.lastSeen.x !== 0 || this.lastSeen.z !== 0 ? this.lastSeen.z : this.pos.z
    );
    this._searchedSpots = new Set();
    this._pendingSpot = null;
    this.searchRing = 0;
    this.lookTimer = 0;
    this._repath(this.searchCenter);
  }

  _pickSearchSpot() {
    let best = null, bestD = 1e9;
    for (const s of this.world.hidingSpots) {
      if (this._searchedSpots.has(s.id)) continue;
      const d = s.pos.distanceTo(this.searchCenter);
      if (d > 16) continue;
      const known = this.knowledge.has(s.id) || s.witnessed;
      const score = d - (known ? 40 : 0);
      if (score < bestD) { bestD = score; best = s; }
    }
    return best;
  }

  _repath(target) {
    this.target.copy(target);
    this.path = this.world.pathWaypoints(this.pos, target);
    this.pathIndex = 0;
    this.waitTimer = 0;
  }

  _arrived() {
    return this.path.length === 0 || this.pathIndex >= this.path.length;
  }

  _moveAlongPath(dt, speed, world) {
    if (this._arrived()) return true;
    const wp = this.path[this.pathIndex];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.55) {
      this.pathIndex++;
      if (this._arrived()) return true;
      return false;
    }
    const step = Math.min(speed * dt, d);
    const nx = this.pos.x + (dx / d) * step;
    const nz = this.pos.z + (dz / d) * step;
    this.pos.x = nx;
    this.pos.z = nz;
    this.facing = Math.atan2(dx, dz);
    return false;
  }

  update(dt, player, world, audio, hooks) {
    this.stateTime += dt;
    this.mat.uniforms.uTime.value += dt;
    this.ghostMat.uniforms.uTime.value += dt;
    const playerPos = player.position;
    const distToPlayer = this.distanceTo(playerPos);
    if (this.grace > 0) this.grace -= dt;

    if (this.holdMode) {
      this._updateHold(dt, player, audio);
      this._animate(dt, 0);
      return;
    }

    if (this.dead) { this.root.visible = false; return; }
    this.root.visible = true;

    const detectionEnabled = this.grace <= 0 && this.state !== 'ghost';
    const sawPlayer = detectionEnabled && this.canSeePlayer(playerPos, player) && !player.hidden;
    if (sawPlayer) {
      this.lastSeen.set(playerPos.x, 0, playerPos.z);
      this.sightMemory = 0;
      if (this.state !== 'hunt') {
        if (this.state !== 'ghost') {
          audio.screech(this.state === 'wander' ? 0.8 : 0.55);
          hooks.onSpot(distToPlayer);
        }
        this.state = 'hunt';
        this.stateTime = 0;
        this._repath(playerPos);
      }
    } else if (this.state === 'hunt') {
      this.sightMemory += dt;
      if (this.sightMemory > 3.8) {
        this._enterSearch();
      }
    }

    switch (this.state) {
      case 'ghost': {
        const path = this.ghostPath;
        if (!path || this.ghostIndex >= path.length) {
          this._setMatGhost(false);
          this.state = 'wander';
          this.stateTime = 0;
          this.grace = 1.2;
          audio.screech(0.9);
          hooks.onMaterialize();
          break;
        }
        const target = path[this.ghostIndex];
        const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) { this.ghostIndex++; break; }
        const spd = 1.35;
        this.pos.x += (dx / d) * Math.min(spd * dt, d);
        this.pos.z += (dz / d) * Math.min(spd * dt, d);
        this.facing = Math.atan2(dx, dz);
        this.footstepPhase += spd * dt;
        if (this.footstepPhase > 0.62) {
          this.footstepPhase = 0;
          audio.footstep('concrete', 0.5, this.pos);
          if (Math.random() < 0.12) audio.whisperBurstAround(playerPos, rand(4, 8));
        }
        for (const spot of world.hidingSpots) {
          if (!this.knowledge.has(spot.id) && this.pos.distanceTo(spot.pos) < 2.6) {
            this.markKnown(spot);
            hooks.onLearn(spot);
          }
        }
        break;
      }
      case 'wander': {
        this.awareness = damp(this.awareness, 0, 1.2, dt);
        const pressure = 0.22 + (this.playerCores || 0) * 0.13;
        const wanderTarget = () => {
          if (Math.random() < pressure) {
            const pc = world.worldToCell(playerPos.x, playerPos.z);
            return world.randomPointInRoom(pc.i, pc.j);
          }
          return world.randomPointInRoom(Math.floor(rand(0, 5)), Math.floor(rand(0, 5)));
        };
        if (this._arrived() || this.waitTimer > 0) {
          this.waitTimer -= dt;
          if (this.waitTimer <= 0) {
            this._repath(wanderTarget());
            this.waitTimer = rand(1.5, 5);
          }
        }
        this.speed = damp(this.speed, 1.05, 3, dt);
        if (this._moveAlongPath(dt, this.speed, world)) {
          this.waitTimer = rand(1, 4);
          this._repath(wanderTarget());
        }
        break;
      }
      case 'investigate': {
        this.speed = damp(this.speed, 2.6, 3, dt);
        this.awareness = damp(this.awareness, 0.5, 2, dt);
        if (this.lastNoise && performance.now() - this.lastNoise.t > 12000) {
          this._enterSearch();
        } else if (this._moveAlongPath(dt, this.speed, world)) {
          this._enterSearch();
        }
        break;
      }
      case 'hunt': {
        this.awareness = damp(this.awareness, 1, 4, dt);
        const targetDist = distToPlayer;
        this.speed = damp(this.speed, 5.15 + this.corrupt * 0.9, 4, dt);
        const repathCooldown = this._repathCd || 0;
        if (performance.now() > repathCooldown) {
          this._repath(this.lastSeen);
          this._repathCd = performance.now() + 900;
        }
        this._moveAlongPath(dt, this.speed, world);
        this.footstepPhase += this.speed * dt;
        if (this.footstepPhase > 0.42) {
          this.footstepPhase = 0;
          audio.footstep('concrete', 0.95, this.pos);
        }
        if (Math.random() < dt * 0.5) audio.whisperBurstAround(playerPos, rand(1.5, 4));
        if (distToPlayer < 1.8 && this.attackTimer <= 0) {
          this.attackTimer = 0.75;
          this.attackQueued = true;
          audio.screech(1.2);
          hooks.onAttackWindup();
        }
        break;
      }
      case 'search': {
        this.awareness = damp(this.awareness, 0.8, 2, dt);
        this.speed = damp(this.speed, 2.2, 3, dt);
        this.lookTimer = (this.lookTimer || 0) - dt;
        if (this._pendingSpot && this._arrived()) {
          const spot = this._pendingSpot;
          this._pendingSpot = null;
          this._searchedSpots.add(spot.id);
          const dSpot = spot.pos.distanceTo(playerPos);
          if (player.hidden && dSpot < 2.0 && this.attackTimer <= 0 && !this.attackQueued) {
            const known = this.knowledge.has(spot.id) || spot.witnessed;
            if (known || Math.random() < 0.45) {
              this.attackTimer = 1.1;
              this.attackQueued = true;
              audio.screech(1.3);
              hooks.onLockerAttack(spot);
            }
          }
          this.lookTimer = 0;
        }
        if (this._arrived() && this.lookTimer <= 0) {
          const spot = this._pickSearchSpot();
          if (spot) {
            this._pendingSpot = spot;
            this._repath(spot.pos);
            this.lookTimer = 99;
          } else {
            this.searchRing = (this.searchRing || 0) + 1;
            const radius = 3.5 + this.searchRing * 3.4;
            const a = Math.random() * Math.PI * 2;
            this._repath(new THREE.Vector3(
              this.searchCenter.x + Math.cos(a) * radius, 0,
              this.searchCenter.z + Math.sin(a) * radius
            ));
            this.lookTimer = rand(2.5, 4.5);
          }
        }
        this._moveAlongPath(dt, this.speed, world);
        if (this.stateTime > 42) {
          this.state = 'wander';
          this.stateTime = 0;
          this._repath(world.randomPointInRoom(Math.floor(rand(0, 5)), Math.floor(rand(0, 5))));
        }
        break;
      }
    }

    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0 && this.attackQueued) {
        this.attackQueued = false;
        if (this.distanceTo(playerPos) < 2.2 && !player.hidden) {
          hooks.onKill();
        }
      }
    }
    if (player.hidden && distToPlayer > 0.5) {
      // lurking near hiding spots
      if (this.state === 'hunt' || this.state === 'search') {
        if (distToPlayer < 2.4 && !this.attackQueued && this.attackTimer <= 0) {
          const spot = this._spotAt(player.guardPoint || playerPos);
          if (spot && (this.knowledge.has(spot.id) || spot.witnessed)) {
            this.attackTimer = 1.1;
            this.attackQueued = true;
            audio.screech(1.3);
            hooks.onLockerAttack(spot);
          }
        }
      }
    }

    this._animate(dt, this.speed);
    const tension = this._tension(distToPlayer);
    return { distToPlayer, tension, sawPlayer, awareness: this.awareness };
  }

  _spotAt(p) {
    for (const s of this.world.hidingSpots) {
      if (s.pos.distanceTo(p) < 1.6) return s;
    }
    return null;
  }

  _tension(dist) {
    let t = clamp(1 - dist / 24, 0, 1);
    if (this.state === 'hunt') t = Math.min(1, t + 0.35);
    else if (this.state === 'search' || this.state === 'investigate') t = Math.min(1, t + 0.15);
    if (this.isGhost) t *= 0.5;
    return t * t;
  }

  beginHold(pos, playerFacing) {
    this.holdMode = true;
    this.root.visible = true;
    this._setMatGhost(false);
    const a = playerFacing + Math.PI * 0.55;
    this.holdPos.set(pos.x + Math.sin(a) * 2.1, 0, pos.z + Math.cos(a) * 2.1);
    this.setPosition(this.holdPos.x, this.holdPos.z);
    this.facing = Math.atan2(pos.x - this.holdPos.x, pos.z - this.holdPos.z);
    this.mat.uniforms.uMouth.value = 0.55;
  }

  _updateHold(dt, player, audio) {
    const p = player.position;
    this.facing = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.stateTime += 0;
    if (Math.random() < dt * 2.5) audio.whisperBurstAround(p, 2.2);
    if (Math.random() < dt * 0.7) audio.screech(0.25);
  }

  endHold(kill) {
    this.holdMode = false;
    if (kill) {
      this.mat.uniforms.uMouth.value = 1;
    } else {
      this.mat.uniforms.uMouth.value = 0;
      this.state = 'wander';
      this.stateTime = 0;
      this._repath(this.world.randomPointInRoom(Math.floor(rand(0, 5)), Math.floor(rand(0, 5))));
    }
  }

  _animate(dt, speed) {
    this.animPhase += dt * (1.4 + speed * 1.35);
    const s = clamp(speed / 4.5, 0, 1.4);
    const swing = Math.sin(this.animPhase * 2.2) * (0.25 + s * 0.75);
    const swing2 = Math.cos(this.animPhase * 2.2) * (0.25 + s * 0.75);
    const hunting = this.state === 'hunt';
    const attack = this.attackTimer > 0;
    this.thighL.group.rotation.x = swing * 0.85;
    this.thighR.group.rotation.x = -swing * 0.85;
    this.shinL.group.rotation.x = Math.max(0, -swing) * 1.1;
    this.shinR.group.rotation.x = Math.max(0, swing) * 1.1;
    this.armL.group.rotation.x = hunting ? -1.6 - swing * 0.25 : -swing2 * 0.5 - 0.15;
    this.armR.group.rotation.x = hunting ? -1.6 + swing * 0.25 : swing2 * 0.5 - 0.15;
    this.armL.group.rotation.z = hunting ? 0.5 : 0.14;
    this.armR.group.rotation.z = hunting ? -0.5 : -0.14;
    this.foreL.group.rotation.x = hunting ? -0.7 : -0.3;
    this.foreR.group.rotation.x = hunting ? -0.7 : -0.3;
    if (attack) {
      const t = 1 - this.attackTimer / 0.8;
      this.armL.group.rotation.x = -2.4 * t;
      this.armR.group.rotation.x = -2.4 * t;
      this.armL.group.rotation.z = 0.1;
      this.armR.group.rotation.z = -0.1;
      this.torso.rotation.x = -0.35 * t;
    } else {
      this.torso.rotation.x = lerp(this.torso.rotation.x, hunting ? 0.32 : 0.08, 1 - Math.exp(-dt * 5));
      this.torso.rotation.y = Math.sin(this.animPhase * 1.1) * 0.06;
    }
    this.hips.position.y = 1.42 + Math.abs(Math.sin(this.animPhase * 2.2)) * 0.05 * (0.4 + s);
    this.twitch -= dt;
    if (this.twitch <= 0) {
      this.twitch = rand(0.5, 2.6);
      this.headTwitch = { x: rand(-0.5, 0.5), y: rand(-1.2, 1.2), t: 1 };
    }
    if (this.headTwitch && this.headTwitch.t > 0) {
      this.headTwitch.t -= dt * 6;
      const k = clamp(this.headTwitch.t, 0, 1);
      this.head.rotation.x = damp(this.head.rotation.x, this.headTwitch.x * k, 14, dt);
      this.head.rotation.y = damp(this.head.rotation.y, this.headTwitch.y * k, 12, dt);
    } else {
      this.head.rotation.x = damp(this.head.rotation.x, 0.12, 3, dt);
      this.head.rotation.y = damp(this.head.rotation.y, 0, 3, dt);
    }
    if (this.holdMode) {
      this.head.rotation.y = 0;
      this.head.rotation.x = -0.1;
      this.mat.uniforms.uMouth.value = 0.45 + Math.sin(performance.now() / 300) * 0.25;
    }
    this.corrupt = this.awareness;
    this.mat.uniforms.uCorrupt.value = this.corrupt;
    this.ghostMat.uniforms.uCorrupt.value = this.corrupt;
    this.root.rotation.y = this.facing || 0;
  }
}
