import * as THREE from 'three';
import {
  rng, pathPerimeter, sweepBand, capDisc, mergeGeoms, pointsAlongPath, countGeometry,
} from '../lib/geometry';
import type { ModelRuntime } from '../lib/types';

/**
 * 20 FENCHURCH STREET, LONDON — the "Walkie-Talkie" — rebuilt in code from one photo.
 *
 * ============================ RESOLUTION LIMIT — READ FIRST ============================
 * The reference is 387 x 516 px. That is roughly a quarter of the linear resolution of
 * every other reference in this repo, and it caps what can honestly be claimed. The
 * tower occupies only ~160 x 200 px of it, and its whole lower ~40% is hidden behind
 * foreground buildings. Numbers below are split into what was MEASURED off pixels and
 * what was INFERRED. Where a measurement was at or past the noise floor it says so.
 * =======================================================================================
 *
 * MEASURED (deterministic pixel scans; scripts in the session scratchpad)
 *  - FLOOR PITCH 8.75 px, autocorrelation +0.86. This one nearly failed. A plain
 *    vertical luminance average down the shadowed face autocorrelated at only +0.42 and
 *    the top band gave pure monotonic decay (no periodicity at all) — i.e. noise floor,
 *    exactly as warned. The cause was not resolution: the floor bands run at ~0.36 px/px
 *    across that face, so a 30 px-wide column average smears a full period. Re-running
 *    the profile SHEARED along the measured band slope lifted the correlation to +0.86
 *    and gave a consistent 8.75 / 8.75 / 9.25 px across three height bands. Constant
 *    pitch => vertical foreshortening is negligible over the visible range and pixels
 *    map ~linearly (the skill's "elevated photograph" case). Cross-checked by counting
 *    bands off a 9x magnified crop: ~70-79 crop px, i.e. 8-9 real px. Confirmed.
 *  - SILHOUETTE, per row, median-filtered, y = 150..285:
 *        left edge   x = 108 -> 118      right edge  x = 274 -> 266
 *        plan centre x = 191.5, fixed to +-0.5 px => the plan scales about a fixed
 *        centre with height; there is no lateral lean.
 *  - PROFILE LAW. Half-width P at four heights fits P(t) = Pmax - A*(1-t)^2 to better
 *    than 0.5 px at every point (t = height/shaft height). The exponent 2 is measured,
 *    not assumed: dP/dt is largest at the base and goes to zero at the roof, which is
 *    why the silhouette edge is dead vertical at the top and leans inward hard low down.
 *    Extrapolated, the plan grows ~1.75x in projected width from ground to roof.
 *  - CORNER (the bright specular line where the two visible faces meet) x = 218 at
 *    y = 155 -> 210 at y = 285, monotonic. Splitting the silhouette there gives
 *    broad-face projected width 110 -> 92 px and end-face 56 -> 55 px: the plan grows
 *    almost entirely along ONE axis. LOW CONFIDENCE — on a rounded plan that line is a
 *    specular highlight on an arc, not a geometric corner, and it can slide as the
 *    facade tilts. The strong-axis growth is modelled; its exact ratio is not trusted.
 *  - MULLION PITCH on the lit face 3.2-3.4 px, from ~30 luminance dips across the face.
 *  - ROOFLINE from the near corner (x 236, y 80) sweeping down-left to (108, 152) —
 *    a perspective curve, not a sloping parapet: we are below a flat roof, so its far
 *    end drops toward the horizon. The horizon itself reads at y ~ 280.
 *  - CROWN: a deeply recessed dark band on the end face, y 107..140 = 3.8 floor pitches
 *    (the three Sky Garden levels), with a projecting slatted CANOPY above it running
 *    from the near corner down-right to (270, 120). The canopy stripes are its ribs.
 *  - COLOUR: lit face #7f9093 (luma 140), shadow face #436684 (luma 97); in the
 *    measure-harness sampling windows 135.2 / 93.3, ratio 1.45. Crown glass #2f3d4d
 *    (luma 59). Sky #0b5ea2 at the top of frame to #accee8 at the horizon.
 *  - Banding contrast down the lit face 0.33, down the shadowed face 0.68.
 *
 * INFERRED / INVENTED
 *  - ABSOLUTE SCALE. Anchored on the real building being ~37 storeys; with the measured
 *    8.75 px pitch and an assumed 4.05 m floor-to-floor that puts the shaft at 149.9 m
 *    and ground level at image row ~426, i.e. some 16 floors hidden behind the
 *    foreground. Nothing in the photograph pins this: the base is not visible.
 *  - PLAN AXIS SPLIT is unconstrained from one view (the skill says so and it is true
 *    here twice over, because the corners are rounded). A camera yaw of 36.9 deg was
 *    chosen; the plan follows from it. Only the PROJECTED width is pinned by pixels.
 *  - The plan section is a superellipse (|x/a|^4.5 + |z/b|^4.5 = 1): rounded rectangle
 *    with continuously convex faces. The reference cannot resolve a corner radius; the
 *    exponent was picked to put the specular turn near the measured corner column.
 *  - PLAN SIZE residual, stated plainly: pixels say the projected width is ~0.49 of the
 *    tower height. Pinning the height at ~150 m therefore forces a top floorplate near
 *    3,200 m2, roughly 15% above the real building's. Perspective inflation of the near
 *    corner accounts for part of it and is reproduced by the render's own perspective;
 *    the rest is measurement error at 387 px. The proportion was kept, not the area.
 *  - Everything below image row 285 — the bottom ~40% of the tower, the podium, the
 *    ground plane — is extrapolation of the measured profile law. It is not observed.
 *  - REAR AND FAR-SIDE ELEVATIONS ARE MIRRORED, NOT RECONSTRUCTED. The -Z broad face is
 *    a mirror of the +Z one. The -X end is INVENTED: the reference shows the canopy and
 *    Sky Garden terrace on one end only, and that is how it is modelled, so the -X end
 *    carries a plain parapet that no pixel supports.
 *  - Site context is generic massing. This is a massing/visualisation model: no survey
 *    accuracy, no BIM, no IFC.
 */

