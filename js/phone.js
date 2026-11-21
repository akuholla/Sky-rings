// Game side of the phone controller: listens for messages relayed by server.py
// over Server-Sent Events, and turns phone tilt into flight inputs.
import * as THREE from 'three';

const CODE_KEY = 'skyrings.phonecode';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

const MAX_BANK = THREE.MathUtils.degToRad(70);   // full phone tilt -> 70 deg bank
const MAX_PITCH = THREE.MathUtils.degToRad(40);  // full phone tilt -> 40 deg climb/dive

export class PhoneController {
  constructor() {
    let code = localStorage.getItem(CODE_KEY);
    if (!code) {
      code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
      localStorage.setItem(CODE_KEY, code);
    }
    this.code = code;
    this.state = { roll: 0, pitch: 0, fire: false, cal: false };
    this.last = 0;
    this.es = null;
    this.onStart = null;
    this.onMenu = null;
    this.available = null; // null = unknown, false = plain static server without the relay
  }

  // Is the relay server running? (it isn't with a plain static file server)
  async checkServer() {
    try {
      const r = await fetch('/api/info', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      this.info = await r.json();
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  connect() {
    if (this.es || this.available === false) return;
    this.es = new EventSource(`/api/events?s=${this.code}`);
    this.es.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'in') {
        this.state.roll = THREE.MathUtils.clamp(+m.roll || 0, -1, 1);
        this.state.pitch = THREE.MathUtils.clamp(+m.pitch || 0, -1, 1);
        this.state.fire = !!m.fire;
        this.state.cal = !!m.cal;
        this.last = performance.now();
      } else if (m.t === 'start') {
        if (this.onStart) this.onStart();
      } else if (m.t === 'menu') {
        if (this.onMenu) this.onMenu();
      }
    };
  }

  // phone has sent data recently
  get active() { return performance.now() - this.last < 700; }
  get ready() { return this.active && this.state.cal; }

  pairUrl() {
    if (!this.info) return null;
    return `https://${this.info.lanIp}:${this.info.httpsPort}/controller.html?s=${this.code}`;
  }

  // Attitude control: the plane follows the phone's tilt. Phone level -> plane level.
  flightInput(flight) {
    const targetBank = this.state.roll * MAX_BANK;
    const targetPitch = this.state.pitch * MAX_PITCH;
    return {
      roll: THREE.MathUtils.clamp((targetBank - flight.bank) * 2.2, -1, 1),
      pitch: THREE.MathUtils.clamp((targetPitch - flight.pitch) * 2.6, -1, 1),
    };
  }
}
