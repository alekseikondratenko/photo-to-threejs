# Licensing — code, models, and photographs are three different things

This trips people up constantly, so it is worth stating plainly.

## The three layers

| Layer | What it is | Licence here |
|---|---|---|
| **Code** | viewer, geometry library, measurement harness, MCP server | Apache-2.0 (see `LICENSE`) |
| **3D models** | the seven procedural reconstructions in `viewer/src/models/` | Apache-2.0 — original work |
| **Reference photographs** | the input images | **each one separately**, see below |

**Depicting a building is not the same as redistributing a photograph of it.**
In the US, 17 U.S.C. §120(a) permits pictorial representation of an architectural
work that is visible from a public place. In the UK, CDPA s.62 goes further and
explicitly permits *making a three-dimensional model* of a building. So all seven
models are free to publish regardless of where the reference came from.

The photograph is a separate copyrighted work with its own author. That is the
only thing constrained here.

## Per-image position

| Reference | Status | In this repo? |
|---|---|---|
| Empire State Building | Own photograph, Nikon P900, 2020-08-19, EXIF intact | ✅ Yes — CC BY 4.0 |
| Taipei 101 | Wikimedia Commons, AngMoKio, CC BY-SA 3.0 | ✅ Yes — attributed, same licence |
| White House | Stock photograph, no EXIF, provenance unverified | ❌ No — placeholder |
| Residential Tower AM271 | Evermotion Archmodels vol. 271 commercial preview | ❌ No — licence forbids it |
| 20 Fenchurch St | Unattributed 387px web image | ❌ No — placeholder |
| Bolted hydraulic cylinder | Vendor image, visible watermark | ❌ No — placeholder |
| Villa "Facade Principale" | Unattributed web image | ❌ No — placeholder |

## Why "we couldn't verify it" means *exclude*, not *include*

Copyright attaches automatically on creation. It does not require registration, a
notice, or a watermark. So an image with no traceable provenance is not
unencumbered — it is an image **whose owner is unknown**. The absence of evidence
of copyright is not evidence of its absence.

That is why the five images above are excluded rather than shipped: not because
anyone proved they are protected, but because nobody can show they are not, and a
public repository is exactly where that becomes someone else's problem too.

## Reproducing the excluded subjects

The models are all here; only the input photographs are missing. To re-run a
measured comparison for one of them, supply your own photograph of the subject
and re-solve — the method for doing so is `skill/SKILL.md`, and the numbers you
should be reproducing are in the `targets` block of the corresponding
`viewer/src/scenes/<id>.ts`.
