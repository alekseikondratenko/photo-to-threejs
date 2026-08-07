/**
 * Deterministic image scanning — the shared core behind `measure_reference`
 * and `score_render`.
 *
 * This is the TypeScript port of the skill's `scripts/measure_reference.py`,
 * upgraded with everything the two acceptance-test runs paid to learn:
 *
 *  - PER-ROW sky model, interpolated between the frame margins. A single sky
 *    sample fails on any graded sky (dusk, haze) and silently mislabels half
 *    the frame — the exact failure that pinned `widthFrac` at its saturation
 *    value in the field.
 *  - Banded floor-pitch autocorrelation with a high-pass, reporting LOCAL
 *    maxima per height band — a pitch that drifts between bands means
 *    perspective is non-linear and a global pixel->metre scale is unsafe.
 *  - Pure-JS decoding (pngjs / jpeg-js): no native deps, no Python, no broken
 *    Pillow wheels.
 *
 * Everything here reports MEASUREMENTS, not conclusions.
 */
import fs from "node:fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export interface Bitmap {
  w: number;
  h: number;
  /** RGBA, row-major */
  data: Uint8Array;
}

export function decodeImage(path: string): Bitmap {
  const buf = fs.readFileSync(path);
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    const png = PNG.sync.read(buf);
    return { w: png.width, h: png.height, data: new Uint8Array(png.data) };
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
    return { w: img.width, h: img.height, data: new Uint8Array(img.data) };
  }
  throw new Error(`Unsupported image type: ${path} (png/jpg only)`);
}

/** Bilinear resize — good enough for silhouette work at comparable sizes. */
export function resize(src: Bitmap, w: number, h: number): Bitmap {
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
        out[(y * w + x) * 4 + c] =
          (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
    }
  }
  return { w, h, data: out };
}

const px = (im: Bitmap, x: number, y: number): [number, number, number] => {
  const i = (y * im.w + x) * 4;
  return [im.data[i], im.data[i + 1], im.data[i + 2]];
};

export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]);
}

/** Per-row sky estimate at BOTH margins. Real skies grade in both axes (a
 *  dusk glow is brighter on one side), so a pixel must be compared against
 *  the sky interpolated horizontally between the margins — pooling the two
 *  margins into one estimate matches neither side and flags whole rows.
 *  Limitation (documented, not hidden): a row where the subject or foreground
 *  spans BOTH margins gets a poisoned estimate. */
function rowSkyLR(im: Bitmap, y: number): { l: [number, number, number]; r: [number, number, number] } {
  const side = (x0: number, x1: number): [number, number, number] => {
    const ch: number[][] = [[], [], []];
    for (let x = x0; x < x1; x++) {
      const p = px(im, x, y);
      ch[0].push(p[0]); ch[1].push(p[1]); ch[2].push(p[2]);
    }
    return [median(ch[0]), median(ch[1]), median(ch[2])];
  };
  return {
    l: side(2, Math.min(14, im.w)),
    r: side(Math.max(0, im.w - 14), im.w - 2),
  };
}

/** Sky colour at (x, y): horizontal interpolation between the margin medians. */
function skyAtX(sky: ReturnType<typeof rowSkyLR>, x: number, w: number): [number, number, number] {
  const t = x / (w - 1);
  return [
    sky.l[0] + (sky.r[0] - sky.l[0]) * t,
    sky.l[1] + (sky.r[1] - sky.l[1]) * t,
    sky.l[2] + (sky.r[2] - sky.l[2]) * t,
  ];
}

export interface SilRow {
  left: number;
  right: number;
  width: number;
}

