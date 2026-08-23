/**
 * Render-vs-reference scorer for the save-render gate.
 *
 * This runs INSIDE the workspace dev server (node context, via vite.config)
 * every time a render is saved. It is a trimmed port of the canonical scorer
 * in the photo-to-threejs MCP server (mcp/src/scan.ts) — same detector for
 * both images, same numbers, so scores from the gate and from `score_render`
 * agree. If you change one, change the other.
 *
 * Why it lives here at all: the whole point of the gate is that saving a
 * render and being graded are ONE action. A rule that lives in instructions
 * can be forgotten; a rule that lives in the endpoint cannot. (Pattern
 * borrowed with respect from arc-skill's predict-before-act gate.)
 */
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export function decodeImage(p) {
  const buf = fs.readFileSync(p);
  const lower = p.toLowerCase();
  if (lower.endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { w: png.width, h: png.height, data: new Uint8Array(png.data) };
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
    return { w: img.width, h: img.height, data: new Uint8Array(img.data) };
  }
  throw new Error(`Unsupported image type: ${p} (png/jpg only)`);
}

function resize(src, w, h) {
  if (src.w === w && src.h === h) return src;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = (y * (src.h - 1)) / (h - 1);
    const y0 = Math.floor(sy), y1 = Math.min(src.h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = (x * (src.w - 1)) / (w - 1);
      const x0 = Math.floor(sx), x1 = Math.min(src.w - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.w + x0) * 4 + c];
        const b = src.data[(y0 * src.w + x1) * 4 + c];
        const d = src.data[(y1 * src.w + x0) * 4 + c];
        const e = src.data[(y1 * src.w + x1) * 4 + c];
        out[(y * w + x) * 4 + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
    }
  }
  return { w, h, data: out };
}

const px = (im, x, y) => {
  const i = (y * im.w + x) * 4;
  return [im.data[i], im.data[i + 1], im.data[i + 2]];
};
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]);
}

function rowSkyLR(im, y) {
  const side = (x0, x1) => {
    const ch = [[], [], []];
    for (let x = x0; x < x1; x++) {
      const p = px(im, x, y);
      ch[0].push(p[0]); ch[1].push(p[1]); ch[2].push(p[2]);
    }
    return [median(ch[0]), median(ch[1]), median(ch[2])];
  };
  return { l: side(2, Math.min(14, im.w)), r: side(Math.max(0, im.w - 14), im.w - 2) };
}

function skyAtX(sky, x, w) {
  const t = x / (w - 1);
  return [
    sky.l[0] + (sky.r[0] - sky.l[0]) * t,
    sky.l[1] + (sky.r[1] - sky.l[1]) * t,
    sky.l[2] + (sky.r[2] - sky.l[2]) * t,
  ];
}

function silhouette(im, tol = 42) {
  const rows = [];
  for (let y = 0; y < im.h; y++) {
    const sky = rowSkyLR(im, y);
    const isSubject = (x) => {
      const p = px(im, x, y);
      const s = skyAtX(sky, x, im.w);
      return Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) > tol;
    };
    let left = -1, right = -1;
    for (let x = 0; x < im.w; x++) if (isSubject(x)) { left = x; break; }
    if (left >= 0) for (let x = im.w - 1; x >= left; x--) if (isSubject(x)) { right = x; break; }
    rows.push({ left, right, width: left >= 0 && right >= 0 ? right - left + 1 : 0 });
  }
  return rows;
}

function boundedRows(sil, w) {
  const m = Math.max(1, Math.round(w * 0.03));
  const out = [];
  for (let y = 0; y < sil.length; y++) {
    const r = sil[y];
    if (r.width > w * 0.05 && r.left > m && r.right < w - 1 - m) out.push(y);
  }
  return out;
}

/**
 * Per-column skyline: first row from the top where the pixel breaks from that
 * column's own top-margin sky. This is the TRANSPOSE of the row-wise
 * silhouette, and it exists because subjects wider than tall (houses) are
 * sky-bounded in almost no rows — the row-wise scorer came back empty on the
 * exact photograph this gate was built for, while a column-wise scan of the
 * same image yields hundreds of comparable columns. (The field agent
 * discovered this first, as silh.py.)
 */
function skyline(im, tol = 42) {
  const out = new Array(im.w).fill(-1);
  const yMax = Math.min(14, im.h);
  for (let x = 0; x < im.w; x++) {
    const ch = [[], [], []];
    for (let y = 2; y < yMax; y++) {
      const p = px(im, x, y);
      ch[0].push(p[0]); ch[1].push(p[1]); ch[2].push(p[2]);
    }
    const sky = [median(ch[0]), median(ch[1]), median(ch[2])];
    let run = 0;
    for (let y = 2; y < im.h; y++) {
      const p = px(im, x, y);
      const d = Math.hypot(p[0] - sky[0], p[1] - sky[1], p[2] - sky[2]);
      run = d > tol ? run + 1 : 0;
      if (run >= 4) { out[x] = y - 3; break; }
    }
  }
  return out;
}

