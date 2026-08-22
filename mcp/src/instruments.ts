/**
 * view_crop and trace_edge — the two instruments every observed run built by
 * hand (crop.py / silh.py in the field run; equivalents in the runs before).
 *
 * view_crop is a magnifier that keeps its coordinates: a crop, upscaled, with
 * a labelled pixel grid burned in so positions can be read off the zoom in
 * ORIGINAL image pixels. It answers "let me look closely and know where I am"
 * — the one thing the scanning tools never provided, and the reason agents
 * went straight to writing Python.
 *
 * trace_edge is silh.py generalised and made exact: scan along an axis, find
 * the first pixel run satisfying a luma condition, return the boundary as
 * points in full-image coordinates plus a robust line fit — endpoints ready
 * to feed solve_camera. Eyes locate the edge; the tool reads it off.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { applyCrop, decodeImage, luma, type Bitmap, type Crop } from "./scan.ts";

// ---------------------------------------------------------------- tiny font
// 3x5 digit glyphs, enough to label grid lines. Row-major, 1 = pixel on.
const GLYPHS: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7], "3": [7, 1, 7, 1, 7],
  "4": [5, 5, 7, 1, 1], "5": [7, 4, 7, 1, 7], "6": [7, 4, 7, 5, 7], "7": [7, 1, 2, 2, 2],
  "8": [7, 5, 7, 5, 7], "9": [7, 5, 7, 1, 7], ",": [0, 0, 0, 2, 4],
};

function drawText(im: Bitmap, x: number, y: number, text: string, color: [number, number, number], scale = 2) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) { cx += 4 * scale; continue; }
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if ((g[r] >> (2 - c)) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + c * scale + sx, py = y + r * scale + sy;
              if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
              const i = (py * im.w + px) * 4;
              im.data[i] = color[0]; im.data[i + 1] = color[1]; im.data[i + 2] = color[2]; im.data[i + 3] = 255;
            }
          }
        }
      }
    }
    cx += 4 * scale;
  }
}

/** Nearest-neighbour upscale — crisp pixels are the point of a magnifier. */
function upscale(src: Bitmap, scale: number): Bitmap {
  const w = Math.round(src.w * scale), h = Math.round(src.h * scale);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.h - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.w - 1, Math.floor(x / scale));
      const si = (sy * src.w + sx) * 4, di = (y * w + x) * 4;
      data[di] = src.data[si]; data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2]; data[di + 3] = 255;
    }
  }
  return { w, h, data };
}

const MAGENTA: [number, number, number] = [255, 0, 255];
const CYAN: [number, number, number] = [0, 255, 255];

export function viewCrop(
  image: string,
  crop: Crop,
  outPath: string,
  opts: { scale?: number; grid?: number } = {},
) {
  const full = decodeImage(image);
  const { im, ox, oy } = applyCrop(full, crop);

  // Default scale targets ~1400 px output on the long edge; grid picks a
  // round step giving 8-20 lines.
  const scale = opts.scale ?? Math.max(1, Math.min(8, Math.round(1400 / Math.max(im.w, im.h))));
  let grid = opts.grid ?? 0;
  if (!grid) {
    const raw = Math.max(im.w, im.h) / 12;
    grid = [5, 10, 20, 25, 50, 100, 200, 500].find((g) => g >= raw) ?? 500;
  }

  const out = upscale(im, scale);
  // Vertical lines at original-x multiples of grid.
  for (let gx = Math.ceil(ox / grid) * grid; gx < ox + im.w; gx += grid) {
    const X = Math.round((gx - ox) * scale);
    for (let y = 0; y < out.h; y++) {
      const i = (y * out.w + X) * 4;
      out.data[i] = MAGENTA[0]; out.data[i + 1] = MAGENTA[1]; out.data[i + 2] = MAGENTA[2];
    }
    drawText(out, X + 3, 3, String(gx), MAGENTA);
  }
  for (let gy = Math.ceil(oy / grid) * grid; gy < oy + im.h; gy += grid) {
    const Y = Math.round((gy - oy) * scale);
    for (let x = 0; x < out.w; x++) {
      const i = (Y * out.w + x) * 4;
      out.data[i] = CYAN[0]; out.data[i + 1] = CYAN[1]; out.data[i + 2] = CYAN[2];
    }
    drawText(out, 3, Y + 3, String(gy), CYAN);
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const png = new PNG({ width: out.w, height: out.h });
  png.data = Buffer.from(out.data);
  fs.writeFileSync(outPath, PNG.sync.write(png));

  return {
    image,
    out: outPath,
    region: { x0: ox, y0: oy, x1: ox + im.w, y1: oy + im.h },
    scale,
    grid_px: grid,
    out_size: [out.w, out.h],
    notes:
      "Grid labels are ORIGINAL image coordinates (magenta = x, cyan = y): read positions " +
      "straight off the zoom, no arithmetic. Nearest-neighbour upscale — blocky is correct.",
  };
}

// ---------------------------------------------------------------- trace_edge

const medianOf = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]);
};

