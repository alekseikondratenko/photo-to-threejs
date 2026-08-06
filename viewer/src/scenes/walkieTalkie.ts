import { createWalkieTalkieModel, TOTAL_H } from '../models/walkieTalkie';
import type { BuildingModel } from '../lib/types';

/**
 * 20 Fenchurch Street — camera, light rig and reference targets.
 *
 * The reference is a real ELEVATED photograph (rooftop, roughly a third of the way up
 * the tower), not a shifted-lens archviz render, so the camera tilts rather than
 * offsetting the frustum. It behaves close to linearly all the same: the floor pitch
 * measured 8.75 / 8.75 / 9.25 px across three height bands, so vertical foreshortening
 * over the visible span is inside the noise.
 *
 * Camera solved from the pixels:
 *  - horizon (vanishing row of the facade's horizontal lines) sits at y ~ 280 of 516,
 *    i.e. 2.8 deg below frame centre -> a slight up-tilt, hence the raised target.
 *  - the tower point at the horizon row is ~60 m up the shaft, so the camera is at
 *    ~60 m: a rooftop about fifteen floors up.
 *  - the near roof corner reads 195 px above the horizon; with the measured floor pitch
 *    that fixes focal-length-over-distance at ~2.16 px/m, which for a 30 deg vertical
 *    field puts the camera ~430 m out.
 *  - the plan centre sits at x = 191.5 of 387: the tower is centred, so no yaw offset.
 *  - camera azimuth 36.9 deg off the broad-face normal. UNCONSTRAINED by one view —
 *    the pixels pin the projected width, not the split between the plan axes.
 */
export const walkieTalkie: BuildingModel = {
  id: 'walkietalkie',
  label: '20 Fenchurch St (Walkie-Talkie)',
  blurb: 'Procedural Three.js reconstruction from one 387x516 photograph',
  referenceImage: '/reference-walkietalkie.svg',
  heightM: TOTAL_H,
  build: (o) => createWalkieTalkieModel(o),

  views: {
    ref:  { pos: [439, 150, 587], target: [0, 76, 0], fov: 34 },
    q34:  { pos: [330, 150, 300], target: [0, 78, 0], fov: 32 },
    side: { pos: [470, 70, 30], target: [0, 76, 0], fov: 28 },
    rear: { pos: [-250, 90, -350], target: [0, 78, 0], fov: 30 },
    top:  { pos: [190, 320, 250], target: [0, 128, 0], fov: 40 },
  },

  lighting: {
    // Sun from camera-left and behind: the broad +Z face is lit, the +X end elevation
    // falls into shade, which is what the reference shows. The measured lit/shadow ratio
    // is only 1.45 — a soft, high-fill London sky, far gentler than Taipei's 2.09 — so
    // the hemisphere carries a lot of the load and the sun is held back.
    sun: { color: 0xfff3e2, intensity: 3.15, position: [-330, 430, 300] },
    hemi: { sky: 0x8ab6ec, ground: 0x8d9088, intensity: 2.6 },
    // Sampled down the reference sky: #0b5ea2 at the top of frame through #4c83c6
    // mid-frame to #accee8 at the horizon.
    skyStops: [
      [0.00, '#0d5aa4'], [0.30, '#3f7ec6'], [0.55, '#7ba8de'],
      [0.72, '#b6d6ee'], [0.80, '#c6d6e0'], [1.00, '#7b8388'],
    ],
    exposure: 1.44,
    shadowExtent: 300,
  },

  /**
   * Measured off the reference photograph by pixel sampling.
   *
   *  litLuma / shadowLuma / ratio come from the same sampling windows the harness uses
   *  (lit x in [l+10, l+0.45w], shadow x in [l+0.72w, r-6]) placed over the reference's
   *  own silhouette: #7a8b8d luma 135.2 and #3f6382 luma 93.3, ratio 1.45.
   *
   *  widthFrac is ASPECT-CORRECTED (a raw fraction is not comparable between a 387x516
   *  portrait photograph and a landscape viewport). The invariant used is the tower's
   *  own width against the frame HEIGHT: 160 px wide in a 516 px-tall frame = 0.310.
   *  Divided by the viewer's aspect at the size this was tuned at (1512x818, aspect
   *  1.848) that is 0.168. Re-derive it as 0.310 / aspect if the window changes shape.
   */
  targets: { litLuma: 135.2, shadowLuma: 93.3, ratio: 1.45, widthFrac: 0.168 },
};
