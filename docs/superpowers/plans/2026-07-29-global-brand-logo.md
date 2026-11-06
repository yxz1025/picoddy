# Global Brand Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the downloaded PICODDY PNG as the single source for every Pi-a brand surface and remove the blue background visible through transparent pixels.

**Architecture:** Keep `PiLogo` as the shared React abstraction but render the local PNG. Generate browser and desktop icon derivatives from the same source with one deterministic Pillow script.

**Tech Stack:** React, TypeScript, CSS, Python Pillow, macOS iconutil, Vite.

---

### Task 1: Replace interface brand surfaces

**Files:**

- Modify: `frontend/src/components/PiLogo.tsx`
- Modify: `frontend/src/components/ChatArea.css`
- Modify: `frontend/src/components/FloatView.css`
- Modify: `frontend/index.html`
- Delete: `frontend/public/favicon.svg`

- [ ] Replace the SVG implementation in `PiLogo.tsx` with:

```tsx
export const PiLogo: React.FC<PiLogoProps> = ({
  size = 28,
  className = "",
  style = {},
}) => (
  <img
    src="/assistant-avatar.png"
    alt=""
    width={size}
    height={size}
    className={`pi-a-logo ${className}`}
    style={{
      display: "inline-block",
      verticalAlign: "middle",
      borderRadius: `${size * 0.22}px`,
      objectFit: "contain",
      flexShrink: 0,
      ...style,
    }}
  />
);
```

- [ ] Set `.assistantAvatar` and `.float-brand` backgrounds to `transparent` and remove their brand-gradient shadows if they produce a blue halo.

- [ ] Replace the old SVG favicon link with:

```html
<link rel="icon" type="image/png" href="/icon-128.png" />
<link rel="apple-touch-icon" href="/icon.png" />
```

### Task 2: Generate all application icon sizes

**Files:**

- Modify: `scripts/generate-icon.py`
- Replace: `frontend/public/icon.png`
- Replace: `frontend/public/icon-128.png`
- Replace: `frontend/public/icon-512.png`
- Replace: `resources/app-icon.png`
- Replace: `resources/app-icon.iconset/*.png`
- Replace: `resources/app-icon.icns`

- [ ] Rewrite `scripts/generate-icon.py` to open `frontend/public/assistant-avatar.png`, convert it to RGBA, and resize it with `Image.Resampling.LANCZOS`.

- [ ] Generate:

```text
frontend/public/icon.png                 1024×1024
frontend/public/icon-512.png              512×512
frontend/public/icon-128.png              128×128
resources/app-icon.png                  1024×1024
resources/app-icon.iconset/icon_*.png   required 1×/2× sizes
resources/app-icon.icns                 rebuilt with iconutil
```

- [ ] Preserve transparency and do not add a colored background, gradient, border, or shadow.

### Task 3: Verify generated assets and frontend

**Files:**

- Verify all files changed in Tasks 1–2.

- [ ] Confirm generated dimensions and formats with `file` and Pillow.

- [ ] Confirm runtime source no longer references `favicon.svg` or renders the old inline Pi SVG.

- [ ] Run:

```bash
cd frontend
npm run build
npm run lint
```

Expected: build and lint exit successfully; existing unrelated warnings may remain.

- [ ] Run `git diff --check`.
