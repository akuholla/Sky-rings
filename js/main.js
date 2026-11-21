import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSceneDef, World, SCENE_LIST } from './world.js';
import { FlightModel, FLIGHT_PARAMS } from './flight.js';
import { buildAircraft } from './aircraft.js';
import { Course } from './course.js';
import { Clouds } from './clouds.js';
import { Trail, Explosion } from './effects.js';
import { Hud } from './hud.js';
import { Atmosphere, buildLook, TIME_LIST, WEATHER_LIST } from './atmosphere.js';
import { Sound } from './sound.js';
import { Combat } from './combat.js';
import { PhoneController } from './phone.js';

// ---------------------------------------------------------------------------
// Renderer, camera, post-processing
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1.5, 24000);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Atmosphere (sky, lights, stars, moon, rain/snow, lightning) + sound
// ---------------------------------------------------------------------------
const sound = new Sound();
const atmo = new Atmosphere(scene, renderer, sound);
let look = null;

// ---------------------------------------------------------------------------
// Game objects
// ---------------------------------------------------------------------------
const hud = new Hud();
const flight = new FlightModel();
const plane = buildAircraft();
scene.add(plane.group);
// soft fill light that follows the plane so it stays readable at night / in storms
const planeFill = new THREE.PointLight(0xc8d4ff, 0, 40, 1.5);
planeFill.position.set(0, 8, 10);
plane.group.add(planeFill);
const trails = [new Trail(scene), new Trail(scene)];
const explosion = new Explosion(scene);
const combat = new Combat(scene, explosion, sound);
const phone = new PhoneController();

let def = null, world = null, course = null, clouds = null;
let currentScene = null;
const stats = { score: 0, time: 0, rings: 0, streak: 0, kills: 0 };
// Fuel (%): each ring refills 10%; burn rate = 10% per ring-to-ring flight time at cruise
let fuel = 100;
const FUEL_PER_RING = 10;
const fuelBurnRate = () => FUEL_PER_RING / (settings.ringGap / FLIGHT_PARAMS.cruise); // %/s

const SETTINGS_KEY = 'skyrings.settings';
const settings = Object.assign({ scene: 'mountains', time: 'sunset', weather: 'clear', invert: false, autoLevel: true, sound: true, ringGap: 340, combat: true },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

function headingDir(h) { return new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)); }

// Find a start spot with a low, clear corridor ahead (e.g. over water / along a valley)
function findStart(w) {
  let best = null;
  for (let k = 0; k < 40; k++) {
    const x = k * 650, z = 0;
    let m = -Infinity;
    for (let s = 0; s <= 1600; s += 200) {
      for (const o of [-60, 0, 60]) m = Math.max(m, w.solidAt(x + o, z - s));
    }
    if (!best || m < best.m) best = { x, z, m };
    if (m < 40) break;
  }
  return { pos: new THREE.Vector3(best.x, best.m + w.def.clearance + 70, best.z), heading: 0 };
}

function resetStats() {
  stats.score = 0; stats.time = 0; stats.rings = 0; stats.streak = 0; stats.kills = 0;
  fuel = 100;
  flight.engineOn = true;
}

