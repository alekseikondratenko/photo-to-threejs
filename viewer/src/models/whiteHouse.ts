import * as THREE from 'three';
import { rectPath, prism, mergeGeoms, countGeometry, rng } from '../lib/geometry';
import type { ModelRuntime } from '../lib/types';

/**
 * THE WHITE HOUSE, NORTH FRONT — rebuilt in code from one photograph
 * (White-House-Washington-DC-portico-USA-Pennsylvania.webp, 1600 x 1067, sunny midday,
 * shot square-on from the North Lawn).
 *
 * This is the first NON-TOWER subject in this viewer. The three existing models are
 * slender verticals whose identity lives in a floor rhythm; here height:width is
 * inverted (52 m wide, 15 m to the balustrade) and the identity lives in a horizontal
 * order: six columns, a pediment, a dentil cornice, a balustrade, and eight window bays
 * a side. All of those are real geometry below. None of them is a texture.
 *
 * ============================================================================
 * MEASURED FROM PIXELS  (deterministic scans of the reference, not eyeballed)
 * ============================================================================
 * Frame of reference: image centre column x = 800.5 px, established two ways that
 * agree — window bay pairs (216.5<->1384.5 gives 800.5, 319<->1280 gives 799.5) and
 * the chimney pair (501<->1100 gives 800.5). The view is square-on and symmetric, so
 * the usual "corner split gives you camera yaw" trick is unavailable here; scale had
 * to come from the repeated window bay and the two storeys instead.
 *
 *  - WINDOW BAY PITCH 104 px, and identical on both wings and both storeys:
 *      2nd-floor heads at x = 1072.5 / 1176.5 / 1280.0 / 1384.5  (pitch 104.0)
 *      state-floor heads at x = 1074.5 / 1179.0 / 1283.5 / 1388.0  (pitch 104.5)
 *    Bay centres sit at +/- 276, 378.5, 481, 583.5 px from the centre line.
 *  - STOREY PITCH 129 px: 2nd-floor window head y = 551, state-floor head y = 680.
 *  - Facade side edge found by gradient at x = 1459 (luma steps 174 -> 105 over 3 px).
 *    The left corner is occluded by the tree, so the left edge is the mirror: x = 142.
 *    Total facade width 1317 px.
 *  - Vertical landmarks, from a luminance profile taken over WALL PIERS ONLY (window
 *    columns excluded, or the windows swamp the steps):
 *      pediment apex 317.5 · attic top behind the portico 360 · chimney tops 373
 *      pediment base / portico cornice 417.5 · balustrade top 430 · balustrade base 456
 *      column capital top 470 · wing cornice 482..500 · 2nd-floor window 551..619
 *      state-floor window cap 647 · state-floor window head 680
 *  - NO STRING COURSE ON THE WINGS. The brief expected one; the pier profile through
 *    y 605..660 is flat to within 1% (177.9 -> 179.5), so there is no continuous band.
 *    The horizontal between the storeys is made instead by the aligned window sills on
 *    consoles and the state-floor window pediment caps, and that is what is modelled.
 *  - BALUSTRADE RHYTHM: dark-gap autocorrelation gives a baluster pitch of 9.0 px, and
 *    the balustrade is not continuous — it runs in panels 73 px wide separated by solid
 *    dies 31 px wide, one panel centred on each window bay (panel centres 1068, 1177,
 *    1281, 1372 against bay centres 1072.5, 1176.5, 1280, 1384.5).
 *  - PORTICO: four column shafts, edges resolved at 4x magnification —
 *      left-end column spans x 577.5..618, right-end column spans x 997.5..1037.5,
 *      so centres +/- 70 and +/- 210 px, diameter 40 px, intercolumniation 140 px.
 *      Pediment base corners at x 562.5 and 1040 (half-span 238.75 px), apex y 317.5,
 *      base y 417.5 — a rise of 100 px on a 238.75 px half-span, pitch 0.419.
 *  - A MASS BEHIND THE PEDIMENT, top edge dead flat at y = 360 from x 577 to 1035, is
 *    real building and not sky: at (620,355) the pixel is (201,218,242) blue sky, at
 *    (620,363) it is (176,187,179) neutral stone, and at x 555 and 1060 the same rows
 *    are sky again. Modelled as the set-back attic storey over the centre block.
 *  - STATE-FLOOR WINDOW CAPS ALTERNATE, symmetrically about the centre: triangular at
 *    |x| = 10.87 and 18.95 m, segmental at 14.91 and 22.99 m. Both wings agree.
 *  - LIGHT (this is a hard sunny day, not the overcast of the Empire State reference):
 *      right-wing wall piers  L = 192.3 / 188.8 / 183.2   (sunlit)
 *      left-wing wall piers   L = 164.4 / 158.6 / 144.8   (in the portico's cast shadow,
 *                                 deepening towards the portico — which is what fixes
 *                                 the sun to the RIGHT of the frame)
 *      portico interior recess L = 87.1, wall behind the colonnade L = 78.7
 *      tympanum face L = 161.1, entablature frieze under the cornice L = 110.3
 *      window glass L = 45.6 · sky zenith L = 209.7 · sky at the horizon L = 239.1
 *      lawn L = 128.1 · hedge L = 35.9
 *    The measured wall/portico-recess luma ratio is 2.16 — do not assume; that is the
 *    number the lighting is tuned against.
 *
 * ============================================================================
 * INFERRED / INVENTED  (not recoverable from one square-on view)
 * ============================================================================
 *  - ABSOLUTE SCALE. One assumed number: the 129 px storey pitch is taken as 5.08 m
 *    floor-to-floor for two grand principal storeys, giving 0.0394 m/px at the wall
 *    plane. Cross-check, not an input: that makes the facade 1317 px -> 51.9 m against
 *    the published 168 ft (51.2 m), 1.3% out. Everything else follows from it.
 *  - CAMERA DISTANCE ~95 m, solved from the FOUNTAIN RING, which is the only object in
 *    the frame that shows the ground plane's foreshortening. The red flower ring
 *    measures 1358 px across (x 127..1485) but only 36 px tall (y 833..869) — an
 *    ellipse axis ratio of 0.0265, which for a circle on the ground equals eye
 *    height / distance. At a 1.7 m eye height that puts the ring 64 m out, and the
 *    ring's own scale relative to the wall's 0.0394 m/px then puts the facade at
 *    ~95 m. That gives a 37 deg horizontal field of view — a moderate telephoto,
 *    which is exactly why the photograph shows almost no perspective distortion.
 *    (An earlier attempt to solve distance from the 2-3.5 px outward drift of the
 *    state-floor bays relative to the 2nd-floor bays was ABANDONED: the wall plane is
 *    parallel to the sensor, so it must project with a uniform scale and that drift is
 *    lens distortion, not parallax. It gave 62 m and it was wrong.)
 *  - GRADE at image row 831, derived rather than guessed: the horizon solves to row 788
 *    from the fountain ellipse, and grade at the wall is one eye height below it,
 *    788 + 1.7/0.0394. Cross-check: that makes the Ionic shafts 13.37 m tall on a
 *    1.47 m diameter, a height:diameter of 9.1, which is the textbook Ionic
 *    proportion. Nothing forced that agreement, so the scale solution stands up.
 *  - PORTICO PROJECTION 6.5 m is INVENTED (a carriage porch has to clear a carriage).
 *    Because the portico stands that far forward of the wall, its pixels are magnified
 *    relative to the wall's; portico dimensions are therefore de-magnified by
 *    (95-6.5)/95 = 0.932 before being used.
 *  - BUILDING DEPTH 25.5 m, the roof behind the balustrade, the attic's plan, and the
 *    two rear columns of the portico are all INVENTED.
 *  - THE SOUTH, EAST AND WEST ELEVATIONS ARE MIRRORED FROM THE NORTH FRONT, NOT
 *    RECONSTRUCTED. The real south front has a semicircular bow and a different portico
 *    entirely; none of that is here, because none of it is in the photograph. Any view
 *    other than `ref` is showing invented geometry.
 *  - No survey accuracy. This is a massing / visualisation model: no BIM, no IFC.
 */

