// World: scene definitions (look + terrain functions), streaming terrain, water, and
// streamed obstacles (city buildings / forest trees). Also answers collision queries.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, fbm, ridged, hash2, smoothstep, mulberry32 } from './noise.js';

const lerp = (a, b, t) => a + (b - a) * t;
function mixInto(o, a, b, t) {
  o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t);
  return o;
}

// ---------------------------------------------------------------------------
// Scene definitions
// ---------------------------------------------------------------------------
export const SCENE_LIST = [
  { id: 'mountains', label: 'Sunset Mountains' },
  { id: 'city', label: 'Skyscraper City' },
  { id: 'forest', label: 'Forest Hills' },
  { id: 'islands', label: 'Island Sea' },
];

export function createSceneDef(id) {
  switch (id) {
    case 'city': return cityDef();
    case 'forest': return forestDef();
    case 'islands': return islandsDef();
    default: return mountainsDef();
  }
}

function mountainsDef() {
  const n1 = makeNoise2D(101), n2 = makeNoise2D(202), n3 = makeNoise2D(303);
  const DEEP = [0.12, 0.12, 0.12], SAND = [0.62, 0.47, 0.33], GRASS = [0.29, 0.29, 0.14],
    FOREST = [0.16, 0.18, 0.09], ROCK = [0.40, 0.29, 0.23], DROCK = [0.21, 0.17, 0.16], SNOW = [0.93, 0.9, 0.92];
  const t1 = [0, 0, 0], t2 = [0, 0, 0];
  return {
    id: 'mountains',
    fogDensity: 0.00022,
    waterLevel: 0, waterColor: 0x0a1620,
    valleyWeight: 1.0, clearance: 45,
    obstacles: null,
    height(x, z) {
      const base = fbm(n1, x * 0.00022, z * 0.00022, 3);
      const land = smoothstep(-0.12, 0.32, base);
      if (land <= 0) return -50;
      const r = ridged(n2, x * 0.00045, z * 0.00045, 4);
      const d = fbm(n3, x * 0.002, z * 0.002, 3);
      return -50 + land * (70 + Math.pow(r, 1.8) * 950 + d * 25);
    },
    color(h, slope, x, z, o) {
      if (h < 4) { mixInto(o, DEEP, SAND, smoothstep(-25, 3, h)); return; }
      mixInto(t1, SAND, GRASS, smoothstep(4, 18, h));
      mixInto(t1, t1, FOREST, smoothstep(30, 160, h) * 0.8);
      mixInto(t2, ROCK, DROCK, n3(x * 0.004, z * 0.004) * 0.5 + 0.5);
      const rockiness = Math.max(smoothstep(0.22, 0.45, slope), smoothstep(250, 520, h) * 0.85);
      mixInto(o, t1, t2, rockiness);
      const line = 640 + n1(x * 0.0015, z * 0.0015) * 110;
      const snow = smoothstep(line, line + 70, h) * (1 - smoothstep(0.38, 0.62, slope));
      mixInto(o, o, SNOW, snow);
    },
  };
}

function cityDef() {
  const n1 = makeNoise2D(404);
  const ASPH = [0.15, 0.15, 0.16], PARK = [0.16, 0.22, 0.11];
  return {
    id: 'city',
    fogDensity: 0.0002,
    waterLevel: null,
    valleyWeight: 0.35, clearance: 40,
    obstacles: 'city',
    height() { return 0; },
    color(h, slope, x, z, o) {
      mixInto(o, ASPH, PARK, smoothstep(0.45, 0.6, n1(x * 0.002, z * 0.002)));
    },
  };
}

