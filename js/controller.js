// Sky Rings phone controller.
// Reads the accelerometer (gravity direction), turns phone tilt into bank / pitch
// values using a 3-step calibration, and streams them + the FIRE button to the game.
//
// Calibration works in the phone's own sensor frame, so it is independent of how the
// phone is held (landscape left/right, portrait) and of iOS vs Android sign conventions:
//   n0 = gravity when "level", r = direction gravity moves when banking right,
//   p  = direction gravity moves when tilting nose-down.
//   bank  = atan2(g·r, g·n0)     pitch = -atan2(g·p, g·n0)

const $ = (id) => document.getElementById(id);
const code = (new URLSearchParams(location.search).get('s') || '').toUpperCase();
const CAL_KEY = 'skyrings.phonecal';
const SENS_KEY = 'skyrings.phonesens';
const DEG = 180 / Math.PI;
const SEND_MS = 33;

// ---------------------------------------------------------------- vector helpers
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return scale(a, 1 / l); };
const reject = (a, n) => sub(a, scale(n, dot(a, n))); // remove the component along n
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- state
let cal = null;
try { cal = JSON.parse(localStorage.getItem(CAL_KEY) || 'null'); } catch { cal = null; }
let maxTilt = +(localStorage.getItem(SENS_KEY) || 35); // phone tilt (deg) for full deflection
let g = null;            // low-passed gravity vector in the phone frame
let lastMotion = 0;
let fire = false;
let angles = { bank: 0, pitch: 0 };
let out = { roll: 0, pitch: 0 };
let gameConnected = false, serverOk = false, inFlight = false;

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const v = [a.x, a.y, a.z];
  if (!g) g = v;
  else for (let i = 0; i < 3; i++) g[i] += (v[i] - g[i]) * 0.3; // smooth out hand shake
  lastMotion = performance.now();
}

function computeAngles(gv, c) {
  if (!gv || !c) return { bank: 0, pitch: 0 };
  const gn = norm(gv);
  const up = dot(gn, c.n0);
  return {
    bank: Math.atan2(dot(gn, c.r), up) * DEG,
    pitch: -Math.atan2(dot(gn, c.p), up) * DEG, // tilting nose-down gives negative pitch
  };
}

function shape(deg) {
  const dz = 2; // degrees of dead zone around level
  const a = Math.abs(deg) < dz ? 0 : deg - Math.sign(deg) * dz;
  return clamp(a / (maxTilt - dz), -1, 1);
}

