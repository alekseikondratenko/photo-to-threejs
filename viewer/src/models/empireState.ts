import * as THREE from 'three';
import {
  rng, rectPath, notchedRectPath, scalePath, pathPerimeter, sweepBand, capDisc, mergeGeoms,
  pointsAlongPath, countGeometry,
} from '../lib/geometry';
import type { ModelRuntime } from '../lib/types';

/**
 * EMPIRE STATE BUILDING — rebuilt in code from one photograph
 * (DSCN0762.jpg, Nikon COOLPIX P900, 2020-08-19, shot from an elevated Midtown vantage).
 *
 * OBSERVED from the reference (deterministic pixel measurement):
 *  - Floor pitch 11 px, and CONSTANT from image row 620 to 940 — no measurable
 *    perspective gradient. The camera sat near mid-height (horizon solves to ~169 m,
 *    a ~50th-floor rooftop), so pixels map near-linearly here. That makes this
 *    reference behave more like the archviz case than the Taipei ground shot.
 *  - Scale 0.334 m/px from 11 px : 3.67 m floor-to-floor. Cross-check: this puts
 *    ground level at image row ~1508 on a 1500 px image — just off the bottom edge,
 *    exactly right for a 443 m tower whose base is hidden behind foreground blocks.
 *  - Main shaft silhouette 209 px wide and CONSTANT (rows 620-880): no taper.
 *  - Corner at x=573 splits the shaft 134 px : 75 px.
 *  - Stepped Art Deco crown, measured width as a fraction of the shaft:
 *      309 m -> 0.91 · 330 m -> 0.85 · 343 m -> 0.69 · 350 m -> 0.64
 *      356 m -> 0.48 · 363 m -> 0.30 · 376 m -> 0.20 · 403 m -> 0.11
 *  - Overcast light: shaft lit face #717073 (luma 112), shadow face #565861 (luma 88)
 *    — a lit/shadow ratio of just 1.27. Nearly shadowless, a third lighting archetype
 *    after AM271's soft archviz (1.60) and Taipei's hard tropical sun (2.09).
 *
 * INFERRED (not recoverable from one view):
 *  - PLAN RATIO. The 134:75 face split pins only the PROJECTED width; the split
 *    between the two axes depends on camera yaw, which the pier spacing was too noisy
 *    to fix (bays are 5-10 px, at the JPEG noise floor). Modelled at 57 x 40.5 m
 *    (1.41:1) for a ~38 deg yaw, which reproduces the measured 69.7 m projected width.
 *    Confidence 0.4.
 *  - The BASE AND LOWER SETBACKS ARE ENTIRELY INVENTED. Every part of the building
 *    below ~209 m is hidden behind foreground blocks in the reference. The 5-storey
 *    base and shoulder tiers below are archetype, not observation.
 *  - Rear and left elevations are MIRRORED from the visible faces.
 */

// ------------------------------------------------------------------ dimensions
export const DIM = {
  planX: 57.0, planZ: 40.5,     // shaft plan — INFERRED ratio, projected width pinned
  chamfer: 2.2,
  floorH: 3.67,
  shaftY0: 62.0, shaftY1: 296.0,
  // Measured off a magnified horizontal profile of the shaft face: fine pier pitch
  // 6.5 px (2.17 m), a heavier pier every ~2 bays, a solid 14 m limestone corner mass,
  // and a deep recessed light-well channel between corner and window field.
  pierBay: 2.17,
  pierDepth: 0.62,
  majorPierEvery: 3,
  notchWidth: 6.4,
  notchDepth: 2.4,
  spandrelInset: 0.34,
  antennaTop: 443.0,
} as const;

export const TOTAL_H = DIM.antennaTop;

/** [yBottom, yTop, planScale] — measured off the reference silhouette above the shaft. */
const CROWN_TIERS: [number, number, number][] = [
  [296.0, 309.0, 0.91],
  [309.0, 330.0, 0.85],
  [330.0, 343.0, 0.69],
  [343.0, 350.0, 0.64],
  [350.0, 356.0, 0.48],
  [356.0, 363.0, 0.30],
];

/** Base and shoulder tiers — INVENTED, occluded in the reference. */
const BASE_TIERS: [number, number, number][] = [
  [0.0, 26.0, 2.24],
  [26.0, 44.0, 1.72],
  [44.0, 62.0, 1.32],
];

// ------------------------------------------------------------------ palette (reference-sampled)
const COL = {
  limestone: 0x8e8c88,
  limestoneShade: 0x6f6e70,
  spandrel: 0x4a4c53,
  crown: 0x8a8785,
  mast: 0xa6adb4,
  window: 0x3b4049,
  ground: 0x6d6a66,
  neighbour: 0x8d8b88,
};