// ------------------------------------------------------------------ dimensions
export const DIM = {
  floors: 37,
  floorH: 4.05,
  /** superellipse exponent: 2 = ellipse, 7 = rounded rect with gently convex faces */
  planN: 7.0,
  planSeg: 112,
  /** half-extent on the BROAD axis (X): ground -> roof */
  aBase: 23.0, aTop: 34.5,
  /** half-extent on the END axis (Z): ground -> roof */
  bBase: 20.0, bTop: 25.0,
  /** exponent of the width-vs-height law — see header, only weakly constrained */
  profileP: 1.5,

  slabH: 0.55,
  slabProject: 0.34,
  finCount: 88,
  finDepth: 0.72,
  finWidth: 0.32,

  /** Sky Garden: the top three levels, recessed at the ENDS only */
  skyLevels: 3,
  skyInsetX: 4.2,
  skyInsetZ: 0.55,

  canopyH: 1.5,
  canopyOverX: 6.4,     // overhang on the +X end (the terrace side)
  canopyOverRest: 0.35,
  canopyRibs: 30,
  terraceDrop: 5.6,
  terraceOut: 3.6,
} as const;

export const SHAFT_H = DIM.floors * DIM.floorH;              // 149.85
export const CANOPY_Y0 = SHAFT_H;
export const TOTAL_H = CANOPY_Y0 + DIM.canopyH + 1.9;        // ~154.4 m

// ------------------------------------------------------------------ palette (reference-sampled)
const COL = {
  mullion: 0xd2dade,
  slab: 0xc3ccd0,
  fascia: 0xdfe6e8,
  crownFrame: 0x8e9aa4,
  canopy: 0xc8d2d6,
  terrace: 0xb6c0c4,
  plant: 0x8d969b,
  ground: 0x6f7369,
  neighbour: 0xa9aeb0,
};

// ------------------------------------------------------------------ local helpers
//
// NOT added to lib/geometry.ts on purpose: a second agent is editing this source tree
// and lib/ is shared. Everything the doubly-curved form needs lives here.

