// DOM heads-up display: stats bar, next-ring marker, speed/alt, popups, crash overlay.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3(), _p = new THREE.Vector3();

export class Hud {
  constructor() {
    this.el = $('hud');
    this.score = $('score'); this.time = $('time'); this.rings = $('rings'); this.streak = $('streak');
    this.spd = $('spd'); this.alt = $('alt');
    this.marker = $('marker'); this.arrow = $('markerArrow'); this.dist = $('markerDist');
    this.popupEl = $('popup'); this.crashEl = $('crash'); this.flashEl = $('flash'); this.fogEl = $('cloudfog');
    this.cache = {};
  }
  _set(el, key, val) {
    if (this.cache[key] !== val) { this.cache[key] = val; el.textContent = val; }
  }
  show(v) { this.el.classList.toggle('hidden', !v); }
  setStats({ score, time, rings, streak }) {
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
}
