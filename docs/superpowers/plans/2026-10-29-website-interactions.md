# Website interaction polish

**Goal:** Apply the approved Appllama motion and feedback principles to the existing static website.

**Architecture:** Keep HTML/CSS/JS and existing mint branding. CSS owns press feedback, responsive layout and motion tokens; local JS owns navigation, demo state and clipboard status. No dependencies or deployment.

## Implementation sequence

- [x] Capture browser regressions for mobile readability, menu dismissal/focus, clipboard feedback and scenario navigation.
- [x] Update `website/index.html` semantics and safe-area viewport; keep all factual content intact.
- [x] Update `website/styles.css`: one ease-out vocabulary, 120ms press states, short transitions, mobile stacked demo, 44px targets, focus and reduced-motion support.
- [x] Update `website/app.js`: interruptible demo fade, no animation on repeated selection, menu outside-click/Escape/focus dismissal, section tracking, copy pending/success/error states and cancellable FAQ animation.
- [x] Run `node --check website/app.js` and `python3 scripts/testing/website-interactions.py` against localhost:4178. Inspect desktop/mobile screenshots and record a browser interaction flow. Document device-emulation limits.

Verification: JavaScript syntax and whitespace checks passed. Eight Chromium browser checks passed across seven viewport widths. Desktop/mobile screenshots and sampled frames from the recorded interaction flow were inspected. Real iOS/Safari hardware and 60fps device performance were not measured.