// ---------------------------------------------------------------- networking
function send(msg) {
  if (!code) return Promise.resolve();
  return fetch(`/api/input?s=${encodeURIComponent(code)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
  }).then((r) => r.json()).then((j) => { serverOk = true; gameConnected = !!j.game; })
    .catch(() => { serverOk = false; gameConnected = false; });
}

setInterval(() => {
  angles = computeAngles(g, cal);
  out = cal ? { roll: shape(angles.bank), pitch: shape(angles.pitch) } : { roll: 0, pitch: 0 };
  if (inFlight) return; // never queue up stale packets
  inFlight = true;
  send({ t: 'in', roll: +out.roll.toFixed(3), pitch: +out.pitch.toFixed(3), fire, cal: !!cal })
    .finally(() => { inFlight = false; });
}, SEND_MS);

// ---------------------------------------------------------------- UI: status + horizon
function drawHorizon(cv, bank, pitch) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, R = W / 2 - 6;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.clip();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-bank / DEG);
  const off = clamp(pitch, -60, 60) / 60 * R;
  ctx.fillStyle = '#3d7cc9'; ctx.fillRect(-W, -H * 2 + off, W * 2, H * 2);   // sky
  ctx.fillStyle = '#8a5a34'; ctx.fillRect(-W, off, W * 2, H * 2);           // ground
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-W, off); ctx.lineTo(W, off); ctx.stroke();
  ctx.restore();
  // fixed aircraft symbol
  ctx.strokeStyle = '#ffd45a'; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W / 2 - R * 0.55, H / 2); ctx.lineTo(W / 2 - R * 0.15, H / 2);
  ctx.moveTo(W / 2 + R * 0.15, H / 2); ctx.lineTo(W / 2 + R * 0.55, H / 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd45a'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.stroke();
}

function uiLoop() {
  requestAnimationFrame(uiLoop);
  const st = $('status');
  const noSensor = !lastMotion || performance.now() - lastMotion > 1500;
  let text, cls;
  if (!code) { text = 'No game code — scan the QR code in the game'; cls = ''; }
  else if (!serverOk) { text = `Can't reach the game server`; cls = ''; }
  else if (!gameConnected) { text = `Waiting for game ${code}…`; cls = 'wait'; }
  else if (!cal) { text = `Connected to ${code} · calibrate first`; cls = 'wait'; }
  else if (noSensor) { text = `Connected · no motion data`; cls = 'wait'; }
  else { text = `Connected to ${code}`; cls = 'ok'; }
  st.className = cls;
  $('statusText').textContent = text;
  drawHorizon($('horizon'), angles.bank, angles.pitch);
  const deg = (v) => `${Math.round(v) || 0}°`; // no "-0°"
  $('vBank').textContent = deg(angles.bank);
  $('vPitch').textContent = deg(angles.pitch);
  if (!$('cal').classList.contains('hidden')) {
    const live = computeAngles(g, calDraft.n0 ? { n0: calDraft.n0, r: calDraft.r || [0, 0, 0], p: calDraft.p || [0, 0, 0] } : null);
    drawHorizon($('calHorizon'), live.bank, live.pitch);
  }
}

// ---------------------------------------------------------------- fire button
const fireBtn = $('fireBtn');
const setFire = (on) => {
  if (fire === on) return;
  fire = on;
  fireBtn.classList.toggle('on', on);
  if (on && navigator.vibrate) navigator.vibrate(15);
  send({ t: 'in', roll: out.roll, pitch: out.pitch, fire, cal: !!cal }); // don't wait for the next tick
};
fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); fireBtn.setPointerCapture(e.pointerId); setFire(true); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fireBtn.addEventListener(ev, () => setFire(false));

$('startBtn').addEventListener('click', () => send({ t: 'start' }));
$('menuBtn').addEventListener('click', () => send({ t: 'menu' }));

// sensitivity
const sens = $('sens');
sens.value = maxTilt;
const showSens = () => { $('sensVal').textContent = `${maxTilt}°`; };
showSens();
sens.addEventListener('input', () => { maxTilt = +sens.value; localStorage.setItem(SENS_KEY, maxTilt); showSens(); });

// ---------------------------------------------------------------- calibration wizard
const STEPS = [
  { title: 'Hold it level', desc: 'Hold the phone sideways the way you want to fly level, then tap Set.' },
  { title: 'Bank right', desc: 'Tilt the phone to bank RIGHT (right edge down, about 30°), then tap Set.' },
  { title: 'Nose down', desc: 'Back to level, then tilt the top edge AWAY from you (nose down, about 30°), then tap Set.' },
];
let calStep = 0, calDraft = {};

