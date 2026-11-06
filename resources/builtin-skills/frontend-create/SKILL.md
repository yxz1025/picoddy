---
name: frontend-create
description: Create distinctive, production-grade frontend interfaces that feel genuinely designed — not AI-generated. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications. Focuses on avoiding repetitive AI design patterns, creating authentic visual identity, and producing work with real craft.
license: Complete terms in LICENSE.txt
---

This skill guides creation of frontend interfaces that feel designed by a human art director, not stamped from an AI template. The goal is **authenticity** — designs that feel intentional, contextual, and surprising in the right ways.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## The Problem This Skill Solves

AI-generated frontends all look the same. After analyzing dozens of AI-designed sites, these patterns recur obsessively:

### BANNED Patterns (Never Use Without Explicit Override)

**Typography clichés:**
- Playfair Display, Syne, Unbounded, Fraunces, Space Grotesk, DM Sans — these are the most overused AI font choices. Avoid them as primary typefaces.
- Pairing a "fancy serif" with "clean sans-serif" in the obvious way — this is the #1 signal of AI design.
- Letter-spacing on uppercase labels (like `0.15em` on micro-text) — every AI site does this.
- Using a monospace font as the sole body font without clear intent — it can work for the right brief (receipts, terminals, technical docs) but shouldn't be a default.

**Color clichés:**
- Dark themes with `#0a0a0c` or `#1a1a2e` as background — AI's default "modern" look.
- Teal/cyan accent colors (`#00e5c3` and its siblings) — AI's default "cool" accent.
- Orange/amber as the only warm accent (`#FF6611`, `#c67b3c`) — AI's default "friendly" accent.
- Purple gradients on anything — the most infamous AI tell.
- CSS variables named after the domain topic (espresso, mocha, caramel for coffee; forest, moss for outdoors). Use abstract color names instead.

**Layout clichés:**
- Hero → section labels → card grid → CTA → footer — this is the AI homepage formula. Break this sequence.
- Every section starts with a tiny uppercase label + large heading. Mix up how sections begin.
- Content always centered, always `max-width: 1100px`. Try left-aligned, asymmetrical, or full-bleed layouts.
- Three-column product/feature cards — the most predictable grid choice.

**Interaction clichés:**
- Fade-up scroll reveal (`.reveal` → `.visible` with `translateY(30px)`) — EVERY AI site does this. Use different entrance strategies: clip-path reveals, stagger transforms from the side, opacity-only fades, scale-from-center, or skip animations entirely for confident stillness.
- Grain/noise overlay on the entire page — use sparingly if at all. It's the AI equivalent of Instagram filters.
- Canvas particle backgrounds — overused to the point of meaninglessness.
- Pulsing dots on badges — done by every AI "like" button and status indicator.
- Toast notifications instead of real interaction design.

**Structural clichés:**
- Navigation: logo left, links right, CTA button far right — the most predictable nav layout possible.
- Hero: big centered heading + subtext + two buttons (primary + ghost) + scroll indicator.
- Numbered cards (01, 02, 03) — AI loves numbering things that don't need numbers.
- Section dividers with gradient lines.
- Marquee/ticker strips — AI's "dynamic" crutch.

### What to Do Instead

**Typography that feels real:**
- Choose fonts from foundries beyond Google Fonts' popular list. Try: Klim, Grilli, Undercase, Colophon, Typefaceshop, or obscure Google Fonts picks (under 1M uses).
- Use type scales with real contrast: a 200-weight body alongside a 900-weight display creates tension that feels designed.
- Let headings be uncomfortable in the right way — too tight, slightly oversized, unexpectedly positioned.
- Consider ALL-UPPERCASE display text set with tight tracking, or italic display faces used straight, or monospace for body text in the right context.
- Try one typeface at two wildly different weights instead of two typefaces.

**Color that feels discovered, not generated:**
- Start from a real object, photograph, or emotion — not a hex picker. "The blue of a rain-soaked Portland sidewalk at dusk" is a better brief than "modern blue."
- Build palettes with hue relationships, not just lightness steps. A single accent against near-monochrome is powerful but overused; try analogous palettes (3 adjacent hues) or split-complementary.
- Use colors that slightly clash and resolve — dirt and fluorescence, pastel and black, oversaturated and muted.
- Let backgrounds be colored, not just white or black. Cream, pale yellow, warm grey, dusty rose, institutional green.
- Abstract CSS variable names: `--ink`, `--paper`, `--highlight`, `--muted`, `--surface`, `--accent-1`, `--accent-2` — not domain-themed names.

