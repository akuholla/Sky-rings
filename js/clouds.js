// Clouds: clusters of billboard "puffs" drawn in a single instanced pass.
//  - a procedural atlas of 4 billowy puff shapes (fBm noise, flat bases) with baked
//    self-shadowing, so each puff has lit tops and darker undersides
//  - puffs are stacked into cumulus-like domes; higher puffs are lit, lower ones shaded
//  - forward scattering: thin edges glow in the sun's colour when you look towards it
//  - puffs fade out as the camera gets close, so flying through a cloud is smooth
//  - instances are re-sorted back-to-front every frame for correct blending
// Ambient clouds recycle ahead of the player; "path" clouds sit across the ring course.
import * as THREE from 'three';
import { mulberry32, makeNoise2D, fbm, smoothstep } from './noise.js';

const CAP = 4000;          // max puffs on screen
const MAX_PUFFS = 26;      // per cluster

// ---------------------------------------------------------------------------
// Texture atlas (2x2 tiles). A = density, G = baked shading (1 = lit, 0 = shadowed)
// ---------------------------------------------------------------------------
function makeCloudAtlas() {
  const T = 128, S = T * 2;
  const data = new Uint8Array(S * S * 4);
  const noise = makeNoise2D(4242), rnd = mulberry32(31);
  const dens = new Float32Array(T * T);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * T, oy = Math.floor(v / 2) * T;
    // a few overlapping round billows on a wide base
    const blobs = [{ x: 0.5, y: 0.36, r: 0.3 }];
    const nb = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < nb; i++) {
      blobs.push({ x: 0.25 + rnd() * 0.5, y: 0.38 + rnd() * 0.25, r: 0.13 + rnd() * 0.13 });
    }
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T, w = (y + 0.5) / T;
      let sh = 0;
      for (const b of blobs) sh = Math.max(sh, 1 - Math.hypot(u - b.x, (w - b.y) * 1.1) / b.r);
      sh *= smoothstep(0.1, 0.32, w); // flatter underside
      const n = fbm(noise, u * 3.2 + v * 13.1, w * 3.2 + v * 7.7, 4) * 0.5 + 0.5;
      let d = smoothstep(0.08, 0.55, sh + (n - 0.5) * 0.38);
      d *= smoothstep(0.0, 0.07, Math.min(u, 1 - u, w, 1 - w)); // zero at tile edges
      dens[y * T + x] = d;
    }
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T, w = (y + 0.5) / T;
      // shadowed where there is a lot of cloud above (light comes from the top)
      const a1 = dens[Math.min(T - 1, y + 5) * T + x];
      const a2 = dens[Math.min(T - 1, y + 14) * T + x];
      const n2 = fbm(noise, u * 6 + v * 3.3, w * 6 - v * 5.1, 3) * 0.5 + 0.5;
      const shade = Math.min(1, Math.max(0, 1.1 - a1 * 0.45 - a2 * 0.4 + (n2 - 0.5) * 0.4));
      const i = ((oy + y) * S + ox + x) * 4;
      data[i] = 255;
      data[i + 1] = shade * 255;
      data[i + 2] = 255;
      data[i + 3] = dens[y * T + x] * 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */`
  attribute vec3 iCenter;
  attribute vec2 iSize;
  attribute float iRot;
  attribute float iVar;
  attribute float iShade;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying float vRot;
  varying float vVar;
  varying float vShade;
  varying float vAlpha;
  varying float vSun;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv; vRot = iRot; vVar = iVar; vShade = iShade;
    vec4 mvPosition = viewMatrix * vec4(iCenter, 1.0);
    float depth = -mvPosition.z;
    mvPosition.xy += position.xy * iSize;
    gl_Position = projectionMatrix * mvPosition;
    // fade puffs that are very close to the camera (smooth fly-through)
    vAlpha = smoothstep(iSize.y * 0.1, iSize.y * 0.6, depth);
    vSun = pow(max(dot(normalize(iCenter - cameraPosition), sunDir), 0.0), 6.0);
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D map;
  uniform vec3 litColor;
  uniform vec3 shadeColor;
  uniform vec3 sunColor;
  uniform float silver;
  uniform float opacity;
  varying vec2 vUv;
  varying float vRot;
  varying float vVar;
  varying float vShade;
  varying float vAlpha;
  varying float vSun;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vUv - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
    float v = vVar;
    float flip = step(3.5, v);
    v -= flip * 4.0;
    if (flip > 0.5) p.x = 1.0 - p.x;
    vec4 t = texture2D(map, (p + vec2(mod(v, 2.0), floor(v / 2.0))) * 0.5);
    float a = t.a * vAlpha * opacity;
    if (a < 0.004) discard;
    float light = clamp(t.g * 0.8 + vShade * 0.5 - 0.22, 0.0, 1.0);
    light = light * light * (3.0 - 2.0 * light);
    vec3 col = mix(shadeColor, litColor, light);
    // forward scattering: bright rims and a warm glow when looking towards the sun
    col += sunColor * silver * vSun * ((1.0 - t.a) * 1.6 + 0.2);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const _v = new THREE.Vector3();

export class Clouds {
  constructor(scene, world, opts = {}) {
    this.scene = scene; this.world = world;
    this.opts = {
      count: 36, palette: [0xffd8c0, 0xe0a088, 0x7a5560], opacity: 1, altMin: 180, altRange: 650,
      sizeMul: 1, pathChance: 0.3, silver: 1, sunDir: new THREE.Vector3(0, 0.05, -1), sunColor: 0xff9a50,
      ...opts,
    };
    this.pathChance = this.opts.pathChance;
    this.rnd = mulberry32(77);
    this.tex = makeCloudAtlas();

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(CAP * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aCenter = attr(3); this.aSize = attr(2); this.aRot = attr(1); this.aVar = attr(1); this.aShade = attr(1);
    geo.setAttribute('iCenter', this.aCenter);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iRot', this.aRot);
    geo.setAttribute('iVar', this.aVar);
    geo.setAttribute('iShade', this.aShade);
    geo.instanceCount = 0;
    this.geo = geo;

    const pal = this.opts.palette;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null },
      litColor: { value: new THREE.Color(pal[0]) },
      shadeColor: { value: new THREE.Color(pal[2]).lerp(new THREE.Color(pal[1]), 0.25) },
      sunColor: { value: new THREE.Color(this.opts.sunColor) },
      silver: { value: this.opts.silver },
      opacity: { value: 0.92 * this.opts.opacity },
      sunDir: { value: this.opts.sunDir.clone().normalize() },
    }]);
    uniforms.map.value = this.tex;
    this.mat = new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.list = [];   // clusters
    this.puffs = [];  // all puffs (sorted each frame)
  }

  _cluster(x, y, z, R, kind) {
    const c = { pos: new THREE.Vector3(x, y, z), R, kind, puffs: [] };
    const n = Math.min(MAX_PUFFS, 8 + Math.floor(R / 14));
    for (let i = 0; i < n; i++) {
      const h = Math.pow(this.rnd(), 0.8);            // 0 = base, 1 = top of the dome
      const ang = this.rnd() * Math.PI * 2;
      const rad = (1 - h * 0.6) * R * 0.75 * Math.sqrt(this.rnd());
      const s = R * (0.55 + this.rnd() * 0.45) * (1 - h * 0.3);
      const puff = {
        c,
        ox: Math.cos(ang) * rad, oy: -0.15 * R + h * 0.5 * R, oz: Math.sin(ang) * rad,
        sx: s * 1.35, sy: s,
        rot: (this.rnd() - 0.5) * 0.5,
        v: Math.floor(this.rnd() * 4) + (this.rnd() < 0.5 ? 4 : 0),
        shade: h,
        d2: 0,
      };
      c.puffs.push(puff);
      this.puffs.push(puff);
    }
    this.list.push(c);
    return c;
  }

  _removeCluster(i) {
    const c = this.list[i];
    this.list.splice(i, 1);
    const dead = new Set(c.puffs);
    this.puffs = this.puffs.filter((p) => !dead.has(p));
  }

  _ambientY(x, z) {
    return Math.max(this.world.surfaceAt(x, z) + this.opts.altMin, this.opts.altMin + 100) + this.rnd() * this.opts.altRange;
  }

  initAmbient(center, count = this.opts.count) {
    for (let i = 0; i < count; i++) {
      const a = this.rnd() * Math.PI * 2, d = 300 + this.rnd() * 4800;
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      this._cluster(x, this._ambientY(x, z), z, (120 + this.rnd() * 160) * this.opts.sizeMul, 'ambient');
    }
  }

  addPathCloud(pos, R) {
    this._cluster(pos.x, pos.y, pos.z, R, 'path');
  }

  _placeAhead(c, pos, fwd) {
    const heading = Math.atan2(fwd.x, -fwd.z) + (this.rnd() - 0.5) * Math.PI * 1.2;
    const d = 3000 + this.rnd() * 2200;
    const x = pos.x + Math.sin(heading) * d, z = pos.z - Math.cos(heading) * d;
    c.pos.set(x, this._ambientY(x, z), z);
  }

  // Recycle / remove clusters; returns how deep inside a cloud the point is (0..1)
  update(pos, fwd) {
    let f = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z, dy = c.pos.y - pos.y;
      const dh = Math.hypot(dx, dz);
      if (c.kind === 'ambient' && dh > 5600) { this._placeAhead(c, pos, fwd); continue; }
      if (c.kind === 'path' && dh > 2500 && dx * fwd.x + dz * fwd.z < 0) { this._removeCluster(i); continue; }
      const e = Math.sqrt((dh / c.R) ** 2 + (dy / (c.R * 0.5)) ** 2);
      if (e < 1) f = Math.max(f, Math.min(1, (1 - e) * 2));
    }
    return f;
  }

  // Write instances back-to-front from the camera's point of view
  render(camPos) {
    const P = this.puffs;
    for (const p of P) {
      _v.set(p.c.pos.x + p.ox, p.c.pos.y + p.oy, p.c.pos.z + p.oz);
      p.d2 = _v.distanceToSquared(camPos);
    }
    P.sort((a, b) => b.d2 - a.d2);
    const n = Math.min(P.length, CAP);
    const C = this.aCenter.array, Z = this.aSize.array, R = this.aRot.array, V = this.aVar.array, H = this.aShade.array;
    for (let i = 0; i < n; i++) {
      const p = P[i], c = p.c.pos;
      C[i * 3] = c.x + p.ox; C[i * 3 + 1] = c.y + p.oy; C[i * 3 + 2] = c.z + p.oz;
      Z[i * 2] = p.sx; Z[i * 2 + 1] = p.sy;
      R[i] = p.rot; V[i] = p.v; H[i] = p.shade;
    }
    for (const a of [this.aCenter, this.aSize, this.aRot, this.aVar, this.aShade]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.geo.instanceCount = n;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose(); this.mat.dispose(); this.tex.dispose();
  }
}
