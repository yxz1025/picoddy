# Desktop Office integration

The desktop preview routes local `.docx`, `.xlsx`, and `.pptx` artifacts to the bundled
Namiwork 3.29.0 Office runtime. The supplied native helpers support macOS ARM64 and Windows x64;
Windows ia32/ARM64, Intel Mac, other platforms and legacy formats retain the basic preview. Browser-only mode
continues to use the existing previews.

## Integration boundaries

- `src/electron/office-preview.ts`: validates main-window IPC, stages the development
  runtime under userData/office-runtime/3.29.0/<platform>-<arch>, creates native views, tracks readiness,
  propagates theme and layout, and handles saves. The development copy needs a
  CommonJS package boundary and executable permission on xlsx-sidecar.
- `src/electron/office-sessions.ts`: preserves hidden editing sessions across file
  switches; releases read-only sessions so reopened previews read current disk data.
  At most eight sessions are retained. Close editing sessions to free capacity.
- `frontend/src/components/previews/OfficePreview.tsx`: preview/edit/save controls,
  native view bounds, overlay visibility, and an explicit basic-preview fallback.
- `main.mjs`: application exit waits for editor close confirmation. Cancelling leaves
  the application open. Closing the Mac window hides it and retains editing sessions.
- `scripts/runtime/office-runtime.cjs` is the single platform mapping used by the
  desktop host and packaging hooks. The common runtime/modules/fonts/licenses come
  from `vendor/office/common`; native helpers come from `vendor/office/native/<platform>-<arch>`. The original extraction directories are no longer dependencies.
  Recomputed SHA-256 confirms all 616 common files are identical.
- Before-pack stages each **target** separately under build/office-staging. Mac and
  Windows extraResources include that staging directory. After-pack checks the
  target manifest and native binary header. Development uses the same preparation
  code, isolates caches by platform/architecture, and sets Mac executable permissions
  during preparation. Unsupported architectures receive a small manifest only.
- Windows uses xlsx-sidecar.exe (PE x64), Mac uses xlsx-sidecar (Mach-O ARM64).
  Frontend, IPC, sessions, readiness/save protection and backup logic remain shared.

Before each new editing session, the original file is copied to
`<userData>/office-backups/<timestamp>-<filename>`. These backups are retained;
no automatic retention cleanup is currently implemented. Save writes the original
artifact. Editing a file simultaneously in another app or through an AI tool has
not been comprehensively tested; editor-specific conflict handling remains in the
upstream runtime. This integration does not yet expose editor transactions to AI.

The runtime is maintained under `vendor/office` with a file hash manifest and source
provenance. All 618 files were verified after migration; the two original extraction
directories can be removed independently. The runtime is extracted distribution
code, not a complete rebuildable source tree.
Keep upstream vendored files unchanged unless applying a documented patch. Its LICENSE/NOTICE are packaged with
it. The NOTICE references third-party notices not present in the supplied material;
complete that distribution review before shipping a public installer.

## Verification

```sh
node --import tsx --test test/src/electron/office-sessions.test.ts
npx tsc -p tsconfig.electron.json --noEmit
npm run build --prefix frontend
node_modules/.bin/electron scripts/testing/office-preview-smoke.cjs
```

The Electron smoke test uses an isolated temporary profile and generated files. It
checks IPC rejection from another window, edits each format, saves, independently
checks OOXML/Excel bytes, closes and reopens in preview mode. `OFFICE_SMOKE_SHOW=1`
shows the test window and captures previews. It never edits user documents.

Runtime smoke verified on Mac ARM64. Windows x64 resource staging and PE architecture
were verified on the Mac build host; Windows execution is not yet verified. Run the
same Electron smoke command on Windows x64 (or `npx electron scripts/testing/office-preview-smoke.cjs`). Simple file roundtrips do not
establish full compatibility with complex Office layouts, charts, formulas, macros,
or Microsoft Office itself. A packaged/signing/notarization run is still required
before distributing an installer.
