import * as THREE from 'three';
import {
  rng, chamferedSquarePath, scalePath, offsetChamferedSquare, pathPerimeter, arcFractions,
  sweepBand, capDisc, mergeGeoms, pointsAlongPath, countGeometry,
} from '../lib/geometry';
import type { ModelRuntime } from '../lib/types';

/**
 * TAIPEI 101 — rebuilt in code from a single photograph.
 *
 * OBSERVED from the reference (deterministic pixel measurement):
 *  - EIGHT stacked modules, boundaries at image rows 416/497/579/663/745/830/913/998,
 *    median pitch 83 px. Each is an INVERTED truncated pyramid: narrow at its bottom,
 *    flaring outward to a projecting cornice at its top.
 *  - Every module shares the same bottom width (163-168 px) and flares ~9-10%. The
 *    stack as a whole does NOT taper — easy to get wrong by eye.
 *  - Plan is a square with chamfered corners. Face-width split either side of the
 *    corner line (79 px vs 96 px) puts camera yaw at ~39 deg and the plan at ~124 px
 *    square-equivalent, so module-height : plan-width = 0.67.
 *  - Teal curtain wall: lit face #8cb7b6 (luma 174), shadow face #395870 (luma 83)
 *    — a lit/shadow ratio of 2.09, far harsher than an archviz render.
 *  - Light metal channel down every chamfered corner; cornice band #577684.
 *  - Four large circular ruyi medallions at the top of the pedestal.
 *
 * TOP PROFILE, measured row by row (width in px, stack top = 180 px):
 *    crown taper   y 416->320   1.00 -> 0.72
 *    crown upper   y 320->290   0.72 -> 0.37
 *    pinnacle      y 290->198   ~0.36, waisted to 0.32, cornice bulge to 0.43
 *    neck          y 198->172   0.33 -> 0.19
 *    BALL collar   y 172->155   peak width 37 px  (the bulge below the mast)
 *    mast          y 155->56    0.04, ring stack near the tip
 *  The pinnacle is a near-straight STEPPED BOX, not a cone — an early pass tapered it
 *  continuously and lost the building's identity at the top.
 *
 * INFERRED / EXTERNAL:
 *  - ABSOLUTE SCALE IS NOT RECOVERABLE FROM THIS PHOTOGRAPH. Unlike the AM271 archviz
 *    reference (shifted lens, no vertical convergence, pixels map linearly to metres),
 *    this is a real ground-level shot: the top is ~25% further from the camera than the
 *    base. Solving the spire length linearly from pixels put ground level ABOVE the
 *    module stack — a contradiction that proves the method fails here. Sizes below come
 *    from the module-local ratio (perspective barely distorts one module) plus an
 *    assumed 4.05 m floor-to-floor at 8 floors per module; heights above the stack carry
 *    a ~1.12x perspective correction.
 *  - The pedestal is two-thirds hidden behind trees; its height and taper are inferred.
 *  - Rear and left elevations are MIRRORED. The building is 4-fold symmetric so this is
 *    far safer here than on the slab tower — but still an assumption.
 */

// ------------------------------------------------------------------ dimensions
export const DIM = {
  plan: 48.5,
  chamfer: 7.6,
  notch: 1.2,
  floorH: 4.05,
  floorsPerModule: 8,
  modules: 8,
  flare: 0.102,
  corniceH: 2.0,
  corniceProject: 1.15,
  slabH: 0.40,          // real projecting nosing at EVERY floor, not a texture line
  slabProject: 0.26,
  pedestalH: 100.0,
  pedestalSpread: 6.0,
  medallionR: 9.4,
  // top assembly, from the measured profile above
  crownH: 40.0, crownTopScale: 0.72,
  crownUpperH: 13.0, crownUpperScale: 0.38,
  pinnacleH: 38.0, pinnacleScale: 0.355, pinnacleTopScale: 0.325, pinnacleCornice: 0.43,
  neckH: 11.0, neckScale: 0.19,
  ballH: 7.0, ballR: 5.1,
  mastH: 42.0,
} as const;