/** Per row: widest sky-contrasting run; (-1,-1,0) when none. */
export function silhouette(im: Bitmap, tol = 42): SilRow[] {
  const rows: SilRow[] = [];
  for (let y = 0; y < im.h; y++) {
    const sky = rowSkyLR(im, y);
    const isSubject = (x: number) => {
      const p = px(im, x, y);
      const s = skyAtX(sky, x, im.w);
      const d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
      return d > tol;
    };
    let left = -1, right = -1;
    for (let x = 0; x < im.w; x++) if (isSubject(x)) { left = x; break; }
    if (left >= 0) for (let x = im.w - 1; x >= left; x--) if (isSubject(x)) { right = x; break; }
    rows.push({ left, right, width: left >= 0 && right >= 0 ? right - left + 1 : 0 });
  }
  return rows;
}

/** Rows that are sky-bounded on both sides — the only rows safe to measure.
 *  The margin is 3% of width, not 1 px: a run starting a few pixels off the
 *  frame edge is foreground (jetties, wave foam) that happens to clear it. */
export function boundedRows(sil: SilRow[], w: number): number[] {
  const m = Math.max(1, Math.round(w * 0.03));
  const out: number[] = [];
  for (let y = 0; y < sil.length; y++) {
    const r = sil[y];
    if (r.width > w * 0.05 && r.left > m && r.right < w - 1 - m) out.push(y);
  }
  return out;
}

export interface PitchBand {
  band: "top" | "middle" | "bottom";
  rows: number;
  peaks: { pitch_px: number; score: number }[];
}

/** Banded autocorrelation of a vertical luminance profile down the subject. */
export function floorPitch(im: Bitmap, sil: SilRow[]): PitchBand[] {
  const rows = boundedRows(sil, im.w);
  if (rows.length < 40) return [];
  const names: PitchBand["band"][] = ["top", "middle", "bottom"];
  const third = Math.floor(rows.length / 3);
  const out: PitchBand[] = [];
  for (let b = 0; b < 3; b++) {
    const band = rows.slice(b * third, b === 2 ? rows.length : (b + 1) * third);
    const prof: number[] = [];
    for (const y of band) {
      const { left, right } = sil[y];
      const xc = (left + right) >> 1, q = (right - left) >> 2;
      let sum = 0, n = 0;
      for (let x = Math.max(left, xc - q); x <= Math.min(right, xc + q); x++) {
        const p = px(im, x, y);
        sum += luma(p[0], p[1], p[2]); n++;
      }
      prof.push(sum / Math.max(1, n));
    }
    const peaks = autocorrPeaks(prof);
    if (peaks !== null) out.push({ band: names[b], rows: prof.length, peaks });
  }
  return out;
}

/** High-pass + autocorrelate a 1-D profile; return local-maxima peaks.
 *  The high-pass matters: a smooth gradient autocorrelates at every small lag
 *  and buries the repeating rhythm. */
export function autocorrPeaks(prof: number[]): { pitch_px: number; score: number }[] | null {
  const n = prof.length;
  if (n < 30) return null;
  const HP = 15;
  const dev = prof.map((v, i) => {
    const lo = Math.max(0, i - HP), hi = Math.min(n, i + HP + 1);
    let s = 0;
    for (let j = lo; j < hi; j++) s += prof[j];
    return v - s / (hi - lo);
  });
  const denom = dev.reduce((s, d) => s + d * d, 0) || 1;
  const corr = new Map<number, number>();
  for (let lag = 4; lag < Math.min(120, n >> 1); lag++) {
    let c = 0;
    for (let i = 0; i < n - lag; i++) c += dev[i] * dev[i + lag];
    corr.set(lag, c / denom);
  }
  const peaks: { pitch_px: number; score: number }[] = [];
  for (const [lag, c] of corr) {
    const a = corr.get(lag - 1), z = corr.get(lag + 1);
    if (a !== undefined && z !== undefined && c > a && c > z && c > 0.1) {
      peaks.push({ pitch_px: lag, score: Math.round(c * 1000) / 1000 });
    }
  }
  peaks.sort((p, q) => q.score - p.score);
  return peaks.slice(0, 4);
}

/** Left/right band luma inside the silhouette. On a corner view these are the
 *  two faces; on a square-on symmetric subject they are NOT (checklist 13). */
