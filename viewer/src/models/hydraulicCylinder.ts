import * as THREE from 'three';
import { rng, countGeometry } from '../lib/geometry';
import type { ModelRuntime } from '../lib/types';

/**
 * BOLTED HYDRAULIC CYLINDER — rebuilt in code from one CAD render.
 *
 * WHY THIS SUBJECT IS DIFFERENT FROM THE FIVE BUILDINGS
 * A solid of revolution is the one case where a single view is NEARLY COMPLETE. Every
 * building in this repo has an invented rear elevation; here the body is fully
 * determined by its silhouette, because revolving a measured profile reproduces all
 * 360 degrees exactly. Only the genuinely asymmetric features (port bosses, the
 * angular clocking of the bolt circle, the far side of each eye) are inferred.
 *
 * OBSERVED (deterministic pixel measurement):
 *  - Principal axis at -29.90 deg from image +x, solved by image moments over
 *    313,009 part pixels. Projected length 1969 px, max width 339 px -> 5.80:1.
 *  - Radius profile sampled perpendicular to that axis at 10 px stations. For an
 *    orthographic view the silhouette half-width of a cylinder IS its true radius at
 *    any axis tilt, so THESE RADII ARE EXACT (in projected px):
 *      chrome rod      r =  67 px, dead constant over t = -745..-490
 *      gland flange    r = 170 px (the widest point on the part)
 *      orange barrel   r = 128 px, constant over t = -140..+540
 *      cap flange      r = 151 px
 *      eye housings    r = 153 px
 *  - Component boundaries from step detection on that profile, with colour sampled at
 *    each: blue eye #2946d0 / #091337, steel #817c76, orange barrel #7a3e04.
 *  - Bolt circle on the gland flange: 12 hex heads, counted at 4x magnification.
 *
 * INFERRED / NOT RECOVERABLE:
 *  - AXIAL FORESHORTENING IS UNRESOLVED. A CAD view compresses lengths along the axis
 *    by an unknown factor while leaving radii exact, and that factor cannot be
 *    separated from the part's true aspect ratio using the silhouette alone. The
 *    rod-eye bearing bore measures 376.3 px along the axis by 315.8 px across
 *    (ratio 1.192), which suggests the real part is up to ~19% stubbier than the
 *    projected 5.80:1. This model is built at the PROJECTED proportions and is
 *    therefore up to 19% too slender. Confidence 0.5.
 *  - ABSOLUTE SCALE is set by choosing a 160 mm barrel OD, a common size for this
 *    proportion. Nothing in the image fixes it — there is no scale reference.
 *  - Internals (piston, seals, gland packing) are not visible and are not modelled.
 *  - Port boss clocking and the far side of each eye are mirrored from the visible side.
 */

// ------------------------------------------------------------------ scale
const MM_PER_PX = 0.625;                 // 160 mm barrel OD / (2 x 128 px)
const S = (px: number) => px * MM_PER_PX;

export const DIM = {
  rodR: S(67), barrelR: S(128), glandR: S(170), capFlangeR: S(151), eyeR: S(153),
  eyeThick: S(96),
  boltCount: 12,
  boltCircleR: S(140),
  segments: 96,
} as const;

/**
 * Axial stations in mm. The profile scan ran t = -1000 .. +880 along the solved axis,
 * so image position maps to model position as y_px = t + 1000. Getting that offset
 * wrong collapses the rod to a stub and pulls both eyes into the barrel.
 */
const Y = {
  rodEyeCentre: S(100),                      // t = -900
  rodStart: S(255), rodEnd: S(510),          // t = -745 .. -490, r constant at 67 px
  glandRamp: S(520), glandFace: S(620), glandBack: S(700),
  blueBandA: S(740), blueBandB: S(820),
  barrelStart: S(860), barrelEnd: S(1540),   // t = -140 .. +540, r constant at 128 px
  capBandA: S(1560), capBandB: S(1600),
  capFlangeA: S(1600), capFlangeB: S(1720),
  capEyeCentre: S(1800),                     // t = +800
};
export const TOTAL_H = S(1880);

// ------------------------------------------------------------------ palette (reference-sampled)
const COL = {
  blue: 0x1d3fb8, blueDark: 0x0d1c5e,
  orange: 0xc8710a, orangeDark: 0x7a3e04,
  steel: 0x8c8983, steelDark: 0x5f5b58,
  chrome: 0xc6cad0,
  bearing: 0x3a3a3c,
};

/** Revolve a [radius, y] polyline about +Y. */
function revolve(profile: [number, number][], segments = DIM.segments): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), segments,
  );
}

