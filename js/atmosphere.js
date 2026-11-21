// Atmosphere: time-of-day + weather presets, sky / sun / moon / stars, fog,
// precipitation (rain streaks, snowflakes) and lightning.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
export const TIME_LIST = [
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'midday', label: 'Midday' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'night', label: 'Night' },
];
export const WEATHER_LIST = [
  { id: 'clear', label: 'Clear' },
  { id: 'storm', label: 'Thunder & Rain' },
  { id: 'snow', label: 'Snow' },
];

const TIME = {
  sunrise: {
    sun: { elevation: 3, azimuth: 140 },
    sky: { turbidity: 6, rayleigh: 2.5, mie: 0.004, mieG: 0.9, tint: [1.15, 0.9, 0.95], sat: 1.2, floor: [0, 0, 0] },
    exposure: 0.45,
    light: { color: 0xffb88a, intensity: 3.0 },
    hemi: { sky: 0xffc8c0, ground: 0x2a2a3a, intensity: 0.8 },
    fog: { color: 0xc4948c, mul: 1.25 },
    env: 0.6,
    clouds: [0xffe2da, 0xeab4b4, 0x8a7088],
    windowGlow: 1.0, windowLit: 0.72, silver: 1.0,
  },
  midday: {
    sun: { elevation: 50, azimuth: 30 },
    sky: { turbidity: 2.2, rayleigh: 1.6, mie: 0.004, mieG: 0.8, tint: [0.85, 0.97, 1.2], sat: 1.35, floor: [0, 0, 0] },
    exposure: 0.4,
    light: { color: 0xfff4e0, intensity: 3.2 },
    hemi: { sky: 0xbfd8ff, ground: 0x4a4238, intensity: 1.4 },
    fog: { color: 0x9fb8d4, mul: 0.8 },
    env: 0.45,
    clouds: [0xffffff, 0xeef2f8, 0xbcc6d4],
    windowGlow: 0.25, windowLit: 0.75, silver: 0.45,
  },
  sunset: {
    sun: { elevation: 2.2, azimuth: 180 },
    sky: { turbidity: 12, rayleigh: 4.0, mie: 0.004, mieG: 0.92, tint: [1.25, 0.82, 0.6], sat: 1.25, floor: [0, 0, 0] },
    exposure: 0.42,
    light: { color: 0xff9a50, intensity: 3.4 },
    hemi: { sky: 0xffb08a, ground: 0x2e2030, intensity: 0.75 },
    fog: { color: 0xb8683f, mul: 1.0 },
    env: 0.6,
    clouds: [0xffd8c0, 0xe0a088, 0x7a5560],
    windowGlow: 1.6, windowLit: 0.7, silver: 1.1,
  },
  night: {
    sun: { elevation: -14, azimuth: 180 },
    moon: { elevation: 28, azimuth: 205 },
    sky: { turbidity: 2, rayleigh: 1.0, mie: 0.003, mieG: 0.8, tint: [1, 1, 1], sat: 1.0, floor: [0.012, 0.022, 0.055] },
    exposure: 0.7,
    light: { color: 0x9fb4ff, intensity: 0.6 },
    hemi: { sky: 0x3a4a78, ground: 0x0a0a14, intensity: 0.55 },
    fog: { color: 0x0b1120, mul: 1.0 },
    env: 0.35,
    clouds: [0x4a5468, 0x353d4e, 0x1c2230],
    windowGlow: 2.6, windowLit: 0.5, silver: 0.35,
    night: true,
  },
};

const _ca = new THREE.Color(), _cb = new THREE.Color();
const mixHex = (a, b, t) => _ca.set(a).lerp(_cb.set(b), t).getHex();
const dirFrom = (elev, az) => new THREE.Vector3().setFromSphericalCoords(
  1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));

