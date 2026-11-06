# Local UI branding patch — 2026-10-27

Replace the exact product label `360Office` with `PiCoddy Office` in the files
listed below. This covers document page titles, runtime product name and default
save directory names, plus matching code comments. Numeric dimensions, angles,
OOXML values, native helpers and LICENSE/NOTICE files are unchanged.

`UPSTREAM.sha256.json` retains original hashes. `MANIFEST.sha256.json` records the
patched distribution. Runtime cache revision 5 forces regeneration of older caches.

- `common/runtime/index.js`: 3 replacements
- `common/modules/sheets/renderer/index.html`: 1 replacements
- `common/modules/sheets/renderer/assets/index-D8RCCAzg.css`: 1 replacements
- `common/modules/markdown/main/index.js`: 1 replacements
- `common/modules/pdf/main/index.js`: 1 replacements
- `common/modules/docs/renderer/index.html`: 1 replacements
- `common/modules/docs/renderer/assets/index-CkIndUnw.css`: 1 replacements
- `common/modules/slides/renderer/index.html`: 1 replacements
- `common/modules/slides/renderer/assets/index-Do8EmVXW.css`: 1 replacements