function forestDef() {
  const n1 = makeNoise2D(505), n2 = makeNoise2D(515), n3 = makeNoise2D(525);
  const MUD = [0.30, 0.25, 0.17], GRASS = [0.24, 0.31, 0.12], MOSS = [0.14, 0.2, 0.08], ROCK = [0.36, 0.31, 0.27];
  const t1 = [0, 0, 0];
  return {
    id: 'forest',
    fogDensity: 0.00024,
    waterLevel: 0, waterColor: 0x0c1a1c,
    valleyWeight: 0.35, clearance: 42,
    obstacles: 'forest',
    height(x, z) {
      return 30 + fbm(n1, x * 0.00045, z * 0.00045, 4) * 190 + fbm(n2, x * 0.0018, z * 0.0018, 3) * 28;
    },
    color(h, slope, x, z, o) {
      if (h < 4) { mixInto(o, MUD, MUD, 0); return; }
      mixInto(t1, GRASS, MOSS, n3(x * 0.003, z * 0.003) * 0.5 + 0.5);
      mixInto(t1, MUD, t1, smoothstep(3, 12, h));
      mixInto(o, t1, ROCK, smoothstep(0.25, 0.5, slope));
    },
  };
}

function islandsDef() {
  const n1 = makeNoise2D(707), n2 = makeNoise2D(717), n3 = makeNoise2D(727);
  const DEEP = [0.1, 0.12, 0.13], SAND = [0.74, 0.6, 0.42], GRASS = [0.22, 0.3, 0.12], ROCK = [0.38, 0.3, 0.25];
  const t1 = [0, 0, 0];
  return {
    id: 'islands',
    fogDensity: 0.0002,
    waterLevel: 0, waterColor: 0x08141e,
    valleyWeight: 0.6, clearance: 45,
    obstacles: null,
    height(x, z) {
      const base = fbm(n1, x * 0.0003, z * 0.0003, 4);
      const land = smoothstep(0.1, 0.42, base);
      if (land <= 0) return -40;
      const r = ridged(n2, x * 0.0008, z * 0.0008, 4);
      return -40 + land * (52 + Math.pow(r, 1.5) * 520 + fbm(n3, x * 0.004, z * 0.004, 2) * 10);
    },
    color(h, slope, x, z, o) {
      if (h < 3) { mixInto(o, DEEP, SAND, smoothstep(-20, 2, h)); return; }
      mixInto(t1, SAND, GRASS, smoothstep(3, 14, h));
      mixInto(o, t1, ROCK, Math.max(smoothstep(0.25, 0.5, slope), smoothstep(200, 400, h)));
    },
  };
}

// ---------------------------------------------------------------------------
// Terrain: a large grid mesh that re-centres on the player, rebuilt incrementally
// over several frames (double-buffered) so there are no hitches.
// ---------------------------------------------------------------------------
const _col = new THREE.Color();

const SNOWC = [0.9, 0.92, 0.96];