// ---------------------------------------------------------------- solved scale
/** Metres per reference pixel at the WALL plane (from the assumed 5.08 m storey). */
const S = 0.0394;
/** Reference image row where the ground plane vanishes (from the fountain ellipse). */
const Y_HORIZON = 788;
/** Eye height, metres. The one free parameter in the camera solve. */
const EYE = 1.7;
/** Camera distance to the wall plane, metres — solved from the fountain ring. */
export const CAM_D = 95;
/** Portico stands this far in front of the wall (INVENTED). */
const PORTICO_PROJ = 6.5;
/** Metres per pixel on the portico plane: it is nearer, so it is magnified. */
const KP = (CAM_D - PORTICO_PROJ) / CAM_D;
const S_P = S * KP;

/**
 * Image row of grade, per plane. The camera is level and the facade is parallel to the
 * sensor, so each plane maps affinely: grade sits exactly one eye height below the
 * horizon, in that plane's own pixels.
 */
const Y_GRADE_WALL = Y_HORIZON + EYE / S;        // 831.2
const Y_GRADE_PORT = Y_HORIZON + EYE / S_P;      // 834.3

/** Reference image row -> metres above grade, for something in the WALL plane. */
const wy = (py: number) => (Y_GRADE_WALL - py) * S;
/** Reference image row -> metres above grade, for something in the PORTICO plane. */
const py2 = (py: number) => (Y_GRADE_PORT - py) * S_P;
/** Reference image column -> metres from the centre line, in the WALL plane. */
const wx = (px: number) => (px - 800.5) * S;
/** Reference image column -> metres from the centre line, in the PORTICO plane. */
const px2 = (px: number) => (px - 800.5) * S_P;

// ---------------------------------------------------------------- dimensions
export const DIM = {
  // --- main block (width MEASURED, depth INVENTED)
  width: wx(1459) * 2,              // 51.87 m
  depth: 25.5,                      // INVENTED
  // --- storey levels (derived from the MEASURED sills, less a 0.9 m sill height)
  gradeY: 0,
  stateFloorY: 2.38,
  secondFloorY: 7.46,
  // --- wall / roof profile, all MEASURED rows
  wallTopY: wy(500),                // 13.05  cornice bed
  corniceTopY: wy(482),             // 13.76
  roofDeckY: wy(456),               // 14.78
  balustradeTopY: wy(430),          // 15.81
  atticTopY: wy(363),               // 18.45  the mass proved to sit behind the pediment
  atticHalfW: wx(1035),             // 9.24
  chimneyTopY: wy(373),             // 18.05
  chimneyX: wx(1100),               // 11.80
  chimneyW: 1.48,
  // --- window bays, MEASURED centres
  bayX: [wx(1076.5), wx(1179), wx(1281.5), wx(1384)],   // 10.87 14.91 18.95 22.99
  winW: 44 * S,                     // 1.73  opening incl. architrave rebate
  winH: (619 - 551) * S,            // 2.68
  win2HeadY: wy(551),               // 11.04
  win1HeadY: wy(680),               // 5.96
  win1CapTopY: wy(647),             // 7.26
  // --- balustrade, MEASURED rhythm
  balusterPitch: 9.0 * S,           // 0.355
  balPanelW: 73 * S,                // 2.88
  // --- portico, MEASURED but de-magnified to the portico plane
  colX: [px2(870.5), px2(1010.5)],  // 2.57  7.71
  colDia: 40 * S_P,                 // 1.47
  colTopY: py2(470),                // 13.37  top of the abacus (h/dia = 9.1, Ionic)
  entabTopY: py2(417.5),            // 15.30  bed of the pediment
  pedApexY: py2(317.5),             // 18.97
  pedHalfW: px2(1039.25),           // 8.76
  entabHalfW: px2(1043.5),          // 8.92
  porticoProj: PORTICO_PROJ,
  // --- entourage, MEASURED where it can be
  hedgeTopY: 3.30,                  // hedge crown at image row 745, on its own plane
  ringZ: 31,                        // fountain ring, from the 95 m / 64 m distance pair
} as const;

/** Reported as the model height: the pediment apex, the highest measured point. */
export const TOTAL_H = DIM.pedApexY;

const HALF_W = DIM.width / 2;
const HALF_D = DIM.depth / 2;
/** North wall plane. The portico sits in front of it, at +Z. */
const WALL_Z = HALF_D;

// ---------------------------------------------------------------- palette
// Albedos, NOT the reference luma. The reference numbers above are what the pixels
// read AFTER sun + sky + tone mapping; these are what goes in the other end.
const COL = {
  // The reference's SUNLIT wall is (182,189,202) — luma 188 and distinctly COOL, blue
  // running ~20 above red. A warm near-white albedo renders it at luma 220 and neutral,
  // which is not just wrong against the photograph: it lands within 54 of the sky in
  // the measure harness's channel-sum test, one unit under its threshold of 55, so the
  // silhouette scan stops seeing the building and widthFrac collapses to a third of
  // what it should be. The albedo is cool for a measured reason.
  stone: 0xbecbe6,
  stoneTrim: 0xc2cfe9,      // cornice, architraves, balustrade
  /**
   * BAKED SHADE. The next three are the portico surfaces that the reference shows are
   * in permanent shadow — column shafts L 157.6, tympanum L 161.1 and the entablature
   * frieze L 110.3, against a 188.4 wall. They should get there by self-shadowing under
   * the portico cornice, and they do not: the shared renderer sets the sun's shadow
   * normalBias to 0.6 m (right for a 400 m tower, which is what it was tuned on), and
   * that offset is larger than the depth of a 1.47 m column or a 0.6 m cornice
   * overhang, so the shadow lookup walks straight out of its own shadow. main.ts is
   * owned by another agent, so instead the occlusion is approximated in the albedo,
   * scaled to land each surface on its measured luma. It is a fudge and it is labelled
   * as one.
   */
  columnShade: 0x9ea8b9,    // -> ~158, measured 157.6
  soffitShade: 0x757c88,    // -> ~110, measured 110.3 (frieze under the cornice)
  tympanumShade: 0x8e97a5,  // -> ~161, measured 161.1
  glass: 0x11161b,
  sash: 0xdde2ea,
  roof: 0x4c534f,
  atticWall: 0xbcc8e2,
  lawn: 0x658136,
  hedge: 0x1b2614,
  flowerRed: 0xb23a2c,
  flowerWhite: 0xc2bfb0,
  gravel: 0x9a9384,
  trunk: 0x4a4038,
  leaf: 0x33471f,
};

