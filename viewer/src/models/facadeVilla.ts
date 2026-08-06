import * as THREE from 'three';
import { rng, countGeometry } from '../lib/geometry';
import type { ModelRuntime } from '../lib/types';

/**
 * "FACADE PRINCIPALE" — a small villa, rebuilt in code from a 2D ORTHOGRAPHIC ELEVATION.
 *
 * A THIRD REFERENCE CLASS, AND THE INVERSE OF THE HYDRAULIC CYLINDER
 * The cylinder was the case where one view is nearly COMPLETE — revolving a profile
 * recovers all 360 degrees. An elevation is the opposite extreme: it gives PERFECT X and
 * Y and ZERO Z. Every width and height below is exact to the pixel because the drawing
 * has no perspective at all. Every depth is invented. There is no measurement anywhere
 * in this file for how far the building extends backwards, how deep a reveal is, or how
 * far the canopy projects — because a front elevation cannot contain that information.
 *
 * OBSERVED (deterministic pixel measurement; orthographic, so these are exact ratios):
 *  - Facade 250 x 313 px, constant width at every height — confirms zero convergence.
 *    Left edge x=85, right edge x=335, ground line y=413, parapet top y=100.
 *  - SCALE 0.0312 m/px, fixed independently by TWO references that agree:
 *      garage door   77 px wide  -> 2.40 m (standard single garage)
 *      entrance door 64 px tall  -> 2.00 m (standard door leaf)
 *    Giving a facade of 7.80 m wide x 9.77 m tall. A 3-storey house at ~3.25 m
 *    floor-to-floor, on a 7.8 m urban plot — internally consistent.
 *  - Three tiers of openings, measured from the ground line:
 *      ground   0.00 - 2.00 m   door, strip window, garage
 *      first    4.09 - 5.96 m   two windows in slatted surrounds
 *      second   6.65 - 9.08 m   two windows in slatted surrounds
 *  - Projecting canopy/slab at 2.90 - 3.46 m, stepping across the facade.
 *  - Roof box (stair or tank enclosure) 9.77 - 11.33 m, ~2.18 m wide, set to the left.
 *  - Colours: wall #fefefd, slat cladding #7b595a, slab #f0f0f0, garage #dddddd,
 *    glass #e2e8ec.
 *
 * INVENTED — everything in the third dimension:
 *  - BUILDING DEPTH (12.0 m). Nothing in the drawing constrains it whatsoever.
 *  - Roof form. Flat-with-parapet is inferred from the elevation's flat top plus the
 *    roof box, but a pitched roof behind the parapet would look identical here.
 *  - SIDE AND REAR ELEVATIONS ARE ENTIRELY FABRICATED. Not mirrored from anything —
 *    there is nothing to mirror. The side walls are blank because I have no information,
 *    not because the building is blank.
 *  - Every projection depth: slat fins, window reveals, canopy overhang, door recess.
 *  - The drawing carries an "ArchiZ Design" watermark and is 420x476 px, so fine
 *    linework is at the resolution floor; the slat pitch is approximated, not counted.
 */

// ------------------------------------------------------------------ scale
const M_PER_PX = 0.0312;
const S = (px: number) => px * M_PER_PX;
const X0 = 85, GROUND = 413;                       // reference origins in the drawing
const fx = (px: number) => (px - X0) * M_PER_PX;   // drawing x -> metres from left edge
const fy = (px: number) => (GROUND - px) * M_PER_PX; // drawing y -> metres above ground

export const DIM = {
  W: fx(335), H: fy(100),
  D: 12.0,                    // INVENTED — no information in a front elevation
  wallT: 0.28,
  slatPitch: 0.30, slatH: 0.20, slatProject: 0.09,
  revealDepth: 0.16,
  canopyProject: 1.25,        // INVENTED
} as const;

export const TOTAL_H = fy(50);   // includes the roof box

/** Openings, all measured off the drawing. [x0, x1, y0, y1] in metres. */
const WINDOWS: [number, number, number, number][] = [
  [fx(128), fx(168), fy(180), fy(145)],   // second floor, left
  [fx(253), fx(292), fy(180), fy(145)],   // second floor, right
  [fx(128), fx(168), fy(268), fy(232)],   // first floor, left
  [fx(253), fx(292), fy(268), fy(232)],   // first floor, right
];
/** Slatted cladding zones surrounding each window pair. */
const SLAT_ZONES: [number, number, number, number][] = [
  [fx(105), fx(185), fy(200), fy(122)],
  [fx(232), fx(315), fy(200), fy(122)],
  [fx(105), fx(185), fy(282), fy(222)],
  [fx(232), fx(315), fy(282), fy(222)],
];

const COL = {
  wall: 0xf2f1ee, slat: 0x7b595a, slab: 0xd8d8d6,
  garage: 0xdedede, glass: 0x9fb2bd, frame: 0x3c3f42,
  door: 0xb9bcbe, ground: 0x9aa08d,
};

