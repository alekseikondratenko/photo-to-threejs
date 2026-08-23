import * as THREE from 'three';

export type View = {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
  /**
   * Architectural shifted lens: render a sub-window of a taller frustum so the
   * verticals stay parallel while the subject sits centred. Archviz references
   * are almost always shot this way; a tilted camera cannot reproduce it.
   */
  shift?: { fullScale: number; offsetYFrac: number };
};

export type LightRig = {
  sun: { color: number; intensity: number; position: [number, number, number] };
  hemi: { sky: number; ground: number; intensity: number };
  skyStops: [number, string][];
  exposure: number;
  shadowExtent: number;
};

/** What the reference photograph measures, so the render can be scored against it. */
export type ReferenceTargets = {
  litLuma: number;
  shadowLuma: number;
  ratio: number;
  widthFrac: number;
  /**
   * The subject's column extent in the reference photograph, in ORIGINAL image
   * pixels. Set it once, after measuring, and every scored save reports an extra
   * subject-band block alongside the full-frame numbers — the flanks of a real
   * photograph usually measure trees and neighbours, not the building.
   * The render trigger forwards this automatically; nobody has to remember it.
   */
  span?: { x0: number; x1: number } | null;
  /** Optional extra checks a specific building cares about. */
  notes?: Record<string, number>;
};

export type BuildingModel = {
  id: string;
  label: string;
  referenceImage: string;
  heightM: number;
  build: (opts: { context: boolean; shadows: boolean }) => THREE.Group;
  views: Record<string, View>;
  lighting: LightRig;
  targets: ReferenceTargets;
  /** Sub-heading shown in the HUD. */
  blurb: string;
};

export type ModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  materials: Record<string, THREE.Material>;
  stats: { floors: number; heightM: number; meshes: number; triangles: number };
};
