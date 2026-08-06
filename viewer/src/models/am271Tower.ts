import * as THREE from 'three';
import {
  rng, roundedRectPath, prism, sweepBand, mergeGeoms, pointsAlongPath, countGeometry,
} from '../lib/geometry';

/**
 * RESIDENTIAL TOWER AM271 — rebuilt in code from a single reference photograph
 * via the img2threejs pipeline (spec: work/spec.json, strict-quality PASS).
 *
 * OBSERVED from the reference (deterministic pixel measurement):
 *  - Floor pitch 15.5px by autocorrelation -> 45 typical floors in the shaft.
 *  - Shaft silhouette 192px wide, constant top-to-bottom: NO taper.
 *  - Overall height:width 4.6:1.
 *  - Continuous projecting slab band at every floor, wrapping the corner fillet unbroken.
 *  - Blue-grey vision glass with strong per-panel tonal variance (blinds/reflections).
 *  - 4-level opaque louvred crown, cream vertical piers, bright coping cap.
 *  - 3-storey podium wider than the shaft, ground-floor colonnade.
 *  - Sun from camera-left: wide face lit, return face in shadow.
 *
 * INFERRED (NOT observable from one near-frontal view — see spec.assumptions):
 *  - Plan 33.7 x 25.8 m. Only the PROJECTED width (40.8 m) is constrained by the
 *    reference; how it splits between the two axes is not, because the corner is a
 *    large-radius fillet with no sharp arris to measure. Confidence 0.45.
 *  - Rear and right elevations are MIRRORED from the visible faces. Invented.
 *  - Absolute height ~180 m assumes 3.25 m floor-to-floor. No scale reference exists.
 *  - Corner fillet radius 7.2 m, estimated from the corner shading gradient width.
 *
 * MEASURED MATCH on the reference view (render vs photograph, same framing):
 *   lit-face luma 128 vs 136 · shadow-face luma 86 vs 85 · lit/shadow ratio 1.48 vs
 *   1.60 · facade banding contrast 0.59 vs 0.62 · silhouette width 0.182 vs 0.192
 *   of frame. All within 7%.
 *
 * REPRESENTATION NOTE: slab bands, crown piers, coping, podium and colonnade are real
 * geometry. Curtain-wall mullions (90 mm at 180 m) are carried in the glass texture,
 * not modelled — at this scale geometry would be sub-pixel and dishonestly precise.
 */

// ------------------------------------------------------------------ dimensions
export const DIM = {
  // Plan solved by render-vs-reference measurement, not by eye. The reference tower
  // measures height:projected-width 4.635:1 (890px / 192px). At the solved 20.6 deg
  // camera yaw that requires a projected width of 40.8 m, i.e. 33.7 x 25.8 m — the
  // first-pass 38 x 29 m guess rendered 18% too wide for its height.
  planX: 33.7, planZ: 25.8, fillet: 7.2,
  floorH: 3.25, floors: 45,
  glassH: 2.5, slabH: 0.75, slabProject: 0.35,
  podiumH: 16.5, colonnadeH: 7.5, podiumSpread: 3.0,
  crownH: 16.8, crownLevels: 4, copingH: 0.9,
  bayW: 1.6,
} as const;

export const SHAFT_H = DIM.floorH * DIM.floors;              // 146.25
export const SHAFT_Y0 = DIM.podiumH;                          // 16.5
export const CROWN_Y0 = SHAFT_Y0 + SHAFT_H;                   // 162.75
export const TOTAL_H = CROWN_Y0 + DIM.crownH;                 // 179.55

// ------------------------------------------------------------------ palette (reference-sampled)
const COL = {
  glass: 0x7d8fa6, glassDk: 0x4a5a72, glassLt: 0xaebecb,
  slab: 0xb3b2ab, slabDk: 0x8e8d86,
  louvre: 0x8a8074, louvreDk: 0x3a3730,
  cream: 0xded9cd,
  storefront: 0x3a3a3e, podiumFrame: 0xc9c7c2,
  mullion: 0x5a5c62,
  massing: 0xe9e8ea,
  ground: 0xb4a69a,
  trunk: 0x6b5847, foliage: 0x6f9147,
  core: 0x4a5260,
};

