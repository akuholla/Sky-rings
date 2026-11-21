// Wingtip smoke trails and crash explosion.
import * as THREE from 'three';

function radialTexture(stops) {
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Trail {
  constructor(scene, n = 70, width = 0.15) {
    this.n = n; this.width = width;
    this.pts = [];
    this.acc = 0;
    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(n * 2 * 3);
    this.colArr = new Float32Array(n * 2 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colArr, 4));
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  reset() { this.pts.length = 0; this.geo.setDrawRange(0, 0); }
  update(dt, pos, up, strength) {
    this.acc += dt;
    if (this.acc >= 1 / 40 || !this.pts.length) {
      this.acc = 0;
      const p = this.pts.length >= this.n ? this.pts.pop() : { c: new THREE.Vector3(), u: new THREE.Vector3() };
      p.c.copy(pos); p.u.copy(up);
      this.pts.unshift(p);
    } else {
      this.pts[0].c.copy(pos); this.pts[0].u.copy(up);
    }
    const P = this.posArr, C = this.colArr, w = this.width, m = this.pts.length;
    for (let i = 0; i < m; i++) {
      const { c, u } = this.pts[i];
      const k = i * 6;
      P[k] = c.x + u.x * w; P[k + 1] = c.y + u.y * w; P[k + 2] = c.z + u.z * w;
      P[k + 3] = c.x - u.x * w; P[k + 4] = c.y - u.y * w; P[k + 5] = c.z - u.z * w;
      const a = Math.pow(1 - i / (this.n - 1), 1.6) * strength * Math.min(1, i / 3);
      const q = i * 8;
      C[q] = C[q + 4] = 1.0; C[q + 1] = C[q + 5] = 0.93; C[q + 2] = C[q + 6] = 0.85;
      C[q + 3] = C[q + 7] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, m - 1) * 6);
  }
  dispose(scene) { scene.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); }
}

export class Explosion {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fireTex = radialTexture([[0, 'rgba(255,255,220,1)'], [0.25, 'rgba(255,190,80,0.9)'], [0.6, 'rgba(255,90,20,0.4)'], [1, 'rgba(120,20,0,0)']]);
    this.smokeTex = radialTexture([[0, 'rgba(60,50,50,0.85)'], [0.6, 'rgba(40,35,35,0.4)'], [1, 'rgba(30,30,30,0)']]);
    this.parts = [];
  }
  spawn(pos, vel) {
    const rnd = Math.random;
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.fireTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      const v = new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).normalize().multiplyScalar(6 + rnd() * 22).addScaledVector(vel, 0.12);
      this.group.add(s);
      this.parts.push({ s, v, life: 0, max: 0.8 + rnd() * 0.7, s0: 4, s1: 16 + rnd() * 16, fire: true });
    }
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      const v = new THREE.Vector3(rnd() - 0.5, 0.6 + rnd(), rnd() - 0.5).multiplyScalar(5 + rnd() * 6).addScaledVector(vel, 0.05);
      this.group.add(s);
      this.parts.push({ s, v, life: -rnd() * 0.3, max: 2.5 + rnd() * 2, s0: 6, s1: 35 + rnd() * 25, fire: false });
    }
  }
  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        this.group.remove(p.s); p.s.material.dispose();
        this.parts.splice(i, 1);
        continue;
      }
      if (p.life < 0) { p.s.visible = false; continue; }
      p.s.visible = true;
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k)));
      p.s.material.opacity = p.fire ? Math.pow(1 - k, 1.5) : 0.75 * (1 - k) * Math.min(1, p.life * 4);
    }
  }
}