/**
 * The worst contiguous stretches of skyline, with a direction for each.
 *
 * The score says HOW MUCH is wrong; until now nothing said WHERE. Field runs
 * spent 6-10 minutes per pass staring at the overlay deciding which element to
 * fix — the single largest remaining cost in refinement. The agent already
 * knows which element lives at columns 1180-1400 (it measured them), so a
 * located error turns a judgement call into a lookup: a compiler pointing at
 * the line instead of saying "there are errors".
 *
 * Signed convention: image y grows DOWNWARD, so a render row smaller than the
 * photograph's means the render's top edge sits HIGHER in the frame.
 */
function worstSegments(cols, signed, limit = 3) {
  const abs = signed.map((v) => Math.abs(v));
  // Noise floor: 4 px, or 1.5x the median column error, whichever is larger —
  // on a converged render nothing should qualify, and nothing should be
  // reported (a located error that is only noise is worse than silence).
  const thr = Math.max(4, median(abs) * 1.5);
  const segs = [];
  let cur = null;
  for (let i = 0; i < cols.length; i++) {
    if (abs[i] <= thr) continue;
    const sign = Math.sign(signed[i]);
    // Continue the run across small gaps, but never across a sign flip: two
    // adjacent errors in opposite directions are two different fixes.
    if (cur && cols[i] - cur.x1 <= 12 && cur.sign === sign) {
      cur.errs.push(abs[i]);
      cur.x1 = cols[i];
    } else {
      if (cur) segs.push(cur);
      cur = { x0: cols[i], x1: cols[i], sign, errs: [abs[i]] };
    }
  }
  if (cur) segs.push(cur);
  const out = segs
    .filter((s) => s.errs.length >= 12)
    .map((s) => {
      const meanAbs = s.errs.reduce((a, b) => a + b, 0) / s.errs.length;
      return {
        x0: s.x0,
        x1: s.x1,
        columns: s.errs.length,
        mean_err_px: Math.round(meanAbs * 10) / 10,
        direction:
          s.sign < 0
            ? 'render skyline too HIGH (render top edge is above the photograph\'s)'
            : 'render skyline too LOW (render top edge is below the photograph\'s)',
        _mass: meanAbs * s.errs.length,
      };
    })
    // Rank by total error mass, not by peak: a 300-column band off by 20 px is
    // a bigger fix than a 15-column spike off by 40.
    .sort((a, b) => b._mass - a._mass)
    .slice(0, limit)
    .map(({ _mass, ...seg }) => seg);
  return out.length ? out : null;
}

function skylineScore(ref, ren, span) {
  const a = skyline(ref), b = skyline(ren);
  const errs = [];
  const signed = [];
  const cols = [];
  const lo = span ? Math.max(0, Math.round(span.x0)) : Math.round(ref.w * 0.03);
  const hi = span ? Math.min(ref.w, Math.round(span.x1)) : ref.w * 0.97;
  for (let x = lo; x < hi; x++) {
    if (a[x] >= 0 && b[x] >= 0) { errs.push(Math.abs(a[x] - b[x])); signed.push(b[x] - a[x]); cols.push(x); }
  }
  if (!errs.length) return null;
  const mean = (v) => (v.length ? Math.round((v.reduce((s, e) => s + e, 0) / v.length) * 10) / 10 : null);
  const third = Math.floor(errs.length / 3);
  const worst = worstSegments(cols, signed);
  return {
    mean_top_error_px: mean(errs),
    top_error_by_band: {
      left: mean(errs.slice(0, third)),
      middle: mean(errs.slice(third, 2 * third)),
      right: mean(errs.slice(2 * third)),
    },
    max_top_error_px: Math.max(...errs),
    columns_compared: errs.length,
    /** WHERE the error is, in original-image columns. Fix the top one first. */
    worst_segments: worst,
    ...(worst
      ? { worst_segments_note: 'x0/x1 are image columns. Identify which element spans them (you measured it), fix that element, re-render.' }
      : {}),
  };
}

/**
 * Lit/shadow band luma and their ratio — the numbers lighting passes are tuned
 * against. A field run flew FIVE consecutive lighting passes with no feedback
 * because this gate reported silhouette only; the agent had to call
 * score_render separately to get numbers the save response should have carried.
 */
function bandStats(im, sil) {
  const ls = [], rs = [];
  for (let y = 0; y < im.h; y++) {
    const { left, right, width } = sil[y];
    if (width < im.w * 0.05) continue;
    const third = Math.max(1, (width / 3) | 0);
    for (let x = left; x < Math.min(left + third, im.w); x++) { const p = px(im, x, y); ls.push(luma(...p)); }
    for (let x = Math.max(right - third, 0); x < right; x++) { const p = px(im, x, y); rs.push(luma(...p)); }
  }
  if (!ls.length || !rs.length) return null;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const a = mean(ls), b = mean(rs);
  return {
    left_band_luma: Math.round(a * 10) / 10,
    right_band_luma: Math.round(b * 10) / 10,
    lit_over_shadow_ratio: Math.round((Math.max(a, b) / Math.max(1, Math.min(a, b))) * 1000) / 1000,
  };
}

