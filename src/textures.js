import * as THREE from 'three';

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 69069)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u, v, oct, period, seed) {
  let amp = 0.5, sum = 0, norm = 0, per = period;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * per, v * per, per, seed + o * 17);
    norm += amp; amp *= 0.5; per *= 2;
  }
  return sum / norm;
}

function canvas(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}

function toTex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

function paintNoise(ctx, S, seed, fn) {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const out = fn(x / S, y / S, (x + y * S) & 0xffff, d[i], d[i + 1], d[i + 2]);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    }
  }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function concrete(seed = 1, tint = [86, 84, 78], grime = 1) {
  return cached(`concrete${seed}${tint}${grime}`, () => {
    const S = 256, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${tint})`; ctx.fillRect(0, 0, S, S);
    paintNoise(ctx, S, seed, (u, v) => {
      const n = fbm(u, v, 4, 4, seed);
      const n2 = fbm(u, v, 3, 2, seed + 99);
      const g = 0.62 + n * 0.55 - n2 * 0.12 * grime;
      return [tint[0] * g, tint[1] * g, tint[2] * g];
    });
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 22; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      ctx.fillStyle = `rgba(20,18,15,${Math.random() * 0.35})`;
      ctx.beginPath(); ctx.ellipse(x, y, 8 + Math.random() * 40, 6 + Math.random() * 26, Math.random() * 3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(15,14,12,0.55)'; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = Math.random() * S, y = Math.random() * S;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) { x += (Math.random() - 0.5) * 26; y += (Math.random() - 0.5) * 26; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return toTex(c, 2, 2);
  });
}

export function metal(seed = 2, tint = [96, 98, 102], rust = 0.4) {
  return cached(`metal${seed}${tint}${rust}`, () => {
    const S = 256, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${tint})`; ctx.fillRect(0, 0, S, S);
    paintNoise(ctx, S, seed, (u, v, k, r, g, b) => {
      const streak = fbm(u * 0.35, v * 6, 3, 4, seed) * 0.35;
      const n = fbm(u, v, 3, 3, seed + 5) * 0.3;
      const m = 0.72 + streak + n;
      let R = r * m, G = g * m, B = b * m;
      const rustN = fbm(u, v, 4, 3, seed + 55);
      if (rustN > 0.62) {
        const t = (rustN - 0.62) * rust * 3.4;
        R = R * (1 - t) + 128 * t; G = G * (1 - t) + 62 * t; B = B * (1 - t) + 28 * t;
      }
      return [R, G, B];
    });
    ctx.strokeStyle = 'rgba(30,30,32,0.8)'; ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, S - 4, S - 4);
    ctx.fillStyle = 'rgba(200,205,210,0.35)';
    for (const [rx, ry] of [[16, 16], [S - 16, 16], [16, S - 16], [S - 16, S - 16]]) {
      ctx.beginPath(); ctx.arc(rx, ry, 5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(20,20,22,0.6)'; ctx.beginPath(); ctx.arc(rx + 1.5, ry + 1.5, 2.5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(200,205,210,0.35)';
    }
    return toTex(c, 2, 2);
  });
}

export function tile(seed = 3, tint = [172, 170, 158], grout = [40, 40, 38]) {
  return cached(`tile${seed}${tint}${grout}`, () => {
    const S = 256, c = canvas(S), ctx = c.getContext('2d');
    const N = 4, T = S / N;
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const jitter = hash(tx, ty, seed) * 26 - 13;
        ctx.fillStyle = `rgb(${tint[0] + jitter},${tint[1] + jitter},${tint[2] + jitter})`;
        ctx.fillRect(tx * T, ty * T, T, T);
      }
    }
    paintNoise(ctx, S, seed, (u, v, k, r, g, b) => {
      const n = fbm(u, v, 3, 4, seed + 8);
      const m = 0.72 + n * 0.4;
      const st = fbm(u, v, 3, 2, seed + 31);
      const dark = st > 0.66 ? 1 - (st - 0.66) * 1.4 : 1;
      return [r * m * dark, g * m * dark, b * m * dark];
    });
    ctx.strokeStyle = `rgb(${grout})`; ctx.lineWidth = 4;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * T, 0); ctx.lineTo(i * T, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * T); ctx.lineTo(S, i * T); ctx.stroke();
    }
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 16; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const grd = ctx.createLinearGradient(x, y, x, y + 30);
      grd.addColorStop(0, 'rgba(35,30,22,0.9)'); grd.addColorStop(1, 'rgba(35,30,22,0)');
      ctx.fillStyle = grd; ctx.fillRect(x, y, 6 + Math.random() * 12, 30);
    }
    ctx.globalAlpha = 1;
    return toTex(c, 2, 2);
  });
}

