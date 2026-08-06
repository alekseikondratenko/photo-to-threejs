import * as THREE from 'three';

/**
 * Shared procedural-geometry helpers for photo-to-Three.js building reconstruction.
 *
 * Every function here encodes a bug that cost a review cycle the first time round.
 * Read the comments before changing any of them.
 */

// ---------------------------------------------------------------- randomness
/** Deterministic PRNG — a reload must reproduce the identical facade. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- plan paths
/** Closed rounded-rectangle path in the XZ plane, CCW, centred on the origin. */
export function roundedRectPath(w: number, d: number, r: number, cornerSeg = 14): THREE.Vector2[] {
  const hw = w / 2 - r, hd = d / 2 - r;
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [
    [hw, hd, 0], [-hw, hd, Math.PI / 2], [-hw, -hd, Math.PI], [hw, -hd, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= cornerSeg; i += 1) {
      const a = a0 + (Math.PI / 2) * (i / cornerSeg);
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
  }
  return pts;
}

/**
 * Square with its four corners cut at 45 degrees — an irregular octagon.
 * `notch` optionally recesses the middle of each chamfer face inward, which is
 * what gives Taipei 101 its shadowed corner channel.
 */
export function chamferedSquarePath(size: number, chamfer: number, notch = 0): THREE.Vector2[] {
  const h = size / 2, c = chamfer;
  const pts: THREE.Vector2[] = [];
  const corners: [number, number][] = [[h, h], [-h, h], [-h, -h], [h, -h]];
  for (let k = 0; k < 4; k += 1) {
    const [cx, cy] = corners[k];
    const sx = Math.sign(cx), sy = Math.sign(cy);
    // entering point on the vertical/horizontal side, then across the chamfer
    const a = new THREE.Vector2(cx, cy - sy * c);
    const b = new THREE.Vector2(cx - sx * c, cy);
    if (k % 2 === 0) { pts.push(a); } else { pts.push(a); }
    if (notch > 0) {
      const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
      const len = Math.hypot(mid.x, mid.y) || 1;
      pts.push(new THREE.Vector2(
        mid.x - (mid.x / len) * notch, mid.y - (mid.y / len) * notch,
      ));
    }
    pts.push(b);
  }
  return pts;
}

/**
 * Rectangular plan with optional corner chamfers — the Art Deco setback archetype.
 * Separate from `chamferedSquarePath` because that one assumes a square.
 */
export function rectPath(w: number, d: number, chamfer = 0): THREE.Vector2[] {
  const hw = w / 2, hd = d / 2, c = chamfer;
  if (c <= 0) {
    return [
      new THREE.Vector2(hw, hd), new THREE.Vector2(-hw, hd),
      new THREE.Vector2(-hw, -hd), new THREE.Vector2(hw, -hd),
    ];
  }
  return [
    new THREE.Vector2(hw, hd - c), new THREE.Vector2(hw - c, hd),
    new THREE.Vector2(-hw + c, hd), new THREE.Vector2(-hw, hd - c),
    new THREE.Vector2(-hw, -hd + c), new THREE.Vector2(-hw + c, -hd),
    new THREE.Vector2(hw - c, -hd), new THREE.Vector2(hw, -hd + c),
  ];
}

/**
 * Rectangular plan with recessed vertical channels cut into each face.
 *
 * Art Deco setback towers (Empire State, Chrysler) are not simple extruded
 * rectangles: solid masonry corner masses are separated from the window field by
 * deep light-well notches that run the full height. Those notches read in a
 * photograph as hard dark vertical channels, and without them the tower renders as
 * a plain box no matter how good the facade texture is.
 *
 * `notchFracs` are positions along each face (0..1, symmetric is typical).
 */
export function notchedRectPath(
  w: number, d: number, notchFracs: number[], notchWidth: number, notchDepth: number,
): THREE.Vector2[] {
  const hw = w / 2, hd = d / 2;
  const corners = [
    new THREE.Vector2(hw, hd), new THREE.Vector2(-hw, hd),
    new THREE.Vector2(-hw, -hd), new THREE.Vector2(hw, -hd),
  ];
  const out: THREE.Vector2[] = [];
  for (let e = 0; e < 4; e += 1) {
    const a = corners[e], b = corners[(e + 1) % 4];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len, uy = ey / len;
    // inward normal: rotate the edge direction so it points at the origin
    let nx = uy, ny = -ux;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (nx * mx + ny * my > 0) { nx = -nx; ny = -ny; }
    out.push(a.clone());
    for (const t of notchFracs) {
      const c = t * len, hwn = notchWidth / 2;
      if (c - hwn <= 0 || c + hwn >= len) continue;
      const s0 = c - hwn, s1 = c + hwn;
      out.push(new THREE.Vector2(a.x + ux * s0, a.y + uy * s0));
      out.push(new THREE.Vector2(a.x + ux * s0 + nx * notchDepth, a.y + uy * s0 + ny * notchDepth));
      out.push(new THREE.Vector2(a.x + ux * s1 + nx * notchDepth, a.y + uy * s1 + ny * notchDepth));
      out.push(new THREE.Vector2(a.x + ux * s1, a.y + uy * s1));
    }
  }
  return out;
}

/** Uniformly scale a closed plan path about the origin. */
export function scalePath(path: THREE.Vector2[], k: number): THREE.Vector2[] {
  return path.map((p) => new THREE.Vector2(p.x * k, p.y * k));
}

/**
 * Outward-offset a convex plan path by `d` metres (radial approximation).
 *
 * ONLY valid for near-circular plans. On a chamfered or rounded-rectangle plan the
 * corner vertices sit further from the origin than the face midpoints, so a radial
 * push moves them further still and grows fins off the corners — which is exactly
 * what turned a tower pedestal into a rocket. For chamfered plans use
 * `offsetChamferedSquare`, which offsets each EDGE along its own normal.
 */
export function offsetPath(path: THREE.Vector2[], d: number): THREE.Vector2[] {
  return path.map((p) => {
    const len = Math.hypot(p.x, p.y) || 1;
    return new THREE.Vector2(p.x + (p.x / len) * d, p.y + (p.y / len) * d);
  });
}

/**
 * True outward offset of a chamfered square: every edge moves out by `d` along its
 * own normal. A 45-degree chamfer face retreats along both axes, so its cut length
 * grows by d*(sqrt(2)-1) to keep the face angle at 45 degrees.
 */
export function offsetChamferedSquare(
  size: number, chamfer: number, notch: number, d: number,
): THREE.Vector2[] {
  return chamferedSquarePath(size + 2 * d, chamfer + d * (Math.SQRT2 - 1), notch);
}

export function pathPerimeter(path: THREE.Vector2[]): number {
  let s = 0;
  for (let i = 0; i < path.length; i += 1) s += path[i].distanceTo(path[(i + 1) % path.length]);
  return s;
}

/**
 * Cumulative arc-length fraction (0..1) of each vertex. Use this to place a
 * feature (a corner strip, a pier) at an exact U coordinate in a swept texture.
 */
export function arcFractions(path: THREE.Vector2[]): number[] {
  const cum = [0];
  for (let i = 1; i <= path.length; i += 1) {
    cum.push(cum[i - 1] + path[i - 1].distanceTo(path[i % path.length]));
  }
  const total = cum[path.length];
  return cum.map((v) => v / total);
}

function shapeFromPath(path: THREE.Vector2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i += 1) s.lineTo(path[i].x, path[i].y);
  s.closePath();
  return s;
}