function loadScene(id) {
  if (world) { course.dispose(); clouds.dispose(); world.dispose(); }
  currentScene = id;
  def = createSceneDef(id);
  look = buildLook(def, settings.time, settings.weather);
  atmo.apply(look);
  planeFill.intensity = look.night ? 120 : look.weatherId === 'storm' ? 60 : 0;
  world = new World(scene, def, look.env);
  const start = findStart(world);
  world.init(start.pos.x, start.pos.z);
  clouds = new Clouds(scene, world, { ...look.clouds, sunDir: look.lightDir, sunColor: look.light.color });
  const [c0, c1] = look.clouds.palette.map((c) => '#' + new THREE.Color(c).getHexString());
  document.getElementById('cloudfog').style.background = `radial-gradient(ellipse at center, ${c0}cc, ${c1}f2)`;
  clouds.initAmbient(start.pos);
  course = new Course(scene, world, clouds, 1234, settings.ringGap);
  course.reset(start.pos, start.heading);
  combat.reset(world, course);
  combat.setEnabled(settings.combat);
  respawnAt(start.pos, headingDir(start.heading));
  resetStats();
  explosion.parts.forEach((p) => { explosion.group.remove(p.s); p.s.material.dispose(); });
  explosion.parts.length = 0;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'menu') { if (started) closeMenu(); } else openMenu();
  } else if (e.code === 'Enter' && state === 'menu') {
    closeMenu();
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readInput() {
  const roll = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  let pitch = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
  if (settings.invert) pitch = -pitch;
  return { roll, pitch };
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
let state = 'menu';
let started = false;
const menuEl = document.getElementById('menu');
const startBtn = document.getElementById('start');
const optInvert = document.getElementById('optInvert');
const optLevel = document.getElementById('optLevel');

// Button groups: scene / time of day / weather. Any change rebuilds the world.
function buttonGroup(boxId, list, key) {
  const box = document.getElementById(boxId);
  for (const item of list) {
    const b = document.createElement('button');
    b.className = 'scene';
    b.dataset.id = item.id;
    b.textContent = item.label;
    b.addEventListener('click', () => {
      if (settings[key] === item.id && (key !== 'scene' || currentScene === item.id)) return;
      settings[key] = item.id; saveSettings();
      loadScene(settings.scene);
      started = false;
      refreshMenu();
    });
    box.appendChild(b);
  }
  return { box, key };
}
const groups = [
  buttonGroup('scenes', SCENE_LIST, 'scene'),
  buttonGroup('times', TIME_LIST, 'time'),
  buttonGroup('weathers', WEATHER_LIST, 'weather'),
];
const optSound = document.getElementById('optSound');
optSound.checked = settings.sound;
sound.setEnabled(settings.sound);
const optCombat = document.getElementById('optCombat');
optCombat.checked = settings.combat;
optCombat.addEventListener('change', () => { settings.combat = optCombat.checked; saveSettings(); combat.setEnabled(settings.combat); });
optSound.addEventListener('change', () => { settings.sound = optSound.checked; saveSettings(); sound.setEnabled(settings.sound); });

// Ring spacing slider: live label while dragging; on release, rebuild the rings
// ahead of the plane with the new spacing (score is kept).
const optGap = document.getElementById('optGap');
const optGapVal = document.getElementById('optGapVal');
const showGap = (v) => { optGapVal.textContent = `${v} m · ~${(v / 72).toFixed(1)} s`; };
optGap.value = settings.ringGap;
showGap(settings.ringGap);
optGap.addEventListener('input', () => showGap(+optGap.value));
optGap.addEventListener('change', () => {
  settings.ringGap = +optGap.value; saveSettings();
  course.spacing = settings.ringGap;
  course.reset(flight.pos.clone(), Math.atan2(flight.forward.x, -flight.forward.z));
});
optInvert.checked = settings.invert;
optLevel.checked = settings.autoLevel;
optInvert.addEventListener('change', () => { settings.invert = optInvert.checked; saveSettings(); });
optLevel.addEventListener('change', () => { settings.autoLevel = optLevel.checked; saveSettings(); });
startBtn.addEventListener('click', () => closeMenu());

// ---- phone pairing panel
const pairEl = document.getElementById('pair');
const pairDots = document.querySelectorAll('.pdot');
document.getElementById('pairBtn').addEventListener('click', async () => {
  pairEl.classList.remove('hidden');
  const ok = await phone.checkServer();
  document.getElementById('pairBody').classList.toggle('hidden', !ok);
  document.getElementById('pairError').classList.toggle('hidden', ok);
  if (!ok) return;
  phone.connect();
  localStorage.setItem('skyrings.phonepaired', '1');
  const url = phone.pairUrl();
  document.getElementById('pairUrl').textContent = url;
  document.getElementById('pairCode').textContent = phone.code;
  const img = document.getElementById('pairQr');
  if (window.qrcode) {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    img.src = qr.createDataURL(6, 2);
  } else {
    img.alt = 'QR library could not load — type the link instead';
  }
});
document.getElementById('pairClose').addEventListener('click', () => pairEl.classList.add('hidden'));
phone.onStart = () => { if (state === 'menu') closeMenu(); };
phone.onMenu = () => { if (state !== 'menu') openMenu(); };
// reconnect automatically if this browser was paired before
if (localStorage.getItem('skyrings.phonepaired')) phone.checkServer().then((ok) => ok && phone.connect());
function updatePhoneStatus() {
  const on = phone.active;
  for (const d of pairDots) d.classList.toggle('on', on);
  const ps = document.getElementById('pairStatus');
  ps.textContent = !on ? 'Waiting for phone…' : phone.state.cal ? 'Phone connected ✓ — tilt it to see the plane move' : 'Phone connected — finish calibration on the phone';
  document.getElementById('phoneBadge').classList.toggle('hidden', !on);
}

function refreshMenu() {
  for (const g of groups) for (const b of g.box.children) b.classList.toggle('active', b.dataset.id === settings[g.key]);
  startBtn.textContent = started ? 'Resume' : 'Start Flying';
}
function openMenu() {
  if (state === 'crashed') finishCrash();
  state = 'menu';
  sound.pause();
  menuEl.classList.remove('hidden');
  hud.show(false);
  refreshMenu();
}
function closeMenu() {
  sound.init();
  sound.resume();
  menuEl.classList.add('hidden');
  hud.show(true);
  state = 'playing';
  started = true;
  startBtn.blur();
}

// ---------------------------------------------------------------------------
// Gameplay
// ---------------------------------------------------------------------------
const prevPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const CAM_OFF = new THREE.Vector3(0, 4.2, 17);
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
let crashT = 0, shake = 0, cloudF = 0, menuAngle = 0;
const crashPos = new THREE.Vector3();

function respawnAt(pos, dir) {
  flight.reset(pos, dir);
  plane.group.visible = true;
  trails.forEach((t) => t.reset());
  camQuat.copy(flight.quat);
}

function checkCollision() {
  const p = flight.pos;
  if (p.y - plane.gearDepth < world.solidAt(p.x, p.z)) return true; // wheels touching down
  for (const s of [-1, 1]) {
    _t.copy(flight.right).multiplyScalar(plane.halfSpan * s).add(p);
    if (_t.y < world.solidAt(_t.x, _t.z)) return true;
  }
  _t.copy(flight.forward).multiplyScalar(3.5).add(p);
  return _t.y < world.solidAt(_t.x, _t.z);
}

function crash() {
  state = 'crashed';
  crashT = 2.4;
  shake = 1;
  crashPos.copy(flight.pos);
  plane.group.visible = false;
  explosion.spawn(flight.pos, flight.vel);
  sound.boom(1.2);
  hud.flash();
  hud.showCrash(true);
  resetStats();
}

function finishCrash() {
  const r = course.respawnPoint();
  respawnAt(r.pos, r.dir);
  combat.clearNear(r.pos, 600);
  hud.showCrash(false);
  state = 'playing';
}

function stepPlaying(dt) {
  prevPos.copy(flight.pos);
  fuel = Math.max(0, fuel - fuelBurnRate() * dt);
  if (fuel <= 0 && flight.engineOn) { flight.engineOn = false; hud.popup('OUT OF FUEL — glide through a ring!', 'bad'); }
  // keyboard wins while an arrow key is held; otherwise a connected phone flies the plane
  let input = readInput(), autoLevel = settings.autoLevel;
  if (phone.ready && input.roll === 0 && input.pitch === 0) { input = phone.flightInput(flight); autoLevel = false; }
  flight.update(dt, input, { autoLevel });
  stats.time += dt;
  for (const ev of course.update(prevPos, flight.pos)) {
    if (ev.type === 'pass') {
      stats.streak++;
      stats.rings++;
      const pts = 100 + 25 * Math.min(stats.streak - 1, 20);
      stats.score += pts;
      const wasOut = !flight.engineOn;
      fuel = Math.min(100, fuel + FUEL_PER_RING);
      flight.engineOn = true;
      hud.popup('+' + pts + (stats.streak > 1 ? `  streak x${stats.streak}` : '') + `  ·  +${FUEL_PER_RING}% fuel`, 'good');
      if (wasOut) hud.popup('ENGINE RESTARTED', 'kill');
    } else {
      stats.streak = 0;
      hud.popup('MISSED', 'bad');
    }
  }
  for (const ev of combat.update(dt, { flight, plane, firing: !!keys.Space || (phone.active && phone.state.fire), active: true })) {
    if (ev.type === 'kill') {
      stats.score += ev.points;
      stats.kills++;
      hud.popup(`+${ev.points}  ${ev.kind === 'balloon' ? 'BALLOON POPPED' : 'ENEMY DOWN'}`, 'kill');
    } else if (ev.type === 'collide') {
      crash();
      return;
    }
  }
  if (checkCollision()) crash();
}

function updateCamera(dt) {
  if (state === 'menu') {
    menuAngle += dt * 0.12;
    camera.position.set(
      flight.pos.x + Math.sin(menuAngle) * 28, flight.pos.y + 7, flight.pos.z + Math.cos(menuAngle) * 28);
    camera.up.set(0, 1, 0);
    camera.lookAt(flight.pos);
  } else if (state === 'crashed') {
    camera.up.set(0, 1, 0);
    camera.lookAt(crashPos);
  } else {
    camQuat.slerp(flight.quat, 1 - Math.exp(-dt * 3.5));
    _t.copy(CAM_OFF).applyQuaternion(camQuat);
    camera.position.copy(flight.pos).add(_t);
    const g = world.solidAt(camera.position.x, camera.position.z) + 3;
    if (camera.position.y < g) camera.position.y = g;
    _u.set(0, 1, 0).applyQuaternion(camQuat);
    camera.up.set(0, 1, 0).lerp(_u, 0.45).normalize();
    _w.set(0, 1.2, -30).applyQuaternion(camQuat).add(flight.pos);
    camera.lookAt(_w);
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 2;
    camera.position.y += (Math.random() - 0.5) * shake * 2;
    shake = Math.max(0, shake - dt * 1.2);
  }
  const fov = 62 + (flight.speed - 72) * 0.18;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastT = performance.now(), elapsed = 0, propSpin = 55;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  elapsed += dt;

  if (state === 'playing') stepPlaying(dt);
  else if (state === 'crashed') {
    crashT -= dt;
    combat.update(dt, { flight, plane, firing: false, active: false });
    if (crashT <= 0) finishCrash();
  }

  world.update(dt, flight.pos.x, flight.pos.z);
  course.animate(dt, elapsed);
  explosion.update(dt);

  // aircraft visuals
  plane.group.position.copy(flight.pos);
  plane.group.quaternion.copy(flight.quat);
  propSpin += ((flight.engineOn ? 55 : 0) - propSpin) * (1 - Math.exp(-dt * 1.5)); // windmills down when out of fuel
  plane.propeller.rotation.z += dt * propSpin;
  plane.group.updateMatrixWorld();
  if (state === 'playing') {
    const strength = 0.45 * THREE.MathUtils.smoothstep(Math.abs(flight.pitchRate) / 0.6 + Math.abs(flight.bank) / 1.2, 0.3, 1.0);
    for (let i = 0; i < 2; i++) {
      _t.copy(plane.tips[i]);
      plane.group.localToWorld(_t);
      trails[i].update(dt, _t, flight.up, strength);
    }
  }

  // clouds: thicker fog + white-out overlay while inside one
  const f = clouds.update(flight.pos, flight.forward);
  cloudF += (f - cloudF) * (1 - Math.exp(-dt * 6));
  scene.fog.density = atmo.baseFog + cloudF * 0.006;
  hud.setCloud(state === 'menu' ? 0 : cloudF);

  updateCamera(dt);
  atmo.update(dt, camera, flight.vel, flight.forward, world);
  clouds.render(camera.position);
  plane.strobe.visible = (elapsed % 1.2) < 0.08;

  if (state !== 'menu') {
    hud.setStats(stats);
    hud.setFlight(flight.speed, flight.pos.y - world.surfaceAt(flight.pos.x, flight.pos.z));
    hud.setFuel(fuel, flight.engineOn);
    const r = course.nextRing();
    hud.updateMarker(camera, r && r.pos, flight.pos);
    const aim = combat.enabled && state === 'playing' ? _w.copy(flight.forward).multiplyScalar(350).add(flight.pos) : null;
    hud.updateReticle(camera, aim);
    hud.updateEnemies(camera, combat.enabled ? combat.enemies : [], flight.pos);
  }

  updatePhoneStatus();
  composer.render();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!SCENE_LIST.some((s) => s.id === settings.scene)) settings.scene = 'mountains';
if (!TIME_LIST.some((s) => s.id === settings.time)) settings.time = 'sunset';
if (!WEATHER_LIST.some((s) => s.id === settings.weather)) settings.weather = 'clear';
loadScene(settings.scene);
refreshMenu();
document.getElementById('loading')?.remove();
requestAnimationFrame((t) => { lastT = t; frame(t); });

// handy for debugging from the console
window.__sim = { flight, get course() { return course; }, get world() { return world; }, get state() { return state; }, get lastT() { return lastT; }, get look() { return look; }, atmo, combat, keys, phone, get fuel() { return fuel; }, set fuel(v) { fuel = v; }, fuelBurnRate, stats, settings };
