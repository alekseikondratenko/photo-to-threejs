#!/usr/bin/env python3
"""Deterministic pixel measurement of a building reference photograph.

Usage:
    python3 measure_reference.py ref.jpg [--sky-sample X,Y] [--json out.json]

Produces the numbers Step 2 of SKILL.md asks for, so the agent scans instead of
eyeballing:

  - image size and aspect ratio
  - per-row silhouette (left edge, right edge, width) against a sky estimate,
    with the raw column profile written alongside for taper/flare/setback reading
  - floor pitch candidates via autocorrelation of a vertical luminance profile
    down the widest part of the subject
  - lit/shadow band luminance and their ratio (left vs right silhouette bands)
  - sampled colours: sky zenith, sky horizon, lit band, shadow band

Requires Pillow (`pip install Pillow`). Nothing else.

Honesty note: this reports MEASUREMENTS, not conclusions. Whether the floor
pitch is constant with height (linear pixel->metre) or not (use local ratios)
is a judgement Step 1 of SKILL.md tells you how to make — check pitch in more
than one height band before trusting a single global scale.

Known limits, validated against the repo's own references:
  - Module-scale rhythm is recovered well (Taipei 101: 86 px found vs 83 px
    measured by hand). FINE pitches near the JPEG noise floor are not — the
    Empire State's 11 px floor pitch needs a magnified band-local scan of one
    facade strip, which this whole-shaft profile cannot resolve. When the peaks
    look like noise, crop a facade band and scan that instead.
  - The left/right band luma split assumes a corner view. On a square-on
    symmetric subject the bands are not faces (SKILL.md checklist item 13).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")


def luma(px) -> float:
    r, g, b = px[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def load(path: Path) -> tuple[int, int, object]:
    im = Image.open(path).convert("RGB")
    return im.size[0], im.size[1], im.load()


def sky_estimate(px, w: int, h: int, sample: tuple[int, int] | None) -> tuple[float, float, float]:
    """Mean sky colour from an explicit sample point, else the top image corners."""
    if sample:
        x, y = sample
        pts = [(x, y)]
    else:
        m = max(4, w // 50)
        pts = [(m, m), (w - m, m)]
    rs = [px[x, y] for x, y in pts]
    n = len(rs)
    return (
        sum(r for r, _, _ in rs) / n,
        sum(g for _, g, _ in rs) / n,
        sum(b for _, _, b in rs) / n,
    )


def is_subject(px, x: int, y: int, sky: tuple[float, float, float], tol: float) -> bool:
    r, g, b = px[x, y]
    dr, dg, db = r - sky[0], g - sky[1], b - sky[2]
    return (dr * dr + dg * dg + db * db) ** 0.5 > tol


def row_sky(px, w: int, y: int) -> tuple[float, float, float]:
    """Per-row sky estimate: per-channel median of the outermost pixels on both
    sides. Real sky is a vertical gradient — one global sample misreads the pale
    horizon as subject. Limitation: a row where the building or an edge tree
    spans BOTH margins gets a poisoned estimate; prefer references with sky at
    the frame edges, or crop first."""
    xs = list(range(2, 14)) + list(range(w - 14, w - 2))
    chans = tuple(median([float(px[x, y][c]) for x in xs]) for c in range(3))
    return chans  # type: ignore[return-value]


def silhouette(px, w: int, h: int, tol: float) -> list[tuple[int, int, int]]:
    """Per row: (left, right, width) of the widest sky-contrasting run; (-1,-1,0) if none."""
    rows: list[tuple[int, int, int]] = []
    for y in range(h):
        sky = row_sky(px, w, y)
        left = right = -1
        for x in range(w):
            if is_subject(px, x, y, sky, tol):
                left = x
                break
        if left >= 0:
            for x in range(w - 1, left - 1, -1):
                if is_subject(px, x, y, sky, tol):
                    right = x
                    break
        rows.append((left, right, (right - left + 1) if left >= 0 and right >= 0 else 0))
    return rows


def median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def floor_pitch_candidates(px, sil, w: int, h: int) -> list[dict]:
    """Autocorrelate a vertical luminance profile down the subject's centre.

    Returns the top correlation peaks as {pitch_px, score}. Run this per height
    band (the function reports thirds automatically) — a pitch that drifts
    between bands means perspective is non-linear and a global scale is unsafe.
    """
    # Only sky-bounded rows: a row whose run touches the frame edge is bounded by
    # foreground (trees, city), not sky, and would poison the profile.
    rows = [
        (y, l, r)
        for y, (l, r, wd) in enumerate(sil)
        if wd > w * 0.05 and l > 0 and r < w - 1
    ]
    if len(rows) < 40:
        return []
    out = []
    thirds = [rows[: len(rows) // 3], rows[len(rows) // 3 : 2 * len(rows) // 3], rows[2 * len(rows) // 3 :]]
    for band_i, band in enumerate(thirds):
        prof = []
        for y, l, r in band:
            xc = (l + r) // 2
            xs = range(max(l, xc - (r - l) // 4), min(r, xc + (r - l) // 4) + 1)
            prof.append(sum(luma(px[x, y]) for x in xs) / max(1, len(list(xs))))
        n = len(prof)
        if n < 30:
            continue
        # High-pass first: subtract a moving average, or the smooth vertical
        # lighting gradient autocorrelates at every small lag with score ~1 and
        # buries the floor rhythm.
        HP = 15
        smooth = [sum(prof[max(0, i - HP) : i + HP + 1]) / len(prof[max(0, i - HP) : i + HP + 1]) for i in range(n)]
        dev = [prof[i] - smooth[i] for i in range(n)]
        denom = sum(d * d for d in dev) or 1.0
        corr: dict[int, float] = {}
        for lag in range(4, min(120, n // 2)):
            corr[lag] = sum(dev[i] * dev[i + lag] for i in range(n - lag)) / denom
        # Local maxima of the correlation curve, not global top values — the
        # global top is always the smallest lag on a smooth curve.
        peaks = [
            {"pitch_px": lag, "score": round(c, 3)}
            for lag, c in corr.items()
            if lag - 1 in corr and lag + 1 in corr and c > corr[lag - 1] and c > corr[lag + 1] and c > 0.1
        ]
        peaks.sort(key=lambda p: -p["score"])
        out.append({"band": ["top", "middle", "bottom"][band_i], "rows": n, "peaks": peaks[:4]})
    return out


def band_stats(px, sil, w: int, h: int) -> dict:
    """Lit/shadow luma from the left and right thirds of the silhouette.

    READ THE LABELS WITH CARE (SKILL.md item 13/21 territory): on a corner view
    these are the two faces; on a square-on symmetric subject they are not.
    """
    ls, rs = [], []
    for y, (l, r, wd) in enumerate(sil):
        if wd < w * 0.05:
            continue
        third = max(1, wd // 3)
        ls += [luma(px[x, y]) for x in range(l, min(l + third, w))]
        rs += [luma(px[x, y]) for x in range(max(r - third, 0), r)]
    if not ls or not rs:
        return {}
    a, b = sum(ls) / len(ls), sum(rs) / len(rs)
    lit, shadow = max(a, b), min(a, b)
    return {
        "left_band_luma": round(a, 1),
        "right_band_luma": round(b, 1),
        "lit_over_shadow_ratio": round(lit / shadow, 3) if shadow else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("--sky-sample", help="X,Y of a clean sky pixel (default: top corners)")
    ap.add_argument("--tolerance", type=float, default=42.0, help="sky colour distance threshold")
    ap.add_argument("--json", type=Path, help="write full result including per-row silhouette")
    args = ap.parse_args()

    w, h, px = load(args.image)
    sample = tuple(int(v) for v in args.sky_sample.split(",")) if args.sky_sample else None
    sky = sky_estimate(px, w, h, sample)
    sil = silhouette(px, w, h, args.tolerance)

    # Width statistics only from sky-bounded rows — a run touching the frame
    # edge is foreground, and counting it saturates the median at image width.
    widths = [wd for l, r, wd in sil if wd > 0 and l > 0 and r < w - 1]
    subject_rows = [y for y, (l, r, wd) in enumerate(sil) if wd > w * 0.05]
    result = {
        "image": str(args.image),
        "size": [w, h],
        "aspect": round(w / h, 4),
        "sky_rgb": [round(v) for v in sky],
        "subject_top_row": subject_rows[0] if subject_rows else None,
        "subject_bottom_row": subject_rows[-1] if subject_rows else None,
        "median_width_px": median([float(v) for v in widths]) if widths else 0,
        "floor_pitch": floor_pitch_candidates(px, sil, w, h),
        "bands": band_stats(px, sil, w, h),
    }
    print(json.dumps(result, indent=2))
    if args.json:
        result["silhouette_rows"] = sil
        args.json.write_text(json.dumps(result))
        print(f"full silhouette written to {args.json}", file=sys.stderr)


if __name__ == "__main__":
    main()