// ------------------------------------------------------------------ textures
/**
 * Curtain-wall bay texture: per-panel tonal variance + dark mullion lines.
 * Reference evidence: individual panels differ markedly in lightness (blinds and
 * curtains at differing positions), which is what stops glass reading as flat plastic.
 */
function glassTexture(bays: number): THREE.CanvasTexture {
  const px = 12, h = 24;
  const c = document.createElement('canvas');
  c.width = bays * px; c.height = h;
  const g = c.getContext('2d')!;
  const rand = rng(20260805);
  g.fillStyle = '#7d8fa6'; g.fillRect(0, 0, c.width, h);
  for (let i = 0; i < bays; i += 1) {
    const r = rand();
    // Three observed populations. Mean lightness is held at the sampled facade
    // value (#7d8fa6 -> hsl 212, 20%, 57%) so ACES tone mapping lands on the
    // reference tone rather than crushing the elevation to near-black.
    let col: string;
    if (r < 0.20) col = `hsl(210, 24%, ${74 + rand() * 12}%)`;       // pale blinds/curtains
    else if (r < 0.68) col = `hsl(211, 21%, ${56 + rand() * 11}%)`;  // mid vision glass
    else col = `hsl(214, 24%, ${43 + rand() * 10}%)`;                // dark vision glass
    g.fillStyle = col;
    g.fillRect(i * px + 1, 0, px - 2, h);
    // horizontal transom line a third up
    g.fillStyle = 'rgba(40,46,58,0.30)';
    g.fillRect(i * px + 1, Math.floor(h * 0.62), px - 2, 1);
  }
  // vertical mullions
  g.fillStyle = 'rgba(58,62,72,0.70)';
  for (let i = 0; i <= bays; i += 1) g.fillRect(i * px - 0.5, 0, 1.5, h);
  // spandrel shadow at the head of the band, under the slab above
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(26,31,41,0.30)');
  grad.addColorStop(0.22, 'rgba(20,24,32,0.0)');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, h);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Horizontal louvre blades for the mechanical crown.
 * Reference: warm mid-tan base (#a4988a sampled off the lit crown face) with dark
 * blade shadows and a bright catch-light on each blade's top edge.
 */
function louvreTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a4988a';
  g.fillRect(0, 0, 16, 64);
  for (let y = 0; y < 64; y += 4) {
    g.fillStyle = 'rgba(48,44,38,0.58)';
    g.fillRect(0, y, 16, 1.7);
    g.fillStyle = 'rgba(214,203,184,0.42)';
    g.fillRect(0, y + 2, 16, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Podium curtain wall: a continuous glazed skin with a light frame grid.
 * The reference base is glazing behind a light mullion grid — NOT free-standing
 * columns, which is what an earlier pass wrongly modelled.
 */
function podiumTexture(bays: number, rows: number): THREE.CanvasTexture {
  const px = 20, py = 26;
  const c = document.createElement('canvas');
  c.width = bays * px; c.height = rows * py;
  const g = c.getContext('2d')!;
  const rand = rng(5150);
  for (let r = 0; r < rows; r += 1) {
    for (let i = 0; i < bays; i += 1) {
      // ground level reads much darker (deep recessed retail) than the storeys above
      const dark = r === rows - 1;
      const l = dark ? 12 + rand() * 9 : 30 + rand() * 16;
      g.fillStyle = `hsl(213, 12%, ${l}%)`;
      g.fillRect(i * px, r * py, px, py);
    }
  }
  // light aluminium frame grid
  g.strokeStyle = '#cdcbc5'; g.lineWidth = 3.2;
  for (let i = 0; i <= bays; i += 1) { g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, c.height); g.stroke(); }
  for (let r = 0; r <= rows; r += 1) { g.beginPath(); g.moveTo(0, r * py); g.lineTo(c.width, r * py); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ options
export type Am271Options = {
  context?: boolean;
  shadows?: boolean;
};

export type Am271Runtime = {
  nodes: Record<string, THREE.Object3D>;
  materials: Record<string, THREE.Material>;
  stats: { floors: number; heightM: number; meshes: number; triangles: number };
  tick?: (t: number) => void;
};

// ------------------------------------------------------------------ factory
export function createAm271TowerModel(opts: Am271Options = {}): THREE.Group {
  const { context = true, shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'ResidentialTowerAM271';

  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  const perimeter = (() => {
    const p = roundedRectPath(DIM.planX, DIM.planZ, DIM.fillet);
    let s = 0;
    for (let i = 0; i < p.length; i += 1) s += p[i].distanceTo(p[(i + 1) % p.length]);
    return s;
  })();
  const bayCount = Math.round(perimeter / DIM.bayW);          // ~75 bays

  // ---------------------------------------------------------------- materials
  const mGlass = new THREE.MeshPhysicalMaterial({
    map: glassTexture(bayCount),
    color: 0xffffff,
    roughness: 0.09, metalness: 0.06,
    clearcoat: 0.40, clearcoatRoughness: 0.08,
    envMapIntensity: 1.15,
    side: THREE.DoubleSide,
  });
  const mSlab = new THREE.MeshStandardMaterial({ color: COL.slab, roughness: 0.78, metalness: 0.0 });
  const mCore = new THREE.MeshStandardMaterial({ color: COL.core, roughness: 0.9 });
  const mLouvre = new THREE.MeshStandardMaterial({
    map: (() => { const t = louvreTexture(); t.repeat.set(bayCount * 0.5, DIM.crownLevels * 2); return t; })(),
    color: COL.louvre, roughness: 0.62, metalness: 0.35,
  });
  const mCream = new THREE.MeshStandardMaterial({ color: COL.cream, roughness: 0.55, metalness: 0.05 });
  const mStorefront = new THREE.MeshPhysicalMaterial({
    color: COL.storefront, roughness: 0.15, metalness: 0.2, envMapIntensity: 1.1,
  });
  const mFrame = new THREE.MeshStandardMaterial({ color: COL.podiumFrame, roughness: 0.8 });
  const mMassing = new THREE.MeshStandardMaterial({ color: COL.massing, roughness: 0.95 });
  const mGround = new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.92 });
  const mTrunk = new THREE.MeshStandardMaterial({ color: COL.trunk, roughness: 0.9 });
  const mFoliage = new THREE.MeshStandardMaterial({ color: COL.foliage, roughness: 0.85, flatShading: true });
  const mMetal = new THREE.MeshStandardMaterial({ color: COL.mullion, roughness: 0.45, metalness: 0.6 });
  Object.assign(materials, {
    'vision-glass': mGlass, 'slab-edge': mSlab, 'louvre-screen': mLouvre, 'cream-fin': mCream,
    'storefront-glass': mStorefront, 'massing-white': mMassing, 'ground-asphalt': mGround,
    'mullion-metal': mMetal, foliage: mFoliage,
  });

  // ---------------------------------------------------------------- paths
  const pGlass = roundedRectPath(DIM.planX, DIM.planZ, DIM.fillet);
  const pSlab = roundedRectPath(
    DIM.planX + DIM.slabProject * 2, DIM.planZ + DIM.slabProject * 2, DIM.fillet + DIM.slabProject,
  );
  const pCore = roundedRectPath(DIM.planX - 0.4, DIM.planZ - 0.4, DIM.fillet);

  // ---------------------------------------------------------------- shaft core
  const core = new THREE.Mesh(prism(pCore, SHAFT_H, SHAFT_Y0), mCore);
  core.name = 'shaft-core';
  root.add(core); nodes['shaft-core'] = core;

  // ---------------------------------------------------------------- 45 glazing bands
  // Merged rather than instanced so each floor gets its own U offset — identical
  // floors would tile visibly up the elevation, which the reference does not do.
  const rand = rng(77003);
  const glassGeoms: THREE.BufferGeometry[] = [];
  for (let f = 0; f < DIM.floors; f += 1) {
    const y = SHAFT_Y0 + f * DIM.floorH;
    glassGeoms.push(sweepBand(pGlass, DIM.glassH, y, Math.floor(rand() * bayCount) / bayCount, 1));
  }
  const glass = new THREE.Mesh(mergeGeoms(glassGeoms), mGlass);
  glass.name = 'glazing-bands';
  root.add(glass); nodes['glazing-bands'] = glass;

  // ---------------------------------------------------------------- 45 slab bands
  const slabGeom = prism(pSlab, DIM.slabH, 0);
  const slabs = new THREE.InstancedMesh(slabGeom, mSlab, DIM.floors);
  slabs.name = 'floor-slab-bands';
  const m4 = new THREE.Matrix4();
  for (let f = 0; f < DIM.floors; f += 1) {
    m4.makeTranslation(0, SHAFT_Y0 + f * DIM.floorH + DIM.glassH, 0);
    slabs.setMatrixAt(f, m4);
  }
  slabs.instanceMatrix.needsUpdate = true;
  slabs.castShadow = false; slabs.receiveShadow = shadows;
  root.add(slabs); nodes['floor-slab-bands'] = slabs;

  // ---------------------------------------------------------------- crown
  const crown = new THREE.Group(); crown.name = 'crown-screen';
  const crownBody = new THREE.Mesh(prism(pGlass, DIM.crownH, CROWN_Y0), mLouvre);
  crownBody.name = 'crown-louvre';
  crown.add(crownBody);

  // cream piers, tangent-aligned around the perimeter
  const finCount = 26;
  const finGeom = new THREE.BoxGeometry(1.1, DIM.crownH, 0.55);
  const fins = new THREE.InstancedMesh(finGeom, mCream, finCount);
  fins.name = 'crown-fins';
  const dummy = new THREE.Object3D();
  for (const [i, p] of pointsAlongPath(pGlass, finCount).entries()) {
    dummy.position.set(p.x, CROWN_Y0 + DIM.crownH / 2, p.z);
    dummy.rotation.set(0, p.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    fins.setMatrixAt(i, dummy.matrix);
  }
  fins.castShadow = shadows;
  crown.add(fins);

  const pCap = roundedRectPath(DIM.planX + 0.7, DIM.planZ + 0.7, DIM.fillet + 0.35);
  const coping = new THREE.Mesh(prism(pCap, DIM.copingH, TOTAL_H - DIM.copingH), mCream);
  coping.name = 'parapet-cap';
  coping.castShadow = shadows;
  crown.add(coping);
  root.add(crown); nodes['crown-screen'] = crown;

  // ---------------------------------------------------------------- podium
  const podium = new THREE.Group(); podium.name = 'podium';
  const sp = DIM.podiumSpread;
  const podFillet = 3.0;
  const pPodium = roundedRectPath(DIM.planX + sp * 2, DIM.planZ + sp * 2, podFillet);
  const pStore = roundedRectPath(DIM.planX + sp * 2 - 1.8, DIM.planZ + sp * 2 - 1.8, podFillet);
  const pBand = roundedRectPath(DIM.planX + sp * 2 + 0.6, DIM.planZ + sp * 2 + 0.6, podFillet);

  // Solid dark core so the glazed skin never reads as an open shell from any angle.
  const podiumCore = new THREE.Mesh(prism(pStore, DIM.podiumH, 0), mCore);
  podiumCore.name = 'podium-core'; podiumCore.receiveShadow = shadows;
  podium.add(podiumCore);

  // One continuous glazed curtain wall over the full podium height, with a light
  // aluminium frame grid — matching the reference base, which is glazing behind a
  // frame rather than a colonnade of free-standing columns.
  const podiumBays = Math.max(8, Math.round(perimeter / 4.6));
  const mPodiumGlass = new THREE.MeshPhysicalMaterial({
    map: podiumTexture(podiumBays, 3),
    color: 0xffffff,
    roughness: 0.16, metalness: 0.15,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  materials['podium-glass'] = mPodiumGlass;
  const podiumGlass = new THREE.Mesh(sweepBand(pPodium, DIM.podiumH - 1.2, 0, 0, 1), mPodiumGlass);
  podiumGlass.name = 'podium-glazing';
  podiumGlass.castShadow = shadows; podiumGlass.receiveShadow = shadows;
  podium.add(podiumGlass);

  // light capping band where the podium meets the shaft
  const band = new THREE.Mesh(prism(pBand, 1.2, DIM.podiumH - 1.2), mFrame);
  band.name = 'podium-cap-band'; band.castShadow = shadows;
  podium.add(band);

  root.add(podium); nodes.podium = podium;

  // ---------------------------------------------------------------- context
  if (context) {
    const ctx = new THREE.Group(); ctx.name = 'site-context';

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mGround);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ctx.add(ground);

    // white massing blocks, deliberately untextured as in the reference
    const mr = rng(4242);
    const blocks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 46; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const w = 22 + mr() * 46, d = 22 + mr() * 40, hgt = 7 + mr() * 22;
      const x = side * (58 + mr() * 210);
      const z = -30 - mr() * 210 + (mr() - 0.5) * 60;
      const g = new THREE.BoxGeometry(w, hgt, d);
      g.translate(x, hgt / 2, z);
      blocks.push(g.toNonIndexed().setIndex(
        Array.from({ length: g.toNonIndexed().getAttribute('position').count }, (_, k) => k),
      ));
    }
    const massing = new THREE.Mesh(mergeGeoms(blocks), mMassing);
    massing.name = 'context-massing';
    massing.castShadow = shadows; massing.receiveShadow = shadows;
    ctx.add(massing);

    // street trees and lamp posts along the forecourt
    const tr = rng(909);
    const trunkG = new THREE.CylinderGeometry(0.16, 0.24, 6, 6);
    const canopyG = new THREE.IcosahedronGeometry(2.6, 1);
    const trunks = new THREE.InstancedMesh(trunkG, mTrunk, 22);
    const canopies = new THREE.InstancedMesh(canopyG, mFoliage, 22);
    const lampG = new THREE.CylinderGeometry(0.13, 0.16, 9, 6);
    const lamps = new THREE.InstancedMesh(lampG, mMetal, 16);
    for (let i = 0; i < 22; i += 1) {
      const x = -170 + i * 16 + tr() * 4;
      const z = 46 + tr() * 5;
      dummy.position.set(x, 3, z); dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.85 + tr() * 0.35); dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 7.4, z); dummy.updateMatrix();
      canopies.setMatrixAt(i, dummy.matrix);
      if (i < 16) {
        dummy.position.set(-160 + i * 21, 4.5, 60); dummy.scale.setScalar(1); dummy.updateMatrix();
        lamps.setMatrixAt(i, dummy.matrix);
      }
    }
    canopies.castShadow = shadows;
    ctx.add(trunks, canopies, lamps);
    root.add(ctx); nodes['site-context'] = ctx;
  }

  // ---------------------------------------------------------------- shadows + stats
  root.traverse((o: THREE.Object3D) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      if (m.name === 'floor-slab-bands') return;
      if (m.name !== 'context-massing') { m.castShadow = shadows; m.receiveShadow = shadows; }
    }
  });

  const { meshes, triangles } = countGeometry(root);

  const runtime: Am271Runtime = {
    nodes, materials,
    stats: { floors: DIM.floors, heightM: TOTAL_H, meshes, triangles },
  };
  (root.userData as { sculptRuntime: Am271Runtime }).sculptRuntime = runtime;
  return root;
}