**Layout that surprises:**
- Break the hero-centered-CTA pattern. Try: a left-aligned narrow column hero, a hero that's mostly white space with a small focused element, or a split-screen that's not 50/50.
- Use horizontal scrolling sections, oversized margins, or content that breaks out of its container.
- Try layouts inspired by editorial design: asymmetric columns, pull quotes, marginal notes, footnotes as design.
- Consider a single strong visual moment (one big thing) rather than many small moments (card grids).
- Editorial inspiration: newspaper layouts, poster design, book cover composition, zine aesthetics, record label design.

**Interaction that serves content:**
- If animations don't add meaning, don't animate. A confident design can be still.
- When animating, use: clip-path reveals, scale-from-center, stagger from left/right, opacity with slight blur, color shifts, or counter animations for numbers.
- One well-timed animation is better than five simultaneous fade-ups.
- Hover states should feel physical: slight movement, color shift, scale change, or content reveal — not just opacity changes and box shadows.
- Consider cursor changes, text selection color, scroll snap, and other micro-interactions that reward attention.

**Structure that breathes:**
- Not every page needs every section. A homepage can be: just a hero + contact. Or: a full-screen product shot + 3 lines of text + a down arrow.
- Leave breathing room. Generous whitespace is a design choice, not "wasted space."
- Use visual rhythm — alternating dense and sparse sections, or using full-bleed images/dividers between text sections.
- Footers don't need 4 columns. Sometimes "© 2026 Name. hello@email.com" is enough.
- Navigation can be: minimal (just a logo), horizontal, hidden behind a hamburger, or even just the company name large with contact info.
- Consider: what if the hero was at the bottom? What if the CTA was the first thing you see? What if there was no CTA at all and the design itself makes you want to act?

## Design Process

Before coding, make deliberate decisions and write them as CSS variables at the top:

1. **Contextual anchor**: What real-world reference or feeling grounds this design? (A chalkboard menu, a transit map, a WPA poster, a vinyl sleeve, a pharmacy receipt, a court filing, a protest sign...)
2. **Color strategy**: Pick colors from a specific source — a photograph, an object, an era. Name variables abstractly.
3. **Type strategy**: Choose at most 2 typefaces. Prefer lesser-known ones. Define the TYPE SCALE with specific sizes and weights.
4. **Layout anchor**: Sketch a one-line description of the spatial composition ("left-leaning column, hero takes 30%, products bleed right").
5. **The one thing**: What's the SINGLE most memorable visual element? Commit to it fully.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually distinctive — not immediately recognizable as AI-generated
- Cohesive with the contextual anchor chosen
- Meticulously refined in details that matter

## Anti-Pattern Checklist

Before finalizing, verify NONE of these apply:

- [ ] Is Playfair Display, Syne, Unbounded, Fraunces, or Space Grotesk used as a primary typeface?
- [ ] Is there a "fade-up on scroll" animation applied to every section?
- [ ] Is there a full-page grain/noise overlay?
- [ ] Is the primary accent color a teal/cyan (`hsl(165-175, ...)` range) or bright orange?
- [ ] Is the hero a centered heading + subtitle + two buttons?
- [ ] Are sections introduced with tiny uppercase labels?
- [ ] Is the background pure black (`#0a0a0c`) or pure white (`#fff`)?
- [ ] Is there a canvas particle/wave animation in the hero?
- [ ] Does every card in a grid have the same structure and hover effect?
- [ ] Are there numbered items (01, 02, 03) that don't need numbers?
- [ ] Does the nav follow the logo-left/links-right/CTA-far-right pattern without variation?
- [ ] Is there a "scroll down" indicator at the bottom of the hero?
- [ ] Does the page end with a gradient CTA box?

If any check passes, redesign that element. Every item on this list is a dog-whistle for AI-generated design.

## Important Nuances

- These guidelines prevent repetitive AI patterns, but don't mandate ugliness or chaos. A design can be clean, minimal, and restrained WITHOUT falling into the AI template. The enemy is predictability, not simplicity.
- Context matters. A design for a law firm SHOULD feel different from a music streaming service. Use the brief to find the right aesthetic anchor.
- "Breaking rules" doesn't mean "being random." It means making deliberate choices that differ from the AI defaults. A left-aligned layout is a choice. A single accent color is a choice. No animations is a choice.
- When the user explicitly requests a pattern on the banned list (e.g., "I want a particle background"), follow the user's request. The banned list represents AI defaults, not user preferences.
- Bold maximalism and refined minimalism both work. The key is intentionality and specificity, not intensity. A design that feels like it could only be for THIS client is a success.

Remember: The goal is to produce work that a human designer would be proud to claim. Designs that look like they could only come from an AI are failures, regardless of technical quality.