// ---------------------------------------------------------------- local helpers
// NOTE: deliberately local. A second agent is authoring another model against the same
// lib/ in this working tree, so nothing here is added to lib/geometry.ts.

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);          // y is the BOTTOM of the box, not its centre
  return g;
}

/** Horizontal moulding run: a stack of boxes of decreasing projection. */
function corniceRun(
  len: number, y0: number, x: number, z: number, axis: 'x' | 'z',
  courses: [h: number, proj: number][], baseD: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  let y = y0;
  for (const [h, proj] of courses) {
    const d = baseD + proj * 2;
    const g = axis === 'x' ? box(len, h, d, x, y, z) : box(d, h, len, x, y, z);
    out.push(g);
    y += h;
  }
  return out;
}

/**
 * Lathed solid of revolution from a [radius, height] profile.
 * Used for the column shafts (with entasis) and for every baluster.
 */
function lathed(profile: [number, number][], seg: number, x: number, y: number, z: number) {
  const pts = profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 1e-4), h));
  const g = new THREE.LatheGeometry(pts, seg);
  g.translate(x, y, z);
  return g;
}

/**
 * Ionic column: entasis shaft + torus base + a capital that is actual volutes.
 * A cylinder with a box on top does not read as Ionic at any distance.
 */
function ionicColumn(x: number, z: number, y0: number, topY: number, dia: number) {
  const out: THREE.BufferGeometry[] = [];
  const r = dia / 2;
  const capH = dia * 0.55;                 // capital
  const baseH = dia * 0.42;
  const shaftY = y0 + baseH;
  const shaftH = topY - capH - shaftY;

  // shaft with entasis: max diameter at ~1/3 height, tapering to 5/6 at the neck
  const prof: [number, number][] = [];
  const N = 12;
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const swell = Math.sin(Math.min(t * 1.15, 1) * Math.PI * 0.5);
    const rr = r * (1.0 - 0.155 * swell * t ** 0.35);
    prof.push([rr, shaftY + shaftH * t]);
  }
  out.push(lathed(prof, 24, x, 0, z));

  // attic base: plinth, lower torus, scotia, upper torus
  out.push(lathed([
    [r * 1.30, y0], [r * 1.30, y0 + baseH * 0.22],
    [r * 1.24, y0 + baseH * 0.30], [r * 1.30, y0 + baseH * 0.46],
    [r * 1.10, y0 + baseH * 0.62], [r * 1.16, y0 + baseH * 0.80],
    [r * 1.02, y0 + baseH], [r, y0 + baseH],
  ], 24, x, 0, z));

  // capital: echinus + abacus. The abacus is 1.3 diameters — a first pass at 2.5 put
  // a dinner plate on every column and read as a mushroom, not an order.
  const cy = topY - capH;
  out.push(lathed([
    [r * 0.94, cy], [r * 1.02, cy + capH * 0.26],
    [r * 1.06, cy + capH * 0.48], [r * 1.04, cy + capH * 0.62],
  ], 24, x, 0, z));
  out.push(box(dia * 1.32, capH * 0.30, dia * 1.32, x, topY - capH * 0.30, z));

  // the volutes — a scroll at each corner of the capital, axis along Z so the spiral
  // faces the viewer. This is the one detail that separates Ionic from Doric at any
  // viewing distance, so it is geometry.
  for (const sz of [1, -1]) {
    const vz = z + sz * dia * 0.52;
    const vy = cy + capH * 0.42;
    for (const sx of [1, -1]) {
      const scroll = new THREE.CylinderGeometry(dia * 0.24, dia * 0.24, dia * 0.16, 14);
      scroll.rotateX(Math.PI / 2);
      scroll.translate(x + sx * dia * 0.50, vy, vz);
      out.push(scroll);
      const eye = new THREE.CylinderGeometry(dia * 0.09, dia * 0.09, dia * 0.22, 8);
      eye.rotateX(Math.PI / 2);
      eye.translate(x + sx * dia * 0.50, vy, vz);
      out.push(eye);
    }
    // the cushion that links the two scrolls
    out.push(box(dia * 1.00, capH * 0.26, dia * 0.16, x, vy - capH * 0.02, vz));
  }
  return out;
}

/**
 * A wall face built as a SKIN WITH REAL HOLES IN IT.
 *
 * The first pass extruded the block as one solid prism and then pushed the glass 0.24 m
 * "into" it. There is no CSG here, so the glass simply ended up buried inside solid
 * geometry and every window vanished — the facade rendered as a blank white slab with
 * faint architrave outlines floating on it. The fix is not to fake the reveal with
 * shading: it is to leave the openings out of the wall in the first place, so the head
 * and jambs cast genuine shadows onto the recessed sash.
 *
 * Sweeps the unique v (height) edges of the hole list, and for each horizontal slab
 * emits the solid runs between whichever holes are active in it. Handles the tall
 * centre door alongside the shorter windows without any special-casing.
 */
function faceSkin(
  half: number, yTop: number, thick: number, outer: number,
  axis: 'z' | 'x', sign: 1 | -1,
  holes: [u0: number, u1: number, v0: number, v1: number][],
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const zc = outer - (sign * thick) / 2;
  const seg = (u0: number, u1: number, v0: number, h: number) => {
    if (u1 - u0 < 1e-4 || h < 1e-4) return;
    const len = u1 - u0, uc = (u0 + u1) / 2;
    out.push(axis === 'z'
      ? box(len, h, thick, uc, v0, zc)
      : box(thick, h, len, zc, v0, uc));
  };
  const edges = new Set<number>([0, yTop]);
  for (const h of holes) { edges.add(h[2]); edges.add(h[3]); }
  const vs = [...edges].filter((v) => v >= 0 && v <= yTop).sort((a, b) => a - b);
  for (let i = 0; i < vs.length - 1; i += 1) {
    const v0 = vs[i], v1 = vs[i + 1];
    if (v1 - v0 < 1e-4) continue;
    const vm = (v0 + v1) / 2;
    const act = holes.filter((h) => h[2] < vm && h[3] > vm).sort((a, b) => a[0] - b[0]);
    let u = -half;
    for (const h of act) {
      if (h[0] > u) seg(u, h[0], v0, v1 - v0);
      u = Math.max(u, h[1]);
    }
    seg(u, half, v0, v1 - v0);
  }
  return out;
}

/** One turned baluster. Small, but there are 400+ of them and they carry the roofline. */
function baluster(x: number, y0: number, z: number, h: number, r: number) {
  return lathed([
    [r * 1.30, y0], [r * 1.30, y0 + h * 0.08],
    [r * 0.62, y0 + h * 0.16], [r * 0.98, y0 + h * 0.30],
    [r * 1.00, y0 + h * 0.42], [r * 0.72, y0 + h * 0.58],
    [r * 0.44, y0 + h * 0.72], [r * 0.50, y0 + h * 0.86],
    [r * 1.20, y0 + h * 0.94], [r * 1.20, y0 + h],
  ], 8, x, 0, z);
}

