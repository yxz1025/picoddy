# Assistant Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download the specified PICODDY image into the frontend and use it for assistant avatars in chat and the floating view.

**Architecture:** Store the image under Vite’s `public` directory and reference it with an absolute public path. Keep the existing avatar wrappers and apply a shared image class so dimensions and layout remain unchanged.

**Tech Stack:** React, TypeScript, CSS, Vite.

---

### Task 1: Add the local avatar asset

**Files:**

- Create: `frontend/public/assistant-avatar.png`

- [ ] Download `https://retail.example.com/logo.ico` to a temporary file, verify it is a non-empty PNG image (the `.ico` source URL returns PNG data), then move the original bytes without transcoding to `frontend/public/assistant-avatar.png`.

```bash
curl -fL https://retail.example.com/logo.ico -o /tmp/pi-agent-assistant-avatar.png
file /tmp/pi-agent-assistant-avatar.png
cp /tmp/pi-agent-assistant-avatar.png frontend/public/assistant-avatar.png
```

### Task 2: Replace letter avatars

**Files:**

- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `frontend/src/components/ChatArea.css`
- Modify: `frontend/src/components/FloatView.tsx`
- Modify: `frontend/src/components/FloatView.css`

- [ ] Replace both chat assistant letters with:

```tsx
<div className="assistantAvatar">
  <img className="assistantAvatarImage" src="/assistant-avatar.png" alt="" />
</div>
```

- [ ] Replace the floating brand letter with:

```tsx
<div className="float-brand">
  <img className="float-brand-image" src="/assistant-avatar.png" alt="" />
</div>
```

- [ ] Add image styles while retaining wrapper dimensions:

```css
.assistantAvatarImage,
.float-brand-image {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: inherit;
  object-fit: cover;
}
```

### Task 3: Verify the frontend

**Files:**

- Verify: `frontend/public/assistant-avatar.png`
- Verify: frontend production build

- [ ] Confirm the code no longer renders the `J` placeholder in either component.

```bash
rg -n 'assistantAvatar">J|float-brand">J' frontend/src/components
```

Expected: no matches.

- [ ] Build and lint the frontend.

```bash
cd frontend
npm run build
npm run lint
```

Expected: build and lint exit successfully; existing unrelated warnings may remain.
