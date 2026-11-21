// Low-poly biplane: coral-red staggered wings with cut tips, yellow faceted fuselage,
// yellow struts, dark engine cowling with a yellow spinner, red two-blade prop,
// red tail surfaces and fixed landing gear with black wheels. Nose points to -Z.
import * as THREE from 'three';

const flat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.0, flatShading: true, ...extra });

// A flat planform (x = span, y = chord) extruded to a thin slab lying in the XZ plane
function slab(points, thickness) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);          // shape y (chord) -> -z, extrusion -> +y
  g.translate(0, -thickness / 2, 0);
  return g;
}

// Planform with chamfered corners
function cutRect(halfSpan, halfChord, cut) {
  return [
    [-halfSpan, -halfChord + cut], [-halfSpan + cut, -halfChord],
    [halfSpan - cut, -halfChord], [halfSpan, -halfChord + cut],
    [halfSpan, halfChord - cut], [halfSpan - cut, halfChord],
    [-halfSpan + cut, halfChord], [-halfSpan, halfChord - cut],
  ];
}

function strut(mat, x, yBottom, yTop, zBottom, zTop, w = 0.12) {
  const len = Math.hypot(yTop - yBottom, zTop - zBottom);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
  m.position.set(x, (yBottom + yTop) / 2, (zBottom + zTop) / 2);
  m.rotation.x = Math.atan2(zTop - zBottom, yTop - yBottom); // lean with the wing stagger
  return m;
}

// Default livery = the player's red/yellow biplane. Enemies pass their own colours.
export const PLAYER_LIVERY = { wing: 0xe0483a, wingLight: 0xf26a55, body: 0xf2bf4a, prop: 0xe0483a };