/** In-silhouette luma distribution — overall exposure of the subject. */
function inLuma(im, sil) {
  const vals = [];
  for (let y = 0; y < im.h; y++) {
    const { left, right, width } = sil[y];
    if (width < im.w * 0.05) continue;
    for (let x = left; x <= right; x += 2) { const p = px(im, x, y); vals.push(luma(...p)); }
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const at = (f) => Math.round(vals[Math.min(vals.length - 1, (vals.length * f) | 0)] * 10) / 10;
  return { mean: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) / 1 * 10) / 10, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

/** Sky luma at fixed heights — the gradient the scene's sky is scored against. */
function skySamples(im) {
  return [0.05, 0.2, 0.4, 0.6, 0.75].map((f) => {
    const s = rowSkyLR(im, Math.min(im.h - 1, Math.round(im.h * f)));
    const m = skyAtX(s, im.w >> 1, im.w);
    return { at_height_frac: f, luma: Math.round(luma(m[0], m[1], m[2]) * 10) / 10 };
  });
}

/** A uniform frame means the page errored or the canvas was read before a
 *  paint — three of these appeared across two field runs, each scored as a
 *  silent null the agent had to diagnose from nothing. */
export function isDegenerate(im) {
  let min = 255, max = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((im.w * im.h) / 4000)));
  for (let y = 0; y < im.h; y += step) {
    for (let x = 0; x < im.w; x += step) {
      const l = luma(...px(im, x, y));
      if (l < min) min = l;
      if (l > max) max = l;
    }
  }
  return max - min < 2;
}

/** Score a render against a reference — same shape as score_render's silhouette block. */
export function scoreImages(renderPath, refPath, span) {
  const ref = decodeImage(refPath);
  const ren = resize(decodeImage(renderPath), ref.w, ref.h);
  const sRef = silhouette(ref);
  const sRen = silhouette(ren);

  const bRef = new Set(boundedRows(sRef, ref.w));
  const bRen = new Set(boundedRows(sRen, ren.w));
  const bothAll = [...bRef].filter((y) => bRen.has(y)).sort((a, b) => a - b);

  const runs = [];
  for (const y of bothAll) {
    const cur = runs[runs.length - 1];
    if (cur && y - cur[cur.length - 1] <= 3) cur.push(y);
    else runs.push([y]);
  }
  const both = runs.reduce((a, b) => (b.length > a.length ? b : a), []);

  let edgeErr = 0, edgeMax = 0, n = 0;
  const perRow = [];
  for (const y of both) {
    const e = (Math.abs(sRef[y].left - sRen[y].left) + Math.abs(sRef[y].right - sRen[y].right)) / 2;
    edgeErr += e; edgeMax = Math.max(edgeMax, e); n++;
    perRow.push(e);
  }
  const bandMean = (a) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
  const third = Math.floor(perRow.length / 3);
  const area = (s) => both.reduce((sum, y) => sum + s[y].width, 0);

  const rowWise = {
    mean_edge_error_px: n ? Math.round((edgeErr / n) * 10) / 10 : null,
    edge_error_by_band: {
      top: bandMean(perRow.slice(0, third)),
      middle: bandMean(perRow.slice(third, 2 * third)),
      bottom: bandMean(perRow.slice(2 * third)),
    },
    max_edge_error_px: edgeMax,
    rows_compared: n,
    area_ratio: Math.round((area(sRen) / Math.max(1, area(sRef))) * 1000) / 1000,
  };

  const result = {
    image_size: [ref.w, ref.h],
    ...rowWise,
    // The transpose measurement — the primary signal on wide/occluded
    // subjects where rows_compared is small. Trust whichever axis compared
    // more of the subject.
    skyline: skylineScore(ref, ren),
    unreliable_row_scan: n < 30 || null,
    luma: {
      bands: { ref: bandStats(ref, sRef), render: bandStats(ren, sRen) },
      in_silhouette: { ref: inLuma(ref, sRef), render: inLuma(ren, sRen) },
      sky: { ref: skySamples(ref), render: skySamples(ren) },
    },
  };

  // Aimed scoring: on this reference the full-frame flanks measure TREES, not
  // building (a field run read 487/585 px flanks against a 107 px middle and
  // hand-built its own subject-scoped checker rather than trust the number).
  // The span block is additive — the full-frame numbers always stay.
  if (span && Number.isFinite(span.x0) && Number.isFinite(span.x1)) {
    result.subject_span = { ...span, skyline: skylineScore(ref, ren, span) };
  }
  return result;
}
