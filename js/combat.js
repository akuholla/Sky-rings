// Combat: player lasers, enemy biplanes (head-on and same-direction) and hot-air
// balloons. Enemies are placed relative to the upcoming ring course so they show up
// where you are flying. Lasers are swept-segment tested against enemy spheres.
import * as THREE from 'three';
import { buildAircraft } from './aircraft.js';

const ENEMY_LIVERY = { wing: 0x3a3f4b, wingLight: 0x565c70, body: 0x23262e, prop: 0x3a3f4b };
const BALLOON_COLORS = [
  [0xe8483a, 0xf6c84c], [0x2f6fd6, 0xf2f2ee], [0x8a3fc2, 0xff9a3a],
  [0x2e9e6a, 0xf3e6c4], [0xe8483a, 0xf2f2ee], [0xf6c84c, 0x2f6fd6],
];

const MAX_BOLTS = 80;
const BOLT_SPEED = 650;      // m/s on top of the plane's speed
const BOLT_LIFE = 1.3;       // s (~950 m range)
const FIRE_INTERVAL = 0.09;  // s between shots (alternating guns)
const GUNS = [new THREE.Vector3(-2.1, 0.35, -1.6), new THREE.Vector3(2.1, 0.35, -1.6)];

const POINTS = { balloon: 150, plane: 300 };

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, -1);

// distance from point p to segment a-b
function segDist(p, a, b) {
  _v.subVectors(b, a);
  const l2 = _v.lengthSq();
  let t = l2 > 0 ? _w.subVectors(p, a).dot(_v) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return _w.copy(a).addScaledVector(_v, t).distanceTo(p);
}

function buildBalloon(colors) {
  const g = new THREE.Group();
  // teardrop envelope via lathe, coloured in alternating vertical gores
  const prof = [[1.3, -10], [4.2, -7.5], [7.6, -3], [9, 1], [8.3, 5.5], [5.6, 8.6], [0.01, 10.2]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  let env = new THREE.LatheGeometry(prof, 12).toNonIndexed();
  const pos = env.attributes.position, col = new Float32Array(pos.count * 3);
  const ca = new THREE.Color(colors[0]), cb = new THREE.Color(colors[1]);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const sector = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12) % 12;
    const c = sector % 2 ? ca : cb;
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  env.setAttribute('color', new THREE.BufferAttribute(col, 3));
  env.computeVertexNormals();
  const envMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(env, envMat));

  const wicker = new THREE.MeshStandardMaterial({ color: 0x7a5432, flatShading: true, roughness: 0.9 });
  const basket = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), wicker);
  basket.position.y = -14.2;
  g.add(basket);
  const ropeGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.1, -13.4, -1.1), new THREE.Vector3(-1.2, -10, -1.2),
    new THREE.Vector3(1.1, -13.4, -1.1), new THREE.Vector3(1.2, -10, -1.2),
    new THREE.Vector3(-1.1, -13.4, 1.1), new THREE.Vector3(-1.2, -10, 1.2),
    new THREE.Vector3(1.1, -13.4, 1.1), new THREE.Vector3(1.2, -10, 1.2),
  ]);
  g.add(new THREE.LineSegments(ropeGeo, new THREE.LineBasicMaterial({ color: 0x3a2a1c })));
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.5) }));
  flame.position.y = -11.6;
  g.add(flame);
  return { group: g, flame, mats: [envMat, wicker] };
}

