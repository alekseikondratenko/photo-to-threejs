import { createAm271TowerModel, TOTAL_H } from '../models/am271Tower';
import type { BuildingModel } from '../lib/types';

export const am271: BuildingModel = {
  id: 'am271',
  label: 'Residential Tower AM271',
  blurb: 'Procedural Three.js reconstruction from one archviz render',
  referenceImage: '/reference-am271.svg',
  heightM: TOTAL_H,
  build: (o) => createAm271TowerModel(o),

  // The reference is an archviz render with a SHIFTED LENS: verticals dead parallel
  // yet the tower centred. Solved for a ~202 m vertical span at 429 m.
  views: {
    ref:  { pos: [151, 25, 401], target: [0, 25, 0], fov: 50.4, shift: { fullScale: 2, offsetYFrac: 0.134 } },
    q34:  { pos: [290, 110, 330],  target: [0, TOTAL_H * 0.45, 0], fov: 32 },
    side: { pos: [450, 30, 25],    target: [0, TOTAL_H * 0.47, 0], fov: 26 },
    rear: { pos: [-150, 72, -430], target: [0, TOTAL_H * 0.47, 0], fov: 26 },
    top:  { pos: [140, 260, 200],  target: [0, TOTAL_H * 0.72, 0], fov: 40 },
  },

  lighting: {
    sun: { color: 0xfff4e2, intensity: 1.95, position: [-260, 320, 210] },
    hemi: { sky: 0x9eb5dd, ground: 0xb4a69a, intensity: 2.45 },
    skyStops: [
      [0.00, '#7d9ed4'], [0.34, '#9eb5dd'], [0.62, '#c3d0e4'],
      [0.78, '#d7dce5'], [1.00, '#b9b0a6'],
    ],
    exposure: 1.08,
    shadowExtent: 260,
  },

  // Measured off the reference photograph by pixel sampling.
  targets: { litLuma: 135.6, shadowLuma: 84.5, ratio: 1.60, widthFrac: 0.192 },
};