/**
 * Closed superellipse plan path in XZ, CCW, centred on the origin.
 * |x/a|^n + |z/b|^n = 1. n = 2 is an ellipse; n -> inf a rectangle. The Walkie-Talkie's
 * plan is a rounded rectangle whose long faces bow outward, which is exactly what a
 * mid-range n gives — and unlike a rounded rect it has NO straight segments, so the
 * facade curves continuously and the specular turn lands where the photo puts it.
 */
function superPath(a: number, b: number, n: number, seg: number): THREE.Vector2[] {
  const e = 2 / n;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < seg; i += 1) {
    const th = (i / seg) * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    pts.push(new THREE.Vector2(
      a * Math.sign(ct) * Math.abs(ct) ** e,
      b * Math.sign(st) * Math.abs(st) ** e,
    ));
  }
  return pts;
}

/**
 * True outward offset of a smooth convex path: every vertex moves along its own vertex
 * normal (the bisector of the two adjacent edge normals).
 *
 * `offsetPath` in lib/ is radial and is documented there as valid only for near-circular
 * plans — on this plan the ends sit much further from the origin than the face midpoints,
 * so a radial push would grow the slab rings off the ends and taper them at the middle.
 */
function offsetConvex(path: THREE.Vector2[], d: number): THREE.Vector2[] {
  const n = path.length;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = path[i], prev = path[(i - 1 + n) % n], next = path[(i + 1) % n];
    const e0x = p.x - prev.x, e0y = p.y - prev.y;
    const e1x = next.x - p.x, e1y = next.y - p.y;
    const l0 = Math.hypot(e0x, e0y) || 1, l1 = Math.hypot(e1x, e1y) || 1;
    // outward normal of each edge (path is CCW in XZ, so (dy, -dx) points outward)
    let n0x = e0y / l0, n0y = -e0x / l0;
    let n1x = e1y / l1, n1y = -e1x / l1;
    if (n0x * p.x + n0y * p.y < 0) { n0x = -n0x; n0y = -n0y; }
    if (n1x * p.x + n1y * p.y < 0) { n1x = -n1x; n1y = -n1y; }
    let bx = n0x + n1x, by = n0y + n1y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const cosHalf = Math.max(0.35, bx * n1x + by * n1y);
    out.push(new THREE.Vector2(p.x + (bx * d) / cosHalf, p.y + (by * d) / cosHalf));
  }
  return out;
}

/**
 * One quad of a lofted sweep: segment `i` of `bot` -> `top`, as a standalone geometry.
 *
 * `sweepBand` only does whole closed rings, and the crown needs the ring split by plan
 * position so the recessed ends can carry a different material from the broad faces.
 *
 * Winding is a, b, c / b, d, c — CCW seen from OUTSIDE. Reversed, every face is
 * back-facing, Three.js flips the shading normal inward, and the band renders lit from
 * behind at roughly half brightness. It reads exactly like a missing material.
 */
function sweepStrip(
  bot: THREE.Vector2[], top: THREE.Vector2[], i: number, y0: number, height: number,
): THREE.BufferGeometry {
  const n = bot.length;
  const j = (i + 1) % n;
  const a = bot[i], b = bot[j], at = top[i], bt = top[j];
  let nx = b.y - a.y, nz = -(b.x - a.x);
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
  if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  const u0 = i / n, u1 = (i + 1) / n;
  const pos = [
    a.x, y0, a.y, at.x, y0 + height, at.y, b.x, y0, b.y,
    at.x, y0 + height, at.y, bt.x, y0 + height, bt.y, b.x, y0, b.y,
  ];
  const uv = [u0, 0, u0, 1, u1, 0, u0, 1, u1, 1, u1, 0];
  const nrm: number[] = [];
  for (let k = 0; k < 6; k += 1) nrm.push(nx, 0, nz);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  return g;
}

/** Remap a swept band's V range so consecutive floors read different texture rows. */
function remapV(g: THREE.BufferGeometry, v0: number, v1: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
  return g;
}

/** Measured profile law: half-extent as a function of height fraction. */
function planAt(y: number): { a: number; b: number } {
  const t = Math.min(1, Math.max(0, y / SHAFT_H));
  const k = (1 - t) ** DIM.profileP;
  return {
    a: DIM.aTop - (DIM.aTop - DIM.aBase) * k,
    b: DIM.bTop - (DIM.bTop - DIM.bBase) * k,
  };
}

