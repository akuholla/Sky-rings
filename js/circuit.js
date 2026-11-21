// Canyon Circuit: a closed, low-altitude race loop.
//   forest clearing -> low over a lake (rock stacks) -> down a town's main street ->
//   red-rock canyon with two natural tunnels, a natural stone bridge and rock spires ->
//   back down to the forest and the start/finish gate.
//
// How it is built:
//  - The route is a closed Catmull-Rom spline sampled every 4 m. Each sample knows its
//    section weights (forest/lake/town/canyon), the ground level along the route (gT)
//    and the flying height (trackY).
//  - The terrain is a height field shaped around the route: each section has its own
//    landscape, and near the route the ground is pulled to gT (a clearing, a lake basin,
//    a street, a steep-walled canyon). It is baked once into a detailed static mesh.
//  - Height fields can't overhang, so tunnels are solid rock roofs arched over stretches
//    of the canyon, and the natural bridge is a separate rock arch mesh. Both have their
//    own collision tests (World.hitTest) and the tunnels dim the lighting (World.shadeAt).
import * as THREE from 'three';
import { makeNoise2D, fbm, ridged, hash2, smoothstep } from './noise.js';

const SCALE = 0.8;
const CONTROL = [
  [0, 1400], [-600, 1550], [-1150, 1350], [-1600, 1500], [-2050, 1250], // 0-4   forest (0 = start/finish)
  [-2350, 800], [-2300, 250], [-1950, -200],                            // 5-7   lake
  [-1500, -450], [-1000, -560], [-500, -560],                           // 8-10  town
  [-50, -700], [400, -950], [900, -1000], [1300, -750], [1600, -350],   // 11-15 canyon, tunnel 1 (12-14)
  [1700, 100], [1550, 550], [1150, 850], [650, 1150],                   // 16 bridge, 17-18 tunnel 2, 19 descent
].map(([x, z]) => [x * SCALE, z * SCALE]);

export const FOREST = 0, LAKE = 1, TOWN = 2, CANYON = 3;
// clr = flying height above the route's ground, fw = flat half-width, ramp = width of the blend to the landscape
const KIND = [
  { clr: 40, fw: 32, ramp: 80 },            // forest: ground follows the hills
  { clr: 28, fw: 45, ramp: 140, g: -14 },   // lake: low over the water (water level 0)
  { clr: 19, fw: 70, ramp: 120, g: 6 },     // town: down the main street
  { clr: 26, fw: 55, ramp: 36 },            // canyon: floor profile, near-vertical walls
];
export const ARCH = { A: 50, H: 48 };       // tunnel bore: half-width and height above the canyon floor
const TRANSITION = 150;                      // m of blending either side of a section boundary
const DS = 4;                                // m between route samples
const TERRAIN_STEP = 18;                     // m between terrain mesh vertices

const lerp = (a, b, t) => a + (b - a) * t;
function mixInto(o, a, b, t) {
  o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t);
  return o;
}
function smoothCyclic(arr, r) {
  const N = arr.length, out = new Float32Array(N);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += arr[(k + N) % N];
  for (let i = 0; i < N; i++) {
    out[i] = sum / (2 * r + 1);
    sum += arr[(i + r + 1) % N] - arr[(i - r + N) % N];
  }
  return out;
}

// colours (sRGB)
const C = {
  grass: [0.24, 0.33, 0.13], grassDark: [0.15, 0.22, 0.09], clearing: [0.40, 0.42, 0.2],
  sand: [0.68, 0.57, 0.40], mud: [0.28, 0.24, 0.19],
  asphalt: [0.2, 0.2, 0.21], plaza: [0.58, 0.52, 0.43],
  floor: [0.72, 0.47, 0.28], rockA: [0.64, 0.32, 0.17], rockB: [0.46, 0.21, 0.13], rockTop: [0.78, 0.57, 0.38],
  mountain: [0.42, 0.33, 0.30], snow: [0.92, 0.92, 0.95],
};

// ===========================================================================
// The route
// ===========================================================================
export class Circuit {
  constructor() {
    this.nA = makeNoise2D(1201); this.nB = makeNoise2D(1202); this.nC = makeNoise2D(1203);
    const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    this.L = curve.getLength();
    const N = this.N = Math.round(this.L / DS);
    this.ds = this.L / N;
    this.px = new Float64Array(N); this.pz = new Float64Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      curve.getPointAt(i / N, p);
      curve.getTangentAt(i / N, t);
      const l = Math.hypot(t.x, t.z) || 1;
      this.px[i] = p.x; this.pz[i] = p.z; this.tx[i] = t.x / l; this.tz[i] = t.z / l;
    }