class Terrain {
  constructor(def, env, size = 12000, seg = 240) {
    this.def = def; this.snow = !!env.snow; this.size = size; this.seg = seg; this.sp = size / seg;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.geos = [this._makeGeo(), this._makeGeo()];
    this.cur = 0;
    this.mesh = new THREE.Mesh(this.geos[0], this.mat);
    this.cx = 0; this.cz = 0; this.job = null;
  }
  _makeGeo() {
    const g = new THREE.PlaneGeometry(this.size, this.size, this.seg, this.seg);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    return g;
  }
  *_fill(geo, cx, cz) {
    const pos = geo.attributes.position.array;
    const n = geo.attributes.position.count;
    const H = this.def.height;
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 1] = H(pos[i * 3] + cx, pos[i * 3 + 2] + cz);
      if (i % 7000 === 6999) yield;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    yield;
    const nrm = geo.attributes.normal.array, col = geo.attributes.color.array, o = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const h = pos[i * 3 + 1], slope = 1 - nrm[i * 3 + 1];
      this.def.color(h, slope, pos[i * 3] + cx, pos[i * 3 + 2] + cz, o);
      if (this.snow && h > (this.def.waterLevel ?? -1e9) + 1.5) mixInto(o, o, SNOWC, (1 - smoothstep(0.3, 0.6, slope)) * 0.92);
      _col.setRGB(o[0], o[1], o[2], THREE.SRGBColorSpace);
      col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
      if (i % 12000 === 11999) yield;
    }
    geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  _snap(v) { return Math.round(v / this.sp) * this.sp; }
  buildNow(x, z) {
    const cx = this._snap(x), cz = this._snap(z);
    const it = this._fill(this.geos[this.cur], cx, cz);
    while (!it.next().done);
    this.mesh.geometry = this.geos[this.cur];
    this.mesh.position.set(cx, 0, cz);
    this.cx = cx; this.cz = cz; this.job = null;
  }
  update(px, pz) {
    if (this.job) {
      const j = this.job;
      if (j.it.next().done) {
        this.mesh.geometry = j.geo;
        this.mesh.position.set(j.cx, 0, j.cz);
        this.cx = j.cx; this.cz = j.cz; this.cur = j.idx; this.job = null;
      }
      return;
    }
    if (Math.hypot(px - this.cx, pz - this.cz) > 1000) {
      const idx = 1 - this.cur, cx = this._snap(px), cz = this._snap(pz);
      this.job = { geo: this.geos[idx], idx, cx, cz, it: this._fill(this.geos[idx], cx, cz) };
    }
  }
  // Bilinear height on the same global grid the mesh uses (matches visuals closely).
  heightAt(x, z) {
    const s = this.sp, H = this.def.height;
    const gx = x / s, gz = z / s;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h00 = H(i * s, j * s), h10 = H((i + 1) * s, j * s);
    const h01 = H(i * s, (j + 1) * s), h11 = H((i + 1) * s, (j + 1) * s);
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }
  dispose() { this.geos.forEach((g) => g.dispose()); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------
// Water: a custom shader on top of MeshStandardMaterial. Three layers of a smooth,
// tileable slope texture (big swells, medium waves, fine ripples) drift in different
// directions in world space; detail fades out with distance so the far water is calm
// and glassy. Lighting, fog and sky reflections still come from three.js.
// ---------------------------------------------------------------------------
function makeWaveSlopeTexture() {
  const S = 256, rnd = mulberry32(9), waves = [];
  for (let k = 0; k < 22; k++) {
    const fx = Math.round((rnd() * 2 - 1) * 5), fy = Math.round((rnd() * 2 - 1) * 5);
    if (fx === 0 && fy === 0) continue;
    const f = Math.hypot(fx, fy);
    waves.push({ fx, fy, a: 1 / Math.pow(f, 1.6), ph: rnd() * Math.PI * 2 });
  }
  // analytic slopes of a sum of sines (smooth, rounded crests)
  const sx = new Float32Array(S * S), sy = new Float32Array(S * S);
  let max = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    for (const w of waves) {
      const c = w.a * Math.cos(2 * Math.PI * (w.fx * x / S + w.fy * y / S) + w.ph);
      dx += c * w.fx; dy += c * w.fy;
    }
    const i = y * S + x;
    sx[i] = dx; sy[i] = dy;
    max = Math.max(max, Math.abs(dx), Math.abs(dy));
  }
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = (sx[i] / max * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (sy[i] / max * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

class Water {
  constructor(level, color, env = {}) {
    this.size = 30000; this.snap = 600;
    this.tex = makeWaveSlopeTexture();
    this.uTime = { value: 0 };
    this.speed = env.waterSpeed ?? 1;
    const strength = (env.waterStrength ?? 1).toFixed(3);
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.07, metalness: 0.0 });
    this.mat.customProgramCacheKey = () => 'water-' + strength;
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWaveTex = { value: this.tex };
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uWaveTex;\nuniform float uTime;')
        .replace('#include <normal_fragment_maps>', `
          {
            vec2 p = vWPos.xz;
            float dist = length(vWPos - cameraPosition);
            vec2 swell  = texture2D(uWaveTex, p / 900.0 + uTime * vec2(0.0040, -0.0025)).xy * 2.0 - 1.0;
            vec2 waves  = texture2D(uWaveTex, p / 260.0 + uTime * vec2(-0.0090, 0.0060)).xy * 2.0 - 1.0;
            vec2 ripple = texture2D(uWaveTex, p / 47.0  + uTime * vec2(0.0300, 0.0220)).xy * 2.0 - 1.0;
            float farFade = 1.0 - 0.75 * smoothstep(150.0, 3000.0, dist);
            float rippleFade = 1.0 - smoothstep(40.0, 500.0, dist);
            vec2 slope = (swell * 0.22 + waves * 0.16) * farFade + ripple * 0.05 * rippleFade;
            slope *= ${strength};
            vec3 wn = normalize(vec3(slope.x, 1.0, slope.y));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`);
    };
    const geo = new THREE.PlaneGeometry(this.size, this.size);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = level;
  }
  update(dt, px, pz) {
    this.mesh.position.x = Math.round(px / this.snap) * this.snap;
    this.mesh.position.z = Math.round(pz / this.snap) * this.snap;
    this.uTime.value += dt * this.speed;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.tex.dispose(); }
}

