import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { installMeasureHarness } from './lib/measure';
import type { BuildingModel, View, ModelRuntime } from './lib/types';

// Add your subjects here: write models/<id>.ts + scenes/<id>.ts (see the
// BuildingModel contract in lib/types.ts), import the scene, and append it.
// The viewer needs at least one model before it will render.
const MODELS: BuildingModel[] = [];

const app = document.getElementById('app')!;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 12000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 6000;
controls.minDistance = 30;

// ---------------------------------------------------------------- scene state
let active: BuildingModel = MODELS[0];
let activeView: View = MODELS[0]?.views.ref ?? { pos: [60, 40, 90], target: [0, 20, 0], fov: 40 };
let root: THREE.Group | null = null;
let runtime: ModelRuntime;
let sun: THREE.DirectionalLight | null = null;
let hemi: THREE.HemisphereLight | null = null;
let wire = false;
let ctxOn = true;

function skyTexture(stops: [number, string][]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  for (const [p, col] of stops) grad.addColorStop(p, col);
  g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n: THREE.Object3D) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[];
    (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
  });
}

function applyProjection(v: View) {
  if (v.shift) {
    const fullH = innerHeight * v.shift.fullScale;
    camera.aspect = innerWidth / fullH;
    camera.setViewOffset(innerWidth, fullH, 0, v.shift.offsetYFrac * innerHeight, innerWidth, innerHeight);
  } else {
    camera.clearViewOffset();
    camera.aspect = innerWidth / innerHeight;
  }
  camera.fov = v.fov;
  camera.updateProjectionMatrix();
}

function setView(v: View) {
  activeView = v;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  applyProjection(v);
  controls.update();
}

function loadModel(model: BuildingModel) {
  active = model;
  if (root) { scene.remove(root); disposeTree(root); }
  if (sun) scene.remove(sun, sun.target);
  if (hemi) scene.remove(hemi);

  const sky = skyTexture(model.lighting.skyStops);
  scene.background = sky;
  scene.environment = pmrem.fromEquirectangular(sky).texture;
  renderer.toneMappingExposure = model.lighting.exposure;

  sun = new THREE.DirectionalLight(model.lighting.sun.color, model.lighting.sun.intensity);
  sun.position.set(...model.lighting.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = model.lighting.shadowExtent * 6;
  const s = model.lighting.shadowExtent;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s * 1.6; sun.shadow.camera.bottom = -s * 0.4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.target.position.set(0, model.heightM * 0.35, 0);
  scene.add(sun, sun.target);

  hemi = new THREE.HemisphereLight(
    model.lighting.hemi.sky, model.lighting.hemi.ground, model.lighting.hemi.intensity,
  );
  scene.add(hemi);

  root = model.build({ context: ctxOn, shadows: true });
  scene.add(root);
  runtime = (root.userData as { sculptRuntime: ModelRuntime }).sculptRuntime;

  wire = false;
  setView(model.views.ref);
  refreshHud();
}

// ---------------------------------------------------------------- HUD
const byId = (id: string) => document.getElementById(id)!;
const VIEW_BUTTONS: [string, string][] = [
  ['v-ref', 'ref'], ['v-34', 'q34'], ['v-side', 'side'], ['v-rear', 'rear'], ['v-top', 'top'],
];

function refreshHud() {
  byId('title').textContent = active.label;
  byId('blurb').textContent = active.blurb;
  (byId('refimg') as HTMLImageElement).src = active.referenceImage;
  byId('stats').innerHTML =
    `${runtime.stats.floors} floors · ${runtime.stats.heightM.toFixed(1)} m<br>`
    + `${runtime.stats.meshes} meshes · ${runtime.stats.triangles.toLocaleString()} tris`;
  MODELS.forEach((m) => byId(`m-${m.id}`).classList.toggle('on', m.id === active.id));
  VIEW_BUTTONS.forEach(([b], i) => byId(b).classList.toggle('on', i === 0));
  byId('t-wire').classList.remove('on');
  byId('t-ctx').classList.toggle('on', ctxOn);
}

const bar = byId('models');
for (const m of MODELS) {
  const b = document.createElement('button');
  b.id = `m-${m.id}`;
  b.textContent = m.label;
  b.onclick = () => loadModel(m);
  bar.appendChild(b);
}

for (const [id, key] of VIEW_BUTTONS) {
  byId(id).onclick = () => {
    setView(active.views[key]);
    VIEW_BUTTONS.forEach(([b]) => byId(b).classList.toggle('on', b === id));
  };
}
byId('t-wire').onclick = () => {
  wire = !wire;
  byId('t-wire').classList.toggle('on', wire);
  Object.values(runtime.materials).forEach((m) => {
    (m as THREE.MeshStandardMaterial).wireframe = wire;
  });
};
byId('t-ctx').onclick = () => {
  ctxOn = !ctxOn;
  byId('t-ctx').classList.toggle('on', ctxOn);
  const n = runtime.nodes['site-context'];
  if (n) n.visible = ctxOn;
};
byId('t-ref').onclick = () => {
  const el = byId('ref');
  el.classList.toggle('hidden');
  byId('t-ref').classList.toggle('on', !el.classList.contains('hidden'));
};

// ---------------------------------------------------------------- loop
addEventListener('resize', () => {
  applyProjection(activeView);
  renderer.setSize(innerWidth, innerHeight);
});

installMeasureHarness(() => active.targets);
// debug handles for the render-review loop
Object.assign(window as unknown as Record<string, unknown>, {
  __scene: scene, __camera: camera, __renderer: renderer, __controls: controls,
  __runtime: () => runtime, __active: () => active,
});
if (MODELS.length > 0) {
  loadModel(MODELS[0]);
} else {
  document.getElementById('title')!.textContent = 'No models registered';
  document.getElementById('blurb')!.textContent =
    'Write models/<id>.ts + scenes/<id>.ts and add the scene to MODELS in main.ts.';
}

renderer.setAnimationLoop(() => {
  // Resize events are missed while the tab is hidden or during HMR, leaving the
  // drawing buffer at a stale size — and every scoring pass then measures a
  // resampled image. Cheaper to check every frame than to debug it again.
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== innerWidth || size.y !== innerHeight) {
    applyProjection(activeView);
    renderer.setSize(innerWidth, innerHeight);
  }
  controls.update();
  renderer.render(scene, camera);
  (window as unknown as { __ready: boolean }).__ready = true;
});