// ------------------------------------------------------------------ texture
/**
 * Window / spandrel strip that sits BETWEEN the limestone piers.
 *
 * The piers themselves are real geometry — they are the building's identity and must
 * survive any viewing distance. Only the glass and the aluminium spandrel panel are
 * textured, and the texel aspect is held to the real surface aspect so the mip chain
 * cannot average the floor rhythm away.
 */
function windowStripTexture(path: THREE.Vector2[], floors: number, seed = 1931): THREE.CanvasTexture {
  const WIDTH = 1024;
  const surfaceAspect = pathPerimeter(path) / (floors * DIM.floorH);
  const HEIGHT = Math.max(64, Math.round(WIDTH / surfaceAspect));
  const rowPx = HEIGHT / floors;
  const c = document.createElement('canvas');
  c.width = WIDTH; c.height = HEIGHT;
  const g = c.getContext('2d')!;
  const rand = rng(seed);

  const bays = Math.max(32, Math.round(pathPerimeter(path) / DIM.pierBay));
  const bw = WIDTH / bays;

  g.fillStyle = '#6d6b67';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  for (let f = 0; f < floors; f += 1) {
    const y = (f * HEIGHT) / floors;
    for (let i = 0; i < bays; i += 1) {
      // dark punched window, two lights per bay
      const wl = 16 + rand() * 16;
      g.fillStyle = `hsl(${212 + rand() * 10}, ${8 + rand() * 10}%, ${wl}%)`;
      g.fillRect(i * bw + bw * 0.16, y + rowPx * 0.10, bw * 0.30, rowPx * 0.52);
      g.fillRect(i * bw + bw * 0.54, y + rowPx * 0.10, bw * 0.30, rowPx * 0.52);
      // aluminium spandrel panel below the window band
      g.fillStyle = `hsl(210, 6%, ${40 + rand() * 8}%)`;
      g.fillRect(i * bw + bw * 0.10, y + rowPx * 0.66, bw * 0.80, rowPx * 0.26);
    }
    // floor line
    g.fillStyle = 'rgba(168,166,160,0.65)';
    g.fillRect(0, y + rowPx * 0.94, WIDTH, rowPx * 0.10);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// ------------------------------------------------------------------ factory
export function createEmpireStateModel(
  opts: { context?: boolean; shadows?: boolean } = {},
): THREE.Group {
  const { context = true, shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'EmpireStateBuilding';
  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  const plan = (s: number) => rectPath(DIM.planX * s, DIM.planZ * s, DIM.chamfer * s);
  // Notched variant: solid corner masses divided from the window field by full-height
  // light-well channels, at the fractions measured off the reference profile.
  const planNotched = (s: number) => notchedRectPath(
    DIM.planX * s, DIM.planZ * s, [0.19, 0.81], DIM.notchWidth * s, DIM.notchDepth * s,
  );
  const shaftPath = plan(1);

  // ---------------------------------------------------------------- materials
  const mWindows = new THREE.MeshStandardMaterial({
    map: windowStripTexture(shaftPath, 64),
    color: 0xffffff,
    roughness: 0.62, metalness: 0.10,
    envMapIntensity: 0.30,
    side: THREE.DoubleSide,
  });
  const mLimestone = new THREE.MeshStandardMaterial({
    color: COL.limestone, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.32,
  });
  const mCrown = new THREE.MeshStandardMaterial({ color: COL.crown, roughness: 0.78, metalness: 0.12, envMapIntensity: 0.32 });
  const mMast = new THREE.MeshStandardMaterial({ color: COL.mast, roughness: 0.34, metalness: 0.78 });
  const mGround = new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.96 });
  const mNeighbour = new THREE.MeshStandardMaterial({ color: COL.neighbour, roughness: 0.92 });
  Object.assign(materials, {
    windows: mWindows, limestone: mLimestone, crown: mCrown, mast: mMast, ground: mGround,
  });

  /**
   * One massing tier: a recessed window/spandrel drum, wrapped in real vertical
   * limestone piers. The piers are what make the building read as the Empire State
   * and not a generic grey slab, so they are geometry, never texture.
   */
  const pierGeoms: THREE.BufferGeometry[] = [];
  const wallGeoms: THREE.BufferGeometry[] = [];
  const capGeoms: THREE.BufferGeometry[] = [];

  function tier(y0: number, y1: number, s: number, withPiers: boolean) {
    const p = withPiers ? planNotched(s) : plan(s);
    const h = y1 - y0;
    const inset = DIM.spandrelInset / (DIM.planX * s / 2);
    wallGeoms.push(sweepBand(scalePath(p, 1 - inset), h, y0, 0, 1, undefined, true));
    capGeoms.push(capDisc(p, y1, true));
    if (!withPiers) return;
    // Bundled rhythm: a heavier pier every `majorPierEvery` bays, slender mullion
    // piers between. A single uniform width reads as corduroy, not as masonry.
    const count = Math.max(12, Math.round(pathPerimeter(p) / DIM.pierBay));
    for (const [i, q] of pointsAlongPath(p, count).entries()) {
      const major = i % DIM.majorPierEvery === 0;
      const wPier = DIM.pierBay * (major ? 0.62 : 0.34);
      const dPier = DIM.pierDepth * (major ? 1.0 : 0.62);
      const pier = new THREE.BoxGeometry(wPier, h, dPier);
      pier.rotateY(q.heading);
      pier.translate(q.x, y0 + h / 2, q.z);
      pierGeoms.push(pier);
    }
  }

  // base + shoulders (invented), main shaft (observed), crown tiers (measured)
  for (const [y0, y1, s] of BASE_TIERS) tier(y0, y1, s, true);
  tier(DIM.shaftY0, DIM.shaftY1, 1.0, true);
  for (const [y0, y1, s] of CROWN_TIERS) tier(y0, y1, s, s > 0.66);

  const walls = new THREE.Mesh(mergeGeoms(wallGeoms), mWindows);
  walls.name = 'window-walls';
  walls.receiveShadow = shadows;
  const piers = new THREE.Mesh(mergeGeoms(pierGeoms), mLimestone);
  piers.name = 'limestone-piers';
  piers.castShadow = false;          // 700+ piers over a 500 m frustum smear the facade
  piers.receiveShadow = shadows;
  const caps = new THREE.Mesh(mergeGeoms(capGeoms), mLimestone);
  caps.name = 'tier-caps';
  caps.castShadow = shadows;
  root.add(walls, piers, caps);
  nodes['window-walls'] = walls; nodes['limestone-piers'] = piers;

  // ---------------------------------------------------------------- mooring mast
  const mastGroup = new THREE.Group(); mastGroup.name = 'mooring-mast';
  const mastGeoms: THREE.BufferGeometry[] = [];
  const MAST_Y0 = 363.0, MAST_Y1 = 403.0;
  const STEPS = 7;
  for (let i = 0; i < STEPS; i += 1) {
    const t0 = i / STEPS, t1 = (i + 1) / STEPS;
    const s0 = 0.30 + (0.11 - 0.30) * t0;
    const s1 = 0.30 + (0.11 - 0.30) * t1;
    const y0 = MAST_Y0 + (MAST_Y1 - MAST_Y0) * t0;
    const h = (MAST_Y1 - MAST_Y0) / STEPS;
    mastGeoms.push(sweepBand(plan(s0), h * 0.86, y0, 0, 1, plan(s1), true));
    mastGeoms.push(sweepBand(scalePath(plan(s1), 1.10), h * 0.14, y0 + h * 0.86, 0, 1, undefined, true));
    mastGeoms.push(capDisc(scalePath(plan(s1), 1.10), y0 + h, true));
  }
  const mast = new THREE.Mesh(mergeGeoms(mastGeoms), mCrown);
  mast.name = 'mast-steps';
  mast.castShadow = shadows;
  mastGroup.add(mast);

  // observation dome + the ribbed Art Deco collar
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 6.2, 9.0, 20), mMast);
  dome.position.y = MAST_Y1 + 4.5;
  const ribG = new THREE.TorusGeometry(4.6, 0.42, 8, 18);
  ribG.rotateX(Math.PI / 2);
  const ribs = new THREE.InstancedMesh(ribG, mMast, 6);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 6; i += 1) {
    dummy.position.set(0, MAST_Y1 + 1.5 + i * 1.6, 0);
    dummy.scale.setScalar(1 - i * 0.06);
    dummy.updateMatrix();
    ribs.setMatrixAt(i, dummy.matrix);
  }
  mastGroup.add(dome, ribs);

  // antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.5, 26.0, 12), mMast);
  ant.position.y = MAST_Y1 + 9.0 + 13.0;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.35, 6.0, 8), mMast);
  tip.position.y = DIM.antennaTop - 3.0;
  mastGroup.add(ant, tip);
  mastGroup.traverse((o: THREE.Object3D) => { (o as THREE.Mesh).castShadow = shadows; });
  root.add(mastGroup); nodes['mooring-mast'] = mastGroup;

  // ---------------------------------------------------------------- context
  if (context) {
    const ctx = new THREE.Group(); ctx.name = 'site-context';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mGround);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ctx.add(ground);

    // Dense Midtown block grid — plain massing, the brief never needs the real city.
    const r = rng(1931);
    const blocks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 90; i += 1) {
      const bw = 30 + r() * 46, bd = 30 + r() * 40, bh = 20 + r() * 62;
      const ang = r() * Math.PI * 2, dist = 190 + r() * 620;
      const g = new THREE.BoxGeometry(bw, bh, bd);
      g.translate(Math.cos(ang) * dist, bh / 2, Math.sin(ang) * dist);
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
    stats: {
      floors: Math.round((DIM.shaftY1 - DIM.shaftY0) / DIM.floorH),
      heightM: TOTAL_H, meshes, triangles,
    },
  };
  (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime = runtime;
  return root;
}