// ---------------------------------------------------------------------------
// Chunk streaming helper for instanced obstacles
// ---------------------------------------------------------------------------
class ChunkField {
  constructor(parent, size, radius, build) {
    this.parent = parent; this.size = size; this.radius = radius; this.build = build;
    this.chunks = new Map();
  }
  update(px, pz, budget = 2) {
    const s = this.size, R = this.radius;
    for (const [k, c] of this.chunks) {
      const d = Math.hypot((c.ci + 0.5) * s - px, (c.cj + 0.5) * s - pz);
      if (d > R + s * 0.75) {
        if (c.obj) { this.parent.remove(c.obj); c.obj.dispose(); }
        this.chunks.delete(k);
      }
    }
    const want = [];
    const ci0 = Math.floor((px - R) / s), ci1 = Math.floor((px + R) / s);
    const cj0 = Math.floor((pz - R) / s), cj1 = Math.floor((pz + R) / s);
    for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
      const d = Math.hypot((ci + 0.5) * s - px, (cj + 0.5) * s - pz);
      if (d < R) {
        const k = ci + ',' + cj;
        if (!this.chunks.has(k)) want.push({ k, ci, cj, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    const n = Math.min(budget, want.length);
    for (let i = 0; i < n; i++) {
      const w = want[i];
      const obj = this.build(w.ci, w.cj);
      if (obj) this.parent.add(obj);
      this.chunks.set(w.k, { ci: w.ci, cj: w.cj, obj });
    }
  }
  dispose() {
    for (const c of this.chunks.values()) if (c.obj) { this.parent.remove(c.obj); c.obj.dispose(); }
    this.chunks.clear();
  }
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

// ---------------------------------------------------------------------------
// City: procedural blocks of buildings with shader-generated lit windows
// ---------------------------------------------------------------------------
const BLOCK = 120, STREET = 30, CITY_CHUNK_BLOCKS = 4;
const BUILDING_PALETTE = [0x8a8f99, 0x6d7380, 0xa59a8c, 0x4f5866, 0x9aa3ad, 0x5d6470, 0xb3a58f];

function makeBuildingMaterial(env) {
  env = { windowLit: 0.7, windowGlow: 1.6, snow: false, ...env };
  const f = (v) => v.toFixed(3);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.2 });
  // shader text depends on env, so give each variant its own program cache key
  mat.customProgramCacheKey = () => `bld-${f(env.windowLit)}-${f(env.windowGlow)}-${env.snow ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBPos;\nvarying vec3 vBNrm;\nvarying float vBSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 bwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bwp = instanceMatrix * bwp;
          vBSeed = instanceMatrix[3].x * 0.0131 + instanceMatrix[3].z * 0.0071;
        #else
          vBSeed = 0.0;
        #endif
        vBPos = (modelMatrix * bwp).xyz;
        vBNrm = objectNormal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBPos; varying vec3 vBNrm; varying float vBSeed;
        float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float isRoof = step(0.5, vBNrm.y);
          float isWall = 1.0 - step(0.5, abs(vBNrm.y));
          float u = (abs(vBNrm.x) > 0.5 ? vBPos.z : vBPos.x) / 4.0;
          float v = vBPos.y / 3.6;
          vec2 cell = floor(vec2(u, v));
          vec2 f = fract(vec2(u, v));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8) * isWall * step(3.0, vBPos.y);
          float lit = step(${f(env.windowLit)}, bHash(cell + vec2(vBSeed, vBSeed * 1.7)));
          diffuseColor.rgb *= mix(1.0, 0.5, isRoof);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.87, 0.9), isRoof * ${env.snow ? '1.0' : '0.0'});
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.3 + vec3(0.02, 0.03, 0.05), win);
          totalEmissiveRadiance += win * lit * vec3(1.0, 0.62, 0.3) * ${f(env.windowGlow)};
        }`);
  };
  return mat;
}

