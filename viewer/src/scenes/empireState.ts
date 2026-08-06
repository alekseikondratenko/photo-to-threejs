import { createEmpireStateModel, TOTAL_H } from '../models/empireState';
import type { BuildingModel } from '../lib/types';

export const empireState: BuildingModel = {
  id: 'empirestate',
  label: 'Empire State Building',
  blurb: 'Procedural Three.js reconstruction from one photograph',
  referenceImage: '/reference-empirestate.jpg',
  heightM: TOTAL_H,
  build: (o) => createEmpireStateModel(o),

  // Camera solved from the reference, not guessed: the horizon in the photograph sits
  // at image row ~1002, which at 0.334 m/px is an eye height of ~169 m — a ~50th-floor
  // rooftop. Fitting the frame's vertical span (2.7 m to 503 m at the tower) to the
  // P900's 35 mm-equivalent field of view puts the camera ~480 m out.
  views: {
    ref:  { pos: [381, 169, 476],  target: [0, 212, 0], fov: 46 },
    q34:  { pos: [430, 250, 500],  target: [0, 190, 0], fov: 38 },
    side: { pos: [780, 120, 30],   target: [0, 195, 0], fov: 34 },
    rear: { pos: [-330, 150, -430], target: [0, 195, 0], fov: 42 },
    top:  { pos: [260, 520, 340],  target: [0, 330, 0], fov: 42 },
  },

  lighting: {
    // OVERCAST — a third archetype. Measured lit/shadow ratio is only 1.27, so the key
    // is weak and the sky dome does nearly all the work. Driving this with a strong sun
    // (as Taipei needs) would blow the contrast far past the reference.
    sun: { color: 0xf2f0ec, intensity: 4.3, position: [-420, 620, 380] },
    hemi: { sky: 0xe1e9f6, ground: 0x7d7a75, intensity: 1.72 },
    skyStops: [
      [0.00, '#dfe8f5'], [0.32, '#e1e9f6'], [0.62, '#cdd3da'],
      [0.84, '#b5b5b4'], [1.00, '#8f8d89'],
    ],
    exposure: 1.12,
    shadowExtent: 520,
  },

  // Measured off the reference photograph by pixel sampling.
  // widthFrac is aspect-corrected: the photo is a 1125x1500 portrait frame where the
  // shaft reads 209 px over a 1328 px tower, i.e. 0.157 of its own height.
  targets: { litLuma: 112.4, shadowLuma: 88.2, ratio: 1.27, widthFrac: 0.157 },
};
