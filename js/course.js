// Endless curvy course of gold rings. Rings are 240-330 m apart (~3-5 s at cruise),
// follow valleys where the scene asks for it, and always clear terrain/buildings.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const RING_RADIUS = 13;
const AHEAD = 10;
const FIRST_RING_DIST = 170;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Course {
  constructor(scene, world, clouds, seed = 1234, spacing = 340) {
    this.scene = scene; this.world = world; this.clouds = clouds;
    this.spacing = spacing; // average distance between rings (m)
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = new THREE.TorusGeometry(RING_RADIUS, 1.3, 14, 56);
    this.baseMat = new THREE.MeshStandardMaterial({
      color: 0xffc94a, metalness: 0.9, roughness: 0.3,
      emissive: 0xffa020, emissiveIntensity: 0.8,
    });
    this.rnd = mulberry32(seed);
    this.rings = []; this.next = 0; this.pts = [];
  }

  reset(start, heading) {
    for (const r of this.rings) this._removeRing(r);
    this.rings = []; this.next = 0;
    this.circuit = this.world.def.circuit || null;
    if (this.circuit) {
      // fixed loop: rings evenly spaced, ring k sits at s = k * gap; k % perLap === 0 is the start/finish gate
      const c = this.circuit;
      this.perLap = Math.max(8, Math.round(c.L / this.spacing));
      this.gap = c.L / this.perLap;
      const s = c.nearest(start.x, start.z).s;
      this.k = Math.ceil((s + 120) / this.gap);
      this.ensureAhead();
      return;
    }
    this.pts = [start.clone()];
    this.heading = heading; this.phase = this.rnd() * 6; this.altPhase = this.rnd() * 6;
    this.ensureAhead();
  }

  nextRing() { return this.rings[this.next] || null; }

  _corridor(a, b, r) {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    const px = (-dz / L) * r, pz = (dx / L) * r;
    let m = -Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = a.x + dx * t, z = a.z + dz * t;
      m = Math.max(m, this.world.solidAt(x, z), this.world.solidAt(x + px, z + pz), this.world.solidAt(x - px, z - pz));
    }
    return m;
  }

  _genPoint() {
    const def = this.world.def;
    const last = this.pts[this.pts.length - 1];
    // first ring sits straight ahead on the starting flight path, close by;
    // after that rings are spaced around this.spacing (+/-15%)
    const first = this.pts.length === 1;
    const d = first ? FIRST_RING_DIST : this.spacing * (0.85 + this.rnd() * 0.3);
    this.phase += 0.55 + this.rnd() * 0.55;
    const desired = Math.sin(this.phase) * 0.34 + (this.rnd() - 0.5) * 0.12;

    // pick a heading change: follow the wavy "desired" turn but prefer low ground
    let best = this.heading, bestCost = Infinity;
    for (let k = first ? 0 : -3; k <= (first ? 0 : 3); k++) {
      const dth = k * 0.13, th = this.heading + dth;
      const dx = Math.sin(th), dz = -Math.cos(th);
      let gh = 0;
      for (const s of [0.6, 1.2, 1.8, 2.4]) gh += this.world.solidAt(last.x + dx * d * s, last.z + dz * d * s);
      const cost = (def.valleyWeight * Math.max(gh / 4, 0)) / 120 + Math.abs(dth - desired) * 3.0;
      if (cost < bestCost) { bestCost = cost; best = th; }
    }
    this.heading = best;
    const dir = _a.set(Math.sin(best), 0, -Math.cos(best));
    const p = last.clone().addScaledVector(dir, d);

    const corridor = this._corridor(last, p, 40);
    const ahead = this._corridor(p, _b.copy(p).addScaledVector(dir, d * 1.2), 40);
    const minAlt = Math.max(corridor + def.clearance, ahead + def.clearance - 50);
    this.altPhase += 0.5 + this.rnd() * 0.4;
    const pref = minAlt + 20 + (Math.sin(this.altPhase) * 0.5 + 0.5) * 80;
    let y = first ? last.y : THREE.MathUtils.clamp(pref, last.y - 65, last.y + 65);
    y = Math.min(Math.max(y, minAlt), 1600);
    p.y = y;
    this.pts.push(p);
  }

  ensureAhead() {
    if (this.circuit) {
      while (this.rings.length - this.next < AHEAD) {
        const k = this.k++, s = this.circuit.wrap(k * this.gap);
        this._createRing(this.circuit.pointAt(s), this.circuit.tangentAt(s), null, { k, s, finish: k % this.perLap === 0 });
      }
      return;
    }
    while (this.rings.length - this.next < AHEAD) {
      this._genPoint();
      const n = this.pts.length;
      if (n >= 3) {
        const prev = this.pts[n - 3], pos = this.pts[n - 2], nxt = this.pts[n - 1];
        const tan = nxt.clone().sub(prev).normalize();
        this._createRing(pos.clone(), tan, prev);
      }
      if (this.pts.length > 3) this.pts.shift();
    }
  }

  _createRing(pos, tan, prev, meta = {}) {
    const mat = this.baseMat.clone();
    if (meta.finish) { mat.color.set(0xf4f6ff); mat.emissive.set(0x4fc3ff); } // start/finish ring
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(pos);
    mesh.lookAt(_c.copy(pos).add(tan));
    this.group.add(mesh);
    this.rings.push({ pos, tan, mesh, state: 'pending', t: 0, ...meta });
    if (!prev) return;

    // sometimes put a cloud bank across the path so you fly through it
    // (keep the opening stretch clear so the first rings are easy to see)
    if (this.clouds && this.rings.length > 2 && this.rnd() < this.clouds.pathChance) {
      const mid = prev.clone().lerp(pos, 0.5);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      mid.addScaledVector(side, (this.rnd() - 0.5) * 60);
      mid.y += (this.rnd() - 0.5) * 30;
      this.clouds.addPathCloud(mid, 70 + this.rnd() * 60);
    }
  }

  _removeRing(r) {
    this.group.remove(r.mesh);
    r.mesh.material.dispose();
  }

  // Detect crossing the plane of the next ring. Returns [{type:'pass'|'miss'}]
  update(prev, cur) {
    const events = [];
    const r = this.rings[this.next];
    if (!r) return events;
    const d0 = _a.subVectors(prev, r.pos).dot(r.tan);
    const d1 = _b.subVectors(cur, r.pos).dot(r.tan);
    let result = null;
    if (d0 < 0 && d1 >= 0) {
      const t = d0 / (d0 - d1);
      _c.lerpVectors(prev, cur, t);
      result = _c.distanceTo(r.pos) <= RING_RADIUS + 0.5 ? 'pass' : 'miss';
    } else if (d1 > 60) {
      result = 'miss';
    }
    if (result) {
      r.state = result; r.t = 0;
      if (result === 'miss') {
        r.mesh.material.color.set(0xff3030);
        r.mesh.material.emissive.set(0x801010);
      }
      r.mesh.material.transparent = true;
      this.next++;
      this.ensureAhead();
      events.push({ type: result, ring: r });
    }
    return events;
  }

  // Visual animation + cleanup of old rings
  animate(dt, time) {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const m = r.mesh.material;
      if (r.state === 'pending') {
        m.emissiveIntensity = i === this.next ? 1.4 + 0.8 * Math.sin(time * 6) : 0.8;
      } else if (r.mesh.parent) {
        r.t += dt;
        if (r.state === 'pass') {
          const k = r.t / 0.6;
          r.mesh.scale.setScalar(1 + k * 0.8);
          m.opacity = Math.max(0, 1 - k);
          m.emissiveIntensity = 2.0 * (1 - k);
          if (k >= 1) this._removeRing(r);
        } else {
          const k = r.t / 1.5;
          m.opacity = Math.max(0, 1 - k);
          if (k >= 1) this._removeRing(r);
        }
      }
    }
    while (this.rings.length && this.next > 0 && !this.rings[0].mesh.parent) {
      this.rings.shift();
      this.next--;
    }
  }

  // Where to put the plane after a crash: on the approach to the next ring
  respawnPoint() {
    const r = this.rings[this.next];
    if (this.circuit) { // back along the route, so tunnels and canyon walls are never in the way
      const s = this.circuit.wrap(r.s - 160);
      return { pos: this.circuit.pointAt(s), dir: this.circuit.tangentAt(s) };
    }
    const pos = r.pos.clone().addScaledVector(r.tan, -240);
    pos.y = Math.max(pos.y, this.world.solidAt(pos.x, pos.z) + 60);
    const dir = r.pos.clone().sub(pos).normalize();
    return { pos, dir };
  }

  dispose() {
    for (const r of this.rings) this._removeRing(r);
    this.scene.remove(this.group);
    this.geo.dispose(); this.baseMat.dispose();
  }
}