export function bandStats(im: Bitmap, sil: SilRow[]) {
  const ls: number[] = [], rs: number[] = [];
  for (let y = 0; y < im.h; y++) {
    const { left, right, width } = sil[y];
    if (width < im.w * 0.05) continue;
    const third = Math.max(1, width / 3 | 0);
    for (let x = left; x < Math.min(left + third, im.w); x++) {
      const p = px(im, x, y); ls.push(luma(p[0], p[1], p[2]));
    }
    for (let x = Math.max(right - third, 0); x < right; x++) {
      const p = px(im, x, y); rs.push(luma(p[0], p[1], p[2]));
    }
  }
  if (!ls.length || !rs.length) return null;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const a = mean(ls), b = mean(rs);
  return {
    left_band_luma: Math.round(a * 10) / 10,
    right_band_luma: Math.round(b * 10) / 10,
    lit_over_shadow_ratio: Math.round((Math.max(a, b) / Math.max(1, Math.min(a, b))) * 1000) / 1000,
  };
}

export function measureImage(path: string) {
  const im = decodeImage(path);
  const sil = silhouette(im);
  const bounded = boundedRows(sil, im.w);
  const widths = bounded.map((y) => sil[y].width);
  const subjectRows = sil
    .map((r, y) => ({ r, y }))
    .filter(({ r }) => r.width > im.w * 0.05)
    .map(({ y }) => y);
  return {
    image: path,
    size: [im.w, im.h],
    aspect: Math.round((im.w / im.h) * 10000) / 10000,
    subject_top_row: subjectRows[0] ?? null,
    subject_bottom_row: subjectRows[subjectRows.length - 1] ?? null,
    sky_bounded_rows: bounded.length,
    median_width_px: median(widths),
    floor_pitch: floorPitch(im, sil),
    bands: bandStats(im, sil),
    notes:
      "Pitch that drifts between bands = non-linear perspective; use local ratios. " +
      "Fine pitches near the JPEG noise floor need a magnified band-local crop.",
  };
}

/**
 * classify_reference core: evidence for reference class and view topology.
 * Reports MEASUREMENTS with hints, never a bare verdict — classification is
 * Step 1's judgement; this makes the judgement cheap and grounded.
 */
