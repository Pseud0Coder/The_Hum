import * as THREE from 'three';
import { RNG, pick, rand } from './utils.js';
import * as TX from './textures.js';
import { applyPS1 } from './ps1.js';

export const GRID = 5;
export const CELL = 14;
export const WALL_H = 3.4;
export const WALL_T = 0.3;
export const DOOR_W = 2.9;
export const DOOR_H = 2.4;
const HALF = CELL / 2;

export function cellCenter(i, j) {
  return { x: (i - (GRID - 1) / 2) * CELL, z: (j - (GRID - 1) / 2) * CELL };
}
export function worldToCell(x, z) {
  return {
    i: Math.round(x / CELL + (GRID - 1) / 2),
    j: Math.round(z / CELL + (GRID - 1) / 2),
  };
}
const inGrid = (i, j) => i >= 0 && j >= 0 && i < GRID && j < GRID;

function segAABB(ax, az, bx, bz, c) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const slabs = [[ax, dx, c.x0, c.x1], [az, dz, c.z0, c.z1]];
  for (const [p, d, mn, mx] of slabs) {
    if (Math.abs(d) < 1e-8) {
      if (p < mn || p > mx) return false;
    } else {
      let ta = (mn - p) / d, tb = (mx - p) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.rng = new RNG(seed);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = new Map();
    this.lights = [];
    this.hidingSpots = [];
    this.items = [];
    this.doors = [];
    this.linkX = {}; // linkX[i][j] connects (i,j)-(i+1,j)
    this.linkZ = {}; // linkZ[i][j] connects (i,j)-(i,j+1)
    this.roomType = {};
    this.decorations = [];
    this.dust = null;
    this._mats = {};
  }

  key(i, j) { return `${i},${j}`; }
  worldToCell(x, z) { return worldToCell(x, z); }
  connected(i, j, i2, j2) {
    if (i2 === i + 1 && j2 === j) return !!this.linkX[this.key(i, j)];
    if (i2 === i - 1 && j2 === j) return !!this.linkX[this.key(i2, j)];
    if (j2 === j + 1 && i2 === i) return !!this.linkZ[this.key(i, j)];
    if (j2 === j - 1 && i2 === i) return !!this.linkZ[this.key(i, j2)];
    return false;
  }

  mat(name, make) {
    if (!this._mats[name]) this._mats[name] = applyPS1(make());
    return this._mats[name];
  }

  // ------------------------------------------------------ generation
  build() {
    this._generateGraph();
    this._assignTypes();
    this._buildRooms();
    this._buildWalls();
    this._placeContent();
    this._buildDust();
    return this;
  }

  _generateGraph() {
    const links = new Set();
    const visited = new Set();
    const stack = [[0, 0]];
    visited.add('0,0');
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const opts = [];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (inGrid(ni, nj) && !visited.has(this.key(ni, nj))) opts.push([ni, nj]);
      }
      if (!opts.length) { stack.pop(); continue; }
      const [ni, nj] = this.rng.pick(opts);
      visited.add(this.key(ni, nj));
      const a = i < ni || j < nj ? [i, j, ni, nj] : [ni, nj, i, j];
      links.add(this.key(a[0], a[1]) + '|' + this.key(a[2], a[3]));
      stack.push([ni, nj]);
    }
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        if (i < GRID - 1 && this.rng.chance(0.22) && !this._has(links, i, j, i + 1, j)) links.add(`${i},${j}|${i + 1},${j}`);
        if (j < GRID - 1 && this.rng.chance(0.22) && !this._has(links, i, j, i, j + 1)) links.add(`${i},${j}|${i},${j + 1}`);
      }
    }
    // guarantee the elevator room (4,4) has at least two exits
    for (const s of links) {
      const [a, b] = s.split('|');
      const [ai, aj] = a.split(',').map(Number);
      const [bi, bj] = b.split(',').map(Number);
      if (bi === ai + 1 && bj === aj) this.linkX[this.key(ai, aj)] = true;
      else if (bj === aj + 1 && bi === ai) this.linkZ[this.key(ai, aj)] = true;
    }
    let exits = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (inGrid(4 + di, 4 + dj) && this.connected(4, 4, 4 + di, 4 + dj)) exits++;
    }
    if (exits < 2) {
      const opts = [];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = 4 + di, nj = 4 + dj;
        if (inGrid(ni, nj) && !this.connected(4, 4, ni, nj)) opts.push([ni, nj]);
      }
      const [ni, nj] = this.rng.pick(opts);
      this._setLink(4, 4, ni, nj);
    }
  }

  _setLink(i, j, i2, j2) {
    if (i2 === i + 1) this.linkX[this.key(i, j)] = true;
    else if (i2 === i - 1) this.linkX[this.key(i2, j)] = true;
    else if (j2 === j + 1) this.linkZ[this.key(i, j)] = true;
    else if (j2 === j - 1) this.linkZ[this.key(i, j2)] = true;
  }

  _has(links, i, j, i2, j2) { return links.has(`${i},${j}|${i2},${j2}`); }

  _bfsDepth() {
    const depth = { '0,0': 0 };
    const q = [[0, 0]];
    while (q.length) {
      const [i, j] = q.shift();
      const d = depth[this.key(i, j)];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (inGrid(ni, nj) && this.connected(i, j, ni, nj) && depth[this.key(ni, nj)] === undefined) {
          depth[this.key(ni, nj)] = d + 1;
          q.push([ni, nj]);
        }
      }
    }
    return depth;
  }

  _assignTypes() {
    this.depth = this._bfsDepth();
    const pools = [
      { type: 'lab', w: 3 }, { type: 'dorm', w: 3 }, { type: 'storage', w: 3 },
      { type: 'server', w: 2 }, { type: 'containment', w: 2 }, { type: 'cafeteria', w: 1 },
    ];
    const totalW = pools.reduce((s, p) => s + p.w, 0);
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      if (i === 0 && j === 0) { this.roomType[this.key(i, j)] = 'lobby'; continue; }
      if (i === GRID - 1 && j === GRID - 1) { this.roomType[this.key(i, j)] = 'elevator'; continue; }
      let r = this.rng.next() * totalW, chosen = 'lab';
      for (const p of pools) { if (r < p.w) { chosen = p.type; break; } r -= p.w; }
      this.roomType[this.key(i, j)] = chosen;
    }
    const depthEntries = Object.entries(this.depth).sort((a, b) => b[1] - a[1]);
    const candidates = depthEntries.map(([k]) => k).filter(k => k !== '0,0' && k !== '4,4');
    const buckets = [[], [], [], []];
    for (const k of candidates) {
      const d = this.depth[k];
      const idx = Math.min(3, Math.max(0, Math.round((d - 2) / 1.4)));
      buckets[idx].push(k);
    }
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    this.coreCells = [];
    for (let b = 3; b >= 0 && this.coreCells.length < 4; b--) {
      shuffle(buckets[b]);
      for (const k of buckets[b]) {
        if (this.coreCells.length < 4 && !this.coreCells.includes(k)) this.coreCells.push(k);
      }
    }
    while (this.coreCells.length < 4) {
      const k = candidates[Math.floor(Math.random() * candidates.length)];
      if (!this.coreCells.includes(k)) this.coreCells.push(k);
    }
    this.coreCells.sort((a, b) => (this.depth[a] || 0) - (this.depth[b] || 0));
  }

  // ------------------------------------------------------ geometry helpers
  _addBox(w, h, d, mat, x, y, z, parent = this.group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  _addCollider(cx, cz, w, d, tag = 'prop', cell = null) {
    const c = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, tag };
    const k = cell || this.key(worldToCell(cx, cz).i, worldToCell(cx, cz).j);
    if (!this.colliders.has(k)) this.colliders.set(k, []);
    this.colliders.get(k).push(c);
    return c;
  }

  collidersNear(x, z) {
    const { i, j } = worldToCell(x, z);
    const out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const k = this.key(i + di, j + dj);
      if (this.colliders.has(k)) out.push(...this.colliders.get(k));
    }
    return out;
  }

  _light(x, z, y, color, intensity, roomKey, style = 'steady') {
    this.lights.push({ x, y, z, color, intensity, roomKey, style, phase: Math.random() * 20 });
  }

  _lamp(x, z, roomKey, { color = 0xdfe8ff, intensity = 17, broken = 0, style } = {}) {
    const on = Math.random() > broken;
    const m = this.mat('lampBody', () => new THREE.MeshLambertMaterial({ color: 0x2a2d31 }));
    const glowMat = new THREE.MeshBasicMaterial({ color });
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.34), m);
    housing.position.y = WALL_H - 0.08;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.045, 0.2), glowMat);
    tube.position.y = WALL_H - 0.15;
    g.add(housing, tube);
    g.position.set(x, 0, z);
    this.group.add(g);
    tube.material = glowMat;
    const fixture = { x, y: WALL_H - 0.2, z, color, intensity, roomKey, style: style || (on ? (Math.random() < 0.14 ? 'dying' : Math.random() < 0.22 ? 'buzz' : 'steady') : 'dead'), phase: Math.random() * 40, mesh: tube, glowMat, base: on ? intensity : 0 };
    this.lights.push(fixture);
    return fixture;
  }

  // ------------------------------------------------------ rooms
  _buildRooms() {
    const mk = this.mat.bind(this);
    this.floorMats = {
      lobby: mk('fLobby', () => new THREE.MeshLambertMaterial({ map: TX.concrete(11, [64, 63, 58], 1.2) })),
      lab: mk('fLab', () => new THREE.MeshLambertMaterial({ map: TX.tile(12, [120, 122, 118], [30, 30, 30]) })),
      dorm: mk('fDorm', () => new THREE.MeshLambertMaterial({ map: TX.carpet(13, [48, 24, 26]) })),
      storage: mk('fStore', () => new THREE.MeshLambertMaterial({ map: TX.concrete(14, [70, 66, 58], 1.6) })),
      server: mk('fServer', () => new THREE.MeshLambertMaterial({ map: TX.metal(15, [58, 60, 66], 0.25) })),
      containment: mk('fCont', () => new THREE.MeshLambertMaterial({ map: TX.tile(16, [104, 110, 104], [24, 28, 24]) })),
      cafeteria: mk('fCafe', () => new THREE.MeshLambertMaterial({ map: TX.tile(17, [96, 88, 74], [36, 32, 28]) })),
      elevator: mk('fElev', () => new THREE.MeshLambertMaterial({ map: TX.metal(18, [74, 76, 80], 0.35) })),
    };
    this.ceilMat = mk('ceil', () => new THREE.MeshLambertMaterial({ map: TX.ceiling(19) }));
    const floorGeo = new THREE.PlaneGeometry(CELL + 0.4, CELL + 0.4);
    const ceilGeo = new THREE.PlaneGeometry(CELL + 0.4, CELL + 0.4);
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const { x, z } = cellCenter(i, j);
        const type = this.roomType[this.key(i, j)];
        const floor = new THREE.Mesh(floorGeo, this.floorMats[type]);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(x, 0, z);
        this.group.add(floor);
        const ceil = new THREE.Mesh(ceilGeo, this.ceilMat);
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(x, WALL_H, z);
        this.group.add(ceil);
        this._roomLights(x, z, type, this.key(i, j));
      }
    }
  }

  _roomLights(x, z, type, roomKey) {
    const r = this.rng;
    const G = CELL / 2 - 1.6;
    if (type === 'lab' || type === 'server' || type === 'cafeteria') {
      this._lamp(x - G * 0.55, z, roomKey, { color: type === 'server' ? 0x9fc6ff : 0xe6efff, intensity: 20 });
      this._lamp(x + G * 0.55, z, roomKey, { color: 0xcfe2ff, intensity: 17, broken: 0.34 });
      if (r.chance(0.5)) this._lamp(x, z - G * 0.55, roomKey, { intensity: 16, broken: 0.3 });
    } else if (type === 'dorm') {
      this._lamp(x, z, roomKey, { color: 0xffc98a, intensity: 12, broken: 0.2, style: 'warm' });
    } else if (type === 'containment') {
      this._lamp(x, z, roomKey, { color: 0xa8ffd0, intensity: 15, broken: 0.3 });
      this._lamp(x - G, z - G, roomKey, { color: 0xff5a4a, intensity: 8, style: 'alarm' });
    } else if (type === 'elevator') {
      this._lamp(x, z, roomKey, { color: 0xffb0a0, intensity: 12, style: 'buzz' });
    } else {
      this._lamp(x - G * 0.5, z - G * 0.3, roomKey, { color: 0xdfe8ff, intensity: 18, broken: 0.3 });
      if (r.chance(0.6)) this._lamp(x + G * 0.6, z + G * 0.4, roomKey, { color: 0xdfe8ff, intensity: 15, broken: 0.4 });
    }
  }

  // ------------------------------------------------------ walls
  _buildWalls() {
    this.wallMat = this.mat('wall', () => new THREE.MeshLambertMaterial({ map: TX.concrete(20, [78, 76, 72], 1.1) }));
    this.metalWallMat = this.mat('wallMetal', () => new THREE.MeshLambertMaterial({ map: TX.metal(21, [76, 78, 82], 0.5) }));
    this.hazardMat = this.mat('hazard', () => new THREE.MeshLambertMaterial({ map: TX.hazard() }));
    this.pipeMat = this.mat('pipe', () => new THREE.MeshLambertMaterial({ color: 0x4a4c4e }));
    this.signMats = {};
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const { x, z } = cellCenter(i, j);
        if (i < GRID - 1) this._wall(x + HALF, z, 'z', !!this.linkX[this.key(i, j)], (i + j) % 3 === 0);
        if (j < GRID - 1) this._wall(x, z + HALF, 'x', !!this.linkZ[this.key(i, j)], (i + j) % 4 === 0);
        if (i === 0) this._wall(x - HALF, z, 'z', false, false);
        if (j === 0) this._wall(x, z - HALF, 'x', false, false);
        if (i === GRID - 1) this._wall(x + HALF, z, 'z', false, false);
        if (j === GRID - 1) this._wall(x, z + HALF, 'x', false, false);
      }
    }
    // rare locked door decoration on perimeter
    for (let i = 0; i < GRID; i++) {
      if (this.rng.chance(0.5)) this._lockedDoor(cellCenter(i, 0).x, cellCenter(i, 0).z - HALF, 'x');
    }
  }

  _wall(cx, cz, axis, hasDoor, metal) {
    const mat = metal ? this.metalWallMat : this.wallMat;
    const t = WALL_T;
    const mk = (px, pz, w, d, h = WALL_H, y = WALL_H / 2) => {
      const m = this._addBox(w, h, d, mat, px, y, pz);
      this._addCollider(px, pz, Math.max(w, t), Math.max(d, t), 'wall');
      return m;
    };
    if (!hasDoor) {
      if (axis === 'z') mk(cx, cz, t, CELL);
      else mk(cx, cz, CELL, t);
      this._wallPipes(cx, cz, axis);
      return;
    }
    const side = (CELL - DOOR_W) / 2;
    const off = DOOR_W / 2 + side / 2;
    if (axis === 'z') {
      mk(cx, cz - off, t, side);
      mk(cx, cz + off, t, side);
      this._addBox(t, WALL_H - DOOR_H, DOOR_W, mat, cx, DOOR_H + (WALL_H - DOOR_H) / 2, cz);
    } else {
      mk(cx - off, cz, side, t);
      mk(cx + off, cz, side, t);
      this._addBox(DOOR_W, WALL_H - DOOR_H, t, mat, cx, DOOR_H + (WALL_H - DOOR_H) / 2, cz);
    }
    this._doorFrame(cx, cz, axis);
  }

  _doorFrame(cx, cz, axis) {
    const fm = this.mat('frame', () => new THREE.MeshLambertMaterial({ color: 0x2c2e30 }));
    const hz = this.hazardMat;
    if (axis === 'z') {
      this._addBox(0.16, DOOR_H, 0.18, fm, cx, DOOR_H / 2, cz - DOOR_W / 2);
      this._addBox(0.16, DOOR_H, 0.18, fm, cx, DOOR_H / 2, cz + DOOR_W / 2);
      this._addBox(0.16, 0.2, DOOR_W + 0.36, fm, cx, DOOR_H + 0.1, cz);
      this._addBox(0.05, 0.3, 0.72, hz, cx - 0.17, 0.15, cz - DOOR_W / 2 - 0.28);
      this._addBox(0.05, 0.3, 0.72, hz, cx - 0.17, 0.15, cz + DOOR_W / 2 + 0.28);
    } else {
      this._addBox(0.18, DOOR_H, 0.16, fm, cx - DOOR_W / 2, DOOR_H / 2, cz);
      this._addBox(0.18, DOOR_H, 0.16, fm, cx + DOOR_W / 2, DOOR_H / 2, cz);
      this._addBox(DOOR_W + 0.36, 0.2, 0.16, fm, cx, DOOR_H + 0.1, cz);
      this._addBox(0.72, 0.3, 0.05, hz, cx - DOOR_W / 2 - 0.28, 0.15, cz - 0.17);
      this._addBox(0.72, 0.3, 0.05, hz, cx + DOOR_W / 2 + 0.28, 0.15, cz - 0.17);
    }
    this.doors.push({ x: cx, z: cz, axis });
  }

  _lockedDoor(x, z, axis) {
    const m = this.mat('doorMetal', () => new THREE.MeshLambertMaterial({ map: TX.metal(22, [88, 86, 84], 0.6) }));
    const d = this._addBox(axis === 'x' ? 2.6 : 0.18, 2.3, axis === 'x' ? 0.18 : 2.6, m, x, 1.15, z);
    this._addCollider(x, z, axis === 'x' ? 2.6 : 0.2, axis === 'x' ? 0.2 : 2.6, 'wall');
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    light.position.set(axis === 'x' ? x + 1.1 : x + 0.12, 1.8, axis === 'x' ? z + 0.12 : z + 1.1);
    this.group.add(light);
  }

  _wallPipes(cx, cz, axis) {
    if (Math.random() > 0.55) return;
    const y = WALL_H - 0.45;
    const r = 0.09;
    const geo = new THREE.CylinderGeometry(r, r, CELL, 8);
    for (let k = 0; k < (Math.random() < 0.5 ? 2 : 1); k++) {
      const m = new THREE.Mesh(geo, this.pipeMat);
      if (axis === 'z') { m.rotation.x = Math.PI / 2; m.position.set(cx + 0.3 + k * 0.24, y - k * 0.2, cz); }
      else { m.rotation.z = Math.PI / 2; m.position.set(cx, y - k * 0.2, cz + 0.3 + k * 0.24); }
      this.group.add(m);
    }
  }

  // ------------------------------------------------------ props
  _sign(text, sub, x, z, axis, y = 2.2, flip = false, color = '#e8b04b') {
    const key = `sign|${text}|${sub}|${color}`;
    if (!this.signMats[key]) {
      this.signMats[key] = new THREE.MeshBasicMaterial({ map: TX.sign(text, sub, color), side: THREE.DoubleSide });
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), this.signMats[key]);
    m.position.set(x, y, z);
    if (axis === 'x') m.rotation.y = flip ? Math.PI : 0;
    else m.rotation.y = flip ? -Math.PI / 2 : Math.PI / 2;
    this.group.add(m);
    return m;
  }

  _poster(x, z, axis) {
    if (!this._posterMat) this._posterMat = new THREE.MeshLambertMaterial({ map: TX.poster(31), side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), this._posterMat);
    m.position.set(x, 1.7, z);
    m.rotation.y = axis === 'x' ? 0 : Math.PI / 2;
    m.rotation.z = (Math.random() - 0.5) * 0.08;
    this.group.add(m);
  }

  _crate(x, z, s, parent = this.group) {
    const m = this.mat('crate', () => new THREE.MeshLambertMaterial({ map: TX.metal(23, [92, 74, 48], 0.7) }));
    const h = s * (0.7 + Math.random() * 0.5);
    this._addBox(s, h, s * 0.9, m, x, h / 2, z, parent);
    this._addCollider(x, z, s, s * 0.9);
  }

  _shelf(x, z) {
    const m = this.mat('shelf', () => new THREE.MeshLambertMaterial({ color: 0x3b3f42 }));
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.7), m);
      b.position.y = 0.5 + k * 0.75;
      g.add(b);
      if (Math.random() < 0.7) {
        const boxMat = this.mat('box', () => new THREE.MeshLambertMaterial({ color: 0x6b5c42 }));
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), boxMat);
        box.position.set(-0.8 + Math.random() * 1.6, 0.68 + k * 0.75, 0);
        box.rotation.y = Math.random();
        g.add(box);
      }
    }
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() < 0.5 ? 0 : Math.PI;
    this.group.add(g);
    this._addCollider(x, z, 2.4, 0.75);
  }

  _locker(x, z, rotY) {
    const m = this.mat('locker', () => new THREE.MeshLambertMaterial({ map: TX.metal(24, [62, 72, 70], 0.45) }));
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.62), m);
    body.position.y = 1.05;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.96, 0.04), m);
    door.position.set(0, 1.05, 0.33);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    slit.position.set(0, 1.72, 0.36);
    g.add(body, door, slit);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, 0.95, 0.72);
    const spot = {
      id: `locker_${this.hidingSpots.length}`,
      type: 'locker',
      pos: new THREE.Vector3(x, 0, z),
      yaw: rotY,
      cell: this.key(worldToCell(x, z).i, worldToCell(x, z).j),
      known: false,
      uses: 0,
    };
    this.hidingSpots.push(spot);
    return spot;
  }

  _serverRack(x, z, rotY) {
    const m = this.mat('rack', () => new THREE.MeshLambertMaterial({ color: 0x22262b }));
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.8), m);
    body.position.y = 1.1;
    g.add(body);
    const leds = [];
    for (let k = 0; k < 12; k++) {
      const c = Math.random() < 0.3 ? 0x37ff6a : (Math.random() < 0.5 ? 0xffb037 : 0xff3b30);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: c }));
      led.position.set(-0.28 + (k % 3) * 0.28, 0.3 + Math.floor(k / 3) * 0.45, 0.41);
      g.add(led);
      leds.push({ mesh: led, t: Math.random() * 10, speed: 2 + Math.random() * 6 });
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, 0.85, 0.85);
    this.decorations.push({ type: 'leds', leds });
  }

  _tank(x, z) {
    const glass = this.mat('glass', () => new THREE.MeshLambertMaterial({ color: 0x2a4a48, transparent: true, opacity: 0.42 }));
    const fluid = this.mat('fluid', () => new THREE.MeshBasicMaterial({ color: 0x1de9a6, transparent: true, opacity: 0.5 }));
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.6, 14), glass);
    tank.position.y = 1.3;
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 1.9, 14), fluid);
    fl.position.y = 1.15;
    g.add(tank, fl);
    g.position.set(x, 0, z);
    this.group.add(g);
    this._addCollider(x, z, 1.5, 1.5);
    this._light(x, 1.5, z, 0x1de9a6, 4.5, this.key(worldToCell(x, z).i, worldToCell(x, z).j));
  }

  _bed(x, z, rotY) {
    const m = this.mat('bed', () => new THREE.MeshLambertMaterial({ color: 0x4a4d52 }));
    const sheet = this.mat('sheet', () => new THREE.MeshLambertMaterial({ color: 0x7d7a6e }));
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.36, 2.1), m);
    frame.position.y = 0.3;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 2.0), sheet);
    bed.position.y = 0.54;
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.4), this.mat('pillow', () => new THREE.MeshLambertMaterial({ color: 0xb9b3a4 })));
    pillow.position.set(0, 0.66, -0.7);
    g.add(frame, bed, pillow);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, 1.15, 2.15);
  }

  _desk(x, z, rotY) {
    const m = this.mat('desk', () => new THREE.MeshLambertMaterial({ color: 0x4a4034 }));
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.85), m);
    top.position.y = 0.76;
    g.add(top);
    for (const dx of [-0.75, 0.75]) for (const dz of [-0.32, 0.32]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.76, 0.07), m);
      leg.position.set(dx, 0.38, dz);
      g.add(leg);
    }
    if (Math.random() < 0.75) {
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.06),
        new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0x1b3a2a : 0x101418 }));
      screen.position.set(0, 1.02, -0.1);
      screen.rotation.x = -0.20;
      g.add(screen);
    }
    const papers = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.4), this.mat('paper', () => new THREE.MeshLambertMaterial({ color: 0xc9c2ae })));
    papers.position.set(0.5, 0.81, 0.1);
    papers.rotation.y = Math.random();
    g.add(papers);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, rotY % Math.PI === 0 ? 1.85 : 0.9, rotY % Math.PI === 0 ? 0.9 : 1.85);
  }

  _chair(x, z, rotY) {
    const m = this.mat('chair', () => new THREE.MeshLambertMaterial({ color: 0x2f3236 }));
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), m); seat.position.y = 0.46;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.06), m); back.position.set(0, 0.76, -0.22);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.44, 8), m); pole.position.y = 0.23;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10), m); base.position.y = 0.03;
    g.add(seat, back, pole, base);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, 0.55, 0.55);
  }

  _barrel(x, z) {
    const m = this.mat('barrel', () => new THREE.MeshLambertMaterial({ map: TX.metal(25, [110, 70, 40], 0.9) }));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), m);
    b.position.set(x, 0.5, z);
    this.group.add(b);
    this._addCollider(x, z, 0.9, 0.9);
  }

  _gurney(x, z, rotY) {
    const m = this.mat('gurney', () => new THREE.MeshLambertMaterial({ color: 0x8b9196 }));
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 2.0), m); top.position.y = 0.85;
    g.add(top);
    for (const dx of [-0.32, 0.32]) for (const dz of [-0.85, 0.85]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), m);
      leg.position.set(dx, 0.42, dz);
      g.add(leg);
    }
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 1.6), this.mat('sheet2', () => new THREE.MeshLambertMaterial({ color: 0x9a958a })));
    cover.position.y = 0.99;
    g.add(cover);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, rotY % Math.PI === 0 ? 0.85 : 2.05, rotY % Math.PI === 0 ? 2.05 : 0.85);
  }

  _vending(x, z, rotY) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.7), this.mat('vend', () => new THREE.MeshLambertMaterial({ color: 0x30343a })));
    body.position.y = 1.0;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), new THREE.MeshBasicMaterial({ color: 0x223322 }));
    face.position.set(0, 1.1, 0.36);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.12 }));
    glow.position.set(0, 1.1, 0.365);
    g.add(body, face, glow);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.group.add(g);
    this._addCollider(x, z, 1.15, 0.75);
  }

  _puddle(x, z) {
    const m = this.mat('puddle', () => new THREE.MeshLambertMaterial({ color: 0x0d1418, transparent: true, opacity: 0.72 }));
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.7 + Math.random() * 0.9, 12), m);
    p.rotation.x = -Math.PI / 2;
    p.scale.set(1, 0.6 + Math.random() * 0.6, 1);
    p.position.set(x + rand(-2, 2), 0.012, z + rand(-2, 2));
    p.rotation.z = Math.random() * 3;
    this.group.add(p);
  }

  _bloodFloor(x, z, scale = 1) {
    const key = 'blood' + (Math.random() * 4 | 0);
    if (!this._bloodMats) this._bloodMats = {};
    if (!this._bloodMats[key]) this._bloodMats[key] = new THREE.MeshLambertMaterial({ map: TX.blood(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6 * scale, 1.6 * scale), this._bloodMats[key]);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.015, z);
    p.rotation.z = Math.random() * 6;
    this.group.add(p);
  }

  _cables(x, z) {
    const pts = [];
    let px = x - 2, pz = z;
    for (let i = 0; i <= 6; i++) {
      pts.push(new THREE.Vector3(px, 0.02, pz));
      px += 0.7; pz += (Math.random() - 0.5) * 1.2;
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035, 5, false), this.mat('cable', () => new THREE.MeshLambertMaterial({ color: 0x131313 })));
    this.group.add(m);
  }

  _camera(x, z, rotY) {
    const m = this.mat('camBody', () => new THREE.MeshLambertMaterial({ color: 0x35383b }));
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.34), m);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8), m);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.2;
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    led.position.set(0.1, 0.08, 0.18);
    g.add(body, lens, led);
    g.position.set(x, 2.6, z);
    g.rotation.y = rotY;
    g.rotation.z = (Math.random() - 0.5) * 0.5;
    this.group.add(g);
  }

  // ------------------------------------------------------ content per room
  _placeContent() {
    const r = this.rng;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const { x, z } = cellCenter(i, j);
        const type = this.roomType[this.key(i, j)];
        const G = HALF - 2.1;
        const wallX = (s) => x + s * (G);
        const wallZ = (s) => z + s * (G);
        const roomKey = this.key(i, j);
        if (type === 'lab') {
          this._desk(x - G * 0.7, z - G * 0.6, r.chance(0.5) ? 0 : Math.PI / 2);
          this._chair(x - G * 0.7 + 1.0, z - G * 0.6 + 0.4, Math.random() * 6);
          this._shelf(x + G * 0.8, z + G * 0.7);
          if (r.chance(0.6)) this._tank(x + G * 0.75, z - G * 0.7);
          if (r.chance(0.5)) this._crate(x - G * 0.8, z + G * 0.75, 0.8);
          if (r.chance(0.4)) this._bloodFloor(x + rand(-3, 3), z + rand(-3, 3));
        } else if (type === 'dorm') {
          const n = r.int(1, 2);
          for (let k = 0; k < n; k++) this._bed(wallX(-0.85 + k * 1.7), z - G * 0.6, 0);
          if (r.chance(0.8)) this._locker(x - G * 0.9, wallZ(0.6), Math.PI / 2);
          if (r.chance(0.6)) this._desk(x + G * 0.6, z + G * 0.7, Math.PI);
          this._poster(wallX(0.4), wallZ(1.0), 'x');
        } else if (type === 'storage') {
          for (let k = 0; k < 3; k++) this._shelf(wallX(-0.85 + k * 1.7), wallZ(0.85));
          this._crate(x - G * 0.6, z - G * 0.6, r.range(0.7, 1.2));
          this._crate(x + G * 0.7, z - G * 0.2, r.range(0.6, 1.0));
          for (let k = 0; k < r.int(1, 4); k++) this._barrel(wallX(-0.8 + k * 0.9), z - G * 0.85);
          this._locker(x + G * 0.9, wallZ(-0.4), -Math.PI / 2);
          this._locker(x + G * 0.9, wallZ(0.7), -Math.PI / 2);
        } else if (type === 'server') {
          for (let k = 0; k < 4; k++) this._serverRack(wallX(-0.9 + (k % 2) * 1.8), wallZ(-0.5 + Math.floor(k / 2) * 1.4), r.chance(0.5) ? 0 : Math.PI);
          this._cables(x, z + 1);
          this._camera(x + G * 0.8, z - G * 0.8, -Math.PI / 4);
        } else if (type === 'containment') {
          for (let k = 0; k < 3; k++) this._tank(wallX(-0.75 + k * 0.75), wallZ(0.85));
          this._gurney(x - G * 0.6, z - G * 0.5, r.chance(0.5) ? Math.PI / 2 : 0);
          if (r.chance(0.8)) this._bloodFloor(x + rand(-2, 2), z + rand(-2, 2), 1.4);
          this._sign('CONTAINMENT', 'PROTOCOL 7', x, wallZ(1.0), 'x', 2.3, false, '#7dffb0');
        } else if (type === 'cafeteria') {
          for (let k = 0; k < 3; k++) {
            this._desk(wallX(-0.8 + k * 0.8), wallZ(0.4), 0);
            this._chair(wallX(-0.8 + k * 0.8), wallZ(0.4) - 0.8, 0);
          }
          this._vending(x + G * 0.85, z - G * 0.4, -Math.PI / 2);
          for (let k = 0; k < 3; k++) this._barrel(wallX(-0.8 + k * 0.8), z - G * 0.85);
        } else if (type === 'elevator') {
          this._elevatorRoom(x, z, roomKey);
        } else if (type === 'lobby') {
          this._sign('VOX-9', 'SUBLEVEL 4', x, wallZ(1.0) - 0.12, 'x', 2.4);
          this._sign('SILENCE', 'IS CONTAINMENT', x - G * 0.99, z + 0.1, 'z', 2.0, true);
          this._desk(x + G * 0.75, z - G * 0.75, Math.PI / 2);
          this._barrel(x - G * 0.8, z - G * 0.8);
          this._puddle(x + 2, z + 2);
          this._bloodFloor(x + G * 0.4, z - G * 0.2, 0.8);
          this._camera(x - G * 0.85, z + G * 0.85, Math.PI * 0.75);
        }
        if (r.chance(0.45)) this._puddle(x, z);
        if (r.chance(0.35)) this._cables(x + rand(-3, 3), z + rand(-3, 3));
        if (r.chance(0.3)) this._poster(x + rand(-4, 4), z + (r.chance(0.5) ? -1 : 1) * G, 'x');
      }
    }
    // items
    for (const coreCell of this.coreCells) {
      const [i, j] = coreCell.split(',').map(Number);
      const { x, z } = cellCenter(i, j);
      this._spawnItem('core', x + rand(-1.5, 1.5), z + rand(-1.5, 1.5), 0.9);
    }
    const freeCells = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) freeCells.push([i, j]);
    const randCell = () => freeCells[Math.floor(Math.random() * freeCells.length)];
    for (let k = 0; k < 7; k++) {
      const [i, j] = randCell();
      const { x, z } = cellCenter(i, j);
      this._spawnItem('battery', x + rand(-4.5, 4.5), z + rand(-4.5, 4.5), 0.06);
    }
    for (let k = 0; k < 9; k++) {
      const [i, j] = randCell();
      const { x, z } = cellCenter(i, j);
      this._spawnItem('bottle', x + rand(-4.5, 4.5), z + rand(-4.5, 4.5), 0.05);
    }
    for (let k = 0; k < 3; k++) {
      const [i, j] = randCell();
      const { x, z } = cellCenter(i, j);
      this._spawnItem('stim', x + rand(-4.0, 4.0), z + rand(-4.0, 4.0), 0.14);
    }
    // signs in rooms
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      if (this.rng.chance(0.3)) {
        const { x, z } = cellCenter(i, j);
        const labels = [['LAB ' + (i * GRID + j), ''], ['DORM ' + (10 + i)], ['SECTOR ' + String.fromCharCode(65 + i) + (j + 1), ''], ['QUIET ZONE', 'LEVEL 0 ONLY'], ['NO SIGNAL', 'MAINTAIN SILENCE']];
        const [t, s] = this.rng.pick(labels);
        this._sign(t, s, x + rand(-3, 3), z + HALF - 0.16, 'x', 2.35);
      }
    }
  }

  _spawnItem(type, x, z, y) {
    let mesh;
    if (type === 'core') {
      const geo = new THREE.IcosahedronGeometry(0.24, 0);
      const mat = new THREE.MeshBasicMaterial({ color: 0x7fffd9, wireframe: false });
      mesh = new THREE.Mesh(geo, mat);
      const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), new THREE.MeshBasicMaterial({ color: 0x39ffc0, wireframe: true, transparent: true, opacity: 0.7 }));
      mesh.add(cage);
      mesh.position.set(x, y, z);
      this._light(x, z, y, 0x39ffc0, 6, this.key(worldToCell(x, z).i, worldToCell(x, z).j));
    } else if (type === 'battery') {
      const m = this.mat('battery', () => new THREE.MeshLambertMaterial({ color: 0x2b6f4f }));
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10), m);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), new THREE.MeshBasicMaterial({ color: 0x9fffc0 }));
      tip.position.y = 0.14;
      mesh.add(tip);
      mesh.position.set(x, 0.12, z);
    } else if (type === 'stim') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 8),
        this.mat('stimBody', () => new THREE.MeshLambertMaterial({ color: 0xe4dfd0 })));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.07, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4a5a }));
      band.position.y = 0.03;
      const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6),
        this.mat('stimPlunger', () => new THREE.MeshLambertMaterial({ color: 0xb9b4a6 })));
      plunger.position.y = 0.17;
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6),
        new THREE.MeshBasicMaterial({ color: 0xcfd6dd }));
      needle.position.y = -0.16;
      mesh = new THREE.Group();
      mesh.add(body, band, plunger, needle);
      mesh.position.set(x, 0.2, z);
      mesh.rotation.z = Math.random() < 0.5 ? Math.PI / 2 : 0.1;
      if (mesh.rotation.z > 1) mesh.position.y = 0.06;
    } else {
      const m = this.mat('bottle', () => new THREE.MeshLambertMaterial({ color: 0x3a5f4a, transparent: true, opacity: 0.85 }));
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8), m);
      mesh.position.set(x, 0.15, z);
      mesh.rotation.z = Math.random() < 0.5 ? Math.PI / 2 : 0;
      if (mesh.rotation.z !== 0) mesh.position.y = 0.07;
    }
    this.group.add(mesh);
    const item = { type, mesh, pos: mesh.position, taken: false, baseY: mesh.position.y, phase: Math.random() * 10 };
    this.items.push(item);
    return item;
  }

  _elevatorRoom(x, z, roomKey) {
    const m = this.mat('elevDoor', () => new THREE.MeshLambertMaterial({ map: TX.metal(26, [96, 98, 104], 0.3) }));
    const g = new THREE.Group();
    const doors = [];
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.7, 0.16), m);
      d.position.set(s * 0.78, 1.35, 0);
      doors.push(d);
      g.add(d);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.3, 0.1), this.mat('elevFrame', () => new THREE.MeshLambertMaterial({ color: 0x2a2c2f })));
    frame.position.set(0, 1.65, -0.12);
    g.add(frame);
    const header = this._sign('EXTRACTION', 'CORES REQUIRED', 0, 0.25, 'x', 3.0);
    header.position.set(0, 3.0, 0.1);
    g.add(header);
    g.position.set(x, 0, z - HALF + 0.25);
    this.group.add(g);
    this._addCollider(x - 0.78, z - HALF + 0.25, 1.5, 0.3, 'elevator');
    this._addCollider(x + 0.78, z - HALF + 0.25, 1.5, 0.3, 'elevator');
    // panel
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.12), this.mat('panel', () => new THREE.MeshLambertMaterial({ color: 0x1c1e22 })));
    panel.position.set(x + 2.4, 1.3, z - HALF + 0.3);
    this.group.add(panel);
    const sockets = [];
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), new THREE.MeshBasicMaterial({ color: 0x331111 }));
      s.position.set(x + 2.4 + (k - 1.5) * 0.1, 1.3 + (k % 2) * 0.12 - 0.06, z - HALF + 0.365);
      this.group.add(s);
      sockets.push(s);
    }
    this.elevator = { x: x + 2.4, z: z - HALF + 0.5, group: g, doors, sockets, roomKey, doorsOpen: false, openT: 0 };
  }

  _buildDust() {
    const N = 500;
    const pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const i = this.rng.int(0, GRID - 1), j = this.rng.int(0, GRID - 1);
      const { x, z } = cellCenter(i, j);
      pos[k * 3] = x + rand(-HALF, HALF);
      pos[k * 3 + 1] = rand(0.2, WALL_H - 0.3);
      pos[k * 3 + 2] = z + rand(-HALF, HALF);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9aa4b0, size: 0.035, transparent: true, opacity: 0.5, sizeAttenuation: true });
    this.dust = new THREE.Points(geo, mat);
    this.group.add(this.dust);
  }

  // ------------------------------------------------------ navigation
  approxDistance(ax, az, bx, bz) {
    const straight = Math.hypot(ax - bx, az - bz);
    if (straight < 3.5) return straight;
    if (!this.segmentBlocked(ax, az, bx, bz)) return straight;
    const cells = this.findCellPath({ x: ax, z: az }, { x: bx, z: bz });
    const pathDist = cells.length * CELL * 0.92;
    return straight + Math.min(pathDist - straight, 18);
  }

  segmentBlocked(ax, az, bx, bz) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5)));
    const cells = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const c = worldToCell(ax + (bx - ax) * t, az + (bz - az) * t);
      cells.add(this.key(c.i, c.j));
    }
    for (const k of cells) {
      const arr = this.colliders.get(k);
      if (!arr) continue;
      for (const c of arr) {
        if (c.tag !== 'wall' && c.tag !== 'elevator') continue;
        if (segAABB(ax, az, bx, bz, c)) return true;
      }
    }
    return false;
  }

  findCellPath(from, to) {
    const a = worldToCell(from.x, from.z);
    const b = worldToCell(to.x, to.z);
    a.i = Math.max(0, Math.min(GRID - 1, a.i)); a.j = Math.max(0, Math.min(GRID - 1, a.j));
    b.i = Math.max(0, Math.min(GRID - 1, b.i)); b.j = Math.max(0, Math.min(GRID - 1, b.j));
    const startK = this.key(a.i, a.j), goalK = this.key(b.i, b.j);
    if (startK === goalK) return [[a.i, a.j]];
    const open = [{ i: a.i, j: a.j, g: 0, f: 0, p: null }];
    const seen = new Map();
    const h = (i, j) => Math.abs(i - b.i) + Math.abs(j - b.j);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      const cur = open.splice(bi, 1)[0];
      const ck = this.key(cur.i, cur.j);
      if (ck === goalK) {
        const path = [];
        let n = cur;
        while (n) { path.unshift([n.i, n.j]); n = n.p; }
        return path;
      }
      if (seen.has(ck) && seen.get(ck) <= cur.g) continue;
      seen.set(ck, cur.g);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = cur.i + di, nj = cur.j + dj;
        if (!inGrid(ni, nj) || !this.connected(cur.i, cur.j, ni, nj)) continue;
        const ng = cur.g + 1;
        const nk = this.key(ni, nj);
        if (seen.has(nk) && seen.get(nk) <= ng) continue;
        open.push({ i: ni, j: nj, g: ng, f: ng + h(ni, nj), p: cur });
      }
    }
    return [[a.i, a.j], [b.i, b.j]];
  }

  pathWaypoints(from, to) {
    const cells = this.findCellPath(from, to);
    const out = [];
    if (cells.length === 1) {
      out.push(new THREE.Vector3(to.x, 0, to.z));
      return out;
    }
    const first = cellCenter(cells[0][0], cells[0][1]);
    if (Math.hypot(from.x - first.x, from.z - first.z) > 1.4) out.push(new THREE.Vector3(first.x, 0, first.z));
    for (let k = 1; k < cells.length; k++) {
      const [pi, pj] = cells[k - 1], [ci, cj] = cells[k];
      const a = cellCenter(pi, pj), c = cellCenter(ci, cj);
      out.push(new THREE.Vector3((a.x + c.x) / 2, 0, (a.z + c.z) / 2));
      out.push(new THREE.Vector3(c.x, 0, c.z));
    }
    if (cells.length > 1) out.push(new THREE.Vector3(to.x, 0, to.z));
    return out;
  }

  randomPointInRoom(i, j) {
    const { x, z } = cellCenter(i, j);
    const lane = Math.random();
    const G = HALF - 2.2;
    if (lane < 0.5) return new THREE.Vector3(x, 0, z + rand(-G, G));
    if (lane < 0.8) return new THREE.Vector3(x + rand(-G, G), 0, z);
    return new THREE.Vector3(x + rand(-G, G), 0, z + rand(-G, G));
  }

  // ------------------------------------------------------ update
  update(dt, playerPos, assignLight) {
    const t = performance.now() / 1000;
    for (const l of this.lights) {
      if (l.mesh && !l.base) { l.mesh.visible = false; }
      else if (l.mesh) l.mesh.visible = true;
      if (l.mesh && l.base > 0) {
        let vis = 1;
        if (l.style === 'dead') vis = 0;
        else if (l.style === 'dying') {
          vis = (Math.sin(t * 23 + l.phase) > -0.2 ? 1 : 0.1) * (Math.sin(t * 3.1 + l.phase) * 0.5 + 0.5) * (Math.random() < 0.02 ? 0 : 1);
        } else if (l.style === 'buzz') {
          vis = 0.82 + Math.sin(t * 47 + l.phase) * 0.06 + (Math.random() < 0.01 ? -0.5 : 0);
        } else if (l.style === 'alarm') {
          vis = Math.sin(t * 2.2 + l.phase) > 0 ? 1 : 0.08;
        } else if (l.style === 'warm') {
          vis = 0.92 + Math.sin(t * 1.7 + l.phase) * 0.05;
        }
        l.current = Math.max(0, vis);
        l.mesh.material.opacity = 1;
        l.mesh.visible = l.current > 0.15;
        if (l.glowMat) l.glowMat.color.setScalar(0.15 + l.current * 0.85).multiply(new THREE.Color(l.color));
      } else if (l.mesh) {
        l.current = 0;
      }
    }
    if (assignLight) {
      const sorted = this.lights
        .filter(l => l.base > 0 && l.style !== 'dead')
        .map(l => ({ l, d: (l.x - playerPos.x) ** 2 + (l.z - playerPos.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, assignLight.length);
      assignLight.forEach((pl, idx) => {
        const e = sorted[idx];
        if (e) {
          pl.position.set(e.l.x, e.l.y, e.l.z);
          pl.color.setHex(e.l.color);
          pl.intensity = e.l.intensity * 1.3 * (e.l.current !== undefined ? e.l.current : 1);
        } else pl.intensity = 0;
      });
    }
    for (const dec of this.decorations) {
      if (dec.type === 'leds') {
        for (const led of dec.leds) {
          led.t += dt * led.speed;
          led.mesh.visible = Math.sin(led.t) > -0.7;
        }
      }
    }
    for (const item of this.items) {
      if (item.taken) continue;
      if (item.type === 'core') {
        item.mesh.rotation.y += dt * 1.2;
        item.mesh.rotation.x += dt * 0.7;
        item.mesh.position.y = item.baseY + Math.sin(t * 2 + item.phase) * 0.12;
        const c = item.mesh.material.color;
        const p = 0.75 + Math.sin(t * 3 + item.phase) * 0.25;
        c.setRGB(0.3 + p * 0.2, 0.6 * p + 0.4, 0.5 + p * 0.3);
      } else if (item.type === 'battery' || item.type === 'stim') {
        item.mesh.rotation.y += dt * 0.8;
      }
    }
    if (this.dust) {
      const p = this.dust.geometry.attributes.position;
      for (let k = 0; k < p.count; k++) {
        let y = p.getY(k) + Math.sin(t * 0.4 + k) * dt * 0.05;
        if (y < 0.2) y = WALL_H - 0.3;
        p.setY(k, y);
      }
      p.needsUpdate = true;
    }
    // elevator doors
    if (this.elevator) {
      const e = this.elevator;
      if (e.doorsOpen) {
        e.openT = Math.min(1, e.openT + dt * 0.5);
        e.doors[0].position.x = -0.78 - e.openT * 1.45;
        e.doors[1].position.x = 0.78 + e.openT * 1.45;
      }
      e.sockets.forEach((s, k) => {
        s.material.color.setHex(k < (this.coresHeld || 0) ? 0x39ffc0 : 0x331111);
      });
    }
  }
}