class City {
  constructor(env) {
    this.noise = makeNoise2D(909);
    this.cache = new Map();
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.geo.translate(0, 0.5, 0);
    this.mat = makeBuildingMaterial(env);
    this.palette = BUILDING_PALETTE.map((c) => new THREE.Color(c));
    this.group = new THREE.Group();
    this.field = new ChunkField(this.group, BLOCK * CITY_CHUNK_BLOCKS, 3800, (ci, cj) => this._buildChunk(ci, cj));
  }
  block(bi, bj) {
    const key = bi + ',' + bj;
    let b = this.cache.get(key);
    if (!b) {
      b = this._gen(bi, bj);
      if (this.cache.size > 40000) this.cache.clear();
      this.cache.set(key, b);
    }
    return b;
  }
  _gen(bi, bj) {
    const out = [];
    const dn = this.noise(bi * 0.05, bj * 0.05) * 0.5 + 0.5;
    const down = smoothstep(0.5, 0.85, dn);
    if (hash2(bi, bj, 1) < 0.07 - down * 0.06) return out; // park
    const ox = bi * BLOCK + STREET / 2, oz = bj * BLOCK + STREET / 2, inner = BLOCK - STREET;
    const split = hash2(bi, bj, 2) < 0.3 + down * 0.35 ? 1 : 2;
    const lot = inner / split;
    for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
      const li = bi * 2 + a, lj = bj * 2 + b;
      const r = hash2(li, lj, 3);
      const inset = 2 + hash2(li, lj, 4) * 5;
      const h = 10 + r * r * (30 + down * 300) + down * 35 * hash2(li, lj, 5);
      out.push({
        x0: ox + a * lot + inset, x1: ox + (a + 1) * lot - inset,
        z0: oz + b * lot + inset, z1: oz + (b + 1) * lot - inset,
        h, c: Math.floor(hash2(li, lj, 6) * BUILDING_PALETTE.length),
      });
    }
    return out;
  }
  _buildChunk(ci, cj) {
    const list = [];
    for (let a = 0; a < CITY_CHUNK_BLOCKS; a++) for (let b = 0; b < CITY_CHUNK_BLOCKS; b++) {
      for (const bl of this.block(ci * CITY_CHUNK_BLOCKS + a, cj * CITY_CHUNK_BLOCKS + b)) list.push(bl);
    }
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(this.geo, this.mat, list.length);
    _q.identity();
    list.forEach((b, i) => {
      _m.compose(_p.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2), _q, _s.set(b.x1 - b.x0, b.h, b.z1 - b.z0));
      m.setMatrixAt(i, _m);
      m.setColorAt(i, this.palette[b.c]);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  }
  topAt(x, z) {
    for (const b of this.block(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b.h;
    }
    return -Infinity;
  }
  update(x, z, budget = 2) { this.field.update(x, z, budget); }
  dispose() { this.field.dispose(); this.geo.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------
// Forest: instanced conifers on a jittered grid with density noise
// ---------------------------------------------------------------------------
const TCELL = 20, FCHUNK = 400;

const WHITE = new THREE.Color(0xe8ecf2);

class Forest {
  constructor(def, env) {
    this.def = def; this.snow = !!env.snow;
    this.noise = makeNoise2D(606);
    const canopy = new THREE.ConeGeometry(1, 0.85, 7, 1); canopy.translate(0, 0.575, 0);
    const canopy2 = new THREE.ConeGeometry(0.75, 0.6, 7, 1); canopy2.translate(0, 0.78, 0);
    const trunk = new THREE.CylinderGeometry(0.1, 0.13, 0.2, 5); trunk.translate(0, 0.1, 0);
    this.geo = mergeGeometries([canopy, canopy2, trunk]);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    this.group = new THREE.Group();
    this.field = new ChunkField(this.group, FCHUNK, 2700, (ci, cj) => this._buildChunk(ci, cj));
  }
  tree(ci, cj) {
    const x = (ci + 0.15 + 0.7 * hash2(ci, cj, 11)) * TCELL;
    const z = (cj + 0.15 + 0.7 * hash2(ci, cj, 12)) * TCELL;
    const dens = this.noise(x * 0.0011, z * 0.0011) * 0.5 + 0.5;
    if (hash2(ci, cj, 13) > dens * 1.3 - 0.1) return null;
    const g = this.def.height(x, z);
    if (g < 3) return null;
    const h = 11 + hash2(ci, cj, 14) * 16;
    return { x, z, g, h, r: h * (0.22 + hash2(ci, cj, 15) * 0.08), ci, cj };
  }
  _buildChunk(ci, cj) {
    const n = FCHUNK / TCELL, list = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const t = this.tree(ci * n + a, cj * n + b);
      if (t) list.push(t);
    }
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(this.geo, this.mat, list.length);
    list.forEach((t, i) => {
      _q.setFromAxisAngle(_yAxis, hash2(t.ci, t.cj, 16) * Math.PI * 2);
      _m.compose(_p.set(t.x, t.g - 1.5, t.z), _q, _s.set(t.r, t.h, t.r));
      m.setMatrixAt(i, _m);
      _c.setHSL(0.22 + hash2(t.ci, t.cj, 17) * 0.1, 0.45, 0.1 + hash2(t.ci, t.cj, 18) * 0.08, THREE.SRGBColorSpace);
      if (this.snow) _c.lerp(WHITE, 0.45);
      m.setColorAt(i, _c);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  }
  topAt(x, z) {
    const ci = Math.floor(x / TCELL), cj = Math.floor(z / TCELL);
    let top = -Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const t = this.tree(ci + di, cj + dj);
      if (!t) continue;
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < t.r * 0.8) top = Math.max(top, t.g - 1.5 + t.h * (1 - d / t.r));
    }
    return top;
  }
  update(x, z, budget = 2) { this.field.update(x, z, budget); }
  dispose() { this.field.dispose(); this.geo.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
export class World {
  constructor(scene, def, env = {}) {
    this.scene = scene;
    this.def = def;
    this.env = env;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.terrain = new Terrain(def, env);
    this.group.add(this.terrain.mesh);
    this.water = def.waterLevel != null ? new Water(def.waterLevel, def.waterColor, env) : null;
    if (this.water) this.group.add(this.water.mesh);
    this.obstacles = def.obstacles === 'city' ? new City(env) : def.obstacles === 'forest' ? new Forest(def, env) : null;
    if (this.obstacles) this.group.add(this.obstacles.group);
  }
  init(x, z) {
    this.terrain.buildNow(x, z);
    if (this.obstacles) this.obstacles.update(x, z, Infinity);
    if (this.water) this.water.update(0, x, z);
  }
  update(dt, x, z) {
    this.terrain.update(x, z);
    if (this.obstacles) this.obstacles.update(x, z, 2);
    if (this.water) this.water.update(dt, x, z);
  }
  // Ground or water surface
  surfaceAt(x, z) {
    const h = this.terrain.heightAt(x, z);
    return this.water ? Math.max(h, this.def.waterLevel) : h;
  }
  // Anything solid: ground, water, buildings, trees
  solidAt(x, z) {
    const s = this.surfaceAt(x, z);
    return this.obstacles ? Math.max(s, this.obstacles.topAt(x, z)) : s;
  }
  dispose() {
    this.scene.remove(this.group);
    this.terrain.dispose();
    if (this.water) this.water.dispose();
    if (this.obstacles) this.obstacles.dispose();
  }
}
