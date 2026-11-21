// Billboard-sprite cloud clusters. Ambient clouds recycle ahead of the player;
// "path" clouds are placed across the ring course so you fly through them.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function makePuffTexture() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * S * 0.2;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.8;
    const rad = S * (0.12 + rnd() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Clouds {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tex = makePuffTexture();
    const mk = (color, opacity) => new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, opacity, depthWrite: false });
    this.mats = [mk(0xffd8c0, 0.8), mk(0xe0a088, 0.75), mk(0x7a5560, 0.65)];
    this.list = [];
    this.rnd = mulberry32(77);
  }

  _cluster(x, y, z, R, kind) {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const n = 7 + Math.floor(R / 14);
    for (let i = 0; i < n; i++) {
      const dy = (this.rnd() - 0.5) * R * 0.5;
      const mat = dy > R * 0.08 ? this.mats[0] : dy < -R * 0.1 ? this.mats[2] : this.mats[1];
      const sp = new THREE.Sprite(mat);
      const s = R * (0.6 + this.rnd() * 0.55);
      sp.scale.set(s * 1.5, s, 1);
      sp.position.set((this.rnd() - 0.5) * 1.4 * R, dy, (this.rnd() - 0.5) * 1.4 * R);
      grp.add(sp);
    }
    this.group.add(grp);
    const c = { group: grp, pos: grp.position, R, kind };
    this.list.push(c);
    return c;
  }

  _ambientY(x, z) {
    return Math.max(this.world.surfaceAt(x, z) + 180, 280) + this.rnd() * 650;
  }

  initAmbient(center, count = 36) {
    for (let i = 0; i < count; i++) {
      const a = this.rnd() * Math.PI * 2, d = 300 + this.rnd() * 4800;
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      this._cluster(x, this._ambientY(x, z), z, 120 + this.rnd() * 160, 'ambient');
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

  // Returns how deep inside a cloud the point is (0..1)
  update(pos, fwd) {
    let f = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z, dy = c.pos.y - pos.y;
      const dh = Math.hypot(dx, dz);
      if (c.kind === 'ambient' && dh > 5600) { this._placeAhead(c, pos, fwd); continue; }
      if (c.kind === 'path' && dh > 2500 && dx * fwd.x + dz * fwd.z < 0) {
        this.group.remove(c.group);
        this.list.splice(i, 1);
        continue;
      }
      const e = Math.sqrt((dh / c.R) ** 2 + (dy / (c.R * 0.5)) ** 2);
      if (e < 1) f = Math.max(f, Math.min(1, (1 - e) * 2));
    }
    return f;
  }

  dispose() {
    this.scene.remove(this.group);
    this.mats.forEach((m) => m.dispose());
    this.tex.dispose();
  }
}