export function classifyReference(path: string) {
  const im = decodeImage(path);
  const sil = silhouette(im);
  const allRows = boundedRows(sil, im.w);
  const pitch = floorPitch(im, sil);

  // Work on the largest CONTIGUOUS bounded run — detached bounded bands are
  // foreground (trees, clutter) that happens to clear the margins.
  const runs: number[][] = [];
  for (const y of allRows) {
    const cur = runs[runs.length - 1];
    if (cur && y - cur[cur.length - 1] <= 3) cur.push(y);
    else runs.push([y]);
  }
  const rows = runs.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);

  // Vertical-edge slopes, Theil–Sen (median of pairwise slopes): a foreground
  // canopy crossing the edge is an outlier to a median, a disaster to least
  // squares.
  const fit = (side: "left" | "right") => {
    if (rows.length < 20) return null;
    const step = Math.max(1, (rows.length / 40) | 0);
    const pts: [number, number][] = [];
    for (let i = 0; i < rows.length; i += step) pts.push([rows[i], sil[rows[i]][side]]);
    const slopes: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dy = pts[j][0] - pts[i][0];
        if (Math.abs(dy) > 20) slopes.push((pts[j][1] - pts[i][1]) / dy);
      }
    }
    return slopes.length ? Math.round(median(slopes) * 10000) / 10000 : null;
  };
  const leftSlope = fit("left"), rightSlope = fit("right");

  // End-pitch asymmetry: column-luma profile across the subject at mid-height,
  // autocorrelated separately for the left and right halves. Tighter pitch at
  // one end = that end recedes = a second face is visible (Step 1's topology
  // falsification, as a number).
  let endPitch: { left: ReturnType<typeof autocorrPeaks>; right: ReturnType<typeof autocorrPeaks> } | null = null;
  if (rows.length > 60) {
    const midRows = rows.slice((rows.length * 0.45) | 0, (rows.length * 0.65) | 0);
    // Median edges, not extrema: one occluded row must not collapse the span.
    const l0 = Math.round(median(midRows.map((y) => sil[y].left)));
    const r0 = Math.round(median(midRows.map((y) => sil[y].right)));
    if (r0 - l0 > 80) {
      const prof: number[] = [];
      for (let x = l0; x <= r0; x++) {
        let s = 0;
        for (const y of midRows) {
          const p = px(im, x, y);
          s += luma(p[0], p[1], p[2]);
        }
        prof.push(s / midRows.length);
      }
      const half = prof.length >> 1;
      endPitch = {
        left: autocorrPeaks(prof.slice(0, half)),
        right: autocorrPeaks(prof.slice(half)),
      };
    }
  }

  const hints: string[] = [];
  if (rows.length < 20) {
    hints.push(
      "sky-bounded detection failed (occluded or cluttered margins) — the numeric " +
      "evidence below is unavailable; classify by eye per Step 1 and say so",
    );
  }
  if (leftSlope !== null && rightSlope !== null) {
    if (Math.abs(leftSlope) < 0.02 && Math.abs(rightSlope) < 0.02) {
      hints.push("verticals ~parallel: no tilt — archviz/elevated behaviour, shifted lens possible");
    } else if (leftSlope < -0.03 && rightSlope > 0.03) {
      hints.push("edges converge upward: tilted ground-level camera — solve the camera before measuring");
    }
  }
  const strongest = (b?: PitchBand) => b?.peaks?.[0]?.pitch_px;
  const top = strongest(pitch.find((b) => b.band === "top"));
  const bottom = strongest(pitch.find((b) => b.band === "bottom"));
  if (top && bottom && Math.abs(bottom / top - 1) > 0.15) {
    hints.push(`vertical pitch drifts ${top}→${bottom} px between bands: non-linear perspective — use local ratios, not one global scale`);
  }
  const epL = endPitch?.left?.[0]?.pitch_px, epR = endPitch?.right?.[0]?.pitch_px;
  if (epL && epR && Math.abs(epL / epR - 1) > 0.15) {
    hints.push(`repeating-unit pitch differs between ends (${epL} vs ${epR} px): a second face is likely visible — run the corner→yaw recipe`);
  }

  return {
    image: path,
    size: [im.w, im.h],
    evidence: {
      sky_bounded_rows: rows.length,
      vertical_edge_slopes: { left: leftSlope, right: rightSlope },
      vertical_pitch_bands: pitch,
      end_pitch_mid_band: endPitch,
    },
    hints,
    notes:
      "Evidence, not a verdict: Step 1 owns the classification. Missing evidence " +
      "(few sky-bounded rows, no repeating elements) means the detectors could not " +
      "see — not that the property is absent.",
  };
}