function openCal() {
  calStep = 0; calDraft = {};
  $('cal').classList.remove('hidden');
  showStep();
}
function showStep() {
  const s = STEPS[calStep];
  $('calTitle').textContent = s.title;
  $('calDesc').textContent = s.desc;
  $('calMsg').textContent = '';
  for (const el of document.querySelectorAll('.steps span')) {
    const i = +el.dataset.step;
    el.className = i === calStep ? 'active' : i < calStep ? 'done' : '';
  }
}
// average the gravity vector over ~0.4 s so the capture is steady
function capture() {
  return new Promise((res) => {
    const acc = [0, 0, 0]; let n = 0;
    const id = setInterval(() => {
      if (g) { for (let i = 0; i < 3; i++) acc[i] += g[i]; n++; }
      if (n >= 12) { clearInterval(id); res(norm(acc)); }
    }, 33);
    setTimeout(() => { clearInterval(id); res(n ? norm(acc) : null); }, 1500);
  });
}
$('calSet').addEventListener('click', async () => {
  const v = await capture();
  if (!v) { $('calMsg').textContent = 'No motion data from the phone — check sensor permission.'; return; }
  if (calStep === 0) {
    calDraft.n0 = v;
  } else {
    const d = reject(v, calDraft.n0);
    const tilt = Math.atan2(len(d), dot(v, calDraft.n0)) * DEG;
    if (tilt < 10) { $('calMsg').textContent = `Only ${tilt.toFixed(0)}° of tilt — tilt a bit further and tap Set again.`; return; }
    if (calStep === 1) calDraft.r = norm(d);
    else {
      let p = reject(norm(d), calDraft.r); // keep pitch independent of bank
      if (len(p) < 0.3) { $('calMsg').textContent = 'That looked like a bank, not a pitch. Tilt the top edge away from you.'; return; }
      calDraft.p = norm(p);
    }
  }
  calStep++;
  if (calStep < STEPS.length) { showStep(); return; }
  cal = { n0: calDraft.n0, r: calDraft.r, p: calDraft.p };
  localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  $('cal').classList.add('hidden');
});
$('calCancel').addEventListener('click', () => $('cal').classList.add('hidden'));
$('calBtn').addEventListener('click', openCal);

// Re-level: keep the bank/pitch directions, just take the current attitude as level
$('levelBtn').addEventListener('click', async () => {
  if (!cal) { openCal(); return; }
  const v = await capture();
  if (!v) return;
  const r = norm(reject(cal.r, v));
  const p = norm(reject(reject(cal.p, v), r));
  cal = { n0: v, r, p };
  localStorage.setItem(CAL_KEY, JSON.stringify(cal));
});

// ---------------------------------------------------------------- mobile niceties
// no pinch-zoom / double-tap zoom / long-press menus while playing
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
// browsers that can't lock orientation: suggest adding to the home screen (opens in landscape fullscreen)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
if (isIOS && !standalone) {
  $('gateHint').textContent = 'Tip: Share → Add to Home Screen opens the controller full-screen without the browser bars.';
}

// ---------------------------------------------------------------- start gate
$('gateCode').textContent = code || '(none)';
$('gateBtn').addEventListener('click', async () => {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      // iOS asks the user here; don't hang forever if the prompt never answers
      const r = await Promise.race([
        DeviceMotionEvent.requestPermission(),
        new Promise((res) => setTimeout(() => res('timeout'), 5000)),
      ]);
      if (r === 'timeout') $('gateErr').textContent = 'No answer to the motion permission request — continuing anyway.';
      else if (r !== 'granted') { $('gateErr').textContent = 'Motion access was denied. Allow it in Safari settings and reload.'; return; }
    }
  } catch (e) { $('gateErr').textContent = 'Could not get motion permission: ' + e.message; return; }
  if (!window.isSecureContext) $('gateErr').textContent = 'This page is not secure (https) — the phone will not share motion data.';
  window.addEventListener('devicemotion', onMotion);
  $('gate').classList.add('hidden');
  document.body.classList.add('started'); // enables the "turn your phone" prompt in portrait
  if (!cal) openCal();
  // nice-to-haves; never wait on them (some browsers leave these promises pending)
  const soft = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch {} };
  // Android: go fullscreen and lock to landscape (iOS Safari can't lock; it shows the rotate prompt)
  soft(() => (document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) ?? Promise.resolve())
    .then(() => screen.orientation?.lock?.('landscape')));
  const keepAwake = () => soft(() => navigator.wakeLock?.request('screen'));
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
});

uiLoop();
