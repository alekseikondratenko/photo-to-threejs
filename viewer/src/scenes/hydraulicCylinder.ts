import { createHydraulicCylinderModel, TOTAL_H } from '../models/hydraulicCylinder';
import type { BuildingModel } from '../lib/types';

const L = TOTAL_H / 1000;   // part length in metres, for camera framing

export const hydraulicCylinder: BuildingModel = {
  id: 'hydcyl',
  label: 'Bolted Hydraulic Cylinder',
  blurb: 'Procedural Three.js reconstruction from one CAD render',
  referenceImage: '/reference-hydcyl.svg',
  heightM: L,
  build: (o) => createHydraulicCylinderModel(o),

  // The reference is a CAD three-quarter view, part axis at -29.9 deg in the image, with
  // the ROD END NEAREST the viewer — that is what makes the gland's bolt ring visible.
  // The bolting face normal points +X, so the reference camera must sit on +X; from -X
  // the twelve bolt heads are correctly modelled but entirely hidden behind the flange.
  // Distances are in millimetres (model units).
  views: {
    ref:  { pos: [1500, 1500, 3050],  target: [-90, 40, 0], fov: 30 },
    q34:  { pos: [1500, 1150, 1900], target: [0, 0, 0], fov: 32 },
    side: { pos: [0, 150, 2700],     target: [0, 0, 0], fov: 30 },
    rear: { pos: [500, -1150, -2200], target: [0, 0, 0], fov: 32 },
    top:  { pos: [0, 2700, 300],     target: [0, 0, 0], fov: 30 },
  },

  lighting: {
    // A CAD render on white: broad even studio light, a soft key for the highlight
    // that runs down the barrel, and almost no cast shadow.
    sun: { color: 0xffffff, intensity: 2.2, position: [-900, 1600, 1400] },
    hemi: { sky: 0xffffff, ground: 0xc9ced6, intensity: 3.8 },
    skyStops: [
      [0.00, '#ffffff'], [0.45, '#f7f9fb'], [0.75, '#e9edf2'], [1.00, '#d3d8e0'],
    ],
    exposure: 1.15,
    shadowExtent: 1400,
  },

  // Measured off the reference by pixel scan along the solved principal axis.
  // Radii are exact (silhouette half-width of a cylinder is its true radius under
  // orthographic projection); the axial foreshortening is unresolved — see the model
  // header. widthFrac here is the part's own max-width : length ratio, 339/1969.
  targets: { litLuma: 152, shadowLuma: 96, ratio: 1.58, widthFrac: 0.172 },
};