    // sections, tunnels and the bridge, anchored to the control points
    const sCP = CONTROL.map(([x, z]) => this._nearestBrute(x, z));
    const mid = (i, j) => this.wrap(sCP[i] + this.wrap(sCP[j] - sCP[i]) / 2);
    this.sCP = sCP;
    this.sections = [
      { kind: FOREST, a: mid(18, 19), b: mid(4, 5) },
      { kind: LAKE, a: mid(4, 5), b: mid(7, 8) },
      { kind: TOWN, a: mid(7, 8), b: mid(10, 11) },
      { kind: CANYON, a: mid(10, 11), b: mid(18, 19) },
    ];
    this.tunnels = [
      { a: this.wrap(sCP[12] + 40), b: this.wrap(sCP[14] - 40) },
      { a: this.wrap(sCP[17] + 30), b: this.wrap(sCP[18] + 40) },
    ];
    this.bridgeS = sCP[16];

    // per-sample section weights
    this.w = [0, 1, 2, 3].map(() => new Float32Array(N));
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      let sum = 0;
      for (const sec of this.sections) {
        const w = this._window(s, sec.a, sec.b);
        this.w[sec.kind][i] = w; sum += w;
      }
      for (let k = 0; k < 4; k++) this.w[k][i] /= sum || 1;
    }

    // ground level along the route, flying height, corridor widths
    const follow = new Float32Array(N);
    for (let i = 0; i < N; i++) follow[i] = this._H(FOREST, this.px[i], this.pz[i], 0);
    const forestG = smoothCyclic(follow, 40);
    const can = this.sections[3], canLen = this.wrap(can.b - can.a);
    const g = new Float32Array(N), clr = new Float32Array(N);
    this.fw = new Float32Array(N); this.ramp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.min(1, Math.max(0, this.wrap(i * this.ds - can.a) / canLen));
      const kindG = [forestG[i], KIND[1].g, KIND[2].g, 22 + 50 * Math.sin(Math.PI * u)];
      for (let k = 0; k < 4; k++) {
        const w = this.w[k][i];
        g[i] += w * kindG[k]; clr[i] += w * KIND[k].clr;
        this.fw[i] += w * KIND[k].fw; this.ramp[i] += w * KIND[k].ramp;
      }
    }
    this.gT = smoothCyclic(g, 20);
    const clrS = smoothCyclic(clr, 20);
    this.trackY = new Float32Array(N);
    for (let i = 0; i < N; i++) this.trackY[i] = this.gT[i] + clrS[i];

    // area to bake into the static terrain mesh
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < N; i++) {
      x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]);
      z0 = Math.min(z0, this.pz[i]); z1 = Math.max(z1, this.pz[i]);
    }
    const margin = 2600;
    const size = Math.max(x1 - x0, z1 - z0) + margin * 2;
    const seg = Math.ceil(size / TERRAIN_STEP / 2) * 2;
    this.extent = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, size: seg * TERRAIN_STEP, seg };
    this._q = {};
  }

  wrap(s) { const L = this.L; return ((s % L) + L) % L; }

  // smooth membership of s in the cyclic range [a, b]
  _window(s, a, b) {
    const L = this.L, R = TRANSITION;
    const len = this.wrap(b - a);
    let x = this.wrap(s - a);
    if (x > L - R) x -= L;
    return smoothstep(-R, R, x) * smoothstep(-R, R, len - x);
  }

  section(kind) { return this.sections.find((s) => s.kind === kind); }
  inRange(s, a, b, pad = 0) { return this.wrap(s - a + pad) <= this.wrap(b - a) + 2 * pad; }
  tunnelAt(s, pad = 0) {
    for (let t = 0; t < this.tunnels.length; t++) if (this.inRange(s, this.tunnels[t].a, this.tunnels[t].b, pad)) return t;
    return -1;
  }

  _nearestBrute(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.N; i++) {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best * this.ds;
  }

  // nearest route sample: i, s, signed lateral offset d (+ = left), distance dAbs
  nearest(x, z, out = {}) {
    const N = this.N, px = this.px, pz = this.pz;
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i += 8) {
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const c = best;
    for (let k = -12; k <= 12; k++) {
      const j = (c + k + N) % N;
      const d = (px[j] - x) ** 2 + (pz[j] - z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    out.i = best;
    out.s = best * this.ds;
    out.d = (x - px[best]) * (-this.tz[best]) + (z - pz[best]) * this.tx[best];
    out.dAbs = Math.sqrt(bd);
    return out;
  }

  // landscape of each section (before the route is carved in)
  _H(kind, x, z, d) {
    switch (kind) {
      case FOREST:
        return 30 + fbm(this.nA, x * 0.0007, z * 0.0007, 4) * 45 + fbm(this.nB, x * 0.004, z * 0.004, 2) * 5;
      case LAKE:
        return -16 + smoothstep(220, 520, d) * (45 + fbm(this.nA, x * 0.001, z * 0.001, 2) * 20);
      case TOWN:
        return 6 + fbm(this.nB, x * 0.003, z * 0.003, 2) * 1.5
          + smoothstep(260, 520, d) * (35 + fbm(this.nA, x * 0.001, z * 0.001, 2) * 25);
      default: { // canyon: terraced red-rock mesas
        let h = 150 + ridged(this.nC, x * 0.0009, z * 0.0009, 4) * 380;
        const T = 34, q = h / T, fl = Math.floor(q);
        h = T * (fl + smoothstep(0.7, 1, q - fl));
        return h + fbm(this.nB, x * 0.01, z * 0.01, 2) * 4;
      }
    }
  }

  // full terrain sample at (x, z)
  sample(x, z, out = {}) {
    this.nearest(x, z, out);
    const i = out.i, d = out.dAbs;
    let H = 0, ws = 0, kind = 0, wMax = -1;
    for (let k = 0; k < 4; k++) {
      const w = this.w[k][i];
      if (w > wMax) { wMax = w; kind = k; }
      if (w < 0.002) continue;
      H += w * this._H(k, x, z, d); ws += w;
    }
    H /= ws || 1;
    const edge = smoothstep(1000, 2100, d); // mountains ring the whole valley
    if (edge > 0) H += edge * (260 + ridged(this.nC, x * 0.0006, z * 0.0006, 3) * 320);
    const near = 1 - smoothstep(this.fw[i], this.fw[i] + this.ramp[i], d);
    out.h = H + (this.gT[i] - H) * near;
    out.kind = kind;
    out.edge = edge;
    out.tunnel = this.tunnelAt(out.s) >= 0 && d < ARCH.A + 8;
    return out;
  }

  height(x, z) { return this.sample(x, z, this._q).h; }

  // ground height where a tree may grow, or null
  treeGround(x, z) {
    const o = this.sample(x, z, this._q);
    if (o.h < 3 || o.h > 200 || o.edge > 0.5) return null;
    const i = o.i, d = o.dAbs;
    if (this.w[FOREST][i] > 0.5) return d > 34 ? o.h : null;
    if (this.w[LAKE][i] > 0.5) return d > 150 ? o.h : null;
    if (this.w[TOWN][i] > 0.5) return d > 170 ? o.h : null;
    return null;
  }

  colorAt(h, slope, i, dAbs, tunnel, x, z, o) {
    const w = this.w, fw = this.fw[i];
    const acc = [0, 0, 0], tmp = [0, 0, 0];
    const add = (c, k) => { acc[0] += c[0] * k; acc[1] += c[1] * k; acc[2] += c[2] * k; };
    const n = this.nB(x * 0.004, z * 0.004) * 0.5 + 0.5;
    // forest
    if (w[FOREST][i] > 0.002) {
      mixInto(tmp, C.grass, C.grassDark, n);
      if (dAbs < fw) mixInto(tmp, tmp, C.clearing, 0.6);
      mixInto(tmp, tmp, C.rockB, smoothstep(0.35, 0.6, slope));
      add(tmp, w[FOREST][i]);
    }
    // lake
    if (w[LAKE][i] > 0.002) {
      if (h < 1) mixInto(tmp, C.mud, C.sand, smoothstep(-10, 1, h));
      else mixInto(tmp, C.sand, C.grass, smoothstep(3, 12, h));
      add(tmp, w[LAKE][i]);
    }
    // town
    if (w[TOWN][i] > 0.002) {
      if (dAbs < 24) tmp.splice(0, 3, ...C.asphalt);
      else if (dAbs < fw + 20) tmp.splice(0, 3, ...C.plaza);
      else mixInto(tmp, C.grass, C.grassDark, n);
      add(tmp, w[TOWN][i]);
    }
    // canyon: sandy floor, banded sandstone walls, pale mesa tops
    if (w[CANYON][i] > 0.002) {
      if (dAbs < fw + 4) mixInto(tmp, C.floor, C.rockA, n * 0.4);
      else {
        mixInto(tmp, C.rockA, C.rockB, 0.5 + 0.5 * Math.sin(h * 0.14 + n * 2));
        mixInto(tmp, tmp, C.rockTop, slope < 0.22 ? 0.7 : 0);
      }
      add(tmp, w[CANYON][i]);
    }
    // surrounding mountains
    const edge = smoothstep(1000, 2100, dAbs);
    if (edge > 0) {
      mixInto(tmp, C.mountain, C.snow, smoothstep(470, 520, h) * (1 - smoothstep(0.4, 0.6, slope)));
      mixInto(acc, acc, tmp, edge);
    }
    const dark = tunnel ? 0.3 : 1;
    o[0] = acc[0] * dark; o[1] = acc[1] * dark; o[2] = acc[2] * dark;
  }

  // position / frame on the route at distance s
  frame(s, out = {}) {
    const f = this.wrap(s) / this.ds;
    const i0 = Math.floor(f) % this.N, i1 = (i0 + 1) % this.N, t = f - Math.floor(f);
    out.x = lerp(this.px[i0], this.px[i1], t);
    out.z = lerp(this.pz[i0], this.pz[i1], t);
    out.g = lerp(this.gT[i0], this.gT[i1], t);
    out.y = lerp(this.trackY[i0], this.trackY[i1], t);
    const tx = lerp(this.tx[i0], this.tx[i1], t), tz = lerp(this.tz[i0], this.tz[i1], t);
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l; out.tz = tz / l;
    return out;
  }
  pointAt(s) { const f = this.frame(s); return new THREE.Vector3(f.x, f.y, f.z); }
  tangentAt(s) {
    const a = this.frame(s - 6), b = this.frame(s + 6);
    return new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  }
  startPose() {
    const s = this.wrap(-170); // the start/finish ring (s = 0) is 170 m ahead
    const t = this.tangentAt(s);
    return { pos: this.pointAt(s), heading: Math.atan2(t.x, -t.z) };
  }
}

// Scene definition used by World / Atmosphere / Course
export function circuitDef() {
  const c = new Circuit();
  return {
    id: 'circuit',
    fogDensity: 0.00017,
    waterLevel: 0, waterColor: 0x0c1a22,
    valleyWeight: 0, clearance: 30,
    obstacles: 'circuit',
    circuit: c,
    extent: c.extent,
    height: (x, z) => c.height(x, z),
    treeGround: (x, z) => c.treeGround(x, z),
  };
}

// ===========================================================================
// Static terrain: the whole valley baked once at 18 m resolution
// ===========================================================================
const _col = new THREE.Color();
const SNOWC = [0.9, 0.92, 0.96];

export class StaticTerrain {
  constructor(def, env = {}) {
    this.def = def; this.c = def.circuit; this.snow = !!env.snow;
    const { cx, cz, size, seg } = def.extent;
    Object.assign(this, { cx, cz, size, seg, sp: size / seg });
    this.geo = new THREE.PlaneGeometry(size, size, seg, seg);
    this.geo.rotateX(-Math.PI / 2);
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.geo.attributes.position.count * 3), 3));
    this.heights = new Float32Array((seg + 1) * (seg + 1));
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.set(cx, 0, cz);
  }
  buildNow() {
    const pos = this.geo.attributes.position.array, n = this.geo.attributes.position.count;
    const idx = new Int32Array(n), dist = new Float32Array(n), tun = new Uint8Array(n), o = {};
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3] + this.cx, z = pos[v * 3 + 2] + this.cz;
      this.c.sample(x, z, o);
      pos[v * 3 + 1] = o.h; this.heights[v] = o.h;
      idx[v] = o.i; dist[v] = o.dAbs; tun[v] = o.tunnel ? 1 : 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    const nrm = this.geo.attributes.normal.array, col = this.geo.attributes.color.array, rgb = [0, 0, 0];
    const water = this.def.waterLevel ?? -1e9;
    for (let v = 0; v < n; v++) {
      const h = pos[v * 3 + 1], slope = 1 - nrm[v * 3 + 1];
      this.c.colorAt(h, slope, idx[v], dist[v], tun[v], pos[v * 3] + this.cx, pos[v * 3 + 2] + this.cz, rgb);
      if (this.snow && h > water + 1.5 && !tun[v]) mixInto(rgb, rgb, SNOWC, (1 - smoothstep(0.3, 0.6, slope)) * 0.92);
      _col.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      col[v * 3] = _col.r; col[v * 3 + 1] = _col.g; col[v * 3 + 2] = _col.b;
    }
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
  update() {}
  // bilinear lookup in the baked grid (falls back to the analytic height outside it)
  heightAt(x, z) {
    const gx = (x - this.cx + this.size / 2) / this.sp, gz = (z - this.cz + this.size / 2) / this.sp;
    if (gx < 0 || gz < 0 || gx >= this.seg || gz >= this.seg) return this.def.height(x, z);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, W = this.seg + 1, H = this.heights;
    const a = H[j * W + i], b = H[j * W + i + 1], c = H[(j + 1) * W + i], d = H[(j + 1) * W + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ===========================================================================
// Obstacles and set pieces: forest, town, tunnels, natural bridge, rocks, gate
// ===========================================================================
const UP = new THREE.Vector3(0, 1, 0);
const TOWN_PALETTE = [0xd8c3a5, 0xc9a27e, 0xe6dccb, 0xb5654a, 0x9c8a74, 0xd1b48c, 0xa9b4b8];

function rockNoise(a, b) { return hash2(Math.floor(a * 7.3), Math.floor(b * 3.1), 97) - 0.5; }

export class CircuitObstacles {
  constructor(def, env, { Forest, makeBuildingMaterial }) {
    this.def = def; this.c = def.circuit;
    this.group = new THREE.Group();
    this.forest = new Forest(def, env);
    this.group.add(this.forest.group);
    this.disposables = [];
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide });
    this.disposables.push(this.rockMat);
    this._q = {};
    this.columns = []; // {x, z, r, top} — rock stacks, spires, gate pylons
    this._buildTown(env, makeBuildingMaterial);
    this._buildTunnels();
    this._buildBridge();
    this._buildRocks();
    this._buildGate();
  }

  _add(obj) {
    this.group.add(obj);
    if (obj.geometry) this.disposables.push(obj.geometry);
    return obj;
  }

  // ---------------------------------------------------------------- town
  _buildTown(env, makeBuildingMaterial) {
    const c = this.c, sec = c.section(TOWN), len = c.wrap(sec.b - sec.a), f = {};
    const boxes = [];
    let k = 0;
    for (let u = 170; u < len - 170; u += 26, k++) {
      c.frame(sec.a + u, f);
      for (const side of [-1, 1]) {
        if (hash2(k, side + 5, 41) < 0.1) continue; // a side street
        let lat = 27;
        const rows = hash2(k, side + 5, 42) < 0.7 ? 2 : 1;
        for (let r = 0; r < rows; r++) {
          const key = side * 7 + r;
          const w = 15 + 7 * hash2(k, key, 43), dep = 13 + 9 * hash2(k, key, 44);
          const ht = r === 0 ? 12 + 30 * Math.pow(hash2(k, key, 45), 1.4) : 18 + 36 * Math.pow(hash2(k, key, 46), 1.2);
          const lc = side * (lat + dep / 2);
          boxes.push({
            x: f.x - f.tz * lc, z: f.z + f.tx * lc, tx: f.tx, tz: f.tz, hw: w / 2, hd: dep / 2,
            base: f.g - 1, top: f.g - 1 + ht, color: TOWN_PALETTE[Math.floor(hash2(k, key, 47) * TOWN_PALETTE.length)],
          });
          lat += dep + 6;
        }
      }
    }
    // a clock tower on the corner where the street bends
    c.frame(sec.a + len * 0.55, f);
    boxes.push({ x: f.x + f.tz * 44, z: f.z - f.tx * 44, tx: f.tx, tz: f.tz, hw: 7, hd: 7, base: f.g - 1, top: f.g + 68, color: 0xe6dccb });
    this.townBoxes = boxes;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = makeBuildingMaterial(env);
    const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
    const m = new THREE.Matrix4(), T = new THREE.Vector3(), S = new THREE.Vector3(), col = new THREE.Color();
    boxes.forEach((b, i) => {
      T.set(b.tx, 0, b.tz); S.set(-b.tz, 0, b.tx);
      m.makeBasis(T, UP, S);
      m.scale(new THREE.Vector3(b.hw * 2, b.top - b.base, b.hd * 2));
      m.setPosition(b.x, b.base, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(b.color));
    });
    mesh.computeBoundingSphere();
    this._add(mesh);
    this.disposables.push(mat);

    // spatial buckets for collision queries
    this.townGrid = new Map();
    const cell = 50;
    boxes.forEach((b, bi) => {
      const r = Math.hypot(b.hw, b.hd);
      for (let gx = Math.floor((b.x - r) / cell); gx <= Math.floor((b.x + r) / cell); gx++) {
        for (let gz = Math.floor((b.z - r) / cell); gz <= Math.floor((b.z + r) / cell); gz++) {
          const key = gx + ',' + gz;
          if (!this.townGrid.has(key)) this.townGrid.set(key, []);
          this.townGrid.get(key).push(bi);
        }
      }
    });
  }

  _townTop(x, z) {
    const list = this.townGrid.get(Math.floor(x / 50) + ',' + Math.floor(z / 50));
    if (!list) return -Infinity;
    let top = -Infinity;
    for (const bi of list) {
      const b = this.townBoxes[bi], dx = x - b.x, dz = z - b.z;
      const along = dx * b.tx + dz * b.tz, lat = -dx * b.tz + dz * b.tx;
      if (Math.abs(along) < b.hw && Math.abs(lat) < b.hd) top = Math.max(top, b.top);
    }
    return top;
  }

  // ---------------------------------------------------------------- tunnels
  // A rock roof extruded along the route: an elliptical bore (half-width A, height H
  // above the canyon floor) inside a thick, rough outer shell that sinks into the walls.
  _buildTunnels() {
    const { A, H } = ARCH, c = this.c;
    const prof = [[A, -6]];
    for (let j = 0; j <= 16; j++) { const th = (j / 16) * Math.PI; prof.push([A * Math.cos(th), H * Math.sin(th)]); }
    prof.push([-A, -6]);
    const innerEnd = prof.length; // indices < innerEnd belong to the bore
    prof.push([-A - 10, -6], [-95, 25], [-88, 90], [-52, 128], [0, 140], [52, 128], [88, 90], [95, 25], [A + 10, -6]);
    const M = prof.length;
    const capTris = THREE.ShapeUtils.triangulateShape(prof.map(([d, h]) => new THREE.Vector2(d, h)), []);

    const lampGeo = new THREE.SphereGeometry(0.9, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.4, 0.8) });
    this.disposables.push(lampGeo, lampMat);
    const lamps = [];

    for (const tun of c.tunnels) {
      const len = c.wrap(tun.b - tun.a), steps = Math.ceil(len / 5), f = {};
      const rings = [];
      for (let r = 0; r <= steps; r++) {
        const s = tun.a + (len * r) / steps;
        c.frame(s, f);
        const ring = [];
        for (let j = 0; j < M; j++) {
          let [d, h] = prof[j];
          const outer = j >= innerEnd;
          const amp = outer ? 7 : (j > 0 && j < innerEnd - 1 ? 1.5 : 0);
          if (amp) { // roughen the rock along its own outward direction
            const n = rockNoise(s * 0.05, j) + 0.5 * rockNoise(s * 0.13, j + 31);
            const rl = Math.hypot(d, h - 30) || 1;
            d += (d / rl) * n * amp; h += ((h - 30) / rl) * n * amp;
          }
          ring.push([f.x - f.tz * d, f.g + h, f.z + f.tx * d]);
        }
        rings.push(ring);
        if (r % 7 === 3) for (const side of [-1, 1]) {
          const d = side * (A - 4);
          lamps.push([f.x - f.tz * d, f.g + 8, f.z + f.tx * d]);
        }
      }
      const pos = [], col = [];
      const tri = (a, b, cc, rgb) => { pos.push(...a, ...b, ...cc); for (let q = 0; q < 3; q++) col.push(...rgb); };
      const rockColor = (h, salt) => {
        const band = 0.5 + 0.5 * Math.sin(h * 0.14 + salt);
        _col.setRGB(lerp(C.rockA[0], C.rockB[0], band), lerp(C.rockA[1], C.rockB[1], band), lerp(C.rockA[2], C.rockB[2], band), THREE.SRGBColorSpace);
        return [_col.r, _col.g, _col.b];
      };
      for (let r = 0; r < steps; r++) {
        for (let j = 0; j < M; j++) {
          const j2 = (j + 1) % M;
          const a = rings[r][j], b = rings[r][j2], cc = rings[r + 1][j2], d = rings[r + 1][j];
          const inner = j < innerEnd - 1;
          const v = hash2(r, j, 5) * 0.25;
          const rgb = inner ? (_col.setRGB(0.34 + v * 0.2, 0.25 + v * 0.15, 0.2 + v * 0.1, THREE.SRGBColorSpace), [_col.r, _col.g, _col.b]) : rockColor(a[1], j);
          tri(a, b, cc, rgb); tri(a, cc, d, rgb);
        }
      }
      for (const ring of [rings[0], rings[steps]]) {
        for (const [a, b, cc] of capTris) tri(ring[a], ring[b], ring[cc], rockColor(ring[a][1], 3));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      this._add(new THREE.Mesh(geo, this.rockMat));
    }
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach((p, i) => lampMesh.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
    lampMesh.computeBoundingSphere();
    this.group.add(lampMesh);
  }

  // ---------------------------------------------------------------- natural bridge
  _buildBridge() {
    const c = this.c, f = c.frame(c.bridgeS);
    const top = (f.y - f.g) + 32; // centreline height of the arch above the canyon floor
    const pts = [];
    for (let k = 0; k <= 28; k++) {
      const u = (k / 28) * 2 - 1;
      pts.push({ d: u * 115, h: top * Math.pow(Math.max(0, 1 - u * u), 0.6) - 10 * u * u, ra: 13 + 7 * u * u, rv: 8 + 7 * u * u });
    }
    this.bridge = { f, pts };
    const T = new THREE.Vector3(f.tx, 0, f.tz), S = new THREE.Vector3(-f.tz, 0, f.tx);
    const K = 12, rings = [];
    pts.forEach((p, k) => {
      const q = pts[Math.min(pts.length - 1, k + 1)], o = pts[Math.max(0, k - 1)];
      let kd = q.d - o.d, kh = q.h - o.h;
      const kl = Math.hypot(kd, kh); kd /= kl; kh /= kl;
      const ring = [];
      for (let a = 0; a < K; a++) {
        const ang = (a / K) * Math.PI * 2, n = 1 + rockNoise(k * 0.7, a) * 0.35;
        const ca = Math.cos(ang) * p.ra * n, sa = Math.sin(ang) * p.rv * n;
        const d = p.d - kh * sa, h = p.h + kd * sa; // offset along the arch's normal in the (side, up) plane
        ring.push([f.x + T.x * ca + S.x * d, f.g + h, f.z + T.z * ca + S.z * d]);
      }
      rings.push(ring);
    });
    const pos = [], col = [];
    for (let k = 0; k < rings.length - 1; k++) {
      for (let a = 0; a < K; a++) {
        const a2 = (a + 1) % K, p1 = rings[k][a], p2 = rings[k][a2], p3 = rings[k + 1][a2], p4 = rings[k + 1][a];
        const band = 0.5 + 0.5 * Math.sin(p1[1] * 0.14);
        _col.setRGB(lerp(C.rockA[0], C.rockB[0], band), lerp(C.rockA[1], C.rockB[1], band), lerp(C.rockA[2], C.rockB[2], band), THREE.SRGBColorSpace);
        pos.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
        for (let q = 0; q < 6; q++) col.push(_col.r, _col.g, _col.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this._add(new THREE.Mesh(geo, this.rockMat));
  }

  // ---------------------------------------------------------------- rock stacks and spires
  _buildRocks() {
    const c = this.c, f = {};
    const place = (kind, frac, side, d, r, height) => {
      const sec = c.section(kind), len = c.wrap(sec.b - sec.a);
      c.frame(sec.a + len * frac, f);
      const x = f.x - f.tz * side * d, z = f.z + f.tx * side * d;
      const base = kind === LAKE ? -14 : f.g - 2;
      this.columns.push({ x, z, r, top: base + height });
      const geo = new THREE.CylinderGeometry(r * 0.55, r, height, 8, 5);
      const p = geo.attributes.position;
      const cols = [];
      for (let v = 0; v < p.count; v++) {
        const y = p.getY(v), k = 1 + rockNoise(v * 0.37, y * 0.05) * 0.4;
        p.setX(v, p.getX(v) * k); p.setZ(v, p.getZ(v) * k);
        const band = 0.5 + 0.5 * Math.sin((y + base) * 0.14);
        _col.setRGB(lerp(C.rockA[0], C.rockB[0], band), lerp(C.rockA[1], C.rockB[1], band), lerp(C.rockA[2], C.rockB[2], band), THREE.SRGBColorSpace);
        cols.push(_col.r, _col.g, _col.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.translate(x, base + height / 2, z);
      this._add(new THREE.Mesh(geo, this.rockMat));
    };
    // sea stacks in the lake
    place(LAKE, 0.3, 1, 72, 18, 74);
    place(LAKE, 0.5, -1, 62, 15, 88);
    place(LAKE, 0.7, 1, 78, 20, 66);
    // spires on the canyon floor (kept clear of the tunnels and the bridge)
    const can = c.section(CANYON), clen = c.wrap(can.b - can.a);
    const canyonFrac = (s) => c.wrap(s - can.a) / clen;
    for (const [s, side] of [[c.sCP[11] + 160, 1], [c.sCP[15] - 60, -1], [c.sCP[15] + 140, 1], [c.sCP[18] + 170, -1]]) {
      if (c.tunnelAt(s, 60) >= 0) continue;
      place(CANYON, canyonFrac(s), side, 33, 8, 85);
    }
  }

  // ---------------------------------------------------------------- start / finish gate
  _buildGate() {
    const c = this.c, f = c.frame(0);
    const S = new THREE.Vector3(-f.tz, 0, f.tx);
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d8, roughness: 0.6 });
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 32;
    const g2 = cv.getContext('2d');
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g2.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; g2.fillRect(i * 8, j * 8, 8, 8); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0x222222 });
    this.disposables.push(pylonMat, bannerMat, tex);
    const topY = f.y + 28;
    for (const side of [-1, 1]) {
      const x = f.x + S.x * side * 38, z = f.z + S.z * side * 38;
      const base = c.height(x, z) - 2;
      const geo = new THREE.BoxGeometry(3, topY - base, 3);
      geo.translate(x, (topY + base) / 2, z);
      this._add(new THREE.Mesh(geo, pylonMat));
      this.columns.push({ x, z, r: 2.5, top: topY });
    }
    const geo = new THREE.BoxGeometry(80, 6, 1.4);
    const banner = new THREE.Mesh(geo, bannerMat);
    banner.position.set(f.x, f.y + 23, f.z);
    banner.rotation.y = Math.atan2(-S.z, S.x);
    this._add(banner);
    this.gate = { f, lo: f.y + 19.5, hi: f.y + 26.5 };
  }

  // ---------------------------------------------------------------- queries
  update(x, z, budget) { this.forest.update(x, z, budget); }

  topAt(x, z) {
    let top = Math.max(this.forest.topAt(x, z), this._townTop(x, z));
    for (const col of this.columns) {
      const d = Math.hypot(x - col.x, z - col.z);
      if (d < col.r * 0.9) top = Math.max(top, col.top);
    }
    return top;
  }

  // collisions that a single "height at (x, z)" can't express: tunnel roofs, the bridge, the gate banner
  hitTest(p) {
    const c = this.c, n = c.nearest(p.x, p.z, this._q);
    if (Math.abs(n.d) < 100 && c.tunnelAt(n.s) >= 0) {
      const h = p.y - c.gT[n.i];
      if (h < 140) {
        const e = (n.d / ARCH.A) ** 2 + (h / ARCH.H) ** 2;
        if (!(e < 0.9 && h > 0.5)) return true;
      }
    }
    const B = this.bridge, bf = B.f;
    const dx = p.x - bf.x, dz = p.z - bf.z;
    const along = dx * bf.tx + dz * bf.tz;
    if (Math.abs(along) < 24) {
      const lat = -dx * bf.tz + dz * bf.tx, h = p.y - bf.g;
      for (const q of B.pts) {
        const e = (along / q.ra) ** 2 + ((lat - q.d) ** 2 + (h - q.h) ** 2) / (q.rv * q.rv);
        if (e < 0.85) return true;
      }
    }
    const G = this.gate, gf = G.f;
    const gx = p.x - gf.x, gz = p.z - gf.z;
    if (Math.abs(gx * gf.tx + gz * gf.tz) < 2.5 && Math.abs(-gx * gf.tz + gz * gf.tx) < 40 && p.y > G.lo && p.y < G.hi) return true;
    return false;
  }

  // 0..1: how deep inside a tunnel the point is (dims the lighting)
  shadeAt(p) {
    const c = this.c, n = c.nearest(p.x, p.z, this._q);
    if (Math.abs(n.d) > ARCH.A || p.y - c.gT[n.i] > ARCH.H) return 0;
    let best = 0;
    for (const t of c.tunnels) {
      const len = c.wrap(t.b - t.a);
      let u = c.wrap(n.s - t.a);
      if (u > c.L - 60) u -= c.L;
      const e = Math.min(u, len - u);
      best = Math.max(best, smoothstep(-15, 60, e));
    }
    return best;
  }

  dispose() {
    this.forest.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