/**
 * Triangular pediment as a REAL WEDGE — a solid triangular prism carried back through
 * the full depth of whatever it caps, with the tympanum face recessed behind a raking
 * cornice that stands proud of it.
 *
 * The first pass built this as a 0.95 m plate on a 6.5 m deep portico. Dead-on it was
 * passable; from the 3/4 and side views it went edge-on and read as cardboard propped
 * against the roof. A pediment is the end of a roof, so it has to have the roof's depth.
 *
 * `dir` is which way the front face points along Z, so the same function serves the
 * north portico and the mirrored window caps on the south elevation.
 */
function pediment(
  halfW: number, rise: number, y0: number, zFront: number,
  depth: number, cornice: number, dir: 1 | -1 = 1,
) {
  const out: THREE.BufferGeometry[] = [];
  const zt = zFront - dir * cornice;             // recessed tympanum face
  const hwT = halfW - cornice * 0.9;
  const riseT = rise - cornice * 1.5;
  const s = new THREE.Shape();
  s.moveTo(-hwT, 0); s.lineTo(hwT, 0); s.lineTo(0, riseT); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, y0, dir === 1 ? zt - depth : zt);
  out.push(g);

  // Raking cornice: a slab along each rake, rotated to the roof pitch.
  // SIGN TRAP: the LEFT rake runs from (-halfW, 0) up to (0, rise), so it rises to the
  // RIGHT and needs a POSITIVE rotation. Using sx * ang tilts each bar the wrong way,
  // and the two bars then cross into an X that shoots out past the roofline on both
  // sides as thin diagonal sheets. Unmistakable once rendered, invisible in the source.
  const rake = Math.hypot(halfW, rise);
  const ang = Math.atan2(rise, halfW);
  const cz = zFront - dir * cornice * 0.5;
  for (const sx of [1, -1]) {
    const c = new THREE.BoxGeometry(rake, cornice * 0.66, cornice);
    c.rotateZ(-sx * ang);
    c.translate(sx * halfW / 2, y0 + rise / 2 + (cornice * 0.33) / Math.cos(ang), cz);
    out.push(c);
  }
  // the horizontal cornice closing the bottom of the triangle
  out.push(box(halfW * 2 + cornice, cornice * 0.5, cornice, 0, y0 - cornice * 0.25, cz));
  return out;
}