// ---------------------------------------------------------------- solids
/**
 * Solid vertical prism spanning y0 .. y0 + height.
 *
 * BUG THAT COST A CYCLE: after rotateX(-PI/2) the extrusion ALREADY occupies
 * y in [0, height]. Translating by `y0 + height` lifts every volume one full
 * body-length too high — it put a tower's core in the sky above its own crown
 * and read as a mystery black block. Translate by y0 alone.
 */
export function prism(path: THREE.Vector2[], height: number, y0: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeFromPath(path), { depth: height, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/**
 * Vertical band swept around a closed path, with arc-length-proportional U so a
 * repeating curtain-wall texture keeps a constant bay width around curves and
 * chamfers. `loftTo` lofts to a second path at the top for tapered/flared volumes.
 *
 * BUG THAT COST A CYCLE: the triangle order must wind CCW as seen from OUTSIDE.
 * Reversed (a, c, b) every face is back-facing; Three.js then flips the shading
 * normal INWARD, lighting the facade from behind and rendering the whole
 * elevation ~2x too dark. It looks exactly like "the material didn't apply".
 */
export function sweepBand(
  path: THREE.Vector2[],
  height: number,
  y0: number,
  uOffset = 0,
  uScale = 1,
  loftTo?: THREE.Vector2[],
  flatShaded = false,
): THREE.BufferGeometry {
  const n = path.length;
  const top = loftTo ?? path;
  const cum = [0];
  for (let i = 1; i <= n; i += 1) cum.push(cum[i - 1] + path[i - 1].distanceTo(path[i % n]));
  const total = cum[n];

  // FACETED plans (chamfered squares, octagons) must not share vertices across an
  // edge: averaged vertex normals round the corners off and a faceted tower renders
  // as a smooth barrel. Emit one un-shared quad per segment with its own face normal.
  if (flatShaded) {
    const fpos: number[] = [], fuv: number[] = [], fnrm: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = path[i], b = path[(i + 1) % n];
      const at = top[i], bt = top[(i + 1) % n];
      const ua = (cum[i] / total) * uScale + uOffset;
      const ub = (cum[i + 1] / total) * uScale + uOffset;
      const ex = b.x - a.x, ez = b.y - a.y;
      let nx = ez, nz = -ex;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      // tilt the normal for lofted (leaning) faces
      const lean = (Math.hypot(at.x, at.y) - Math.hypot(a.x, a.y)) / (height || 1);
      const ny = -lean;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const push = (px: number, py: number, pz: number, u: number, v: number) => {
        fpos.push(px, py, pz); fuv.push(u, v); fnrm.push(nx * inv, ny * inv, nz * inv);
      };
      push(a.x, y0, a.y, ua, 0);
      push(at.x, y0 + height, at.y, ua, 1);
      push(b.x, y0, b.y, ub, 0);
      push(b.x, y0, b.y, ub, 0);
      push(at.x, y0 + height, at.y, ua, 1);
      push(bt.x, y0 + height, bt.y, ub, 1);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(fnrm, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(Array.from({ length: fpos.length / 3 }, (_, k) => k));
    return fg;
  }

  const pos: number[] = [], uvs: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const p = path[i % n], q = top[i % n];
    const prev = path[(i - 1 + n) % n], next = path[(i + 1) % n];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let nx = ty, nz = -tx;
    if (nx * p.x + nz * p.y < 0) { nx = -nx; nz = -nz; }   // force outward on a convex hull
    const u = (cum[i] / total) * uScale + uOffset;
    pos.push(p.x, y0, p.y, q.x, y0 + height, q.y);
    uvs.push(u, 0, u, 1);
    nrm.push(nx, 0, nz, nx, 0, nz);
  }
  for (let i = 0; i < n; i += 1) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  if (loftTo) g.computeVertexNormals();     // lofted sides are not vertical
  return g;
}

/** Horizontal cap filling a closed path at height y, facing up (+Y) or down. */
export function capDisc(path: THREE.Vector2[], y: number, faceUp = true): THREE.BufferGeometry {
  const n = path.length;
  const pos: number[] = [0, y, 0], uvs: number[] = [0.5, 0.5], nrm: number[] = [0, faceUp ? 1 : -1, 0];
  let maxR = 0;
  for (const p of path) maxR = Math.max(maxR, Math.hypot(p.x, p.y));
  for (const p of path) {
    pos.push(p.x, y, p.y);
    uvs.push(0.5 + p.x / (2 * maxR), 0.5 + p.y / (2 * maxR));
    nrm.push(0, faceUp ? 1 : -1, 0);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = 1 + i, b = 1 + ((i + 1) % n);
    if (faceUp) idx.push(0, b, a); else idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Merge geometries that share the position/normal/uv layout. */
export function mergeGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of geoms) {
    const p = g.getAttribute('position'), nAttr = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i += 1) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(nAttr ? nAttr.getX(i) : 0, nAttr ? nAttr.getY(i) : 1, nAttr ? nAttr.getZ(i) : 0);
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i += 1) idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i += 1) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(idx);
  return out;
}

/** N evenly arc-length-spaced points around a closed path, with tangent headings. */
export function pointsAlongPath(path: THREE.Vector2[], count: number) {
  const n = path.length;
  const cum = [0];
  for (let i = 1; i <= n; i += 1) cum.push(cum[i - 1] + path[i - 1].distanceTo(path[i % n]));
  const total = cum[n];
  const out: { x: number; z: number; heading: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * total;
    let k = 0; while (k < n - 1 && cum[k + 1] < target) k += 1;
    const a = path[k], b = path[(k + 1) % n];
    const seg = (cum[k + 1] - cum[k]) || 1;
    const t = (target - cum[k]) / seg;
    out.push({
      x: a.x + (b.x - a.x) * t,
      z: a.y + (b.y - a.y) * t,
      heading: Math.atan2(b.x - a.x, b.y - a.y),
    });
  }
  return out;
}

/** Count meshes and triangles under a root, expanding instanced counts. */
export function countGeometry(root: THREE.Object3D) {
  let meshes = 0, triangles = 0;
  root.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes += 1;
    const ix = m.geometry.getIndex();
    const n = ix ? ix.count / 3 : m.geometry.getAttribute('position').count / 3;
    triangles += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  });
  return { meshes, triangles: Math.round(triangles) };
}
