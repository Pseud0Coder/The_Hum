import * as THREE from 'three';

export const ps1Uniforms = {
  uPs1Grid: { value: new THREE.Vector2(160, 90) },
  uPs1Affine: { value: 1.0 },
};

const VERT_DECL = 'varying float vAffineW;\nvarying vec3 vPs1View;\nuniform vec2 uPs1Grid;\nuniform float uPs1Affine;\n';
const FRAG_DECL = 'varying float vAffineW;\nvarying vec3 vPs1View;\nuniform float uPs1Affine;\n';

export function applyPS1(material, { snap = true, affine = true } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPs1Grid = ps1Uniforms.uPs1Grid;
    shader.uniforms.uPs1Affine = ps1Uniforms.uPs1Affine;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vPs1View = -mvPosition.xyz;
        vAffineW = gl_Position.w;
        if (gl_Position.w > 0.0) {
          vec3 ndc = gl_Position.xyz / gl_Position.w;
          ${snap ? 'ndc.xy = floor(ndc.xy * uPs1Grid) / uPs1Grid;' : ''}
          gl_Position = vec4(ndc * gl_Position.w, gl_Position.w);
        }
        ${affine ? `
        #ifdef USE_MAP
        vMapUv *= mix(1.0, gl_Position.w, uPs1Affine);
        #endif
        #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv *= mix(1.0, gl_Position.w, uPs1Affine);
        #endif
        ` : ''}
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv / max(1e-4, mix(1.0, vAffineW, uPs1Affine)) );
          diffuseColor *= sampledDiffuseColor;
        #endif
      `);
  };
  material.customProgramCacheKey = () => `ps1_${snap ? 1 : 0}_${affine ? 1 : 0}`;
  return material;
}

export function updatePS1Grid(resX, resY) {
  ps1Uniforms.uPs1Grid.value.set(resX, resY);
}