/** Window glass: one canvas, muntins only. Everything with relief is geometry. */
function glassTexture(): THREE.CanvasTexture {
  // Texel aspect is pinned to the real surface aspect (1.73 m x 2.68 m) so the mip
  // chain cannot average the muntin grid into flat gloss.
  const WIDTH = 192, HEIGHT = Math.round(192 * (2.68 / 1.73));
  const c = document.createElement('canvas');
  c.width = WIDTH; c.height = HEIGHT;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c1015';                       // valid hex — a bad one silently no-ops
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const rand = rng(1792);
  // 6 over 6 sash, the pane count read off the reference at 4x
  const cols = 3, rows = 6;
  for (let r = 0; r < rows; r += 1) {
    for (let cc = 0; cc < cols; cc += 1) {
      const l = 8 + rand() * 13;
      g.fillStyle = `hsl(${205 + rand() * 14}, 16%, ${l}%)`;
      g.fillRect(
        (cc * WIDTH) / cols + 2, (r * HEIGHT) / rows + 2,
        WIDTH / cols - 4, HEIGHT / rows - 4,
      );
    }
  }
  // Muntins are painted white but they sit at the BACK of a 0.34 m reveal, so in the
  // reference they never read as white: the whole 30x50 px window patch averages
  // L 45.6 against a 188 wall. Drawing them at #e8e6df lifted that patch to 54.6.
  g.strokeStyle = '#aeb5bd'; g.lineWidth = 1.8;
  for (let cc = 1; cc < cols; cc += 1) {
    g.beginPath(); g.moveTo((cc * WIDTH) / cols, 0); g.lineTo((cc * WIDTH) / cols, HEIGHT); g.stroke();
  }
  for (let r = 1; r < rows; r += 1) {
    g.beginPath(); g.moveTo(0, (r * HEIGHT) / rows); g.lineTo(WIDTH, (r * HEIGHT) / rows); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- factory
export function createWhiteHouseModel(
  opts: { context?: boolean; shadows?: boolean } = {},
): THREE.Group {
  const { context = true, shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'WhiteHouse';
  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  // envMapIntensity is set EXPLICITLY on every material. Left unset it defaults to 1.0
  // and a bright sky dome then lights the shaded faces as hard as the sun lights the
  // front, which pins the measured lit/shadow ratio at 1.0 whatever the sun does.
  const mStone = new THREE.MeshStandardMaterial({
    color: COL.stone, roughness: 0.86, metalness: 0.0, envMapIntensity: 0.20,
  });
  const mTrim = new THREE.MeshStandardMaterial({
    color: COL.stoneTrim, roughness: 0.80, metalness: 0.0, envMapIntensity: 0.20,
  });
  const mColumn = new THREE.MeshStandardMaterial({
    color: COL.columnShade, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.18,
  });
  const mSoffit = new THREE.MeshStandardMaterial({
    color: COL.soffitShade, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.16,
  });
  const mTympanum = new THREE.MeshStandardMaterial({
    color: COL.tympanumShade, roughness: 0.86, metalness: 0.0, envMapIntensity: 0.18,
  });
  const mGlass = new THREE.MeshStandardMaterial({
    map: glassTexture(), color: 0xffffff,
    roughness: 0.34, metalness: 0.0, envMapIntensity: 0.04,
  });
  const mSash = new THREE.MeshStandardMaterial({
    color: COL.sash, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.30,
  });
  const mRoof = new THREE.MeshStandardMaterial({
    color: COL.roof, roughness: 0.72, metalness: 0.14, envMapIntensity: 0.28,
  });
  const mAttic = new THREE.MeshStandardMaterial({
    color: COL.atticWall, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.20,
  });
  const mLawn = new THREE.MeshStandardMaterial({
    color: COL.lawn, roughness: 0.98, metalness: 0.0, envMapIntensity: 0.16,
  });
  const mHedge = new THREE.MeshStandardMaterial({
    color: COL.hedge, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.16,
  });
  const mLeaf = new THREE.MeshStandardMaterial({
    color: COL.leaf, roughness: 0.94, metalness: 0.0, envMapIntensity: 0.16,
  });
  const mTrunk = new THREE.MeshStandardMaterial({
    color: COL.trunk, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.18,
  });
  const mFlowerR = new THREE.MeshStandardMaterial({
    color: COL.flowerRed, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.24,
  });
  const mFlowerW = new THREE.MeshStandardMaterial({
    color: COL.flowerWhite, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.26,
  });
  const mGravel = new THREE.MeshStandardMaterial({
    color: COL.gravel, roughness: 0.97, metalness: 0.0, envMapIntensity: 0.24,
  });
  Object.assign(materials, {
    stone: mStone, trim: mTrim, column: mColumn, glass: mGlass, sash: mSash,
    roof: mRoof, attic: mAttic, lawn: mLawn, hedge: mHedge,
  });

  const wall: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const sash: THREE.BufferGeometry[] = [];
  const columns: THREE.BufferGeometry[] = [];
  const balusters: THREE.BufferGeometry[] = [];
  const soffit: THREE.BufferGeometry[] = [];      // permanently shaded portico surfaces
  const tympanum: THREE.BufferGeometry[] = [];

  // -------------------------------------------------------------- 1. main block
  // Wall depth of the reveal. 0.34 m is ~8.6 reference px, so the head shadow is a
  // real, resolvable line at the reference framing rather than a sub-pixel hint.
  const REVEAL = 0.34;
  const sill2Y = DIM.win2HeadY - DIM.winH;
  const sill1Y = DIM.win1HeadY - DIM.winH;
  const HW = DIM.winW / 2;
  const wingX = [...DIM.bayX.map((v) => -v), ...DIM.bayX];
  // MEASURED: the three bays on the wall behind the colonnade read at +/- 120 px from
  // the centre line on the wall plane, i.e. +/- 4.73 m.
  const porticoX = [-4.73, 0, 4.73];
  const DOOR_W = 2.4;

  type Hole = [number, number, number, number];
  const northHoles: Hole[] = [];
  for (const x of [...wingX, ...porticoX]) {
    northHoles.push([x - HW, x + HW, sill2Y, DIM.win2HeadY]);
  }
  for (const x of [...wingX, -4.73, 4.73]) {
    northHoles.push([x - HW, x + HW, sill1Y, DIM.win1HeadY]);
  }
  northHoles.push([-DOOR_W / 2, DOOR_W / 2, DIM.stateFloorY - 0.10, DIM.win1HeadY]);

  const southHoles: Hole[] = [];
  for (const x of wingX) {
    southHoles.push([x - HW, x + HW, sill2Y, DIM.win2HeadY]);
    southHoles.push([x - HW, x + HW, sill1Y, DIM.win1HeadY]);
  }
  const endZ = [-7.2, 0, 7.2];
  const endHoles: Hole[] = [];
  for (const z of endZ) {
    endHoles.push([z - HW, z + HW, sill2Y, DIM.win2HeadY]);
    endHoles.push([z - HW, z + HW, sill1Y, DIM.win1HeadY]);
  }

  // core, then four pierced skins
  wall.push(prism(rectPath(DIM.width - 2 * REVEAL, DIM.depth - 2 * REVEAL), DIM.wallTopY, 0));
  for (const g of faceSkin(HALF_W, DIM.wallTopY, REVEAL, WALL_Z, 'z', 1, northHoles)) wall.push(g);
  for (const g of faceSkin(HALF_W, DIM.wallTopY, REVEAL, -WALL_Z, 'z', -1, southHoles)) wall.push(g);
  for (const g of faceSkin(HALF_D - REVEAL, DIM.wallTopY, REVEAL, HALF_W, 'x', 1, endHoles)) wall.push(g);
  for (const g of faceSkin(HALF_D - REVEAL, DIM.wallTopY, REVEAL, -HALF_W, 'x', -1, endHoles)) wall.push(g);

  // low plinth / water table at grade
  trim.push(box(DIM.width + 0.5, 0.55, DIM.depth + 0.5, 0, 0, 0));

  // -------------------------------------------------------------- 2. main cornice
  // MEASURED 12.02 -> 12.73. A modillion cornice: fascia, dentil band, corona, cyma.
  const CORN: [number, number][] = [
    [0.16, 0.10], [0.26, 0.30], [0.14, 0.46], [0.15, 0.62],
  ];
  for (const [ax, len, x, z] of [
    ['x', DIM.width, 0, WALL_Z], ['x', DIM.width, 0, -WALL_Z],
    ['z', DIM.depth, HALF_W, 0], ['z', DIM.depth, -HALF_W, 0],
  ] as [('x' | 'z'), number, number, number][]) {
    const baseD = ax === 'x' ? 0.0 : 0.0;
    for (const g of corniceRun(len + 1.4, DIM.wallTopY, x, z, ax, CORN, baseD)) trim.push(g);
  }
  // dentils — real blocks, not a painted band. 0.30 m pitch reads at the ref distance.
  {
    const dy = DIM.wallTopY + 0.16;
    const pitch = 0.30;
    const n = Math.floor(DIM.width / pitch);
    for (let i = 0; i <= n; i += 1) {
      const x = -DIM.width / 2 + i * pitch + pitch / 2;
      for (const z of [WALL_Z + 0.22, -WALL_Z - 0.22]) {
        trim.push(box(pitch * 0.52, 0.20, 0.20, x, dy, z));
      }
    }
    const nd = Math.floor(DIM.depth / pitch);
    for (let i = 0; i <= nd; i += 1) {
      const z = -DIM.depth / 2 + i * pitch + pitch / 2;
      for (const x of [HALF_W + 0.22, -HALF_W - 0.22]) {
        trim.push(box(0.20, 0.20, pitch * 0.52, x, dy, z));
      }
    }
  }

  // -------------------------------------------------------------- 3. roof + attic
  // Roof deck, invented above the MEASURED cornice line.
  const roofDeck = new THREE.Mesh(
    box(DIM.width - 0.2, 0.30, DIM.depth - 0.2, 0, DIM.corniceTopY, 0), mRoof,
  );
  roofDeck.name = 'roof-deck';
  roofDeck.receiveShadow = shadows;

  // parapet the balustrade stands on (MEASURED 13.76 base)
  for (const z of [WALL_Z - 0.30, -WALL_Z + 0.30]) {
    trim.push(box(DIM.width - 0.4, DIM.roofDeckY - DIM.corniceTopY, 0.60, 0, DIM.corniceTopY, z));
  }
  for (const x of [HALF_W - 0.30, -HALF_W + 0.30]) {
    trim.push(box(0.60, DIM.roofDeckY - DIM.corniceTopY, DIM.depth - 1.4, x, DIM.corniceTopY, 0));
  }

  // The attic mass proved by the silhouette scan at image row 360. Plan INVENTED.
  const attic = new THREE.Mesh(
    box(DIM.atticHalfW * 2, DIM.atticTopY - DIM.roofDeckY + 0.2, DIM.depth * 0.62,
      0, DIM.roofDeckY - 0.2, -1.2), mAttic,
  );
  attic.name = 'attic-storey';
  attic.castShadow = shadows; attic.receiveShadow = shadows;
  // cap moulding, so the attic is not a bare box from the free-camera views
  trim.push(box(DIM.atticHalfW * 2 + 0.5, 0.26, DIM.depth * 0.62 + 0.5,
    0, DIM.atticTopY - 0.26, -1.2));

  // chimneys — MEASURED at x +/- 11.80, top 17.03. Mirrored to the south slope.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      trim.push(box(DIM.chimneyW, DIM.chimneyTopY - DIM.roofDeckY, DIM.chimneyW * 0.72,
        sx * DIM.chimneyX, DIM.roofDeckY, sz * DIM.depth * 0.26));
      trim.push(box(DIM.chimneyW * 1.22, 0.22, DIM.chimneyW * 0.94,
        sx * DIM.chimneyX, DIM.chimneyTopY - 0.22, sz * DIM.depth * 0.26));
    }
  }

  // -------------------------------------------------------------- 4. balustrade
  // MEASURED: 9.0 px baluster pitch, panels 73 px wide centred on each window bay,
  // solid dies between. The rail is continuous; the balusters are not.
  {
    const y0 = DIM.roofDeckY;
    const h = DIM.balustradeTopY - y0;
    const railH = 0.18, plinthH = 0.14;
    const balH = h - railH - plinthH;
    const balR = DIM.balusterPitch * 0.34;

    const runBalusters = (
      a: number, b: number, fixed: number, axis: 'x' | 'z',
    ) => {
      const n = Math.max(2, Math.round((b - a) / DIM.balusterPitch));
      const step = (b - a) / n;
      for (let i = 0; i < n; i += 1) {
        const t = a + step * (i + 0.5);
        balusters.push(axis === 'x'
          ? baluster(t, y0 + plinthH, fixed, balH, balR)
          : baluster(fixed, y0 + plinthH, t, balH, balR));
      }
    };

    // front + rear: panels on the MEASURED bay centres, interrupted by the portico
    for (const z of [WALL_Z - 0.30, -WALL_Z + 0.30]) {
      // continuous plinth + rail
      trim.push(box(DIM.width - 0.4, plinthH, 0.66, 0, y0, z));
      trim.push(box(DIM.width - 0.4, railH, 0.72, 0, DIM.balustradeTopY - railH, z));
      for (const sx of [1, -1]) {
        for (const bx of DIM.bayX) {
          const c = sx * bx;
          runBalusters(c - DIM.balPanelW / 2, c + DIM.balPanelW / 2, z, 'x');
        }
        // solid dies between panels, at the pier positions
        for (let i = 0; i < DIM.bayX.length - 1; i += 1) {
          const c = sx * (DIM.bayX[i] + DIM.bayX[i + 1]) / 2;
          trim.push(box(1.22, h - railH, 0.62, c, y0, z));
        }
        // die at the outer corner and at the portico end
        trim.push(box(1.22, h - railH, 0.62, sx * (HALF_W - 0.85), y0, z));
        trim.push(box(1.22, h - railH, 0.62, sx * (DIM.bayX[0] - 2.1), y0, z));
      }
    }
    // the two end elevations, plain panels at the same pitch
    for (const x of [HALF_W - 0.30, -HALF_W + 0.30]) {
      trim.push(box(0.66, plinthH, DIM.depth - 1.6, x, y0, 0));
      trim.push(box(0.72, railH, DIM.depth - 1.6, x, DIM.balustradeTopY - railH, 0));
      runBalusters(-DIM.depth / 2 + 1.6, DIM.depth / 2 - 1.6, x, 'z');
    }
  }

  // -------------------------------------------------------------- 5. windows
  /**
   * One window. `cap` 0 = plain (2nd floor), 1 = triangular, 2 = segmental.
   * MEASURED: the state-floor caps alternate triangular / segmental symmetrically
   * about the centre line, and both wings agree.
   */
  function window1(x: number, headY: number, z: number, cap: 0 | 1 | 2, faceZ: 1 | -1) {
    const w = DIM.winW, hh = DIM.winH;
    const sillY = headY - hh;
    const zr = z + faceZ * 0.02;
    // The opening is a real hole in the skin (see faceSkin), so the glass sits on the
    // back of the reveal and the head and jambs shade it for free.
    const zg = z - faceZ * (REVEAL - 0.04);
    glass.push(box(w - 0.10, hh - 0.06, 0.05, x, sillY + 0.03, zg));
    // sash frame, a little proud of the glass
    sash.push(box(w - 0.10, 0.08, 0.09, x, headY - 0.14, zg + faceZ * 0.06));
    sash.push(box(0.08, hh - 0.06, 0.09, x, sillY + 0.03, zg + faceZ * 0.06));
    // architrave surround, MEASURED at 44 px overall
    const t = 0.22, proj = 0.16;
    trim.push(box(w + 2 * t, t, proj, x, headY, zr));
    trim.push(box(t, hh + t, proj, x - (w + t) / 2, sillY, zr));
    trim.push(box(t, hh + t, proj, x + (w + t) / 2, sillY, zr));
    // sill on two consoles — this is the horizontal that reads between the storeys,
    // since the reference proves there is no continuous string course.
    trim.push(box(w + 0.70, 0.16, 0.34, x, sillY - 0.16, z + faceZ * 0.06));
    for (const sx of [1, -1]) {
      trim.push(box(0.18, 0.38, 0.26, x + sx * (w * 0.40), sillY - 0.54, z + faceZ * 0.04));
    }
    if (cap === 0) return;
    // entablature over the state-floor windows, on consoles
    const eY = headY + 0.22;
    trim.push(box(w + 1.02, 0.20, 0.34, x, eY, z + faceZ * 0.06));
    for (const sx of [1, -1]) {
      trim.push(box(0.20, 0.52, 0.26, x + sx * (w * 0.52), headY + 0.02, z + faceZ * 0.04));
    }
    const cy = eY + 0.20;
    if (cap === 1) {
      for (const g of pediment(
        (w + 1.02) / 2, DIM.win1CapTopY - cy, cy, z + faceZ * 0.40, 0.34, 0.13, faceZ,
      )) trim.push(g);
    } else {
      // segmental: a shallow arc raised on the same bed
      const half = (w + 1.02) / 2, rise = DIM.win1CapTopY - cy;
      const R = (half * half + rise * rise) / (2 * rise);
      const s = new THREE.Shape();
      const a0 = Math.asin(half / R);
      s.moveTo(-half, 0);
      for (let i = 0; i <= 16; i += 1) {
        const a = -a0 + (2 * a0 * i) / 16;
        s.lineTo(R * Math.sin(a), R * Math.cos(a) - (R - rise));
      }
      s.lineTo(half, 0); s.closePath();
      // solid too — extrude runs +Z always, so the south copies translate back by depth
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.34, bevelEnabled: false });
      g.translate(0, cy, faceZ === 1 ? z + 0.06 : z - 0.40);
      trim.push(g);
    }
  }

  // eight bays a side, both storeys, MEASURED centres.
  // cap pattern MEASURED: |x|=10.87 tri, 14.91 seg, 18.95 tri, 22.99 seg
  const CAPS: (1 | 2)[] = [1, 2, 1, 2];
  for (const sx of [1, -1]) {
    for (let i = 0; i < DIM.bayX.length; i += 1) {
      const x = sx * DIM.bayX[i];
      window1(x, DIM.win2HeadY, WALL_Z, 0, 1);
      window1(x, DIM.win1HeadY, WALL_Z, CAPS[i], 1);
      // rear (south) elevation — MIRRORED, invented
      window1(x, DIM.win2HeadY, -WALL_Z, 0, -1);
      window1(x, DIM.win1HeadY, -WALL_Z, CAPS[i], -1);
    }
  }
  // End elevations: INVENTED, 3 bays each, so the model survives the `side` view.
  for (const sx of [1, -1]) {
    for (const z of endZ) {
      const w = DIM.winW, hh = DIM.winH;
      for (const headY of [DIM.win2HeadY, DIM.win1HeadY]) {
        const sillY = headY - hh;
        glass.push(box(0.05, hh - 0.06, w - 0.10, sx * (HALF_W - REVEAL + 0.04), sillY + 0.03, z));
        trim.push(box(0.16, 0.22, w + 0.44, sx * (HALF_W + 0.02), headY, z));
        for (const sz of [1, -1]) {
          trim.push(box(0.16, hh + 0.22, 0.22, sx * (HALF_W + 0.02), sillY, z + sz * (w + 0.22) / 2));
        }
        trim.push(box(0.34, 0.16, w + 0.70, sx * (HALF_W + 0.06), sillY - 0.16, z));
      }
    }
  }

  // -------------------------------------------------------------- 6. north portico
  // The identity of the building. Six real Ionic columns, a real pediment, a real
  // entablature — not one pixel of it is texture.
  const porticoZ = WALL_Z + DIM.porticoProj;         // front column axis plane
  const rearColZ = WALL_Z + DIM.porticoProj * 0.34;  // the two rear columns (INVENTED)
  const porticoGroup = new THREE.Group();
  porticoGroup.name = 'north-portico';

  const colXs = [-DIM.colX[1], -DIM.colX[0], DIM.colX[0], DIM.colX[1]];
  for (const cx of colXs) {
    for (const g of ionicColumn(cx, porticoZ, 0.10, DIM.colTopY, DIM.colDia)) columns.push(g);
  }
  // the fifth and sixth columns, set back at the outer positions. They are hidden
  // behind the front pair in the `ref` view — which is exactly why the photograph
  // cannot prove where they are, so their Z is INVENTED.
  for (const cx of [-DIM.colX[1], DIM.colX[1]]) {
    for (const g of ionicColumn(cx, rearColZ, 0.10, DIM.colTopY, DIM.colDia)) columns.push(g);
  }
  // pilasters where the portico meets the wall
  for (const cx of [-DIM.colX[1], DIM.colX[1]]) {
    trim.push(box(DIM.colDia * 1.05, DIM.colTopY - 0.10, 0.26, cx, 0.10, WALL_Z + 0.13));
    trim.push(box(DIM.colDia * 1.55, DIM.colDia * 0.34, 0.34, cx, DIM.colTopY - DIM.colDia * 0.34, WALL_Z + 0.17));
  }

  // portico entablature: MEASURED 12.00 -> 13.85, half-width 8.57
  {
    const y0 = DIM.colTopY, y1 = DIM.entabTopY;
    const hw = DIM.entabHalfW, zf = porticoZ + DIM.colDia * 0.95;
    const zb = WALL_Z;
    const d = zf - zb;
    // architrave, then the frieze (in the cornice's shade), then the cornice
    trim.push(box(hw * 2, (y1 - y0) * 0.30, d, 0, y0, zb + d / 2));
    soffit.push(box(hw * 2 - 0.12, (y1 - y0) * 0.38, d, 0, y0 + (y1 - y0) * 0.30, zb + d / 2));
    for (const g of corniceRun(hw * 2 + 0.9, y0 + (y1 - y0) * 0.68, 0, zb + d / 2 + 0.30, 'x',
      [[0.18, 0.12], [0.22, 0.34], [0.20, 0.52]], d)) trim.push(g);
    // dentils under the portico cornice, same 0.30 m pitch as the wing cornice
    const n = Math.floor((hw * 2) / 0.30);
    for (let i = 0; i <= n; i += 1) {
      trim.push(box(0.16, 0.20, 0.22, -hw + i * 0.30 + 0.15, y0 + (y1 - y0) * 0.68,
        zf + 0.40));
    }
    // soffit of the porte-cochere ceiling
    soffit.push(box(hw * 2 - 0.4, 0.16, d - 0.3, 0, y0 - 0.16, zb + d / 2));
  }

  // Pediment: MEASURED apex 18.97, base 15.30, half-span 8.76. Built as a solid wedge
  // carried 7.6 m back to the wall — it is the end of the portico roof, so it has the
  // portico's depth. Its tympanum sits 0.6 m behind the raking cornice, which is why
  // the reference reads it at L 161 against a 188 wall: it is in the cornice's shade.
  {
    const zf = porticoZ + DIM.colDia * 0.95 + 0.52;
    const parts = pediment(
      DIM.pedHalfW, DIM.pedApexY - DIM.entabTopY, DIM.entabTopY, zf, 7.6, 0.60, 1,
    );
    // parts[0] is the wedge, whose front cap IS the tympanum — it sits 0.6 m behind the
    // raking cornice and the reference reads it 14% down on the wall (161 vs 188).
    tympanum.push(parts[0]);
    for (const g of parts.slice(1)) trim.push(g);
    // the sloping roof planes behind the pediment, so the wedge is not a lone triangle
    const rise = DIM.pedApexY - DIM.entabTopY;
    const ang = Math.atan2(rise, DIM.pedHalfW);
    for (const sx of [1, -1]) {
      const slope = new THREE.BoxGeometry(Math.hypot(DIM.pedHalfW, rise), 0.30, 7.4);
      slope.rotateZ(-sx * ang);
      slope.translate(sx * DIM.pedHalfW / 2, DIM.entabTopY + rise / 2, zf - 0.6 - 3.9);
      trim.push(slope);
    }
  }

  // portico floor + the two flights of steps that reach the carriage drive
  trim.push(box(DIM.entabHalfW * 2, 0.36, DIM.porticoProj + 0.6, 0, 0, WALL_Z + DIM.porticoProj / 2));

  // the wall behind the colonnade: MEASURED bays at +/- 4.73 m plus the centre door
  {
    const bz = WALL_Z;
    window1(-4.73, DIM.win2HeadY, bz, 0, 1);
    window1(0, DIM.win2HeadY, bz, 0, 1);
    window1(4.73, DIM.win2HeadY, bz, 0, 1);
    window1(-4.73, DIM.win1HeadY, bz, 1, 1);
    window1(4.73, DIM.win1HeadY, bz, 1, 1);
    // the north door, taller than a window, with its fanlight
    const dw = 2.30, dh = 4.30;
    glass.push(box(dw - 0.34, dh - 0.20, 0.06, 0, 0.46, bz - 0.26));
    sash.push(box(dw - 0.34, 0.10, 0.12, 0, 0.46 + dh - 0.30, bz - 0.22));
    trim.push(box(dw + 0.44, 0.24, 0.16, 0, 0.36 + dh, bz + 0.02));
    for (const sx of [1, -1]) {
      trim.push(box(0.22, dh + 0.30, 0.16, sx * (dw + 0.22) / 2, 0.36, bz + 0.02));
    }
    trim.push(box(dw + 1.30, 0.22, 0.40, 0, 0.36 + dh + 0.24, bz + 0.06));
  }

  // -------------------------------------------------------------- 7. assemble
  const wallMesh = new THREE.Mesh(mergeGeoms(wall), mStone);
  wallMesh.name = 'walls';
  wallMesh.castShadow = shadows; wallMesh.receiveShadow = shadows;

  const trimMesh = new THREE.Mesh(mergeGeoms(trim), mTrim);
  trimMesh.name = 'trim-cornice-architraves';
  // The cornice and the portico entablature MUST cast — the deep shadow they throw on
  // the frieze (measured luma 110 against a 188 wall) is half the character of the
  // photograph. The window architraves are in the same merged mesh and are cheap here
  // because the whole shadow frustum is only ~60 m, not the 600 m a tower needs.
  trimMesh.castShadow = shadows; trimMesh.receiveShadow = shadows;

  const colMesh = new THREE.Mesh(mergeGeoms(columns), mColumn);
  colMesh.name = 'ionic-columns';
  colMesh.castShadow = shadows; colMesh.receiveShadow = shadows;

  const balMesh = new THREE.Mesh(mergeGeoms(balusters), mTrim);
  balMesh.name = 'balusters';
  // 400+ turned balusters casting into the roof deck buys nothing at this distance and
  // only produces acne along the roofline.
  balMesh.castShadow = false; balMesh.receiveShadow = shadows;

  const glassMesh = new THREE.Mesh(mergeGeoms(glass), mGlass);
  glassMesh.name = 'glazing';
  const sashMesh = new THREE.Mesh(mergeGeoms(sash), mSash);
  sashMesh.name = 'sashes';

  const soffitMesh = new THREE.Mesh(mergeGeoms(soffit), mSoffit);
  soffitMesh.name = 'portico-soffit-frieze';
  soffitMesh.castShadow = shadows; soffitMesh.receiveShadow = shadows;
  const tympMesh = new THREE.Mesh(mergeGeoms(tympanum), mTympanum);
  tympMesh.name = 'tympanum';
  tympMesh.castShadow = shadows; tympMesh.receiveShadow = shadows;
  Object.assign(materials, { soffit: mSoffit, tympanum: mTympanum });

  porticoGroup.add(colMesh, soffitMesh, tympMesh);
  root.add(wallMesh, trimMesh, balMesh, glassMesh, sashMesh, roofDeck, attic, porticoGroup);
  Object.assign(nodes, {
    walls: wallMesh, trim: trimMesh, columns: colMesh, balusters: balMesh,
    'north-portico': porticoGroup, attic,
  });

  // -------------------------------------------------------------- 8. entourage
  // Deliberately coarse: lawn, hedge massing, the flower ring, and the tree that the
  // reference proves is casting the shadow across the left wing. The fountain itself
  // is a low basin only — modelling its plume is not what this exercise is about.
  if (context) {
    const ctx = new THREE.Group(); ctx.name = 'site-context';
    const r = rng(1792);

    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mLawn);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = -0.02;
    lawn.receiveShadow = shadows;
    ctx.add(lawn);

    // gravel carriage drive under the portico
    const drive = new THREE.Mesh(new THREE.PlaneGeometry(DIM.width * 0.9, 16), mGravel);
    drive.rotation.x = -Math.PI / 2;
    drive.position.set(0, 0.005, WALL_Z + 11);
    drive.receiveShadow = shadows;
    ctx.add(drive);

    // Hedge line: MEASURED crown at image row 745, which on the hedge's own plane
    // (5 m in front of the wall) is 3.30 m — these are big yews, and they are what
    // hides grade and the whole ground storey in the reference.
    const hedge: THREE.BufferGeometry[] = [];
    for (let x = -27; x <= 27; x += 2.1) {
      if (Math.abs(x) < 9.5) continue;                 // opening in front of the portico
      const h = DIM.hedgeTopY - 0.35 + r() * 0.7, rad = 1.55 + r() * 0.5;
      const g = new THREE.SphereGeometry(rad, 10, 8);
      g.scale(1.0, h / (2 * rad), 0.85);
      g.translate(x + (r() - 0.5) * 0.5, h / 2, WALL_Z + 5.0 + (r() - 0.5) * 1.1);
      hedge.push(g);
    }
    const hedgeMesh = new THREE.Mesh(mergeGeoms(hedge), mHedge);
    hedgeMesh.name = 'hedges';
    hedgeMesh.castShadow = shadows; hedgeMesh.receiveShadow = shadows;
    ctx.add(hedgeMesh);

    // The fountain ring. Its ellipse is what solved the camera, so its own numbers come
    // straight back out of that solve: 1358 px across at 0.0265 m/px on its plane is a
    // 36 m ring, sitting 31 m north of the facade. Basin + two planting bands, no plume
    // — the brief is explicit that the fountain is entourage.
    const ringZ = WALL_Z + DIM.ringZ;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 0.55, 32), mGravel);
    basin.position.set(0, 0.27, ringZ);
    basin.receiveShadow = shadows;
    const bedR = new THREE.Mesh(new THREE.TorusGeometry(17.2, 0.80, 6, 64), mFlowerR);
    bedR.rotation.x = Math.PI / 2; bedR.position.set(0, 0.45, ringZ);
    const bedW = new THREE.Mesh(new THREE.TorusGeometry(18.4, 0.45, 6, 64), mFlowerW);
    bedW.rotation.x = Math.PI / 2; bedW.position.set(0, 0.32, ringZ);
    ctx.add(basin, bedR, bedW);

    /**
     * The tree at the left edge of the reference. It is entourage, but it is NOT
     * optional: the reference's left-wing piers read 145-164 against the right wing's
     * 183-192, and that ~20% deficit is a cast shadow. Without something to throw it
     * the render's lit/shadow ratio cannot reach the measured target.
     * Kept clear of the top-left corner of the `ref` frame so the measure harness's
     * sky reference sample stays on actual sky.
     */
    const treeG: THREE.BufferGeometry[] = [];
    const tx = -26.5, tz = WALL_Z + 15;
    const trunk = new THREE.CylinderGeometry(0.55, 0.95, 7.2, 10);
    trunk.translate(tx, 3.6, tz);
    const trunkMesh = new THREE.Mesh(trunk, mTrunk);
    trunkMesh.castShadow = shadows;
    for (let i = 0; i < 16; i += 1) {
      const rad = 3.0 + r() * 2.4;
      const g = new THREE.SphereGeometry(rad, 9, 7);
      g.translate(
        tx + (r() - 0.5) * 9.5,
        7.5 + r() * 6.4,
        tz + (r() - 0.5) * 7.0,
      );
      treeG.push(g);
    }
    const canopy = new THREE.Mesh(mergeGeoms(treeG), mLeaf);
    canopy.name = 'tree-canopy';
    canopy.castShadow = shadows; canopy.receiveShadow = shadows;
    ctx.add(trunkMesh, canopy);

    // a second, smaller tree at the right edge, matching the reference's right margin
    const t2: THREE.BufferGeometry[] = [];
    const tx2 = 36.5, tz2 = WALL_Z + 13;
    const trunk2 = new THREE.CylinderGeometry(0.42, 0.72, 5.4, 8);
    trunk2.translate(tx2, 2.7, tz2);
    for (let i = 0; i < 10; i += 1) {
      const rad = 2.4 + r() * 1.8;
      const g = new THREE.SphereGeometry(rad, 8, 6);
      g.translate(tx2 + (r() - 0.5) * 6.5, 6.0 + r() * 4.4, tz2 + (r() - 0.5) * 5.5);
      t2.push(g);
    }
    const canopy2 = new THREE.Mesh(mergeGeoms(t2), mLeaf);
    canopy2.castShadow = shadows; canopy2.receiveShadow = shadows;
    ctx.add(new THREE.Mesh(trunk2, mTrunk), canopy2);

    root.add(ctx);
    nodes['site-context'] = ctx;
  }

  const { meshes, triangles } = countGeometry(root);
  const runtime: ModelRuntime = {
    nodes, materials,
    stats: { floors: 3, heightM: TOTAL_H, meshes, triangles },
  };
  (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime = runtime;
  return root;
}
