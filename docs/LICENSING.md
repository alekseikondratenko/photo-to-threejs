# Licensing — code, models, and photographs are three different things

This trips people up constantly, so it is worth stating plainly.

## The three layers

| Layer | What it is | Licence here |
|---|---|---|
| **Code** | viewer, geometry library, measurement harness, MCP server | Apache-2.0 (see `LICENSE`) |
| **3D models** | the three procedural reconstructions in `viewer/src/models/` | Apache-2.0 — original work |
| **Reference photographs** | the input images | **each one separately**, see below |

**Depicting a building is not the same as redistributing a photograph of it.**
In the US, 17 U.S.C. §120(a) permits pictorial representation of an architectural
work that is visible from a public place. In the UK, CDPA s.62 goes further and
explicitly permits *making a three-dimensional model* of a building. So the
models are free to publish regardless of where the reference came from.

The photograph is a separate copyrighted work with its own author. That is the
only thing constrained here.

## Per-image position

| Reference | Status | In this repo? |
|---|---|---|
| White House (viewer + example) | Unsplash, Tomasz Zielonka, Unsplash License | ✅ Yes — attributed |
| White House (original solve frame) | Stock photograph, no EXIF, provenance unverified | ❌ No — see note below |
| Taipei 101 | Wikimedia Commons, AngMoKio, CC BY-SA 3.0 | ✅ Yes — attributed, same licence |
| Empire State Building | Own photograph, Nikon P900, 2020-08-19, EXIF intact | ✅ Yes — CC BY 4.0 |

The White House needs the two rows: the model was *solved* against a stock photograph
whose author could not be traced, so that frame is excluded and its role is documented
honestly on the [example page](examples/white-house/). The Unsplash photograph that ships
in its place has near-identical framing (aspect 1.4999 vs the solve frame's 1.4995) and is
the right thing to judge the geometry against — but the measured percentages were not
scored against it, and its overcast light differs from the hard sun the model reproduces.

During development the method was also exercised on four further subjects (a commercial
archviz tower, 20 Fenchurch St, a bolted hydraulic cylinder, a villa facade) whose
reference images all failed the same provenance test. Rather than ship those models with
placeholder cards, this repository publishes only the three subjects whose comparisons
can be shown.

## Why "we couldn't verify it" means *exclude*, not *include*

Copyright attaches automatically on creation. It does not require registration, a
notice, or a watermark. So an image with no traceable provenance is not
unencumbered — it is an image **whose owner is unknown**. The absence of evidence
of copyright is not evidence of its absence.

That is why the unverifiable images are excluded rather than shipped: not because
anyone proved they are protected, but because nobody can show they are not, and a
public repository is exactly where that becomes someone else's problem too.

## Re-scoring against your own photograph

To re-run a measured comparison, supply your own photograph of a subject and
re-solve — the method for doing so is `skills/photo-to-threejs-building/SKILL.md`, and the numbers you
should be reproducing are in the `targets` block of the corresponding
`viewer/src/scenes/<id>.ts`.
