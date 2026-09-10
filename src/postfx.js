import * as THREE from 'three';
import { updatePS1Grid } from './ps1.js';

const FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uCorrupt;
  uniform float uTension;
  uniform float uDamage;
  uniform float uGlitch;
  uniform float uFade;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float bayer4(vec2 p){
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int i = y * 4 + x;
    float m[16];
    m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
    m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
    m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
    m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
    for (int k=0;k<16;k++){ if(k==i) return m[k]/16.0; }
    return 0.5;
  }

  void main(){
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float t = uTime;

    float warpAmt = uCorrupt * 0.012 + uTension * 0.004 + uDamage * 0.03;
    uv += vec2(
      sin(uv.y * 34.0 + t * 3.1) * warpAmt,
      cos(uv.x * 27.0 - t * 2.3) * warpAmt
    );

    float glitchLine = step(0.995 - uGlitch * 0.06, hash(vec2(floor(uv.y * 90.0), floor(t * 18.0))));
    uv.x += glitchLine * (hash(vec2(floor(t * 22.0), 3.0)) - 0.5) * 0.09 * (1.0 + uGlitch);

    float ab = (0.0012 + uCorrupt * 0.006 + uTension * 0.0022 + uDamage * 0.012);
    vec2 dir = normalize(c + 1e-5);
    float r = texture2D(tDiffuse, uv + dir * ab).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - dir * ab).b;
    vec3 col = vec3(r, g, b);

    vec3 shadowTint = vec3(0.86, 0.92, 1.08);
    vec3 highTint = vec3(1.04, 1.0, 0.94);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col *= mix(shadowTint, highTint, smoothstep(0.05, 0.7, lum));
    col *= mix(vec3(1.0), vec3(1.06, 0.97, 0.99), uCorrupt);

    float vig = smoothstep(1.25, 0.25, length(c) * (1.0 + uTension * 1.1 + uDamage * 1.4));
    col *= mix(0.55, 1.0, vig);
    col = mix(col, col * vec3(1.3, 0.25, 0.2), uDamage * 0.75);

    float grain = hash(uv * uRes + fract(t) * 100.0) - 0.5;
    col += grain * (0.045 + uCorrupt * 0.05);

    col += vec3(0.010, 0.011, 0.016);
    float levels = 26.0 - uCorrupt * 8.0;
    vec2 px = uv * uRes;
    float dither = (bayer4(px) - 0.5) / levels;
    col = floor((col + dither) * levels) / levels;

    float scan = 1.0 - 0.06 * step(0.5, mod(px.y, 2.0));
    col *= scan;

    col *= mix(1.0, 0.0, clamp(uFade, 0.0, 1.0));
    gl_FragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
  }
`;

const VERT = `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class PostFX {
  constructor(renderer, pixelScale = 3) {
    this.renderer = renderer;
    this.pixelScale = pixelScale;
    this.target = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uCorrupt: { value: 0 },
        uTension: { value: 0 },
        uDamage: { value: 0 },
        uGlitch: { value: 0 },
        uFade: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.params = { corrupt: 0, tension: 0, damage: 0, glitch: 0, fade: 0 };
  }

  setSize(w, h) {
    const scale = this.pixelScale;
    const iw = Math.max(160, Math.floor(w / scale));
    const ih = Math.max(90, Math.floor(h / scale));
    if (this.target) this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(iw, ih, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.generateMipmaps = false;
    this.mat.uniforms.uRes.value.set(iw, ih);
    updatePS1Grid(iw * 0.5, ih * 0.5);
  }

  setPixelScale(s) {
    this.pixelScale = s;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.setSize(size.x * this.renderer.getPixelRatio(), size.y * this.renderer.getPixelRatio());
  }

  render(scene, camera, dt, params) {
    const u = this.mat.uniforms;
    u.uTime.value += dt;
    for (const k of ['corrupt', 'tension', 'damage', 'glitch', 'fade']) {
      if (params[k] !== undefined) this.params[k] = params[k];
      const map = { corrupt: 'uCorrupt', tension: 'uTension', damage: 'uDamage', glitch: 'uGlitch', fade: 'uFade' };
      u[map[k]].value = this.params[k];
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    u.tDiffuse.value = this.target.texture;
    this.renderer.render(this.scene, this.camera);
  }
}