// Combine scene + time of day + weather into one "look" description
export function buildLook(sceneDef, timeId, weatherId) {
  const t = TIME[timeId] || TIME.sunset;
  const night = !!t.night;
  const sky = { ...t.sky, tint: [...t.sky.tint], floor: [...t.sky.floor] };
  const look = {
    timeId, weatherId, night,
    sunDir: dirFrom(t.sun.elevation, t.sun.azimuth),
    lightDir: t.moon ? dirFrom(t.moon.elevation, t.moon.azimuth) : dirFrom(t.sun.elevation, t.sun.azimuth),
    sky,
    exposure: t.exposure,
    light: { ...t.light },
    hemi: { ...t.hemi },
    fogColor: t.fog.color,
    fogDensity: sceneDef.fogDensity * t.fog.mul,
    envIntensity: t.env,
    clouds: { count: 36, palette: [...t.clouds], opacity: 1, altMin: 180, altRange: 650, sizeMul: 1, pathChance: 0.3, silver: t.silver },
    stars: night, moon: night,
    precip: null, lightning: false,
    env: { snow: false, night, windowGlow: t.windowGlow, windowLit: t.windowLit, waterStrength: 1, waterSpeed: 1 },
  };

  if (weatherId === 'storm') {
    sky.tint = sky.tint.map((v, i) => v * [0.4, 0.42, 0.48][i]);
    sky.sat = 0.35; sky.mie = 0.001;
    look.light.intensity *= 0.06;
    look.hemi.sky = mixHex(look.hemi.sky, night ? 0x1c2230 : 0x6a7280, 0.6);
    look.hemi.intensity *= 0.8;
    look.fogColor = mixHex(look.fogColor, night ? 0x10141c : 0x575d66, 0.75);
    look.fogDensity *= 2.6;
    look.envIntensity *= 0.5;
    look.clouds = {
      count: 80, opacity: 0.95, altMin: 140, altRange: 320, sizeMul: 1.5, pathChance: 0.5, silver: 0.12,
      palette: (night ? [0x2c323e, 0x1e232c, 0x111419] : [0x8a909a, 0x5e646e, 0x30343c]),
    };
    look.stars = look.moon = false;
    look.precip = 'rain';
    look.lightning = true;
    look.env.waterStrength = 1.9; look.env.waterSpeed = 2.2; // choppy, wind-blown sea
  } else if (weatherId === 'snow') {
    sky.tint = sky.tint.map((v, i) => v * [0.85, 0.88, 0.95][i]);
    sky.sat = 0.5; sky.mie = 0.002;
    look.light.intensity *= 0.45;
    look.hemi.sky = mixHex(look.hemi.sky, night ? 0x2a3040 : 0xd8e0ea, 0.5);
    look.fogColor = mixHex(look.fogColor, night ? 0x1c2230 : 0xc4ccd6, 0.7);
    look.fogDensity *= 2.0;
    look.clouds = {
      count: 60, opacity: 0.9, altMin: 200, altRange: 400, sizeMul: 1.3, pathChance: 0.4, silver: 0.3,
      palette: (night ? [0x4a5262, 0x363c48, 0x22262e] : [0xf4f6fa, 0xd0d6de, 0x9aa2ae]),
    };
    look.stars = look.moon = false;
    look.precip = 'snow';
    look.env.snow = true;
    look.env.waterStrength = 0.7; look.env.waterSpeed = 0.7; // cold, calm water
  }
  return look;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSky() {
  const s = new Sky();
  const u = s.material.uniforms;
  u.tint = { value: new THREE.Vector3(1, 1, 1) };
  u.sat = { value: 1.25 };
  u.skyFloor = { value: new THREE.Vector3() };
  s.material.fragmentShader = s.material.fragmentShader
    .replace('void main() {', 'uniform vec3 tint;\nuniform float sat;\nuniform vec3 skyFloor;\nvoid main() {')
    .replace('gl_FragColor = vec4( retColor, 1.0 );',
      'float lum = dot(retColor, vec3(0.3, 0.55, 0.15));\n' +
      'retColor = mix(vec3(lum), retColor, sat) * tint;\n' +
      'retColor += skyFloor * (0.35 + 0.65 * pow(1.0 - max(direction.y, 0.0), 3.0));\n' +
      'gl_FragColor = vec4( retColor, 1.0 );');
  return s;
}

function setSkyUniforms(s, look, tintScale = 1) {
  const u = s.material.uniforms;
  u.turbidity.value = look.sky.turbidity;
  u.rayleigh.value = look.sky.rayleigh;
  u.mieCoefficient.value = look.sky.mie;
  u.mieDirectionalG.value = look.sky.mieG;
  u.sunPosition.value.copy(look.sunDir);
  u.tint.value.fromArray(look.sky.tint).multiplyScalar(tintScale);
  u.sat.value = look.sky.sat;
  u.skyFloor.value.fromArray(look.sky.floor).multiplyScalar(tintScale);
}

function dotTexture(inner, outer) {
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.5, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function moonTexture() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const glow = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
  glow.addColorStop(0, 'rgba(200,215,255,0.35)'); glow.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, S, S);
  g.fillStyle = '#eef0f6';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(150,160,180,0.45)';
  for (const [x, y, r] of [[-6, -5, 6], [7, 4, 5], [-3, 9, 4], [5, -9, 3]]) {
    g.beginPath(); g.arc(S / 2 + x, S / 2 + y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Precipitation: particles live in a box that wraps around the camera
// ---------------------------------------------------------------------------
class Rain {
  constructor(scene, night) {
    this.n = 3500; this.half = new THREE.Vector3(90, 70, 90);
    this.p = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      this.p[i * 3] = (Math.random() * 2 - 1) * this.half.x;
      this.p[i * 3 + 1] = (Math.random() * 2 - 1) * this.half.y;
      this.p[i * 3 + 2] = (Math.random() * 2 - 1) * this.half.z;
    }
    this.fall = new THREE.Vector3(6, -55, 3);
    this.geo = new THREE.BufferGeometry();
    this.seg = new Float32Array(this.n * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.seg, 3));
    this.mesh = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({
      color: night ? 0x6a7690 : 0xa8b2c2, transparent: true, opacity: night ? 0.35 : 0.45, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.inited = false;
    scene.add(this.mesh);
  }
  update(dt, cam, vel) {
    const p = this.p, s = this.seg, h = this.half, f = this.fall;
    if (!this.inited) { // place relative to camera on first frame
      for (let i = 0; i < this.n; i++) { p[i * 3] += cam.x; p[i * 3 + 1] += cam.y; p[i * 3 + 2] += cam.z; }
      this.inited = true;
    }
    // streak along apparent velocity (rain relative to the plane)
    const ax = f.x - vel.x, ay = f.y - vel.y, az = f.z - vel.z;
    const k = 0.03;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      let x = p[j] + f.x * dt, y = p[j + 1] + f.y * dt, z = p[j + 2] + f.z * dt;
      let d = x - cam.x; if (d > h.x) x -= 2 * h.x; else if (d < -h.x) x += 2 * h.x;
      d = y - cam.y; if (d > h.y) y -= 2 * h.y; else if (d < -h.y) y += 2 * h.y;
      d = z - cam.z; if (d > h.z) z -= 2 * h.z; else if (d < -h.z) z += 2 * h.z;
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
      const q = i * 6;
      s[q] = x; s[q + 1] = y; s[q + 2] = z;
      s[q + 3] = x - ax * k; s[q + 4] = y - ay * k; s[q + 5] = z - az * k;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); }
}

class Snow {
  constructor(scene, night) {
    this.n = 6000; this.half = new THREE.Vector3(120, 80, 120);
    this.p = new Float32Array(this.n * 3);
    this.ph = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.p[i * 3] = (Math.random() * 2 - 1) * this.half.x;
      this.p[i * 3 + 1] = (Math.random() * 2 - 1) * this.half.y;
      this.p[i * 3 + 2] = (Math.random() * 2 - 1) * this.half.z;
      this.ph[i] = Math.random() * Math.PI * 2;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.tex = dotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.mesh = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.8, map: this.tex, transparent: true, depthWrite: false,
      color: night ? 0x8a94a8 : 0xffffff, opacity: 0.9,
    }));
    this.mesh.frustumCulled = false;
    this.inited = false; this.t = 0;
    scene.add(this.mesh);
  }
  update(dt, cam) {
    const p = this.p, h = this.half;
    this.t += dt;
    if (!this.inited) {
      for (let i = 0; i < this.n; i++) { p[i * 3] += cam.x; p[i * 3 + 1] += cam.y; p[i * 3 + 2] += cam.z; }
      this.inited = true;
    }
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, ph = this.ph[i];
      let x = p[j] + (2 + Math.sin(this.t * 0.8 + ph) * 1.5) * dt;
      let y = p[j + 1] - (2.5 + (ph % 1)) * dt;
      let z = p[j + 2] + (1 + Math.cos(this.t * 0.7 + ph) * 1.5) * dt;
      let d = x - cam.x; if (d > h.x) x -= 2 * h.x; else if (d < -h.x) x += 2 * h.x;
      d = y - cam.y; if (d > h.y) y -= 2 * h.y; else if (d < -h.y) y += 2 * h.y;
      d = z - cam.z; if (d > h.z) z -= 2 * h.z; else if (d < -h.z) z += 2 * h.z;
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); this.tex.dispose(); }
}