export function createHydraulicCylinderModel(
  opts: { context?: boolean; shadows?: boolean } = {},
): THREE.Group {
  const { shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'BoltedHydraulicCylinder';
  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  const mBlue = new THREE.MeshPhysicalMaterial({
    color: COL.blue, roughness: 0.22, metalness: 0.10,
    clearcoat: 0.85, clearcoatRoughness: 0.12, envMapIntensity: 0.9,
  });
  const mOrange = new THREE.MeshPhysicalMaterial({
    color: COL.orange, roughness: 0.24, metalness: 0.08,
    clearcoat: 0.80, clearcoatRoughness: 0.14, envMapIntensity: 0.9,
  });
  // A CAD render shows machined steel as mid-grey with soft gradients, NOT as a mirror.
  // metalness 1.0 gives a material with no diffuse term at all: lit only by whatever the
  // environment reflects, and a smooth sky gradient reflects almost nothing, so the rod
  // and every flange rendered flat black. Dial metalness well down for this look.
  const mSteel = new THREE.MeshStandardMaterial({
    color: 0xa9a7a2, roughness: 0.33, metalness: 0.42, envMapIntensity: 1.5,
  });
  const mChrome = new THREE.MeshStandardMaterial({
    color: 0xd6dade, roughness: 0.14, metalness: 0.58, envMapIntensity: 1.7,
  });
  const mBearing = new THREE.MeshStandardMaterial({
    color: 0x5b5b5f, roughness: 0.52, metalness: 0.35, envMapIntensity: 1.1,
  });
  Object.assign(materials, {
    blue: mBlue, orange: mOrange, steel: mSteel, chrome: mChrome, bearing: mBearing,
  });

  const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    root.add(mesh); nodes[name] = mesh;
    return mesh;
  };

  // ---------------------------------------------------------------- chrome rod
  add(revolve([
    [0, Y.rodStart - S(12)], [DIM.rodR * 0.72, Y.rodStart - S(12)],
    [DIM.rodR, Y.rodStart], [DIM.rodR, Y.rodEnd],
  ]), mChrome, 'piston-rod');

  // ---------------------------------------------------------------- gland / head flange
  // Flat annular front face at Y.glandRamp, then a full-radius cylinder. The first pass
  // ramped straight from rod to flange radius, which left no face for the bolt ring to
  // sit on and swallowed all twelve heads inside the solid.
  add(revolve([
    [DIM.rodR, Y.rodEnd], [DIM.rodR * 1.24, Y.rodEnd],
    [DIM.rodR * 1.24, Y.glandRamp],
    [DIM.glandR, Y.glandRamp],                 // flat annular bolting face
    [DIM.glandR, Y.glandFace],
    [DIM.glandR * 0.99, Y.glandBack],
    [DIM.barrelR * 1.06, Y.glandBack + S(8)],
  ]), mSteel, 'gland-flange');

  // blue collar between gland and barrel
  add(revolve([
    [DIM.barrelR * 1.06, Y.blueBandA], [DIM.barrelR * 1.10, Y.blueBandA + S(6)],
    [DIM.barrelR * 1.10, Y.blueBandB - S(6)], [DIM.barrelR * 1.02, Y.blueBandB],
  ]), mBlue, 'gland-collar');

  // ---------------------------------------------------------------- barrel
  add(revolve([
    [DIM.barrelR, Y.barrelStart], [DIM.barrelR, Y.barrelEnd],
  ]), mOrange, 'barrel');

  // ---------------------------------------------------------------- cap end
  add(revolve([
    [DIM.barrelR * 1.02, Y.capBandA], [DIM.barrelR * 1.10, Y.capBandA + S(6)],
    [DIM.barrelR * 1.10, Y.capBandB - S(6)], [DIM.barrelR * 1.06, Y.capBandB],
  ]), mBlue, 'cap-collar');

  add(revolve([
    [DIM.barrelR * 1.06, Y.capBandB], [DIM.capFlangeR, Y.capFlangeA],
    [DIM.capFlangeR, Y.capFlangeB], [DIM.capFlangeR * 0.62, Y.capFlangeB + S(14)],
    [0, Y.capFlangeB + S(14)],
  ]), mSteel, 'cap-flange');

  // ---------------------------------------------------------------- bolt circle (real geometry)
  // 12 hex heads counted at 4x magnification. The bolt ring is the part's signature —
  // it is modelled, never textured.
  const boltGroup = new THREE.Group(); boltGroup.name = 'bolt-circle';
  const headG = new THREE.CylinderGeometry(S(17), S(17), S(16), 6);
  const shankG = new THREE.CylinderGeometry(S(8), S(8), S(20), 12);
  const heads = new THREE.InstancedMesh(headG, mSteel, DIM.boltCount);
  const shanks = new THREE.InstancedMesh(shankG, mSteel, DIM.boltCount);
  const d = new THREE.Object3D();
  for (let i = 0; i < DIM.boltCount; i += 1) {
    const a = (i / DIM.boltCount) * Math.PI * 2;
    const x = Math.cos(a) * DIM.boltCircleR, z = Math.sin(a) * DIM.boltCircleR;
    // heads stand PROUD of the bolting face, shanks run back into the flange
    d.position.set(x, Y.glandRamp - S(7), z); d.rotation.set(0, a, 0); d.updateMatrix();
    heads.setMatrixAt(i, d.matrix);
    d.position.set(x, Y.glandRamp + S(8), z); d.updateMatrix();
    shanks.setMatrixAt(i, d.matrix);
  }
  heads.castShadow = shadows; shanks.castShadow = shadows;
  boltGroup.add(heads, shanks);
  root.add(boltGroup); nodes['bolt-circle'] = boltGroup;

  // ---------------------------------------------------------------- port bosses
  // Raised bored bosses on both flanges. Their clocking is INFERRED — only the
  // near-side boss is visible in the reference.
  const portGroup = new THREE.Group(); portGroup.name = 'ports';
  for (const [py, pr] of [[Y.glandBack - S(22), DIM.glandR], [Y.capFlangeA + S(24), DIM.capFlangeR]]) {
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(S(30), S(34), S(30), 24), mSteel);
    boss.rotation.z = Math.PI / 2;
    boss.position.set(0, py, pr * 0.86);
    boss.rotation.y = Math.PI / 2;
    const bore = new THREE.Mesh(new THREE.TorusGeometry(S(19), S(5), 8, 24), mSteel);
    bore.position.set(0, py, pr * 0.86 + S(15));
    portGroup.add(boss, bore);
  }
  portGroup.traverse((o: THREE.Object3D) => { (o as THREE.Mesh).castShadow = shadows; });
  root.add(portGroup); nodes.ports = portGroup;

  // ---------------------------------------------------------------- rod / cap eyes
  // Flat disc housings whose bore axis runs PERPENDICULAR to the cylinder axis. They
  // are not part of the revolve — treating them as such turns each into a sphere.
  function eye(yc: number, name: string) {
    const g = new THREE.Group(); g.name = name;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(DIM.eyeR, DIM.eyeR, DIM.eyeThick, 48, 1, false), mBlue,
    );
    body.rotation.x = Math.PI / 2;
    body.position.y = yc;
    // bearing outer race, inner race and bore, each a real ring
    const outer = new THREE.Mesh(new THREE.TorusGeometry(DIM.eyeR * 0.58, DIM.eyeR * 0.10, 10, 44), mBearing);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(DIM.eyeR * 0.40, DIM.eyeR * 0.40, DIM.eyeThick * 1.06, 40, 1, true), mSteel);
    inner.rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.RingGeometry(DIM.eyeR * 0.40, DIM.eyeR * 0.56, 44), mSteel);
    outer.position.y = yc; inner.position.y = yc;
    face.position.set(0, yc, DIM.eyeThick / 2 + 0.4);
    const faceB = face.clone(); faceB.position.z = -(DIM.eyeThick / 2 + 0.4); faceB.rotation.y = Math.PI;
    // grease nipple boss, visible on both eyes in the reference
    const nip = new THREE.Mesh(new THREE.CylinderGeometry(S(14), S(16), S(16), 16), mBlue);
    nip.rotation.z = Math.PI / 2;
    nip.position.set(-DIM.eyeR * 0.82, yc, 0);
    g.add(body, outer, inner, face, faceB, nip);
    g.traverse((o: THREE.Object3D) => {
      (o as THREE.Mesh).castShadow = shadows; (o as THREE.Mesh).receiveShadow = shadows;
    });
    root.add(g); nodes[name] = g;
  }
  eye(Y.rodEyeCentre, 'rod-eye');
  eye(Y.capEyeCentre, 'cap-eye');

  // Lay the part along its own axis and CENTRE it on the origin. The profile is
  // revolved about +Y from y=0 upward, so without the shift the group's origin sits at
  // one end and every camera in the scene frames the cap eye instead of the assembly.
  root.rotation.z = Math.PI / 2;
  root.position.x = TOTAL_H / 2;

  const _unused = rng(1);
  void _unused;
  const { meshes, triangles } = countGeometry(root);
  const runtime: ModelRuntime = {
    nodes, materials,
    stats: { floors: 0, heightM: TOTAL_H / 1000, meshes, triangles },
  };
  (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime = runtime;
  return root;
}
