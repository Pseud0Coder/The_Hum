import { loadJSON, saveJSON } from './utils.js';

const KEY = 'the_hum_save_v1';

export class GameState {
  constructor() {
    this.data = loadJSON(KEY, null) || {
      deaths: 0,
      escapes: 0,
      runs: 0,
      knowledge: [],
      paths: [],
      micNoise: 0,
      causes: {},
      bestEscape: null,
      created: Date.now(),
    };
    if (!this.data.paths) this.data.paths = [];
    if (!this.data.knowledge) this.data.knowledge = [];
    this.path = [];
    this.pathTimer = 0;
    this.runStart = performance.now();
    this.micNoiseThisRun = 0;
    this.causeThisRun = 'unknown';
  }

  save() { saveJSON(KEY, this.data); }

  startRun() {
    this.data.runs++;
    this.path = [];
    this.pathTimer = 0;
    this.runStart = performance.now();
    this.micNoiseThisRun = 0;
    this.causeThisRun = 'unknown';
    this.save();
  }

  recordTick(dt, pos, flashlight) {
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = 0.5;
      this.path.push({ x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), f: flashlight ? 1 : 0 });
      if (this.path.length > 2400) this.path.shift();
    }
  }

  recordMicNoise() {
    this.micNoiseThisRun++;
    this.data.micNoise++;
  }

  recordDeath(cause) {
    this.data.deaths++;
    this.causeThisRun = cause;
    this.data.causes[cause] = (this.data.causes[cause] || 0) + 1;
    if (this.path.length > 8) {
      this.data.paths.unshift(this.path.slice());
      if (this.data.paths.length > 3) this.data.paths.pop();
    }
    this.save();
  }

  recordEscape(timeSec) {
    this.data.escapes++;
    if (this.data.bestEscape === null || timeSec < this.data.bestEscape) this.data.bestEscape = timeSec;
    this.save();
  }

  learn(ids) {
    for (const id of ids) {
      if (!this.data.knowledge.includes(id)) this.data.knowledge.push(id);
    }
    this.save();
  }

  get lastPath() {
    return this.data.paths[0] || null;
  }

  get knowledgePct() {
    const spots = 6 + this.data.knowledge.length;
    return Math.min(100, Math.round((this.data.knowledge.length / Math.max(6, spots)) * 100));
  }

  get runTime() { return (performance.now() - this.runStart) / 1000; }
}