// ---------------------------------------------------------------------------
// Lightning: jagged bolts in the distance + sky/ambient flash + thunder callback
// ---------------------------------------------------------------------------
class Lightning {
  constructor(scene, onThunder) {
    this.scene = scene; this.onThunder = onThunder;
    this.timer = 3 + Math.random() * 4;
    this.flash = 0; this.life = 0;
    this.mat = new THREE.LineBasicMaterial({ color: new THREE.Color(6, 6, 8), transparent: true, fog: false });
    this.bolt = null;
  }
  _makeBolt(top, bottomY) {
    const pts = [];
    const build = (start, endY, spread, depth) => {
      let cur = start.clone();
      const steps = 12;
      const dy = (start.y - endY) / steps;
      for (let i = 0; i < steps; i++) {
        const next = cur.clone();
        next.y -= dy;
        next.x += (Math.random() - 0.5) * spread;
        next.z += (Math.random() - 0.5) * spread;
        pts.push(cur.clone(), next.clone());
        if (depth < 2 && Math.random() < 0.18) build(next, next.y - dy * (2 + Math.random() * 4), spread * 0.8, depth + 1);
        cur = next;
      }
    };
    build(top, bottomY, 90, 0);
    const grp = new THREE.Group();
    for (const o of [0, 1.5, -1.5]) {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().add(new THREE.Vector3(o, 0, o))));
      grp.add(new THREE.LineSegments(g, this.mat));
    }
    return grp;
  }
  _clearBolt() {
    if (!this.bolt) return;
    this.scene.remove(this.bolt);
    this.bolt.children.forEach((c) => c.geometry.dispose());
    this.bolt = null;
  }
  update(dt, cam, fwd, world) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 4 + Math.random() * 7;
      const ang = Math.atan2(fwd.x, -fwd.z) + (Math.random() - 0.5) * 2.0;
      const dist = 1200 + Math.random() * 2600;
      const x = cam.x + Math.sin(ang) * dist, z = cam.z - Math.cos(ang) * dist;
      const ground = world.surfaceAt(x, z);
      this._clearBolt();
      this.bolt = this._makeBolt(new THREE.Vector3(x, Math.max(ground + 700, 900), z), ground);
      this.scene.add(this.bolt);
      this.life = 0;
      this.strength = 1 - (dist - 1200) / 3600 * 0.6;
      if (this.onThunder) this.onThunder(Math.min(4, dist / 340), this.strength);
    }
    if (this.bolt) {
      this.life += dt;
      // two quick flickers then fade
      const l = this.life;
      const f = l < 0.08 ? 1 : l < 0.14 ? 0.2 : l < 0.24 ? 0.9 : Math.max(0, 0.9 - (l - 0.24) * 3);
      this.flash = f * this.strength;
      this.mat.opacity = f;
      if (l > 0.6) this._clearBolt();
    } else {
      this.flash = 0;
    }
    return this.flash;
  }
  dispose() { this._clearBolt(); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------
// Atmosphere controller
// ---------------------------------------------------------------------------
export class Atmosphere {
  constructor(scene, renderer, sound) {
    this.scene = scene; this.renderer = renderer; this.sound = sound;
    this.sky = makeSky();
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    this.light = new THREE.DirectionalLight(0xffffff, 3);
    scene.add(this.light, this.light.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    scene.add(this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    // stars
    const N = 2500, sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.95 + 0.03;
      v.normalize().multiplyScalar(15000);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starTex = dotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: false, map: this.starTex, transparent: true, depthWrite: false, fog: false, color: 0xdfe6ff,
    }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // moon
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTexture(), fog: false, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.7),
    }));
    this.moon.scale.setScalar(1400);
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    this.precip = null; this.lightning = null; this.flash = 0;
    this.flashEl = document.getElementById('lightning');
  }

  apply(look) {
    this.look = look;
    setSkyUniforms(this.sky, look);
    this.light.color.set(look.light.color);
    this.light.intensity = look.light.intensity;
    this.light.position.copy(look.lightDir).multiplyScalar(1000);
    this.hemi.color.set(look.hemi.sky);
    this.hemi.groundColor.set(look.hemi.ground);
    this.hemi.intensity = look.hemi.intensity;
    this.baseFog = look.fogDensity;
    this.scene.fog = new THREE.FogExp2(look.fogColor, look.fogDensity);
    this.renderer.toneMappingExposure = look.exposure;
    this.stars.visible = look.stars;
    this.moon.visible = look.moon;

    // reflections from a pre-filtered copy of the sky
    const envScene = new THREE.Scene();
    const envSky = makeSky();
    envSky.scale.setScalar(50);
    setSkyUniforms(envSky, look);
    envScene.add(envSky);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02);
    envSky.geometry.dispose(); envSky.material.dispose();
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = look.envIntensity;

    if (this.precip) { this.precip.dispose(this.scene); this.precip = null; }
    if (look.precip === 'rain') this.precip = new Rain(this.scene, look.night);
    else if (look.precip === 'snow') this.precip = new Snow(this.scene, look.night);
    if (this.lightning) { this.lightning.dispose(); this.lightning = null; }
    if (look.lightning) {
      this.lightning = new Lightning(this.scene, (delay, strength) => this.sound && this.sound.thunder(delay, strength));
    }
    if (this.sound) this.sound.setRain(look.precip === 'rain' ? 1 : 0);
    this.flash = 0;
  }

  update(dt, camera, vel, fwd, world) {
    const cam = camera.position;
    this.sky.position.copy(cam);
    this.stars.position.copy(cam);
    if (this.moon.visible) this.moon.position.copy(this.look.lightDir).multiplyScalar(12000).add(cam);
    if (this.precip) this.precip.update(dt, cam, vel);

    const prev = this.flash;
    this.flash = this.lightning ? this.lightning.update(dt, cam, fwd, world) : 0;
    if (this.flash > 0 || prev > 0) {
      const f = this.flash;
      setSkyUniforms(this.sky, this.look, 1 + f * 5);
      if (this.flashEl) this.flashEl.style.opacity = (f * 0.22).toFixed(3);
    }
    // inside a tunnel (shade -> 1) the sun, sky light and reflections fade out
    const sh = this.shade || 0;
    this.light.intensity = this.look.light.intensity * (1 - 0.85 * sh);
    this.hemi.intensity = this.look.hemi.intensity * (1 - 0.45 * sh) + this.flash * 3;
    this.scene.environmentIntensity = this.look.envIntensity * (1 - 0.7 * sh);
  }
}
