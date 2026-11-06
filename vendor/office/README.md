# Vendored Office runtime — 3.29.0

This directory is the project's self-contained source for desktop Office resources.
Development and packaging do not read the original extraction directories.

- `common/`: 616 files shared by macOS and Windows (identical at import, with local branding patches documented in PATCHES.md): runtime,
  renderer/preload modules, fonts, WASM and original license notices.
- `native/darwin-arm64/xlsx-sidecar`: macOS ARM64 helper.
- `native/win32-x64/xlsx-sidecar.exe`: Windows x64 helper.
- `MANIFEST.sha256.json`: SHA-256 of all 618 current runtime files.
- `UPSTREAM.sha256.json`: original hashes before local patches.
- `PATCHES.md`: documented UI branding changes.

Original license texts are retained in `common/LICENSE`, `common/NOTICE` and
`common/LICENSE-UNICODE.txt`. The core NOTICE identifies GenOffice / Mainfunc, Inc.
It references THIRD-PARTY-NOTICES.txt, which was not present in the supplied bundles;
that missing upstream distribution material remains to be resolved before public
release. These files are extracted runtime artifacts, not a full rebuildable
TypeScript/React/Rust source repository.

Provenance:

- Namiwork-3.29.0-arm64.dmg SHA-256:
  `84689d0ad7e095cc9923ed7f534d4e4c2808177520c3777c17f8f0e0e89198f7`.
- Namiwork_3.29.0.exe SHA-256:
  `0ff698a0d7dcad049d519a57224983cc78e38b16cedb53b46bc459d3baa7fbb8`.
- All 616 common file hashes were compared before deduplicating.
- Windows sidecar SHA-256:
  `10c27273b3841c46d1fa196ef8ed95ed96503554984553ba9b8496dcbbb28f88`.

`scripts/runtime/office-runtime.cjs` assembles a target-specific tree under
`build/office-staging/<platform>-<arch>` for packaging, or in the per-platform
application data cache for development. Original directory layout is reconstructed
there, with licenses alongside runtime/modules and only the target native helper.
`.gitattributes` preserves original bytes across platform checkouts.

When updating, replace common files and both architecture helpers together,
regenerate the manifest, update runtime VERSION/REVISION, and run platform staging
and Electron roundtrip tests. See `docs/office/integration.md`.
