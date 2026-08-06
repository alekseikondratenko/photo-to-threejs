import { createTaipei101Model, TOTAL_H } from '../models/taipei101';
import type { BuildingModel } from '../lib/types';

export const taipei101: BuildingModel = {
  id: 'taipei101',
  label: 'Taipei 101',
  blurb: 'Procedural Three.js reconstruction from one photograph',
  referenceImage: '/reference-taipei101.jpg',
  heightM: TOTAL_H,
  build: (o) => createTaipei101Model(o),

  // A real ground-level photograph, NOT a shifted-lens archviz render: the verticals
  // genuinely converge, so the reference view tilts rather than offsetting the frustum.
  // Face-width split either side of the corner line puts the yaw at ~39 degrees.
  views: {
    ref:  { pos: [660, 105, 815], target: [0, TOTAL_H * 0.44, 0], fov: 30 },
    q34:  { pos: [620, 330, 700], target: [0, TOTAL_H * 0.42, 0], fov: 34 },
    side: { pos: [1180, 90, 40],  target: [0, TOTAL_H * 0.42, 0], fov: 27 },
    rear: { pos: [-560, 150, -900], target: [0, TOTAL_H * 0.42, 0], fov: 28 },
    top:  { pos: [340, 640, 480], target: [0, TOTAL_H * 0.74, 0], fov: 42 },
  },

  lighting: {
    // Hard tropical morning sun from camera-left; measured lit/shadow ratio 2.09,
    // much harsher than the archviz reference's 1.60.
    sun: { color: 0xfff2dc, intensity: 5.2, position: [-620, 700, 430] },
    hemi: { sky: 0x86b0e8, ground: 0x8f9a78, intensity: 2.1 },
    skyStops: [
      [0.00, '#3f6fc0'], [0.30, '#5c89d0'], [0.60, '#71a2e4'],
      [0.82, '#a9c8ee'], [1.00, '#93a08a'],
    ],
    exposure: 1.24,
    shadowExtent: 620,
  },

  // Measured off the reference photograph by pixel sampling.
  //
  // widthFrac is ASPECT-CORRECTED. The photograph is a 960x1547 portrait frame where
  // the tower reads 180 px wide; the viewer is near-square, so the raw 0.187 fraction
  // is not comparable. Corrected against the tower's own silhouette (180 px wide over
  // ~1294 px tall once the tree-occluded pedestal is added back) this is 0.139.
  targets: { litLuma: 173.8, shadowLuma: 83.1, ratio: 2.09, widthFrac: 0.139 },
};