export function createFacadeVillaModel(
  opts: { context?: boolean; shadows?: boolean } = {},
): THREE.Group {
  const { context = true, shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'FacadeVilla';
  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  const mWall = new THREE.MeshStandardMaterial({ color: COL.wall, roughness: 0.92, envMapIntensity: 0.4 });
  const mSlat = new THREE.MeshStandardMaterial({ color: COL.slat, roughness: 0.78, envMapIntensity: 0.35 });
  const mSlab = new THREE.MeshStandardMaterial({ color: COL.slab, roughness: 0.86, envMapIntensity: 0.4 });
  const mGlass = new THREE.MeshPhysicalMaterial({
    color: COL.glass, roughness: 0.12, metalness: 0.0,
    clearcoat: 0.5, clearcoatRoughness: 0.1, envMapIntensity: 1.0,
  });
  const mFrame = new THREE.MeshStandardMaterial({ color: COL.frame, roughness: 0.5, metalness: 0.3 });
  const mGarage = new THREE.MeshStandardMaterial({ color: COL.garage, roughness: 0.7, metalness: 0.15 });
  const mDoor = new THREE.MeshStandardMaterial({ color: COL.door, roughness: 0.55, metalness: 0.3 });
  const mGround = new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.96 });
  Object.assign(materials, {
    wall: mWall, slat: mSlat, slab: mSlab, glass: mGlass,
    frame: mFrame, garage: mGarage, door: mDoor, ground: mGround,
  });

  // model is centred on the facade so the cameras frame it symmetrically
  const cx = -DIM.W / 2;
  const box = (w: number, hgt: number, d: number, x: number, y: number, z: number,
               m: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), m);
    mesh.position.set(cx + x + w / 2, y + hgt / 2, z + d / 2);
    mesh.name = name;
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    root.add(mesh);
    return mesh;
  };

  // ---------------------------------------------------------------- main mass
  // Depth is INVENTED. The elevation fixes only the facade plane.
  const mass = box(DIM.W, DIM.H, DIM.D, 0, 0, -DIM.D, mWall, 'main-mass');
  nodes['main-mass'] = mass;

  // roof box (stair / tank enclosure), measured position and size, invented depth
  box(S(70), TOTAL_H - DIM.H, 3.2, fx(95), DIM.H, -3.6, mWall, 'roof-box');
  // parapet capping
  box(DIM.W + 0.16, 0.22, DIM.D + 0.16, -0.08, DIM.H, -DIM.D - 0.08, mSlab, 'parapet');

  // ---------------------------------------------------------------- slatted cladding
  // The horizontal slat bands are the facade's strongest motif, so they are REAL FINS,
  // not a texture — the same rule that made the towers' floor rhythm survive.
  const slats = new THREE.Group(); slats.name = 'slat-cladding';
  const inWindow = (x0: number, x1: number, y: number) =>
    WINDOWS.some(([wx0, wx1, wy0, wy1]) =>
      x0 < wx1 - 0.01 && x1 > wx0 + 0.01 && y > wy0 - 0.02 && y < wy1 + 0.02);

  for (const [zx0, zx1, zy0, zy1] of SLAT_ZONES) {
    const n = Math.max(1, Math.round((zy1 - zy0) / DIM.slatPitch));
    for (let i = 0; i < n; i += 1) {
      const y = zy0 + i * DIM.slatPitch;
      if (inWindow(zx0, zx1, y + DIM.slatH / 2)) {
        // slat interrupted by the window: emit the two side returns only
        const win = WINDOWS.find(([wx0, wx1, wy0, wy1]) =>
          zx0 < wx1 && zx1 > wx0 && y + DIM.slatH / 2 > wy0 && y + DIM.slatH / 2 < wy1)!;
        if (win[0] - zx0 > 0.05) {
          slats.add(box(win[0] - zx0, DIM.slatH, DIM.slatProject, zx0, y, 0, mSlat, 'slat'));
        }
        if (zx1 - win[1] > 0.05) {
          slats.add(box(zx1 - win[1], DIM.slatH, DIM.slatProject, win[1], y, 0, mSlat, 'slat'));
        }
      } else {
        slats.add(box(zx1 - zx0, DIM.slatH, DIM.slatProject, zx0, y, 0, mSlat, 'slat'));
      }
    }
  }
  root.add(slats); nodes['slat-cladding'] = slats;

  // ---------------------------------------------------------------- windows
  // Real recessed reveals: the glass sits back behind the wall face so the head and
  // jambs self-shadow, rather than a dark rectangle painted on a flat plane.
  const wins = new THREE.Group(); wins.name = 'windows';
  // NOTE ON DEPTH: the main mass spans z = -D .. 0, so z=0 IS the facade face and
  // anything at negative z is inside the solid. There is no CSG here, so a window
  // cannot be recessed into a hole — it is built PROUD of the face instead, and the
  // reveal is read from the projecting frame rather than a cut opening.
  for (const [x0, x1, y0, y1] of WINDOWS) {
    const w = x1 - x0, hgt = y1 - y0;
    wins.add(box(w, hgt, 0.04, x0, y0, 0.02, mGlass, 'glass'));
    wins.add(box(w + 0.14, 0.11, 0.11, x0 - 0.07, y1, 0.0, mFrame, 'lintel'));
    wins.add(box(w + 0.14, 0.11, 0.11, x0 - 0.07, y0 - 0.11, 0.0, mFrame, 'sill'));
    wins.add(box(0.07, hgt, 0.11, x0 - 0.07, y0, 0.0, mFrame, 'jamb-l'));
    wins.add(box(0.07, hgt, 0.11, x1, y0, 0.0, mFrame, 'jamb-r'));
    wins.add(box(0.05, hgt, 0.07, x0 + w / 2 - 0.025, y0, 0.03, mFrame, 'mullion'));
  }
  root.add(wins); nodes.windows = wins;

  // ---------------------------------------------------------------- canopy / first-floor slab
  const canopy = new THREE.Group(); canopy.name = 'canopy';
  canopy.add(box(DIM.W * 0.62, S(18), DIM.canopyProject, 0, fy(320), 0, mSlab, 'canopy-left'));
  canopy.add(box(DIM.W * 0.46, S(18), DIM.canopyProject * 0.8, DIM.W * 0.54, fy(300), 0, mSlab, 'canopy-right'));
  root.add(canopy); nodes.canopy = canopy;

  // ---------------------------------------------------------------- ground floor
  const gf = new THREE.Group(); gf.name = 'ground-floor';
  // entrance door, recessed
  gf.add(box(fx(125) - fx(90), fy(349), 0.05, fx(90), 0, 0.02, mDoor, 'entrance-door'));
  gf.add(box(fx(125) - fx(90) + 0.14, 0.12, 0.12, fx(90) - 0.07, fy(349), 0.0, mFrame, 'door-head'));
  gf.add(box(0.07, fy(349), 0.12, fx(90) - 0.07, 0, 0.0, mFrame, 'door-jamb-l'));
  gf.add(box(0.07, fy(349), 0.12, fx(125), 0, 0.0, mFrame, 'door-jamb-r'));
  // strip window
  gf.add(box(fx(190) - fx(138), S(22), 0.04, fx(138), fy(392), 0.02, mGlass, 'strip-window'));
  gf.add(box(fx(190) - fx(138) + 0.12, 0.09, 0.11, fx(138) - 0.06, fy(370), 0.0, mFrame, 'strip-head'));
  gf.add(box(fx(190) - fx(138) + 0.12, 0.09, 0.11, fx(138) - 0.06, fy(392) - 0.09, 0.0, mFrame, 'strip-sill'));
  // garage door with a real panel grid
  const gx0 = fx(235), gw = fx(312) - fx(235), gh = fy(349);
  gf.add(box(gw, gh, 0.07, gx0, 0, 0.02, mGarage, 'garage-door'));
  gf.add(box(gw + 0.14, 0.12, 0.13, gx0 - 0.07, gh, 0.0, mFrame, 'garage-head'));
  const cols = 6, rows = 4;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const pw = (gw - 0.14) / cols, ph = (gh - 0.14) / rows;
      gf.add(box(pw * 0.88, ph * 0.82, 0.03, gx0 + 0.07 + c * pw + pw * 0.06,
        0.07 + r * ph + ph * 0.09, 0.09, mFrame, 'garage-panel'));
    }
  }
  root.add(gf); nodes['ground-floor'] = gf;

  // ---------------------------------------------------------------- context
  if (context) {
    const ctx = new THREE.Group(); ctx.name = 'site-context';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), mGround);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ctx.add(ground);
    // neighbouring party walls — an urban plot this narrow is almost certainly attached,
    // but the drawing does not say so. INVENTED.
    const r = rng(4321);
    for (const side of [-1, 1]) {
      const hgt = DIM.H * (0.82 + r() * 0.25);
      const nb = new THREE.Mesh(new THREE.BoxGeometry(7.5, hgt, DIM.D), mWall);
      nb.position.set(side * (DIM.W / 2 + 3.9), hgt / 2, -DIM.D / 2);
      nb.receiveShadow = shadows;
      ctx.add(nb);
    }
    root.add(ctx); nodes['site-context'] = ctx;
  }

  const { meshes, triangles } = countGeometry(root);
  const runtime: ModelRuntime = {
    nodes, materials,
    stats: { floors: 3, heightM: TOTAL_H, meshes, triangles },
  };
  (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime = runtime;
  return root;
}