export function traceEdge(
  image: string,
  crop: Crop,
  direction: "down" | "up" | "left" | "right",
  opts: { threshold?: number; condition?: "below" | "above"; step?: number; run?: number } = {},
) {
  const full = decodeImage(image);
  const { im, ox, oy } = applyCrop(full, crop);

  const lum = (x: number, y: number) => {
    const i = (y * im.w + x) * 4;
    return luma(im.data[i], im.data[i + 1], im.data[i + 2]);
  };

  // Default threshold: midway between the crop's bright and dark populations
  // (10th/90th percentile) — the same idea as silh.py's hand-tuned 115, minus
  // the hand-tuning.
  let threshold = opts.threshold;
  if (threshold === undefined) {
    const sample: number[] = [];
    const stride = Math.max(1, Math.floor(Math.sqrt((im.w * im.h) / 20000)));
    for (let y = 0; y < im.h; y += stride) for (let x = 0; x < im.w; x += stride) sample.push(lum(x, y));
    sample.sort((a, b) => a - b);
    const p10 = sample[Math.floor(sample.length * 0.1)];
    const p90 = sample[Math.floor(sample.length * 0.9)];
    threshold = (p10 + p90) / 2;
  }
  const condition = opts.condition ?? "below";
  const hit = (v: number) => (condition === "below" ? v < threshold! : v > threshold!);
  const run = Math.max(1, opts.run ?? 4);
  const step = Math.max(1, opts.step ?? Math.max(1, Math.floor((direction === "down" || direction === "up" ? im.w : im.h) / 200)));

  const vertical = direction === "down" || direction === "up";
  const across = vertical ? im.w : im.h;
  const along = vertical ? im.h : im.w;

  const points: [number, number][] = [];
  for (let a = 0; a < across; a += step) {
    let found = -1;
    for (let t = 0; t <= along - run; t++) {
      const tt = direction === "down" || direction === "right" ? t : along - run - t;
      let ok = true;
      for (let k = 0; k < run; k++) {
        const v = vertical ? lum(a, tt + k) : lum(tt + k, a);
        if (!hit(v)) { ok = false; break; }
      }
      if (ok) { found = direction === "down" || direction === "right" ? tt : tt + run - 1; break; }
    }
    if (found >= 0) {
      points.push(vertical ? [a + ox, found + oy] : [found + ox, a + oy]);
    }
  }

  // Theil–Sen fit: median of pairwise slopes — one occluder crossing the edge
  // is an outlier to a median and a disaster to least squares.
  let fit: { slope: number; intercept: number; residual_median_px: number; residual_max_px: number } | null = null;
  let segment: { x0: number; y0: number; x1: number; y1: number } | null = null;
  if (points.length >= 8) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const slopes: number[] = [];
    const stride = Math.max(1, Math.floor(points.length / 40));
    for (let i = 0; i < points.length; i += stride) {
      for (let j = i + 1; j < points.length; j += stride) {
        const dx = xs[j] - xs[i];
        if (Math.abs(dx) > 3) slopes.push((ys[j] - ys[i]) / dx);
      }
    }
    if (slopes.length) {
      const slope = medianOf(slopes);
      const intercept = medianOf(points.map((p) => p[1] - slope * p[0]));
      const residuals = points.map((p) => Math.abs(p[1] - (slope * p[0] + intercept)));
      fit = {
        slope: Math.round(slope * 10000) / 10000,
        intercept: Math.round(intercept * 100) / 100,
        residual_median_px: Math.round(medianOf(residuals) * 100) / 100,
        residual_max_px: Math.round(Math.max(...residuals) * 100) / 100,
      };
      const x0 = xs[0], x1 = xs[xs.length - 1];
      segment = {
        x0, y0: Math.round((slope * x0 + intercept) * 100) / 100,
        x1, y1: Math.round((slope * x1 + intercept) * 100) / 100,
      };
    }
  }

  return {
    image,
    region: { x0: ox, y0: oy, x1: ox + im.w, y1: oy + im.h },
    direction,
    condition: `first ${run}-px run with luma ${condition} ${Math.round(threshold * 10) / 10}`,
    points_found: points.length,
    points: points.map(([x, y]) => [x, y]),
    fit,
    /** Endpoints on the fitted line at the traced extremes — paste into solve_camera. */
    segment_for_solve_camera: segment,
    warnings:
      fit && fit.residual_max_px > 6
        ? [
            `max residual ${fit.residual_max_px} px — the traced boundary is not one straight ` +
            "edge (a kink, an occluder, or two building elements). Split the crop and trace " +
            "each part separately before feeding solve_camera.",
          ]
        : [],
    notes:
      "Points are in ORIGINAL image pixels. The fit is Theil–Sen (median), so a few " +
      "outliers are survivable — but check residual_max_px before trusting the segment.",
  };
}