export function carpet(seed = 4, tint = [58, 30, 32]) {
  return cached(`carpet${seed}${tint}`, () => {
    const S = 128, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${tint})`; ctx.fillRect(0, 0, S, S);
    paintNoise(ctx, S, seed, (u, v, k, r, g, b) => {
      const n = hash(k, k * 7, seed);
      const n2 = fbm(u, v, 2, 8, seed + 3);
      const m = 0.55 + n * 0.6 + n2 * 0.25;
      return [r * m, g * m, b * m];
    });
    return toTex(c, 8, 8);
  });
}

export function ceiling(seed = 5, tint = [120, 118, 110]) {
  return cached(`ceil${seed}${tint}`, () => {
    const S = 256, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${tint})`; ctx.fillRect(0, 0, S, S);
    paintNoise(ctx, S, seed, (u, v, k, r, g, b) => {
      const n = fbm(u, v, 3, 5, seed);
      const m = 0.7 + n * 0.4;
      return [r * m, g * m, b * m];
    });
    ctx.strokeStyle = 'rgba(35,35,34,0.9)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(S, i * 64); ctx.stroke();
    }
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (hash(x, y, seed + 44) < 0.35) { img.data[i] *= 0.9; img.data[i + 1] *= 0.9; img.data[i + 2] *= 0.9; }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c, 2, 2);
  });
}

export function hazard(seed = 6) {
  return cached('hazard', () => {
    const S = 128, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#171717';
    for (let i = -S; i < S * 2; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 + 48, S); ctx.lineTo(i + 48, S); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.25;
    paintNoise(ctx, S, seed, (u, v, k, r, g, b) => [r * (0.7 + hash(k, k, seed) * 0.4), g * (0.7 + hash(k, k, seed) * 0.4), b * 0.8]);
    ctx.globalAlpha = 1;
    return toTex(c, 1, 1);
  });
}

export function sign(text, sub = '', color = '#e8b04b', bg = '#101010') {
  return cached(`sign${text}${sub}${color}${bg}`, () => {
    const W = 512, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px "SF Mono", Menlo, monospace';
    ctx.fillText(text, W / 2, sub ? H / 2 - 18 : H / 2);
    if (sub) {
      ctx.font = '26px "SF Mono", Menlo, monospace';
      ctx.globalAlpha = 0.85; ctx.fillText(sub, W / 2, H / 2 + 34); ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 0.12; ctx.fillStyle = '#000';
    for (let i = 0; i < 400; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 3, 1);
    ctx.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  });
}

export function poster(seed = 9) {
  return cached(`poster${seed}`, () => {
    const W = 256, H = 384;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#cdc3a8'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1b1a17'; ctx.textAlign = 'center';
    ctx.font = 'bold 40px "SF Mono", monospace';
    ctx.fillText('BE', W / 2, 100); ctx.fillText('QUIET', W / 2, 148);
    ctx.font = '20px "SF Mono", monospace';
    ctx.fillText('SILENCE IS', W / 2, 220);
    ctx.fillText('CONTAINMENT', W / 2, 248);
    ctx.strokeStyle = '#8b2f2a'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(W / 2 - 34, 290); ctx.lineTo(W / 2, 330); ctx.lineTo(W / 2 + 34, 290); ctx.stroke();
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#2a2418';
    for (let i = 0; i < 900; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    ctx.globalAlpha = 1;
    return new THREE.CanvasTexture(c);
  });
}

export function blood(seed = 10) {
  return cached(`blood${seed}`, () => {
    const S = 128, c = canvas(S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const cx = 40 + Math.random() * 48, cy = 40 + Math.random() * 48;
    ctx.fillStyle = 'rgba(74,8,8,0.92)';
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      const r = 18 + fbm(0.5 + Math.cos(a) * 0.4, 0.5 + Math.sin(a) * 0.4, 3, 4, seed) * 30;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * 6.28, d = 30 + Math.random() * 24;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + Math.random() * 6, 0, 7); ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  });
}

export function warning(seed = 11) {
  return cached('warning', () => {
    const S = 128, c = canvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = '#151515'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#d8b23a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(S / 2, 14); ctx.lineTo(S - 14, S - 22); ctx.lineTo(14, S - 22); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#d8b23a'; ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center';
    ctx.fillText('!', S / 2, S - 34);
    return toTex(c, 1, 1);
  });
}