export const MODULE_H = DIM.floorH * DIM.floorsPerModule;   // 32.4
export const STACK_H = MODULE_H * DIM.modules;               // 259.2
export const STACK_Y0 = DIM.pedestalH;                       // 100
export const CROWN_Y0 = STACK_Y0 + STACK_H;                  // 359.2
export const CROWN_UPPER_Y0 = CROWN_Y0 + DIM.crownH;         // 399.2
export const PINNACLE_Y0 = CROWN_UPPER_Y0 + DIM.crownUpperH; // 412.2
export const NECK_Y0 = PINNACLE_Y0 + DIM.pinnacleH;          // 450.2
export const BALL_Y0 = NECK_Y0 + DIM.neckH;                  // 461.2
export const MAST_Y0 = BALL_Y0 + DIM.ballH;                  // 468.2
export const TOTAL_H = MAST_Y0 + DIM.mastH;                  // 510.2

// ------------------------------------------------------------------ palette (reference-sampled)
const COL = {
  cornice: 0x93aeab,
  cornerMetal: 0x9db0ae,
  pinnacle: 0x67737f,
  mast: 0x9AA0B2,
  medallion: 0x97a2ad,
  ground: 0x7d8a6a,
  neighbour: 0xa8b0b4,
};

// ------------------------------------------------------------------ textures
/**
 * Teal curtain wall.
 *
 * The floor lines and mullions MUST survive tone mapping — an earlier pass used a
 * high clearcoat and low roughness, and the specular layer washed the whole pattern
 * out into a uniform gloss. Keep the line contrast strong here and the clearcoat low
 * on the material.
 *
 * The chamfered-corner metal channels are painted at their exact arc-length U rather
 * than modelled: at 500 m a mullion is sub-pixel, and the corner channel is the only
 * corner feature actually legible in the reference.
 */