/** Score a render against a reference: both scanned with the SAME detector. */
export function scoreImages(renderPath: string, refPath: string) {
  const ref = decodeImage(refPath);
  const ren = resize(decodeImage(renderPath), ref.w, ref.h);
  const sRef = silhouette(ref);
  const sRen = silhouette(ren);

  const bRef = new Set(boundedRows(sRef, ref.w));
  const bRen = new Set(boundedRows(sRen, ren.w));
  const bothAll = [...bRef].filter((y) => bRen.has(y)).sort((a, b) => a - b);

  // Compare only the largest CONTIGUOUS run of mutually sky-bounded rows —
  // that is the subject. Detached bounded bands elsewhere are foreground
  // texture (sea foam, street clutter) that happens to contrast with the
  // margins, and comparing them scores the staging, not the building.
  const runs: number[][] = [];
  for (const y of bothAll) {
    const cur = runs[runs.length - 1];
    if (cur && y - cur[cur.length - 1] <= 3) cur.push(y);
    else runs.push([y]);
  }
  const both = runs.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);

  let edgeErr = 0, edgeMax = 0, n = 0;
  const perRow: number[] = [];
  for (const y of both) {
    const e = (Math.abs(sRef[y].left - sRen[y].left) + Math.abs(sRef[y].right - sRen[y].right)) / 2;
    edgeErr += e; edgeMax = Math.max(edgeMax, e); n++;
    perRow.push(e);
  }
  // Thirds of the compared span — a mean that is fine in one band and wild in
  // another localises the defect (top assembly vs shaft vs base).
  const bandMean = (a: number[]) =>
    a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null;
  const third = Math.floor(perRow.length / 3);
  const edgeByBand = {
    top: bandMean(perRow.slice(0, third)),
    middle: bandMean(perRow.slice(third, 2 * third)),
    bottom: bandMean(perRow.slice(2 * third)),
  };

  const area = (s: SilRow[]) => both.reduce((sum, y) => sum + s[y].width, 0);
  // Tip = first row where a subject at least 3 px wide persists for 5
  // consecutive rows — spires and masts are thin, noise is thinner still.
  const top = (s: SilRow[], w: number) => {
    let streak = 0;
    for (let y = 0; y < s.length; y++) {
      const ok = s[y].width >= 3 && s[y].left > 0 && s[y].right < w - 1;
      streak = ok ? streak + 1 : 0;
      if (streak >= 5) return y - 4;
    }
    return null;
  };

  const inLuma = (im: Bitmap, s: SilRow[]) => {
    const vals: number[] = [];
    for (let y = 0; y < im.h; y++) {
      const { left, right, width } = s[y];
      if (width < im.w * 0.05) continue;
      for (let x = left; x <= right; x += 2) {
        const p = px(im, x, y); vals.push(luma(p[0], p[1], p[2]));
      }
    }
    vals.sort((a, b) => a - b);
    const at = (f: number) => Math.round(vals[Math.min(vals.length - 1, (vals.length * f) | 0)] * 10) / 10;
    return vals.length
      ? { mean: Math.round((vals.reduce((s2, v) => s2 + v, 0) / vals.length) * 10) / 10, p10: at(0.1), p50: at(0.5), p90: at(0.9) }
      : null;
  };

  const skyAt = (im: Bitmap, fr: number) => {
    const s = rowSkyLR(im, Math.min(im.h - 1, Math.round(im.h * fr)));
    const m = skyAtX(s, im.w >> 1, im.w);
    return Math.round(luma(m[0], m[1], m[2]) * 10) / 10;
  };

  const refTop = top(sRef, ref.w), renTop = top(sRen, ren.w);
  return {
    reference: refPath,
    render: renderPath,
    scored_at: [ref.w, ref.h],
    silhouette: {
      mean_edge_error_px: n ? Math.round((edgeErr / n) * 10) / 10 : null,
      edge_error_by_band: edgeByBand,
      max_edge_error_px: edgeMax,
      rows_compared: n,
      area_ratio: Math.round((area(sRen) / Math.max(1, area(sRef))) * 1000) / 1000,
      top_row: { ref: refTop, render: renTop, delta: refTop !== null && renTop !== null ? renTop - refTop : null },
    },
    in_silhouette_luma: { ref: inLuma(ref, sRef), render: inLuma(ren, sRen) },
    // Shared vocabulary with the viewer's __measure(): lit/shadow band luma and
    // their ratio, so the skill's Step 4 tuning map applies to this output too.
    bands: { ref: bandStats(ref, sRef), render: bandStats(ren, sRen) },
    sky_luma: [0.05, 0.2, 0.4, 0.6, 0.75].map((f) => ({
      at_height_frac: f, ref: skyAt(ref, f), render: skyAt(ren, f),
    })),
    notes:
      "Identity features (bracing pitch, bay rhythm, feature counts) are NOT covered by " +
      "these metrics — give them their own targets and check them by eye every pass.",
  };
}
