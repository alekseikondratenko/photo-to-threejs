import { createFacadeVillaModel, TOTAL_H, DIM } from '../models/facadeVilla';
import type { BuildingModel } from '../lib/types';

export const facadeVilla: BuildingModel = {
  id: 'facadevilla',
  label: 'Villa — "Facade Principale"',
  blurb: 'Procedural Three.js reconstruction from a 2D elevation drawing',
  referenceImage: '/reference-facade.svg',
  heightM: TOTAL_H,
  build: (o) => createFacadeVillaModel(o),

  // The reference is an ORTHOGRAPHIC drawing — no perspective at all. The honest camera
  // match is therefore a near-orthographic one: a long lens far back, dead level, aimed
  // at the facade's mid-height. Any three-quarter view is already showing invented depth.
  views: {
    ref:  { pos: [0, TOTAL_H * 0.5, 78], target: [0, TOTAL_H * 0.5, 0], fov: 10 },
    q34:  { pos: [17, 9.5, 20], target: [0, 4.4, -3], fov: 34 },
    side: { pos: [30, 6.5, -6], target: [0, 4.4, -6], fov: 30 },
    rear: { pos: [-13, 8.5, -30], target: [0, 4.4, -6], fov: 34 },
    top:  { pos: [11, 26, 15], target: [0, 3.0, -5], fov: 36 },
  },

  lighting: {
    // The drawing has no lighting to measure — it is line art with flat fills. So this
    // rig is CHOSEN, not solved: a bright even daylight that reads the slat relief
    // without inventing a mood the reference never had.
    sun: { color: 0xfff6e8, intensity: 2.9, position: [-18, 26, 22] },
    hemi: { sky: 0xcfe0f2, ground: 0x9aa08d, intensity: 2.3 },
    skyStops: [
      [0.00, '#8fb4e2'], [0.35, '#b9d2ee'], [0.70, '#dce8f5'], [1.00, '#a9ad97'],
    ],
    exposure: 1.05,
    shadowExtent: 26,
  },

  // NOTE: unlike every other subject here, these targets are NOT measured from the
  // reference — a flat-fill line drawing has no lit/shadow ratio to sample. They are
  // placeholders so the harness runs; only widthFrac is meaningful, taken from the
  // drawing's exact 250:313 facade ratio.
  targets: { litLuma: 190, shadowLuma: 150, ratio: 1.27, widthFrac: 0.30 },
};