function curtainWallTexture(
  path: THREE.Vector2[], floors: number, seed = 101101,
): THREE.CanvasTexture {
  // Texel aspect MUST track the real surface aspect (perimeter : band height), or the
  // isotropic mip chain destroys the floor lines long before the tower is small on
  // screen: 2048 texels squeezed into ~50 screen px averaged the entire window pattern
  // into flat gloss. Anisotropic filtering alone does not save it.
  const WIDTH = 1024;
  const surfaceAspect = pathPerimeter(path) / (floors * 4.05);
  const HEIGHT = Math.max(64, Math.round(WIDTH / surfaceAspect));
  const rowPx = HEIGHT / floors;
  const c = document.createElement('canvas');
  c.width = WIDTH; c.height = HEIGHT;
  const g = c.getContext('2d')!;
  const rand = rng(seed);

  const perim = pathPerimeter(path);
  const bays = Math.max(48, Math.round(perim / 1.45));
  const bw = WIDTH / bays;

  g.fillStyle = '#2b8a80';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // vision-glass panels: three tonal populations, mean held near the sampled facade
  for (let f = 0; f < floors; f += 1) {
    const y = (f * HEIGHT) / floors;
    const hRow = HEIGHT / floors;
    for (let i = 0; i < bays; i += 1) {
      // Wide tonal separation is what makes individual windows legible. A narrow
      // spread averages to a flat stripe the moment the tower is small on screen.
      const r = rand();
      const l = r < 0.18 ? 72 + rand() * 14 : r < 0.62 ? 46 + rand() * 14 : 24 + rand() * 12;
      g.fillStyle = `hsl(${170 + rand() * 10}, ${46 + rand() * 18}%, ${l}%)`;
      g.fillRect(i * bw + 0.5, y + hRow * 0.18, bw - 1.0, hRow * 0.66);
      // dark head reveal at the top of every pane
      g.fillStyle = `rgba(10,26,32,${0.28 + rand() * 0.2})`;
      g.fillRect(i * bw + 0.5, y + hRow * 0.18, bw - 1.0, hRow * 0.13);
    }
  }

  // spandrel / floor-edge band under every floor line — the strongest horizontal cue
  for (let f = 0; f <= floors; f += 1) {
    const y = (f * HEIGHT) / floors;
    g.fillStyle = 'rgba(206,222,220,0.85)';
    g.fillRect(0, y - rowPx * 0.10, WIDTH, rowPx * 0.20);
    g.fillStyle = 'rgba(14,32,40,0.70)';
    g.fillRect(0, y + rowPx * 0.10, WIDTH, rowPx * 0.10);
  }
  // vertical mullions
  g.fillStyle = 'rgba(196,216,214,0.55)';
  for (let i = 0; i <= bays; i += 1) g.fillRect(i * bw - 0.5, 0, 1.4, HEIGHT);

  // light metal channel down each chamfered corner, at its true arc-length position
  const fr = arcFractions(path);
  const n = path.length;
  for (let i = 0; i < n; i += 1) {
    const a = path[i], b = path[(i + 1) % n];
    const isChamfer = Math.abs(b.x - a.x) > 0.35 && Math.abs(b.y - a.y) > 0.35;
    if (!isChamfer) continue;
    const u0 = fr[i] * WIDTH, u1 = fr[i + 1] * WIDTH;
    const w = Math.max(4, u1 - u0);
    const grad = g.createLinearGradient(u0, 0, u0 + w, 0);
    grad.addColorStop(0, 'rgba(22,44,52,0.80)');
    grad.addColorStop(0.5, 'rgba(206,218,216,0.95)');
    grad.addColorStop(1, 'rgba(22,44,52,0.80)');
    g.fillStyle = grad;
    g.fillRect(u0, 0, w, HEIGHT);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// ------------------------------------------------------------------ factory
export function createTaipei101Model(
  opts: { context?: boolean; shadows?: boolean } = {},
): THREE.Group {
  const { context = true, shadows = true } = opts;
  const root = new THREE.Group();
  root.name = 'Taipei101';
  const nodes: Record<string, THREE.Object3D> = {};
  const materials: Record<string, THREE.Material> = {};

  const basePath = chamferedSquarePath(DIM.plan, DIM.chamfer, DIM.notch);
  const cham = (scale: number, d = 0) =>
    offsetChamferedSquare(DIM.plan * scale, DIM.chamfer * scale, DIM.notch * scale, d);

  // ---------------------------------------------------------------- materials
  // Low clearcoat: the specular layer is what erased the window pattern last pass.
  const mGlass = new THREE.MeshPhysicalMaterial({
    map: curtainWallTexture(basePath, DIM.floorsPerModule),
    color: 0xbfeee6,   // tint toward the sampled teal; ACES + blue sky pulls it grey
    roughness: 0.38, metalness: 0.0,
    clearcoat: 0.05, clearcoatRoughness: 0.35,
    envMapIntensity: 0.30,
    side: THREE.DoubleSide,
  });
  const mPedestalGlass = new THREE.MeshPhysicalMaterial({
    map: curtainWallTexture(basePath, 22, 5150),
    color: 0xffffff,
    roughness: 0.40, metalness: 0.0,
    clearcoat: 0.04, clearcoatRoughness: 0.38,
    envMapIntensity: 0.28,
    side: THREE.DoubleSide,
  });
  const mPinnacleGlass = new THREE.MeshPhysicalMaterial({
    map: curtainWallTexture(scalePath(basePath, DIM.pinnacleScale), 10, 909),
    color: 0xdfe6e8,
    roughness: 0.45, metalness: 0.12,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
  });
  const mCornice = new THREE.MeshStandardMaterial({ color: COL.cornice, roughness: 0.55, metalness: 0.35 });
  const mMetal = new THREE.MeshStandardMaterial({ color: COL.cornerMetal, roughness: 0.4, metalness: 0.65 });
  const mPinnacle = new THREE.MeshStandardMaterial({ color: COL.pinnacle, roughness: 0.5, metalness: 0.5 });
  const mMast = new THREE.MeshStandardMaterial({ color: COL.mast, roughness: 0.34, metalness: 0.78 });
  const mMedallion = new THREE.MeshStandardMaterial({ color: COL.medallion, roughness: 0.32, metalness: 0.78 });
  const mGround = new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.95 });
  const mNeighbour = new THREE.MeshStandardMaterial({ color: COL.neighbour, roughness: 0.9 });
  Object.assign(materials, {
    'curtain-wall': mGlass, 'pedestal-glass': mPedestalGlass, 'pinnacle-glass': mPinnacleGlass,
    cornice: mCornice, 'corner-metal': mMetal, pinnacle: mPinnacle,
    mast: mMast, medallion: mMedallion, ground: mGround,
  });

  // ---------------------------------------------------------------- pedestal
  const pedFloors = Math.round(DIM.pedestalH / DIM.floorH);
  const pedGeoms: THREE.BufferGeometry[] = [];
  const pedRings: THREE.BufferGeometry[] = [];
  for (let f = 0; f < pedFloors; f += 1) {
    const t0 = f / pedFloors, t1 = (f + 1) / pedFloors;
    const y = t0 * DIM.pedestalH;
    const h = DIM.pedestalH / pedFloors;
    const lerp = (t: number) => DIM.plan + (DIM.pedestalSpread * 2) * (1 - t);
    const p0 = offsetChamferedSquare(DIM.plan, DIM.chamfer, DIM.notch, (lerp(t0) - DIM.plan) / 2);
    const p1 = offsetChamferedSquare(DIM.plan, DIM.chamfer, DIM.notch, (lerp(t1) - DIM.plan) / 2);
    pedGeoms.push(sweepBand(p0, h - DIM.slabH, y, 0, 1, p1, true));
    const ring = offsetChamferedSquare(DIM.plan, DIM.chamfer, DIM.notch,
      (lerp(t1) - DIM.plan) / 2 + DIM.slabProject);
    pedRings.push(sweepBand(ring, DIM.slabH, y + h - DIM.slabH, 0, 1, undefined, true));
    pedRings.push(capDisc(ring, y + h, true));
    pedRings.push(capDisc(ring, y + h - DIM.slabH, false));
  }
  pedGeoms.push(capDisc(basePath, DIM.pedestalH, true));
  const pedestal = new THREE.Mesh(mergeGeoms(pedGeoms), mPedestalGlass);
  const pedestalRings = new THREE.Mesh(mergeGeoms(pedRings), mCornice);
  pedestalRings.name = 'pedestal-floor-rings';
  root.add(pedestalRings);
  pedestal.name = 'pedestal';
  pedestal.castShadow = shadows; pedestal.receiveShadow = shadows;
  root.add(pedestal); nodes.pedestal = pedestal;

  // ---------------------------------------------------------------- 8 flaring modules
  const stack = new THREE.Group(); stack.name = 'module-stack';
  const glassGeoms: THREE.BufferGeometry[] = [];
  const corniceGeoms: THREE.BufferGeometry[] = [];
  const topPath = scalePath(basePath, 1 + DIM.flare);
  const lipPath = offsetChamferedSquare(
    DIM.plan * (1 + DIM.flare), DIM.chamfer * (1 + DIM.flare), DIM.notch, DIM.corniceProject,
  );

  // EVERY FLOOR IS REAL GEOMETRY, not a line in the texture.
  //
  // This is the lesson the slab tower taught and that a first pass here ignored: on
  // AM271 the horizontal rhythm comes from 45 projecting slab rings, and it survives
  // any viewing distance. Here the first attempt used 8 big smooth lofted surfaces
  // with the floor lines painted into the map — and at 500 m tall on a slender tower
  // the mip chain averaged them away into uniform gloss. No material tweak fixes
  // that; the detail has to exist as geometry.
  const bodyH = MODULE_H - DIM.corniceH;
  const floorsInBody = DIM.floorsPerModule;
  for (let m = 0; m < DIM.modules; m += 1) {
    const yModule = STACK_Y0 + m * MODULE_H;
    for (let f = 0; f < floorsInBody; f += 1) {
      const t0 = f / floorsInBody;
      const t1 = (f + 1) / floorsInBody;
      const s0 = 1 + DIM.flare * t0;
      const s1 = 1 + DIM.flare * t1;
      const y = yModule + t0 * bodyH;
      const h = bodyH / floorsInBody;
      const glassH = h - DIM.slabH;
      const sGlassTop = s0 + (s1 - s0) * (glassH / h);
      glassGeoms.push(
        sweepBand(scalePath(basePath, s0), glassH, y, 0, 1, scalePath(basePath, sGlassTop), true),
      );
      // projecting slab nosing at every floor line
      const slabPath = offsetChamferedSquare(
        DIM.plan * s1, DIM.chamfer * s1, DIM.notch, DIM.slabProject,
      );
      corniceGeoms.push(sweepBand(slabPath, DIM.slabH, y + glassH, 0, 1, undefined, true));
      corniceGeoms.push(capDisc(slabPath, y + glassH + DIM.slabH, true));
      corniceGeoms.push(capDisc(slabPath, y + glassH, false));
    }
    // deep cornice lip crowning each module
    corniceGeoms.push(sweepBand(lipPath, DIM.corniceH, yModule + bodyH, 0, 1, undefined, true));
    corniceGeoms.push(capDisc(lipPath, yModule + bodyH + DIM.corniceH, true));
    corniceGeoms.push(capDisc(lipPath, yModule + bodyH, false));
  }
  // Real vertical fins as well as the texture: geometry carries the vertical rhythm
  // at distance, the texture carries the individual panes up close.
  //
  // Fins are built PER FLOOR at that floor's own flare scale. Building them per module
  // at the mid-module scale made them punch through the silhouette at every module
  // base, because the module widens 10% over its height.
  const finGeoms: THREE.BufferGeometry[] = [];
  const FINS = 36;
  for (let m = 0; m < DIM.modules; m += 1) {
    const yModule = STACK_Y0 + m * MODULE_H;
    for (let f = 0; f < floorsInBody; f += 1) {
      const t0 = f / floorsInBody;
      const s0 = 1 + DIM.flare * t0;
      const y = yModule + t0 * bodyH;
      const h = bodyH / floorsInBody - DIM.slabH;
      for (const p of pointsAlongPath(scalePath(basePath, s0), FINS)) {
        const fin = new THREE.BoxGeometry(0.30, h, 0.30);
        fin.rotateY(p.heading);
        fin.translate(p.x * 1.002, y + h / 2, p.z * 1.002);
        finGeoms.push(fin);
      }
    }
  }
  const fins = new THREE.Mesh(mergeGeoms(finGeoms), mCornice);
  fins.name = 'mullion-fins';
  stack.add(fins);

  const glass = new THREE.Mesh(mergeGeoms(glassGeoms), mGlass);
  glass.name = 'module-glazing';
  glass.receiveShadow = shadows;
  const cornices = new THREE.Mesh(mergeGeoms(corniceGeoms), mCornice);
  cornices.name = 'module-cornices';
  // Cornices deliberately do NOT cast: 8 big lips over a 620 m shadow frustum smear
  // shadow across the whole elevation and crush the facade (the AM271 slab lesson).
  cornices.castShadow = false;
  stack.add(glass, cornices);
  root.add(stack); nodes['module-stack'] = stack;

  // ---------------------------------------------------------------- ruyi medallions
  const medallions = new THREE.Group(); medallions.name = 'ruyi-medallions';
  const discGeom = new THREE.CylinderGeometry(DIM.medallionR, DIM.medallionR, 3.2, 40);
  discGeom.rotateX(Math.PI / 2);
  const ringGeom = new THREE.TorusGeometry(DIM.medallionR * 0.74, 0.95, 10, 40);
  const half = DIM.plan / 2 + 1.2;
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2;
    const px = Math.sin(a) * half, pz = Math.cos(a) * half;
    const disc = new THREE.Mesh(discGeom, mMedallion);
    disc.position.set(px, DIM.pedestalH - 7.0, pz);
    disc.rotation.y = a;
    disc.castShadow = shadows;
    const ring = new THREE.Mesh(ringGeom, mMetal);
    ring.position.set(px * 1.03, DIM.pedestalH - 7.0, pz * 1.03);
    ring.rotation.y = a;
    medallions.add(disc, ring);
  }
  root.add(medallions); nodes['ruyi-medallions'] = medallions;

  // ---------------------------------------------------------------- crown (two tapers)
  const crown = new THREE.Mesh(
    mergeGeoms([
      sweepBand(scalePath(basePath, 1 + DIM.flare), DIM.crownH, CROWN_Y0, 0, 1,
        scalePath(basePath, DIM.crownTopScale), true),
      sweepBand(scalePath(basePath, DIM.crownTopScale), DIM.crownUpperH, CROWN_UPPER_Y0, 0, 1,
        scalePath(basePath, DIM.crownUpperScale), true),
    ]),
    mGlass,
  );
  crown.name = 'crown-taper';
  crown.castShadow = shadows; crown.receiveShadow = shadows;
  root.add(crown); nodes['crown-taper'] = crown;

  // ---------------------------------------------------------------- stepped pinnacle
  // A near-straight stepped BOX with a cornice bulge, not a cone.
  const pin = new THREE.Group(); pin.name = 'pinnacle';
  const pinBody = new THREE.Mesh(
    sweepBand(cham(DIM.pinnacleScale), DIM.pinnacleH, PINNACLE_Y0, 0, 1,
      cham(DIM.pinnacleTopScale), true),
    mPinnacleGlass,
  );
  pinBody.name = 'pinnacle-body';
  pin.add(pinBody);

  const bands: THREE.BufferGeometry[] = [];
  // flared skirt where the pinnacle meets the crown
  bands.push(sweepBand(cham(DIM.pinnacleScale, 2.4), 2.6, PINNACLE_Y0 - 1.0, 0, 1, undefined, true));
  bands.push(capDisc(cham(DIM.pinnacleScale, 2.4), PINNACLE_Y0 + 1.6, true));
  // cornice bulge at ~45% height, matching the measured 0.43 width band
  const cy = PINNACLE_Y0 + DIM.pinnacleH * 0.45;
  bands.push(sweepBand(cham(DIM.pinnacleCornice), 3.0, cy, 0, 1, undefined, true));
  bands.push(capDisc(cham(DIM.pinnacleCornice), cy + 3.0, true));
  bands.push(capDisc(cham(DIM.pinnacleCornice), cy, false));
  // dark cap on top of the pinnacle
  bands.push(sweepBand(cham(DIM.pinnacleTopScale, 1.1), 3.2, NECK_Y0 - 3.2, 0, 1, undefined, true));
  bands.push(capDisc(cham(DIM.pinnacleTopScale, 1.1), NECK_Y0, true));
  const pinBands = new THREE.Mesh(mergeGeoms(bands), mPinnacle);
  pinBands.name = 'pinnacle-bands';
  pin.add(pinBands);
  pin.traverse((o: THREE.Object3D) => { (o as THREE.Mesh).castShadow = shadows; });
  root.add(pin); nodes.pinnacle = pin;

  // ---------------------------------------------------------------- neck + ball + mast
  const top = new THREE.Group(); top.name = 'mast-assembly';

  const neck = new THREE.Mesh(
    sweepBand(cham(DIM.pinnacleTopScale), DIM.neckH, NECK_Y0, 0, 1, cham(DIM.neckScale), true),
    mPinnacle,
  );
  neck.name = 'neck';
  top.add(neck);

  // THE BALL: the flattened bulbous collar the mast rises out of. Measured peak width
  // 37 px against a 180 px stack — it is wider than the mast but much narrower than
  // the pinnacle, and it sits ABOVE the neck, not on the pinnacle directly.
  const ball = new THREE.Group(); ball.name = 'ball-collar';
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(DIM.ballR, 32, 20), mMetal);
  bulb.scale.set(1, 0.62, 1);
  bulb.position.y = BALL_Y0 + DIM.ballH * 0.45;
  const bulbRing = new THREE.Mesh(new THREE.TorusGeometry(DIM.ballR * 0.98, 0.55, 10, 36), mMast);
  bulbRing.rotation.x = Math.PI / 2;
  bulbRing.position.y = BALL_Y0 + DIM.ballH * 0.45;
  ball.add(bulb, bulbRing);
  top.add(ball); nodes['ball-collar'] = ball;

  const shaftH = DIM.mastH * 0.70;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 2.1, shaftH, 16), mMast);
  shaft.position.y = MAST_Y0 + shaftH / 2;
  top.add(shaft);

  const ringG = new THREE.TorusGeometry(1.5, 0.28, 8, 22);
  ringG.rotateX(Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringG, mMast, 12);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 12; i += 1) {
    dummy.position.set(0, MAST_Y0 + shaftH * 0.94 + i * 1.05, 0);
    dummy.scale.setScalar(1 - i * 0.032);
    dummy.updateMatrix();
    rings.setMatrixAt(i, dummy.matrix);
  }
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 5.0, 10), mMast);
  tip.position.y = TOTAL_H - 2.5;
  top.add(rings, tip);
  top.traverse((o: THREE.Object3D) => { (o as THREE.Mesh).castShadow = shadows; });
  root.add(top); nodes['mast-assembly'] = top;

  // ---------------------------------------------------------------- context
  if (context) {
    const ctx = new THREE.Group(); ctx.name = 'site-context';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mGround);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = shadows;
    ctx.add(ground);

    // Plain low-rise neighbours. The reference surroundings are dense real city that
    // the brief explicitly does not need reproduced — massing only.
    const r = rng(7788);
    const blocks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 44; i += 1) {
      const w = 26 + r() * 44, d = 26 + r() * 38, hgt = 14 + r() * 40;
      const ang = r() * Math.PI * 2, dist = 150 + r() * 340;
      const g = new THREE.BoxGeometry(w, hgt, d);
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
    stats: {
      floors: DIM.modules * DIM.floorsPerModule,
      heightM: TOTAL_H, meshes, triangles,
    },
  };
  (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime = runtime;
  return root;
}