function pathAt(y: number, grow = 0): THREE.Vector2[] {
  const { a, b } = planAt(y);
  return superPath(a + grow, b + grow, DIM.planN, DIM.planSeg);
}

// ------------------------------------------------------------------ textures
/**
 * Blue-grey curtain wall, six floors tall so consecutive bands do not repeat.
 *
 * The horizontal rhythm and the vertical ribs are REAL GEOMETRY (slab rings and fins);
 * this map only carries what is genuinely sub-pixel at the reference distance: per-pane
 * tonal variance, the mullion hairline between fins, and the dark head reveal.
 */
function curtainWallTexture(
  path: THREE.Vector2[], floorsPerTile: number, seed: number, dark: boolean,
): THREE.CanvasTexture {
  // Texel aspect MUST track the real surface aspect (perimeter : tile height) or the
  // isotropic mip chain averages the pane pattern into flat gloss long before the tower
  // is small on screen. Anisotropic filtering alone does not save it.
  const WIDTH = 1024;
  const surfaceAspect = pathPerimeter(path) / (floorsPerTile * DIM.floorH);
  const HEIGHT = Math.max(64, Math.round(WIDTH / surfaceAspect));
  const c = document.createElement('canvas');
  c.width = WIDTH; c.height = HEIGHT;
  const g = c.getContext('2d')!;
  const rand = rng(seed);

  const bays = Math.max(64, Math.round(pathPerimeter(path) / 1.75));
  const bw = WIDTH / bays;
  const rowPx = HEIGHT / floorsPerTile;

  g.fillStyle = dark ? '#1d2833' : '#41535e';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  for (let f = 0; f < floorsPerTile; f += 1) {
    const y = f * rowPx;
    for (let i = 0; i < bays; i += 1) {
      // Three tonal populations. A narrow spread averages to a flat stripe the moment
      // the tower is small on screen; the wide spread is what keeps panes legible.
      const r = rand();
      const l = dark
        ? (r < 0.16 ? 34 + rand() * 12 : r < 0.62 ? 20 + rand() * 10 : 12 + rand() * 8)
        : (r < 0.20 ? 74 + rand() * 16 : r < 0.64 ? 52 + rand() * 14 : 34 + rand() * 12);
      g.fillStyle = `hsl(${200 + rand() * 16}, ${16 + rand() * 20}%, ${l}%)`;
      g.fillRect(i * bw + 0.4, y + rowPx * 0.14, bw - 0.8, rowPx * 0.72);
      // dark head reveal under each floor slab
      g.fillStyle = `rgba(9,18,26,${0.30 + rand() * 0.22})`;
      g.fillRect(i * bw + 0.4, y + rowPx * 0.14, bw - 0.8, rowPx * 0.14);
    }
    // spandrel below each floor line — reinforces the geometry, does not replace it
    g.fillStyle = dark ? 'rgba(18,26,34,0.85)' : 'rgba(30,44,54,0.72)';
    g.fillRect(0, y + rowPx * 0.86, WIDTH, rowPx * 0.14);
    g.fillStyle = dark ? 'rgba(120,136,150,0.45)' : 'rgba(206,218,224,0.80)';
    g.fillRect(0, y + rowPx * 0.985, WIDTH, rowPx * 0.05);
  }

  // mullion hairlines between the modelled fins
  g.fillStyle = dark ? 'rgba(150,166,178,0.35)' : 'rgba(214,226,232,0.62)';
  for (let i = 0; i <= bays; i += 1) g.fillRect(i * bw - 0.5, 0, 1.2, HEIGHT);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// ------------------------------------------------------------------ factory
export function createWalkieTalkieModel(
  opts: { context?: boolean; shadows?: boolean } = {},
): THREE.Group {
  const { context = true, shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'WalkieTalkie';
  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  const midPath = pathAt(SHAFT_H * 0.6);

  // ---------------------------------------------------------------- materials
  // envMapIntensity is set EXPLICITLY on every material. Left unset it defaults to 1.0,
  // and a bright sky environment then lights the shadow face as hard as the key lights
  // the front: the lit/shadow ratio pins at ~1.0 no matter how far the sun is pushed.
  // Clearcoat stays low for the same reason a specular layer erased an earlier facade.
  const mGlass = new THREE.MeshPhysicalMaterial({
    map: curtainWallTexture(midPath, 6, 200140, false),
    color: 0xa9b9be,
    roughness: 0.30, metalness: 0.0,
    clearcoat: 0.12, clearcoatRoughness: 0.30,
    envMapIntensity: 0.34,
    side: THREE.DoubleSide,
  });
  const mCrownGlass = new THREE.MeshPhysicalMaterial({
    map: curtainWallTexture(midPath, 3, 771, true),
    color: 0x6c7b87,
    roughness: 0.26, metalness: 0.0,
    clearcoat: 0.10, clearcoatRoughness: 0.28,
    envMapIntensity: 0.22,
    side: THREE.DoubleSide,
  });
  const mSlab = new THREE.MeshStandardMaterial({
    color: COL.slab, roughness: 0.52, metalness: 0.28, envMapIntensity: 0.30,
  });
  const mMullion = new THREE.MeshStandardMaterial({
    color: COL.mullion, roughness: 0.40, metalness: 0.52, envMapIntensity: 0.32,
  });
  const mFascia = new THREE.MeshStandardMaterial({
    color: COL.fascia, roughness: 0.38, metalness: 0.46, envMapIntensity: 0.34,
  });
  const mCanopy = new THREE.MeshStandardMaterial({
    color: COL.canopy, roughness: 0.44, metalness: 0.40, envMapIntensity: 0.30,
  });
  const mFrame = new THREE.MeshStandardMaterial({
    color: COL.crownFrame, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.24,
  });
  const mTerrace = new THREE.MeshStandardMaterial({
    color: COL.terrace, roughness: 0.60, metalness: 0.18, envMapIntensity: 0.26,
  });
  const mPlant = new THREE.MeshStandardMaterial({
    color: COL.plant, roughness: 0.75, metalness: 0.20, envMapIntensity: 0.22,
  });
  const mGround = new THREE.MeshStandardMaterial({
    color: COL.ground, roughness: 0.96, envMapIntensity: 0.18,
  });
  const mNeighbour = new THREE.MeshStandardMaterial({
    color: COL.neighbour, roughness: 0.90, envMapIntensity: 0.20,
  });
  Object.assign(materials, {
    'curtain-wall': mGlass, 'crown-glass': mCrownGlass, 'floor-slabs': mSlab,
    mullions: mMullion, fascia: mFascia, canopy: mCanopy, 'crown-frame': mFrame,
    terrace: mTerrace, plant: mPlant, ground: mGround, neighbour: mNeighbour,
  });

  // ---------------------------------------------------------------- shaft
  //
  // THE IDENTITY RULE: the horizontal floor rhythm and the vertical ribs are the two
  // things that make this building readable, and both are GEOMETRY. A doubly-curved
  // lofted surface with the floor lines painted into the map mips down to a smooth
  // blue blob — no material tweak recovers it.
  //
  // The double curvature is approximated by stacking 37 short lofted bands, each swept
  // between its own bottom and top plan path taken off the measured profile law. There
  // is no single sweep that can do this: the plan grows AND changes proportion with
  // height, so every band needs its own pair of paths.
  const shaftFloors = DIM.floors - DIM.skyLevels;
  const glassGeoms: THREE.BufferGeometry[] = [];
  const slabGeoms: THREE.BufferGeometry[] = [];
  const finGeoms: THREE.BufferGeometry[] = [];

  for (let f = 0; f < shaftFloors; f += 1) {
    const y0 = f * DIM.floorH;
    const glassH = DIM.floorH - DIM.slabH;
    const yGlassTop = y0 + glassH;
    const p0 = pathAt(y0);
    const p1 = pathAt(yGlassTop);
    const v = f % 6;
    glassGeoms.push(remapV(sweepBand(p0, glassH, y0, 0, 1, p1), v / 6, (v + 1) / 6));

    // projecting slab nosing at every floor line — the horizontal rhythm, as geometry
    const ring = offsetConvex(pathAt(y0 + DIM.floorH), DIM.slabProject);
    slabGeoms.push(sweepBand(ring, DIM.slabH, yGlassTop, 0, 1));
    slabGeoms.push(capDisc(ring, yGlassTop + DIM.slabH, true));
    slabGeoms.push(capDisc(ring, yGlassTop, false));

    // vertical mullion ribs, rebuilt at every floor at that floor's own plan so they
    // fan outward with the form instead of punching through the silhouette
    for (const p of pointsAlongPath(p0, DIM.finCount)) {
      const fin = new THREE.BoxGeometry(DIM.finDepth, glassH, DIM.finWidth);
      fin.rotateY(p.heading);
      fin.translate(p.x * 1.004, y0 + glassH / 2, p.z * 1.004);
      finGeoms.push(fin);
    }
  }

  const glass = new THREE.Mesh(mergeGeoms(glassGeoms), mGlass);
  glass.name = 'shaft-glazing';
  glass.castShadow = shadows; glass.receiveShadow = shadows;
  const slabs = new THREE.Mesh(mergeGeoms(slabGeoms), mSlab);
  slabs.name = 'floor-slab-rings';
  // 37 projecting rings casting into a 400 m shadow frustum smear shadow across the
  // whole elevation and crush the facade. The soffit line is carried by the map.
  slabs.castShadow = false; slabs.receiveShadow = shadows;
  const fins = new THREE.Mesh(mergeGeoms(finGeoms), mMullion);
  fins.name = 'mullion-fins';
  fins.castShadow = false; fins.receiveShadow = shadows;
  root.add(glass, slabs, fins);
  nodes['shaft-glazing'] = glass;
  nodes['mullion-fins'] = fins;

  // ---------------------------------------------------------------- Sky Garden crown
  // Measured: a dark recessed band 3.8 floor pitches deep on the end elevation, under a
  // projecting canopy. On the broad faces the curtain wall runs on with only a reveal.
  const crown = new THREE.Group(); crown.name = 'sky-garden';
  const crownY0 = shaftFloors * DIM.floorH;
  const crownGeoms: THREE.BufferGeometry[] = [];
  const crownFrameGeoms: THREE.BufferGeometry[] = [];

  // The recess is at the ENDS only. Uniformly shrinking the crown plan put a black
  // band right round the tower; the reference shows the curtain wall running to the
  // roofline on the broad face and stepping back hard only on the end elevation. The
  // |x|/a weighting leaves the broad faces where they were and pulls the ends in.
  const inset = (y: number) => {
    const { a, b } = planAt(y);
    return superPath(a, b, DIM.planN, DIM.planSeg).map((p) => new THREE.Vector2(
      p.x - Math.sign(p.x) * DIM.skyInsetX * (Math.abs(p.x) / a) ** 3,
      p.y - Math.sign(p.y) * DIM.skyInsetZ * (Math.abs(p.y) / b) ** 2,
    ));
  };
  // setback ledge where the shaft stops
  crownFrameGeoms.push(capDisc(pathAt(crownY0), crownY0, true));

  // The band is SPLIT along the plan: across the broad faces the ordinary curtain wall
  // and its mullions run unbroken to the roofline, exactly as the reference shows, and
  // only the pulled-back END arcs carry the dark Sky Garden glazing. A first pass used
  // one dark ring for the whole crown and put a black collar right round the tower.
  const crownLightGeoms: THREE.BufferGeometry[] = [];
  const crownFinGeoms: THREE.BufferGeometry[] = [];
  const isEnd = (p: THREE.Vector2, a: number) => Math.abs(p.x) / a > 0.60;

  for (let f = 0; f < DIM.skyLevels; f += 1) {
    const y0 = crownY0 + f * DIM.floorH;
    const glassH = DIM.floorH - 0.42;
    const p0 = inset(y0), p1 = inset(y0 + glassH);
    const a0 = planAt(y0).a;
    const v = f % 3;
    for (let i = 0; i < p0.length; i += 1) {
      const strip = sweepStrip(p0, p1, i, y0, glassH);
      const end = isEnd(p0[i], a0) || isEnd(p0[(i + 1) % p0.length], a0);
      (end ? crownGeoms : crownLightGeoms).push(
        remapV(strip, v / 3, (v + 1) / 3),
      );
    }
    for (const p of pointsAlongPath(p0, DIM.finCount)) {
      if (Math.abs(p.x) / a0 > 0.56) continue;
      const fin = new THREE.BoxGeometry(DIM.finDepth, glassH, DIM.finWidth);
      fin.rotateY(p.heading);
      fin.translate(p.x * 1.006, y0 + glassH / 2, p.z * 1.006);
      crownFinGeoms.push(fin);
    }
    // the crown keeps its floor lines: without them the broad face lost the bright
    // horizontal rhythm and read as a dark collar against the lit shaft below
    const ring = offsetConvex(inset(y0 + DIM.floorH), 0.22);
    crownFrameGeoms.push(sweepBand(ring, 0.42, y0 + glassH, 0, 1));
    crownFrameGeoms.push(capDisc(ring, y0 + glassH + 0.42, true));
    crownFrameGeoms.push(capDisc(ring, y0 + glassH, false));
  }
  const crownLight = new THREE.Mesh(mergeGeoms(crownLightGeoms), mGlass);
  crownLight.name = 'sky-garden-broad-glazing';
  crownLight.receiveShadow = shadows;
  const crownFins = new THREE.Mesh(mergeGeoms(crownFinGeoms), mMullion);
  crownFins.name = 'sky-garden-mullions';
  crownFins.castShadow = false;
  crown.add(crownLight, crownFins);
  const crownGlass = new THREE.Mesh(mergeGeoms(crownGeoms), mCrownGlass);
  crownGlass.name = 'sky-garden-glazing';
  crownGlass.receiveShadow = shadows;
  const crownFrame = new THREE.Mesh(mergeGeoms(crownFrameGeoms), mSlab);
  crownFrame.name = 'sky-garden-frame';
  crownFrame.castShadow = false; crownFrame.receiveShadow = shadows;
  crown.add(crownGlass, crownFrame);

  // viewing terrace projecting off the +X end, under the canopy (INVENTED on -X)
  {
    const yT = SHAFT_H - DIM.terraceDrop;
    const { a, b } = planAt(yT);
    const deck = new THREE.BoxGeometry(DIM.terraceOut + 1.6, 0.7, b * 0.84);
    deck.translate(a - DIM.skyInsetX + DIM.terraceOut / 2, yT, 0);
    const rail = new THREE.BoxGeometry(0.3, 1.4, b * 0.84);
    rail.translate(a - DIM.skyInsetX + DIM.terraceOut + 0.6, yT + 1.05, 0);
    const terrace = new THREE.Mesh(mergeGeoms([deck, rail]), mTerrace);
    terrace.name = 'sky-terrace';
    terrace.castShadow = shadows;
    crown.add(terrace);
  }
  root.add(crown); nodes['sky-garden'] = crown;

  // ---------------------------------------------------------------- roof canopy
  // Measured as a bright SLATTED band sweeping from the near roof corner down-right
  // across the end elevation. The ribs are modelled: as a smooth plate the crown loses
  // the one feature that reads at this distance.
  const capGrp = new THREE.Group(); capGrp.name = 'roof-canopy';
  const { a: aR, b: bR } = planAt(SHAFT_H);
  const shift = (DIM.canopyOverX - DIM.canopyOverRest) / 2;
  const canopyPath = superPath(
    aR + DIM.canopyOverRest + shift, bR + DIM.canopyOverRest, DIM.planN, DIM.planSeg,
  ).map((p) => new THREE.Vector2(p.x + shift, p.y));

  const canopyGeoms: THREE.BufferGeometry[] = [
    sweepBand(canopyPath, DIM.canopyH, CANOPY_Y0),
    capDisc(canopyPath, CANOPY_Y0 + DIM.canopyH, true),
    capDisc(canopyPath, CANOPY_Y0, false),
  ];
  const canopy = new THREE.Mesh(mergeGeoms(canopyGeoms), mCanopy);
  canopy.name = 'canopy-plate';
  canopy.castShadow = shadows; canopy.receiveShadow = shadows;
  capGrp.add(canopy);

  // ribs under the overhang, running in X and spaced along Z
  const ribGeoms: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DIM.canopyRibs; i += 1) {
    const t = (i + 0.5) / DIM.canopyRibs;
    const z = (t * 2 - 1) * (bR + DIM.canopyOverRest) * 0.97;
    // rib length follows the canopy edge so they die away toward the ends
    const half = (aR + DIM.canopyOverRest + shift)
      * Math.abs(1 - Math.abs(z / (bR + DIM.canopyOverRest)) ** DIM.planN) ** (1 / DIM.planN);
    const x1 = half + shift;
    const x0 = Math.max(-x1, aR - DIM.skyInsetX - 2.0);
    if (x1 - x0 < 1.5) continue;
    const rib = new THREE.BoxGeometry(x1 - x0, 0.85, 0.55);
    rib.translate((x0 + x1) / 2, CANOPY_Y0 - 0.42, z);
    ribGeoms.push(rib);
  }
  const ribs = new THREE.Mesh(mergeGeoms(ribGeoms), mFascia);
  ribs.name = 'canopy-ribs';
  ribs.castShadow = false;
  capGrp.add(ribs);

  // bright fascia lip round the canopy edge — the roofline the photo traces
  const lip = offsetConvex(canopyPath, 0.28);
  const fascia = new THREE.Mesh(
    mergeGeoms([
      sweepBand(lip, 0.6, CANOPY_Y0 + DIM.canopyH - 0.6),
      capDisc(lip, CANOPY_Y0 + DIM.canopyH, true),
    ]),
    mFascia,
  );
  fascia.name = 'canopy-fascia';
  fascia.castShadow = false;
  capGrp.add(fascia);

  // rooftop plant enclosure
  {
    const plant = new THREE.Mesh(
      new THREE.BoxGeometry(aR * 0.9, 1.9, bR * 0.8),
      mPlant,
    );
    plant.position.set(-aR * 0.18, CANOPY_Y0 + DIM.canopyH + 0.95, 0);
    plant.castShadow = shadows;
    capGrp.add(plant);
  }
  root.add(capGrp); nodes['roof-canopy'] = capGrp;

  // ---------------------------------------------------------------- podium (invented)
  {
    const skirt = offsetConvex(pathAt(0), 1.6);
    const pod = new THREE.Mesh(
      mergeGeoms([
        sweepBand(skirt, 8.1, 0, 0, 1, offsetConvex(pathAt(8.1), 0.5)),
        capDisc(skirt, 0.02, true),
      ]),
      mFrame,
    );
    pod.name = 'podium';
    pod.castShadow = shadows; pod.receiveShadow = shadows;
    root.add(pod); nodes.podium = pod;
  }

  // ---------------------------------------------------------------- context
  if (context) {
    const ctx = new THREE.Group(); ctx.name = 'site-context';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mGround);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ctx.add(ground);

    // Generic City of London massing. The reference surroundings are real dense city
    // that is explicitly not part of this reconstruction.
    const r = rng(20140901);
    const blocks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 58; i += 1) {
      const w = 24 + r() * 46, d = 24 + r() * 40, hgt = 18 + r() * 46;
      const ang = r() * Math.PI * 2, dist = 95 + r() * 330;
      const g = new THREE.BoxGeometry(w, hgt, d);
      g.rotateY(r() * Math.PI);
      g.translate(Math.cos(ang) * dist, hgt / 2, Math.sin(ang) * dist);
      blocks.push(g);
    }
    const neighbours = new THREE.Mesh(mergeGeoms(blocks), mNeighbour);
    neighbours.name = 'context-massing';
    neighbours.receiveShadow = shadows;
    ctx.add(neighbours);
    root.add(ctx); nodes['site-context'] = ctx;
  }

  const { meshes, triangles } = countGeometry(root);
  const runtime: ModelRuntime = {
    nodes, materials,
    stats: { floors: DIM.floors, heightM: TOTAL_H, meshes, triangles },
  };
  (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime = runtime;
  return root;
}