export class Combat {
  constructor(scene, explosion, sound) {
    this.scene = scene; this.explosion = explosion; this.sound = sound;
    this.enabled = true;
    this.group = new THREE.Group();
    scene.add(this.group);

    // laser bolt pool
    this.boltGeo = new THREE.BoxGeometry(0.5, 0.5, 16);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 4.5, 5.5) });
    this.bolts = [];
    for (let i = 0; i < MAX_BOLTS; i++) {
      const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.bolts.push({ mesh, pos: mesh.position, prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, alive: false });
    }
    this.fireT = 0; this.gun = 0;
    this.enemies = [];
    this.t = 0;
  }

  reset(world, course) {
    this.world = world; this.course = course;
    for (const e of this.enemies) this._removeEnemy(e);
    this.enemies = [];
    for (const b of this.bolts) { b.alive = false; b.mesh.visible = false; }
    this.spawnT = 3;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      for (const e of this.enemies) this._removeEnemy(e);
      this.enemies = [];
      for (const b of this.bolts) { b.alive = false; b.mesh.visible = false; }
    }
  }

  // remove enemies close to a point (used when respawning after a crash)
  clearNear(p, r) {
    for (const e of [...this.enemies]) if (e.pos.distanceTo(p) < r) this._removeEnemy(e);
  }

  counts() {
    const c = { balloon: 0, head: 0, same: 0 };
    for (const e of this.enemies) c[e.kind === 'balloon' ? 'balloon' : e.mode]++;
    return c;
  }

  // ---------------------------------------------------------------- spawning
  _ring(k) { return this.course.rings[this.course.next + k] || null; }

  _spawnPlane(mode) {
    const r = this._ring(mode === 'head' ? 6 : 3);
    if (!r) return;
    const side = new THREE.Vector3(-r.tan.z, 0, r.tan.x).normalize();
    const sgn = Math.random() < 0.5 ? -1 : 1;
    const pos = r.pos.clone()
      .addScaledVector(side, sgn * (mode === 'head' ? 30 + Math.random() * 80 : 25 + Math.random() * 45))
      .add(new THREE.Vector3(0, (mode === 'head' ? -5 : 10) + Math.random() * 25, 0));
    let vel;
    if (mode === 'head') {
      // fly back along the course, aimed to pass beside the player
      const aim = this.player.pos.clone().addScaledVector(side, sgn * 35);
      vel = aim.sub(pos).normalize().multiplyScalar(75);
    } else {
      vel = r.tan.clone().multiplyScalar(46); // slower: you catch up from behind
    }
    const model = buildAircraft(ENEMY_LIVERY);
    model.group.position.copy(pos);
    this.group.add(model.group);
    const mats = [];
    model.group.traverse((o) => { if (o.material && o.material.isMeshStandardMaterial) mats.push(o.material); });
    this.enemies.push({
      kind: 'plane', mode, model, group: model.group, pos: model.group.position, vel,
      hp: 2, radius: 6, flashT: 0, mats, ph: Math.random() * 6,
    });
  }

  _spawnBalloon() {
    const r = this._ring(3 + Math.floor(Math.random() * 5));
    if (!r) return;
    const side = new THREE.Vector3(-r.tan.z, 0, r.tan.x).normalize();
    const sgn = Math.random() < 0.5 ? -1 : 1;
    const pos = r.pos.clone().addScaledVector(side, sgn * (35 + Math.random() * 90))
      .add(new THREE.Vector3(0, -10 + Math.random() * 50, 0))
      .addScaledVector(r.tan, (Math.random() - 0.5) * 120);
    const floor = this.world.solidAt(pos.x, pos.z) + 30;
    if (pos.y < floor) pos.y = floor;
    const b = buildBalloon(BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)]);
    b.group.position.copy(pos);
    b.group.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(b.group);
    this.enemies.push({
      kind: 'balloon', model: b, group: b.group, pos: b.group.position,
      vel: new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3),
      hp: 1, radius: 10, flashT: 0, mats: b.mats, ph: Math.random() * 6, baseY: pos.y,
    });
  }

  _removeEnemy(e) {
    this.group.remove(e.group);
    e.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  _fire(flight, plane) {
    const b = this.bolts.find((x) => !x.alive);
    if (!b) return;
    _v.copy(GUNS[this.gun]);
    this.gun = 1 - this.gun;
    plane.group.localToWorld(_v);
    b.pos.copy(_v); b.prev.copy(_v);
    b.vel.copy(flight.forward).multiplyScalar(BOLT_SPEED).add(flight.vel);
    b.mesh.quaternion.copy(flight.quat);
    b.life = BOLT_LIFE; b.alive = true; b.mesh.visible = true;
    if (this.sound) this.sound.laser();
  }

  _hit(e, events) {
    e.hp--;
    if (e.hp > 0) { e.flashT = 0.12; if (this.sound) this.sound.hit(); return; }
    this.explosion.spawn(e.pos, e.vel);
    if (e.kind === 'balloon') this.explosion.spawn(e.pos.clone().add(new THREE.Vector3(0, -6, 0)), e.vel);
    if (this.sound) this.sound.boom(0.8);
    events.push({ type: 'kill', kind: e.kind, points: POINTS[e.kind], pos: e.pos.clone() });
    this._removeEnemy(e);
  }

  // ---------------------------------------------------------------- update
  update(dt, { flight, plane, firing, active }) {
    const events = [];
    if (!this.enabled || !this.world) return events;
    this.t += dt;
    this.player = flight;

    // spawn
    if (active) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 2.2 + Math.random() * 2.3;
        const c = this.counts();
        const options = [];
        if (c.balloon < 4) options.push('balloon', 'balloon');
        if (c.head < 2) options.push('head');
        if (c.same < 2) options.push('same');
        const pick = options[Math.floor(Math.random() * options.length)];
        if (pick === 'balloon') this._spawnBalloon();
        else if (pick) this._spawnPlane(pick);
      }
    }

    // fire
    this.fireT -= dt;
    if (active && firing && this.fireT <= 0) {
      this._fire(flight, plane);
      this.fireT = FIRE_INTERVAL;
    }

    // move enemies
    for (const e of [...this.enemies]) {
      if (e.kind === 'plane') {
        e.pos.addScaledVector(e.vel, dt);
        const floor = this.world.solidAt(e.pos.x, e.pos.z) + 35;
        if (e.pos.y < floor) e.pos.y += (floor - e.pos.y) * Math.min(1, dt * 2);
        _m.lookAt(new THREE.Vector3(), e.vel, UP);
        e.group.quaternion.setFromRotationMatrix(_m);
        _q.setFromAxisAngle(FWD, Math.sin(this.t * 0.9 + e.ph) * 0.25);
        e.group.quaternion.multiply(_q);
        e.model.propeller.rotation.z += dt * 50;
      } else {
        e.pos.addScaledVector(e.vel, dt);
        e.pos.y = e.baseY + Math.sin(this.t * 0.5 + e.ph) * 2.5;
        e.model.flame.scale.setScalar(0.7 + Math.random() * 0.6);
      }
      if (e.flashT > 0) {
        e.flashT -= dt;
        const k = e.flashT > 0 ? 1 : 0;
        for (const m of e.mats) { m.emissive.setRGB(k, k, k); }
      }
      // despawn far away or well behind
      _v.subVectors(e.pos, flight.pos);
      if (_v.length() > 3500 || _v.dot(flight.forward) < -600) { this._removeEnemy(e); continue; }
      // player collision
      if (active && _v.length() < e.radius * 0.8 + 3) events.push({ type: 'collide', enemy: e });
    }

    // move bolts + hit test
    for (const b of this.bolts) {
      if (!b.alive) continue;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0 || b.pos.y < this.world.solidAt(b.pos.x, b.pos.z);
      if (!dead) {
        for (const e of this.enemies) {
          if (segDist(e.pos, b.prev, b.pos) < e.radius) { this._hit(e, events); dead = true; break; }
        }
      }
      if (dead) { b.alive = false; b.mesh.visible = false; }
    }
    return events;
  }
}