export function buildAircraft(livery = PLAYER_LIVERY) {
  const g = new THREE.Group();
  const red = flat(livery.wing);
  const redLight = flat(livery.wingLight);
  const yellow = flat(livery.body);
  const dark = flat(0x2c2c33, { roughness: 0.5, metalness: 0.3 });
  const black = flat(0x18181b);

  const SPAN = 5.2;                 // half span
  const LOWER = { y: -0.55, z: -0.5 };
  const UPPER = { y: 1.35, z: -0.85 }; // staggered forward

  // --- fuselage: 8-sided tapered body, wide at the engine, narrow at the tail ---
  const fus = new THREE.CylinderGeometry(0.9, 0.32, 5.7, 8, 1);
  fus.rotateY(Math.PI / 8);          // flat top and sides
  fus.rotateX(-Math.PI / 2);         // radiusTop (wide end) -> -Z (front)
  fus.translate(0, 0.1, 0.8);
  g.add(new THREE.Mesh(fus, yellow));

  // cockpit opening
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.9), dark);
  cockpit.position.set(0, 0.95, 0.5);
  g.add(cockpit);

  // --- engine cowling + spinner ---
  const cowl = new THREE.CylinderGeometry(0.97, 0.92, 0.7, 8, 1);
  cowl.rotateY(Math.PI / 8);
  cowl.rotateX(-Math.PI / 2);
  const cowling = new THREE.Mesh(cowl, yellow);
  cowling.position.set(0, 0.1, -2.35);
  g.add(cowling);
  const engineFace = new THREE.CylinderGeometry(0.7, 0.7, 0.12, 8, 1);
  engineFace.rotateY(Math.PI / 8);
  engineFace.rotateX(-Math.PI / 2);
  const face = new THREE.Mesh(engineFace, dark);
  face.position.set(0, 0.1, -2.72);
  g.add(face);
  const spinGeo = new THREE.ConeGeometry(0.34, 0.7, 8);
  spinGeo.rotateX(-Math.PI / 2);     // apex -> -Z
  const spinner = new THREE.Mesh(spinGeo, yellow);
  spinner.position.set(0, 0.1, -3.1);
  g.add(spinner);

  // --- propeller: two tapered red blades + faint blur disc ---
  const propeller = new THREE.Group();
  propeller.position.set(0, 0.1, -2.95);
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.45, 0.07), red);
    blade.position.y = s * 0.78;
    blade.rotation.y = s * 0.25;     // a bit of pitch
    blade.scale.x = 1;
    propeller.add(blade);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 24),
    new THREE.MeshBasicMaterial({ color: livery.prop, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
  );
  propeller.add(disc);
  g.add(propeller);

  // --- wings: two staggered slabs with chamfered tips and a lighter centre band ---
  const wingGeo = slab(cutRect(SPAN, 0.8, 0.45), 0.2);
  const lowerWing = new THREE.Mesh(wingGeo, red);
  lowerWing.position.set(0, LOWER.y, LOWER.z);
  const upperWing = new THREE.Mesh(wingGeo, red);
  upperWing.position.set(0, UPPER.y, UPPER.z);
  g.add(lowerWing, upperWing);
  const bandGeo = new THREE.BoxGeometry(SPAN * 2 - 1.0, 0.02, 0.55);
  for (const w of [LOWER, UPPER]) {
    const band = new THREE.Mesh(bandGeo, redLight);
    band.position.set(0, w.y + 0.11, w.z - 0.05);
    g.add(band);
  }

  // --- interplane struts (yellow), two per side, plus cabane struts to the fuselage ---
  const strutY0 = LOWER.y + 0.1, strutY1 = UPPER.y - 0.1;
  for (const s of [-1, 1]) {
    for (const dz of [-0.45, 0.35]) {
      g.add(strut(yellow, s * 3.7, strutY0, strutY1, LOWER.z + dz, UPPER.z + dz));
    }
    g.add(strut(yellow, s * 0.55, 0.85, strutY1, -0.9, UPPER.z - 0.2, 0.1));
    g.add(strut(yellow, s * 0.55, 0.85, strutY1, -0.1, UPPER.z + 0.4, 0.1));
  }

  // --- tail: horizontal stabiliser + swept fin (red) ---
  const stab = new THREE.Mesh(slab(cutRect(1.8, 0.5, 0.3), 0.12), red);
  stab.position.set(0, 0.2, 3.65);
  g.add(stab);
  const finShape = new THREE.Shape([
    [3.0, 0.3], [4.25, 0.3], [4.2, 1.15], [3.95, 1.85], [3.55, 1.85],
  ].map(([x, y]) => new THREE.Vector2(x, y)));
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);      // shape x -> +z, thickness along x
  finGeo.translate(0.06, 0, 0);
  g.add(new THREE.Mesh(finGeo, red));

  // --- landing gear: yellow V legs, axle, black wheels, tail skid ---
  const wheelY = -1.65, wheelZ = -1.05;
  for (const s of [-1, 1]) {
    g.add(strut(yellow, s * 0.75, wheelY, -0.35, wheelZ, -1.6, 0.1));
    g.add(strut(yellow, s * 0.75, wheelY, -0.35, wheelZ, -0.4, 0.1));
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.26, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(wheelGeo, black);
    wheel.position.set(s * 0.95, wheelY, wheelZ);
    g.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 6).rotateZ(Math.PI / 2), yellow);
    hub.position.copy(wheel.position);
    g.add(hub);
  }
  const axle = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), yellow);
  axle.position.set(0, wheelY, wheelZ);
  g.add(axle);
  g.add(strut(dark, 0, -0.35, 0.0, 4.2, 3.8, 0.08));

  // --- navigation lights: red left / green right on the upper wingtips, white tail strobe ---
  const navGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const mkLight = (r, gg, b, x, y, z) => {
    const m = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(r, gg, b) }));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  mkLight(6, 0.3, 0.2, -SPAN - 0.05, UPPER.y, UPPER.z);
  mkLight(0.2, 6, 0.6, SPAN + 0.05, UPPER.y, UPPER.z);
  const strobe = mkLight(8, 8, 8, 0, 1.95, 3.75);

  return {
    group: g,
    propeller,
    strobe,
    halfSpan: SPAN,
    gearDepth: -wheelY + 0.42,       // how far the wheels hang below the centre
    tips: [new THREE.Vector3(-SPAN, UPPER.y, UPPER.z), new THREE.Vector3(SPAN, UPPER.y, UPPER.z)],
  };
}
