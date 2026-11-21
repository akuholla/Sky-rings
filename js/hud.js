// DOM heads-up display: stats bar, next-ring marker, speed/alt, popups, crash overlay.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3(), _p = new THREE.Vector3();
export const fmtLap = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export class Hud {
  constructor() {
    this.el = $('hud');
    this.score = $('score'); this.time = $('time'); this.rings = $('rings'); this.streak = $('streak'); this.kills = $('kills');
    this.fuelEl = $('fuel'); this.fuelFill = $('fuelFill'); this.fuelPct = $('fuelPct'); this.fuelWarn = $('fuelWarn');
    this.lapEls = document.querySelectorAll('.lapstat'); this.lap = $('lap'); this.lapTime = $('lapTime'); this.bestLap = $('bestLap');
    this.reticle = $('reticle'); this.markerBox = $('enemyMarkers'); this.enemyEls = [];
    this.spd = $('spd'); this.alt = $('alt');
    this.marker = $('marker'); this.arrow = $('markerArrow'); this.dist = $('markerDist');
    this.popupEl = $('popup'); this.crashEl = $('crash'); this.flashEl = $('flash'); this.fogEl = $('cloudfog');
    this.cache = {};
  }
  _set(el, key, val) {
    if (this.cache[key] !== val) { this.cache[key] = val; el.textContent = val; }
  }
  show(v) { this.el.classList.toggle('hidden', !v); }
  setStats({ score, time, rings, streak, kills = 0 }) {
    this._set(this.kills, 'kills', String(kills).padStart(2, '0'));
    this._set(this.score, 'score', String(score).padStart(4, '0'));
    const t = Math.floor(time);
    this._set(this.time, 'time', `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    this._set(this.rings, 'rings', String(rings).padStart(2, '0'));
    this._set(this.streak, 'streak', 'x' + streak);
  }
  setFlight(speed, alt) {
    this._set(this.spd, 'spd', String(Math.round(speed * 3.6)));
    this._set(this.alt, 'alt', String(Math.max(0, Math.round(alt))));
  }
  popup(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.textContent = text;
    this.popupEl.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }
  showCrash(v) { this.crashEl.classList.toggle('hidden', !v); }
  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }
  setCloud(f) { this.fogEl.style.opacity = (f * 0.55).toFixed(3); }

  updateMarker(camera, target, from) {
    if (!target) { this.marker.style.display = 'none'; return; }
    this.marker.style.display = 'block';
    _v.copy(target).applyMatrix4(camera.matrixWorldInverse);
    const behind = _v.z > 0;
    _p.copy(target).project(camera);
    let x = _p.x, y = _p.y;
    if (behind) { x = -x; y = -y; }
    const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
    if (!onScreen) {
      if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) y = -1;
      const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88);
      x /= m; y /= m;
    }
    const W = innerWidth, H = innerHeight;
    const sx = (x * 0.5 + 0.5) * W, sy = (1 - (y * 0.5 + 0.5)) * H;
    this.marker.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    this.marker.classList.toggle('edge', !onScreen);
    this.arrow.style.transform = onScreen ? 'rotate(45deg)' : `rotate(${Math.atan2(-y, x)}rad)`;
    this._set(this.dist, 'dist', Math.round(from.distanceTo(target)) + ' m');
  }

  // circuit lap counter: lap number, current lap time, best lap
  showLaps(v) { for (const el of this.lapEls) el.classList.toggle('hidden', !v); }
  setLap(lap) {
    this._set(this.lap, 'lap', lap.started ? String(lap.n) : '–');
    this._set(this.lapTime, 'lapTime', fmtLap(lap.t));
    this._set(this.bestLap, 'bestLap', lap.best ? fmtLap(lap.best) : '–');
  }

  setFuel(pct, engineOn) {
    const p = Math.max(0, Math.min(100, pct));
    this.fuelFill.style.width = p.toFixed(1) + '%';
    this._set(this.fuelPct, 'fuel', Math.ceil(p) + '%');
    this.fuelEl.classList.toggle('low', p <= 30 && p > 15);
    this.fuelEl.classList.toggle('critical', p <= 15);
    const warn = !engineOn ? 'ENGINE OUT — GLIDE THROUGH A RING' : p <= 15 ? 'LOW FUEL' : '';
    this._set(this.fuelWarn, 'fuelWarn', warn);
    this.fuelWarn.classList.toggle('blink', !!warn);
  }

  // Laser aim point: where the bolts will be ~350 m ahead
  updateReticle(camera, point) {
    if (!point) { this.reticle.style.display = 'none'; return; }
    _v.copy(point).applyMatrix4(camera.matrixWorldInverse);
    if (_v.z > 0) { this.reticle.style.display = 'none'; return; }
    _p.copy(point).project(camera);
    this.reticle.style.display = 'block';
    this.reticle.style.transform = `translate(${((_p.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((1 - (_p.y * 0.5 + 0.5)) * innerHeight).toFixed(1)}px)`;
  }

  // Brackets on enemies that are on screen and within range
  updateEnemies(camera, enemies, from) {
    let n = 0;
    for (const e of enemies) {
      const d = from.distanceTo(e.pos);
      if (d > 2200) continue;
      _v.copy(e.pos).applyMatrix4(camera.matrixWorldInverse);
      if (_v.z > 0) continue;
      _p.copy(e.pos).project(camera);
      if (Math.abs(_p.x) > 1 || Math.abs(_p.y) > 1) continue;
      let el = this.enemyEls[n];
      if (!el) {
        el = document.createElement('div');
        el.className = 'em';
        el.appendChild(document.createElement('span'));
        this.markerBox.appendChild(el);
        this.enemyEls.push(el);
      }
      el.style.display = 'block';
      el.classList.toggle('balloon', e.kind === 'balloon');
      el.style.transform = `translate(${((_p.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((1 - (_p.y * 0.5 + 0.5)) * innerHeight).toFixed(1)}px)`;
      el.firstChild.textContent = Math.round(d) + ' m';
      n++;
    }
    for (let i = n; i < this.enemyEls.length; i++) this.enemyEls[i].style.display = 'none';
  }
}
