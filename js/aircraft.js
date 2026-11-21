// Low-poly red-orange propeller aircraft built from primitives. Nose points to -Z.
import * as THREE from 'three';

export function buildAircraft() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a1a, roughness: 0.42, metalness: 0.25, side: THREE.DoubleSide });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.5, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.6, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x10202e, roughness: 0.06, metalness: 0.9 });

  // Fuselage: lathe profile (radius, length) rotated so its axis is along Z
  const prof = [[0.0, 0], [0.5, 0.05], [0.72, 0.45], [0.8, 1.4], [0.78, 2.8], [0.66, 4.4], [0.45, 6.2], [0.24, 8.0], [0.12, 8.6], [0.0, 8.62]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const fusGeo = new THREE.LatheGeometry(prof, 20);
  fusGeo.rotateX(Math.PI / 2);
  fusGeo.translate(0, 0, -3.2);
  g.add(new THREE.Mesh(fusGeo, red));

  // White stripe around the fuselage
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.71, 0.69, 0.35, 20, 1, true), white);
  band.rotation.x = Math.PI / 2; band.position.z = 1.4;
  g.add(band);

  // Spinner + propeller
  const spinGeo = new THREE.ConeGeometry(0.4, 0.8, 16);
  spinGeo.rotateX(-Math.PI / 2);
  const spinner = new THREE.Mesh(spinGeo, white);
  spinner.position.z = -3.55;
  g.add(spinner);

  const propeller = new THREE.Group();
  propeller.position.z = -3.3;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.05), dark);
  propeller.add(blade);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  );
  propeller.add(disc);
  g.add(propeller);

  // Wings with slight dihedral and white tips
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(0, -0.45, -0.4);
    wing.rotation.z = s * 0.06;
    const w = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.2, 1.8), red);
    w.position.x = s * 2.7;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 1.8), white);
    tip.position.x = s * 5.7;
    wing.add(w, tip);
    g.add(wing);
  }

  // Tailplane and fin
  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.9), red);
  tail.position.set(0, 0.1, 4.7);
  g.add(tail);
  for (const s of [-1, 1]) {
    const tt = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.9), white);
    tt.position.set(s * 1.9, 0.1, 4.7);
    g.add(tt);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 1.2), red);
  fin.position.set(0, 0.9, 4.9); fin.rotation.x = -0.28;
  g.add(fin);
  const finTop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 1.0), white);
  finTop.position.set(0, 1.62, 5.15); finTop.rotation.x = -0.28;
  g.add(finTop);

  // Canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), glass);
  canopy.scale.set(0.9, 0.75, 2.0);
  canopy.position.set(0, 0.62, -0.4);
  g.add(canopy);

  return {
    group: g,
    propeller,
    tips: [new THREE.Vector3(-5.9, -0.1, -0.2), new THREE.Vector3(5.9, -0.1, -0.2)],
  };
}
