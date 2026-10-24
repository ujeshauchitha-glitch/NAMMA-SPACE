# Namma Space V1 — Definitive Design Handoff

**Design system name:** GROUNDTRUTH
**Ethinca line:** *Everything on screen is either measured, stated, or explicitly labelled as simulated.*
**Status:** implementation-ready. A developer should not need further design input.
**Mode:** Operate (a tool used under time pressure at a live Techfest finale — scanability, honesty, and precision outrank expression).
**Scope:** application shell + 01 CAPTURE STUDIO + 02 SPATIAL VIEWER + 03 LIVE SCAN + compact top nav.

---

## 0. Repo facts that constrain this design (read first)

Verified against the repository on 2026-10-24. These are not suggestions; they constrain implementation.

| Fact | Evidence | Consequence for this handoff |
|---|---|---|
| **GSAP is NOT installed.** Neither is `@gsap/react`, nor `three`. | `package.json` deps: `playcanvas ^2.6.0`, `react ^19.1.1`, `react-dom ^19.1.1`, `zod ^4.1.5` only. | Motion tokens are specified twice: (a) CSS custom properties that drive all micro-interactions with zero dependencies, and (b) a GSAP choreography layer that requires adding `gsap@^3.13` + `@gsap/react` first (§7.0). If the dependency cannot be added, every moment in §7 has a documented CSS/WAAPI fallback. GSAP is now free incl. previously paid plugins (Webflow, 2025); core + `Flip` + `SplitText` are enough for V1. |
| **Styling is one global stylesheet with plain CSS custom properties.** No CSS Modules, no Tailwind, no CSS-in-JS. | `src/styles.css` imported once in `App.tsx`. | Tokens ship as CSS custom properties. New component styles go in **CSS Modules** (`*.module.css`, native to Vite — zero new deps). Global file shrinks to `tokens.css` + `base.css` only. |
| **Current visual identity is the rejected one**: dark graphite `#0d100f` + amber `#e9a54f`, Manrope + DM Mono, glyph "icons" (`⌂ ↻ ⌕ ✦ ＋`). | `src/styles.css` L1–22, L37, L89, L191. | The palette, fonts, mark, and icon approach are **replaced**, not refactored. Treat `styles.css` as the anti-reference. |
| **`App.tsx` is a 230-line single-workspace monolith** (viewer + search + capture staging in one screen). | `src/App.tsx`. | The three-workspace shell is new structure: route by workspace id, keep `PlayCanvasViewer` engine code untouched (D-003). |
| **The engine already owns pointer-lock walkthrough, WASD, A\*, route/POI entities, ResizeObserver.** | `src/engine/PlayCanvasViewer.ts`. | All viewer motion (camera jump, route reveal) must go through the existing `PlayCanvasViewer` public methods (`jumpTo`, `routeTo`, `reset`, `enterWalkthrough`) — the UI never tweens the camera itself. |
| **State vocabulary already exists in Zod schemas** and must not drift. | `src/types/scene.ts`: `quality.status: passed/needs-review/failed`; `readiness: blocked/partial/visual_ready/navigation_ready/validated`; POI `category: room/service/landmark/furniture/entrance/other`; `sceneKind: synthetic-demo/reconstructed-capture`; POI `source: operator/model/synthetic`. | UI state names (§8.3) map onto these enums 1:1. Never invent a state that has no schema value, and never display a state the schema can't back. |
| **Navigation grid has explicit `blocked` and `unknown` cells**; A* returns `ok`/`detail`. | `src/types/scene.ts` L39–71, `src/lib/navigation.ts`. | Route/status UI distinguishes *unreachable* (blocked) from *unverified* (unknown) — different copy, different color+glyph. |
| **Fixture scenes are synthetic and must stay labelled as such**; provenance fields are enforced by schema. | `public/scenes/*/manifest.json`, `sceneKind` superRefine. | The "SIMULATED" provenance chip (§4.12) is mandatory chrome, derived from `manifest.sceneKind`/`provenance.source`, never styled down. |
| **PlayCanvas 2.x lazy chunk** (~332 KB initial / engine split) per D-012. | `DECISION_LOG.md` D-012. | Viewer loading state is a real, frequently-seen state — designed as a first-class skeleton (§4.15), not a spinner. |
| Demo may run **offline at the finale** (local laptop, no guaranteed network). | `PROJECT_SCOPE.md` assumptions; Google Fonts `@import` currently in `styles.css` L1. | Fonts are **self-hosted woff2** (preferred) or Google-hosted with hard system fallbacks; no layout may depend on a webfont loading. QR pairing is local-network only. |

---

## 1. Identity — GROUNDTRUTH

The design system is named **Groundtruth**: in surveying and remote sensing, *ground truth* is the in-situ measurement used to validate what was sensed from afar — exactly this product's thesis (a capture is only published when its evidence holds). One-line ethos:

> **Everything on screen is either measured, stated, or explicitly labelled as simulated.**

**Mark (describe, do not draw from stock):** a 24×24 **survey benchmark** — a 1.5 px ink-stroked circle bisected by a full-width/height crosshair, with a 3 px lime (`--accent-lime`) dot at the intersection. It reads as "a measured point" at 16 px and as a plan-view station at 64 px. Favicon variant: the crosshair alone.

**Wordmark:** `NAMMA SPACE` in Archivo, uppercase, weight 650, tracking +0.08 em at ≤13 px sizes, with a hairline vertical rule then a mono descriptor (`SPATIAL TWIN LAB` / current workspace). The legacy rotated "NS" amber square is retired.

**Voice in one line:** terse, technical, honest — a survey instrument's field notebook, not a product launch.

---

## 2. Three palette explorations

All three explored as full token sets. Contrast values computed with the WCAG 2.1 relative-luminance formula. Direction C's existing dark-graphite/amber predecessor (`#0d100f`/`#e9a54f`) is an **anti-reference for all three**: no amber, no graphite.

### 2.1 Direction A — "MERIDIAN" (light mineral cartography)

Survey paper, botanical drafting ink, one signal color, one data color. Reads as a plan room: maps, contact sheets, measured drawings.

| Token | Hex | Role |
|---|---|---|
| `--surface-0` | `#F2EFE6` | app canvas ("mineral paper") |
| `--surface-1` | `#FAF8F2` | panels, rails, top nav |
| `--surface-2` | `#FFFFFF` | raised: inputs, popovers, modals, thumbnails backdrop |
| `--surface-inset` | `#EBE7DB` | recessed wells: readouts, code, search field bed |
| `--line` | `#DED8C9` | hairline borders |
| `--line-strong` | `#C7BFA9` | emphasized borders, dividers, chip outlines |
| `--text` | `#15241D` | primary ("botanical ink") |
| `--text-muted` | `#4B5A50` | secondary |
| `--text-dim` | `#636E60` | tertiary (AA-corrected, see §3.1) |
| `--accent-botanical` | `#0E4034` | primary structural accent: primary button fill, links |
| `--accent-lime` | `#A9CC16` | **signal**: coverage fills, selected marker core, active tab underline, live dot. Never as text on light. |
| `--accent-cobalt` | `#2748C7` | **data**: route lines, focus ring, data links, chart strokes. Never as large fill. |
| `--success` | `#2F6B4B` | validated/published |
| `--warning` | `#8F5509` | needs review / partial |
| `--error` | `#A6331E` | failed |
| `--blocked` | `#615E56` | blocked/unavailable (neutral — absence, not alarm) |

**3D-scene compatibility:** the SPATIAL VIEWER HUD becomes floating **field chips**: `rgba(247,245,238,0.92)` + `backdrop-filter: blur(10px)` + 1 px `--line-strong` + shadow. Because the chip is 92 % opaque, its composited background is bounded between `#E3E1DB` (over pure black scene) and `#F8F6EF` (over pure white scene) — **ink text stays ≥ 12.3:1 over literally any scene content** (computed, §3.1). This is the strongest HUD-legibility guarantee of the three directions, and it costs nothing at any scene exposure. Route/markers use ink-cased shapes (cartographic casing technique) so silhouettes survive bright scenes; lime carries dark scenes. Weakness: bright HUD chips are luminous against very dark scenes — accepted, they are small, bordered, shadowed, and read as *labels pinned to a plate*, which is the intended metaphor.

### 2.2 Direction B — "SECTION" (warm architectural editorial)

Stone, dark teal ink, survey-orange markers. Magazine-morning-light mood.

| Token | Hex | Role |
|---|---|---|
| `--surface-0` | `#E9E5DC` | canvas (warm stone) |
| `--surface-1` | `#F3F0E9` | panels |
| `--surface-2` | `#FCFBF8` | raised |
| `--text` | `#16292B` | teal-ink |
| `--text-muted` | `#4E5C5C` | secondary |
| `--text-dim` | `#6E7878` | tertiary |
| `--accent-teal` | `#0F4F4C` | structural accent |
| `--accent-survey` | `#C24A17` | markers, warnings-adjacent signal |
| `--success/--warning/--error/--blocked` | `#3F6B3C / #8A5607 / #A5301A / #63605A` | semantic |

**3D-scene compatibility:** survey orange survives dark scenes but **disappears against warm captures** — and indoor smartphone captures are dominated by exactly the wood/brick/tungsten tones that `#C24A17` sits inside. Orange markers on a warm hall = invisible POIs at demo time. Ink-on-survey is only **3.09:1** (fails AA for small text on the primary action fill); `--text-dim` 3.62:1 on stone fails; survey-as-text 3.90:1 fails. The palette is beautiful for the CAPTURE STUDIO and unreliable in the two workspaces that are shown to judges.

### 2.3 Direction C — "DATUM" (dark spatial instrument)

Deep slate, mineral white, desaturated cyan, one hi-vis color. The classic 3D-tool world.

| Token | Hex | Role |
|---|---|---|
| `--surface-0` | `#0A1013` | canvas |
| `--surface-1` | `#111A1E` | panels |
| `--surface-2` | `#17232A` | raised |
| `--text` | `#E6ECE9` | mineral white |
| `--text-muted` | `#9FADAC` | secondary |
| `--text-dim` | `#77858A` | tertiary |
| `--accent-cyan` | `#6FB9C4` | structural/data accent |
| `--accent-signal` | `#D3EE49` | hi-vis signal |
| `--success/--warning/--error/--blocked` | `#6FBF88 / #DFA34C / #E06B58 / #84908F` | semantic |

**3D-scene compatibility:** best-in-theory blending (dark chrome dissolves around dark scenes), and honestly strong contrast (mineral on void 16:1). But: (1) against **bright captures** — sunlit halls, white walls, windows, which is the majority of real indoor phone footage — dark chrome *and* dark scene-framing produces glare sandwiches; thumbnails and the camera preview glare hardest on dark surfaces, and 60–80 % of CAPTURE STUDIO and LIVE SCAN surface area is photographic content. (2) The demo machine and judges' first impression is a dark UI with a neon-ish accent — the exact genre the founder rejected, one re-hue away from the incumbent. (3) `--text-dim` fails on raised (4.20:1) and error/blocked barely pass (4.89/4.86). Dark is not wrong; *this* dark reads as default.

---

## 3. Evaluation + final pick

### 3.1 Computed contrast (WCAG 2.1, shipped pairs)

**Picked direction A — MERIDIAN / GROUNDTRUTH:**

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` `#15241D` on `--surface-0` `#F2EFE6` | **14.03:1** | AAA |
| `--text` on `--surface-1` `#FAF8F2` | **15.19:1** | AAA |
| `--text` on `--surface-2` `#FFFFFF` | **16.13:1** | AAA |
| `--text-muted` `#4B5A50` on `--surface-0` | **6.35:1** | AA |
| `--text-muted` on `--surface-1` | **6.87:1** | AA |
| `--text-dim` `#636E60` on `--surface-0` | **4.65:1** | AA (corrected from `#6B776E` = 4.07 ✗) |
| `--text-dim` on `--surface-1` / `--surface-2` | 5.03 / 5.34 | AA |
| `--accent-botanical` `#0E4034` on `--surface-0` | **10.14:1** | AAA (links) |
| `#FFFFFF` on `--accent-botanical` (primary button) | **11.66:1** | AAA |
| `#FFFFFF` on `--accent-cobalt` `#2748C7` | **7.40:1** | AA |
| `--text` on `--accent-lime` `#A9CC16` (badge fill) | **8.71:1** | AAA |
| `--success` `#2F6B4B` on `--surface-1` | **5.95:1** | AA |
| `--warning` `#8F5509` on `--surface-1` | **5.70:1** | AA |
| `--error` `#A6331E` on `--surface-1` | **6.35:1` | AA |
| `--blocked` `#615E56` on `--surface-1` | **6.10:1** | AA |
| HUD chip ink over scene extremes (chip `rgba(247,245,238,0.92)` composited over `#000000` / `#FFFFFF`) | **12.33 / 14.92:1** | AAA over *any* scene |
| HUD chip muted over scene extremes | 5.58 / 6.75:1 | AA over *any* scene |

Rejected candidates' failures (already tabulated): B — ink-on-survey fill 3.09:1, survey-as-text 3.90:1, dim 3.62:1. C — dim-on-raised 4.20:1, error-on-raised 4.89:1.

Disabled text rule (A): disabled controls render `--text` at 45 % → 2.69:1 — **allowed only because disabled is exempt (WCAG 1.4.3)**, and disabled controls always keep their icon + label legible at 55 %+ via `--text-dim`.

### 3.2 Decision

**Ship Direction A — MERIDIAN, presented as the GROUNDTRUTH system.** Rationale, in order of weight:

1. **HUD-over-scene legibility is provable, not hopeful.** The 92 %-opacity chip bounds ink contrast to ≥ 12.3:1 against 100 % of scene luminance (computed above). No other direction has a closed-form guarantee; both B and C need per-scene scrims.
2. **Photographic content is this product's raw material** — captures, thumbnails, camera preview, reconstructed textures. Mineral paper is the neutral-warm ground that frames real photos (the contact-sheet/archive precedent); dark surfaces make them glare, warm stone tints them.
3. **Identity separation.** Light mineral cartography is neither the rejected graphite/amber, nor a SaaS template, nor sci-fi neon. It gives Techfest judges an instantly non-generic first frame: a *plan room* with a live window into the scanned space.
4. **Accessibility headroom.** Every shipped text pair is AA-or-better with most at AAA; status is never color-only (§7); focus cobalt is 6.44:1 on paper.
5. **3D compatibility by casing, not scrim.** Ink-cased route tape and markers (§4.10, §6.4) are the cartographic solution to unpredictable backgrounds and read as *instrumentation*, reinforcing the concept instead of apologizing for the scene.

Trade-off accepted: the 3D viewport sits inside a light shell, so the scene reads as a *plate on a drawing board*. This is deliberate and is the visual thesis (a measured drawing with a live window), executed with a 1 px `--line-strong` frame + inner shadow so the boundary is a drawn edge, not a seam.

---

## 4. Full token spec

### 4.0 Delivery mechanics

- `src/styles/tokens.css` — `:root` custom properties, no rules. Imported once in `main.tsx`.
- `src/styles/base.css` — reset, fonts, `body`, focus-visible defaults, scrollbar, `kbd`.
- Every component: `src/components/<Name>/<Name>.module.css`. **No new dependencies.**
- GSAP reads tokens via `gsap.to(el, { duration: TOKENS.dur.base, ease: TOKENS.ease.out })` from `src/styles/motion.ts` (typed export mirroring §7.1). CSS and GSAP share one source of truth; never hardcode a number in JS that exists as a token.
- All colors in CSS via `var(--…)`. `color-mix(in srgb, …)` is allowed (baseline 2023; Chromium/Firefox/Safari all support it — matches existing usage in `styles.css` L40).

### 4.1 Color (complete)

```css
:root {
  /* surfaces */
  --surface-0: #F2EFE6;        /* app canvas */
  --surface-1: #FAF8F2;        /* panels, nav, rails */
  --surface-2: #FFFFFF;        /* raised: inputs, popovers, modals */
  --surface-inset: #EBE7DB;    /* recessed readouts, code, empty wells */
  --surface-skeleton: #E7E2D4; /* skeleton base */
  --surface-skeleton-hi: #F5F2E9; /* skeleton sweep */

  /* HUD (over-scene only) */
  --hud-bg: rgba(247, 245, 238, 0.92);
  --hud-bg-strong: rgba(247, 245, 238, 0.97); /* modals/panels over scene */
  --hud-blur: blur(10px) saturate(1.1);

  /* lines */
  --line: #DED8C9;
  --line-strong: #C7BFA9;
  --line-ink: rgba(21, 36, 29, 0.18);

  /* text */
  --text: #15241D;
  --text-muted: #4B5A50;
  --text-dim: #636E60;
  --text-inverse: #F7F5EE;     /* on botanical/cobalt fills */

  /* accents */
  --accent-botanical: #0E4034;
  --accent-botanical-hover: #0A342A;
  --accent-lime: #A9CC16;      /* signal: fills/marks only, never text on light */
  --accent-lime-wash: rgba(169, 204, 22, 0.18);
  --accent-cobalt: #2748C7;    /* data: routes, focus, links */
  --accent-cobalt-wash: rgba(39, 72, 199, 0.10);

  /* semantic */
  --success: #2F6B4B;  --success-wash: rgba(47, 107, 75, 0.12);
  --warning: #8F5509;  --warning-wash: rgba(143, 85, 9, 0.12);
  --error:   #A6331E;  --error-wash:   rgba(166, 51, 30, 0.12);
  --blocked: #615E56;  --blocked-wash: rgba(97, 94, 86, 0.12);

  /* 3D defaults (engine-side, mirrored here for the frame) */
  --scene-clear: #DCD8CC;      /* PlayCanvas clearColor: neutral mineral, matches paper family */
}
```

Rules: lime and cobalt are **ink-adjacent** colors — lime only ever appears as fill/mark/underline (text-on-lime is ink, 8.71:1), cobalt only as stroke/text-on-paper/focus. No gradients anywhere except the skeleton sweep.

### 4.2 Typography

**Font strategy: self-hosted variable webfonts + hard system fallback.** (Offline finale safety.)

- **Archivo** (variable, wght 400–700) — all UI text. Architectural grotesque, real `tnum`, excellent at 11–14 px.
- **IBM Plex Mono** (400/500) — technical metadata only: coordinates, ids, hashes, counts, timestamps, stage names, uppercase micro-labels. Engineering voice, better small-size legibility than DM Mono (current, retired).
- Fallback stacks (ship in `base.css`; layout must not break if webfonts never load):
  `'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` /
  `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace`.

```css
:root {
  --font-ui: 'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* scale — sizes are fixed px; density adjusts via breakpoints, not rem math */
  --text-display: 650 34px/1.05 var(--font-ui);   /* workspace title */
  --text-title:   600 20px/1.25 var(--font-ui);   /* panel titles */
  --text-heading: 600 15px/1.35 var(--font-ui);   /* section headings, list primaries */
  --text-body:    400 13.5px/1.5 var(--font-ui);  /* body, descriptions */
  --text-label:   500 12px/1.3 var(--font-ui);    /* buttons, chips, inputs */
  --text-meta:    450 11px/1.4 var(--font-mono);  /* metadata rows, ids, coords */
  --text-micro:   500 10px/1.35 var(--font-mono); /* uppercase eyebrows, tab numbers */

  --tracking-eyebrow: 0.08em;   /* uppercase mono micro-labels only */
  --tracking-tab: 0.06em;
  --tracking-display: -0.02em;
  --numeric: tabular-nums;      /* apply to all mono + any digit run: .num */
}
```

- Display sizes step down at breakpoints (`--text-display` → 28 px ≤1024 → 24 px ≤560). No fluid `vw` type — a measuring instrument doesn't breathe.
- Every element containing digits that change in place (counts, coordinates, %, MB, grid sizes) gets `font-variant-numeric: tabular-nums` — no width jitter during counting animations.
- Sentence case everywhere except mono micro-labels (uppercase + `--tracking-eyebrow`).

### 4.3 Spacing, radius, borders, elevation, blur, focus

```css
:root {
  /* spacing — 4px base */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --space-12: 48px; --space-16: 64px;

  /* radius — architectural: tight */
  --radius-1: 2px;   /* chips, buttons, tags */
  --radius-2: 3px;   /* inputs, panels, thumbnails */
  --radius-3: 6px;   /* modals, toasts */
  --radius-dot: 999px; /* ONLY the 6px status/live dot */

  /* borders */
  --border: 1px solid var(--line);
  --border-strong: 1px solid var(--line-strong);
  --border-active: 2px solid var(--accent-lime);   /* selected row / active tab */
  --rule-signal: 3px;                              /* left signal rule on cards */

  /* elevation — restrained; shadow only where something floats */
  --shadow-1: 0 1px 2px rgba(21, 36, 29, 0.06);
  --shadow-2: 0 8px 24px -12px rgba(21, 36, 29, 0.28);           /* popovers, toasts */
  --shadow-3: 0 24px 64px -24px rgba(21, 36, 29, 0.35);          /* modals */
  --shadow-hud: 0 1px 0 rgba(21, 36, 29, 0.10), 0 10px 28px -10px rgba(0, 0, 0, 0.45);
  --inner-plate: inset 0 0 0 1px rgba(21, 36, 29, 0.14);          /* 3D viewport frame */

  /* blur */
  --blur-hud: blur(10px) saturate(1.1);
  --blur-sheet: blur(16px) saturate(1.15);

  /* focus — dual-context */
  --focus: var(--accent-cobalt);
  --focus-halo: rgba(247, 245, 238, 0.9);   /* outer halo for over-scene elements */
}
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
/* over-scene controls add a halo so the ring survives dark scene content: */
.hud :focus-visible {
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--focus-halo);
}
```

### 4.4 Iconography — hand-rolled SVG set (NO emoji, no icon package)

Cannot install packages; the current glyph hacks (`⌂ ↻ ⌕ ✦ ＋`) are retired. Ship `src/components/icons/icons.tsx`: ~26 pure-function React components, **16 px grid, 1.5 px stroke, `stroke-linecap: square`, `stroke-linejoin: miter`, `fill: none`**, `currentColor`, `aria-hidden` by default (icon+label pairs) or `role="img"` + `<title>` (icon-only buttons). Square caps + miter joins = drafting-instrument voice.

Inventory: `Search, Route, Jump, Reset, Compass, Grid, Layers, Camera, Upload, Qr, Check, AlertTriangle, XSquare, Lock, Minus, ChevronRight, ChevronDown, Plus, Close, Play, Pause, Signal, Room, Service, Landmark, Furniture, Entrance`. POI categories map to `Room/Service/Landmark/Furniture/Entrance` + `Grid` for `other` — category is **always** icon + text, never color-only.

---

## 5. Component inventory (visual specs)

Shared conventions: 12/16 px internal padding; radius per §4.3; all interactive targets ≥ 32 px desktop, ≥ 44 px in LIVE SCAN/touch; every state change pairs **color + glyph/shape + text** (§7.2).

### 5.1 Buttons
`variant × state`. Anatomy: label (Archivo 12/650, sentence case — never ALL CAPS on buttons) + optional 16 px icon (8 px gap) + optional trailing icon.

| Variant | Default | Hover | Active | Disabled |
|---|---|---|---|---|
| **primary** | fill `--accent-botanical`, text `--text-inverse` | `--accent-botanical-hover` | +`translateY(1px)` 90 ms | opacity .45, cursor not-allowed |
| **secondary** | transparent, `--border-strong`, text `--text` | bg `--surface-inset` | same press | opacity .45 |
| **signal** (one per view: PREPARE CAPTURE / PUBLISH) | fill `--accent-lime`, text `--text` | filter `brightness(1.04)` | press | opacity .45 |
| **quiet** | transparent, text `--text-muted`, no border | bg `--surface-inset`, text `--text` | press | opacity .45 |
| **danger** (destructive confirm only) | fill `--error`, `#FFFFFF` | darken 6 % | press | opacity .45 |
| **icon** | 32×32, transparent, `--border`, text `--text-muted` | bg `--surface-inset` | press | disabled |

Loading: label swaps to same-width mono (`…` → three 3 px dots pulsing in sequence, 900 ms loop) **plus** `aria-busy="true"`; width frozen via `min-width` captured before swap. Focus-visible per §4.3. **No transform-on-hover lift** (the current `translateY(-1px)` on every button is retired — only `active` presses).

### 5.2 Inputs
Field: 32 px tall, `--surface-2` fill, `--border-strong`, radius 2, Archivo 13 px, padding 0 10 px; focus = cobalt border + ring; invalid = `--error` border + 14 px mono error text below (with `AlertTriangle`), `aria-invalid`. Label above, 11 px mono uppercase (`--tracking-eyebrow`), 6 px gap. Search field adds inset bed `--surface-inset`, leading `Search` icon, trailing `⌘K` `kbd` badge (mono 9 px). Selects: native `<select>` styled to match (demo reliability > custom listbox for V1).

### 5.3 Workspace tabs (numbered)
`role="tablist"`, horizontal, roving `tabindex`. Each tab: mono index `01` (10 px, `--text-dim`) + label (12 px, 650, uppercase, `--tracking-tab`). Active: ink text + **3 px lime underline** flush to the tab bottom + index flips to `--accent-botanical`. Hover: `--surface-inset` wash. Keyboard: ←/→ move + activate (manual-activation not needed at this size), Home/End; `aria-selected`, `aria-controls` → `role="tabpanel"`. Shortcuts `⌘/Ctrl+1..3` (global) and `1..3` when focus is not in a text field. Inactive panels: `hidden` (PlayCanvas app must be `destroy()`ed on tab exit — canvas is never kept alive in the DOM while hidden).

### 5.4 Room list item
Row: 40 px, grid `[icon 20px] [name 1fr] [count mono] [chevron]`. Name Archivo 13/600; count mono 11 `--text-muted` (`12 imgs`). Selected: `--accent-lime-wash` bg + 2 px lime left rule + ink name. Hover: `--surface-inset`. Drag-over state (for image assignment): dashed `--accent-cobalt` inset outline + wash. Row is a `<button>` inside a listbox or a `<li>` with nested button per a11y pass — never a clickable div.

### 5.5 Image thumbnail grid + view-group chips
Grid: `repeat(auto-fill, minmax(96px, 1fr))`, 8 px gap, each cell aspect 4:3, `--surface-2`, radius 2, `object-fit: cover`, 1 px `--line`. Hover: 1 px cobalt inset outline + zoom-free; focus-visible ring. Selected: 2 px lime outline + corner check glyph. Unassigned images get a 3 px hatched top bar (CSS `repeating-linear-gradient` in `--line-strong`) — hatching = "not yet placed", the system's universal unverified texture.
**View-group chips:** `[Front] [Rear] [Left] [Right] [Ceiling] [Floor] [Entrance] [Detail] [+ Custom]` — mono 10 px uppercase, `--border`, radius 2, 24 px; occupied groups show a filled lime 5 px square + count (`FRONT · 6`); empty groups show hollow square + `0` in `--text-dim`. Chip toggle = instant (90 ms), drives the grid filter.

### 5.6 Coverage indicator (honest — category occupancy, never fake geometry)
Anatomy: mono header `VIEW GROUPS  7/9` + one **segmented bar**: one 8 px segment per view group, filled lime when the group meets its configured minimum (`≥1 image`, per-group minimum editable), hollow `--line-strong` when empty, **hatched** when images exist but are below minimum. Legend row: `Minimum: 1 image per group`. Caption rule: this measures *category occupancy, not geometric coverage* — the label under the bar says so verbatim (11 px, `--text-dim`). **Forbidden:** radial % rings, "92 % complete" scores, progress bars implying reconstructed area. (The legacy `score-ring` readiness number is retired from all surfaces.)

### 5.7 Metadata key-value block
Two-column grid, key 11 px mono uppercase `--text-dim` (or 11 px label), value Archivo 13/500 ink; rows 8 px apart; long values (`provenance.pipeline`, ids, URIs) in mono 11 with `overflow-wrap: anywhere` + copy button (`Copy` → 1.4 s `Copied ✓` state, `aria-live="polite"`). Numeric values get `.num`. This block is the workhorse of the provenance panel — treat it as sacred: nothing here is ever truncated without a copy affordance.

### 5.8 Status pill
Tag (radius 2, mono 10 uppercase, 4 px 8 px): wash bg (semantic @ 12 %) + semantic text + leading 10 px glyph. Tones: `validated ✓ / needs-review ▲ / failed ✕ / blocked ⊘ / simulated ◇ / live ●`. `simulated` (hollow diamond) is the mandatory synthetic-fixture label; `live` dot is the only 999-radius element in the system. Always glyph+text — color is the third redundant channel.

### 5.9 Toast
Bottom-center, max 420 px, `--surface-2`, `--border-strong`, `--radius-3`, `--shadow-2`, 13 px body + optional mono detail line + optional action button. Enter: 220 ms fade+rise 8 px. Auto-dismiss 5 s (errors: persistent with dismiss). Container `role="status"` region `aria-live="polite"`; errors `assertive`. Max 3 stacked.

### 5.10 Modal / confirm
Backdrop `rgba(21,36,29,0.45)`; dialog `--surface-2`, `--radius-3`, `--shadow-3`, 1 px `--line-strong`, 32 px padding, max 480 px. Title `--text-title`; body 13.5; footer right-aligned secondary+primary. Focus trap, restore focus on close, `Esc` closes, `aria-modal`. Destructive variants name the object and the consequence ("Delete **Lab 201** and its 14 staged images? This cannot be undone.").

### 5.11 Empty states
Centered column: 40 px line-drawing icon (stroke-only, `--line-strong`), 15/600 title, 13.5 `--text-muted` body (max 36 ch), one primary action. Must state *why* the state exists and the next real step ("No view groups yet. Assign staged images to FRONT, REAR… or create a custom group."). No illustrations, no mascots, no encouragement copy.

### 5.12 Loading skeletons
`--surface-skeleton` blocks with a 1.2 s left-to-right sweep (`--surface-skeleton-hi`), geometry matching the target layout (list rows, 4:3 thumbs, 2-col kv). Shown after 200 ms delay (no flash for fast loads). Scene-load skeleton additionally carries mono status lines from the engine callback (`Validating manifest → Loading geometry → Building nav grid`) — real messages from `onStatus`, never invented progress.

### 5.13 Error states
Inline error panel: 3 px left rule `--error`, wash bg, `AlertTriangle` + 13/600 title + 13 body + mono `detail` line (`overflow-wrap: anywhere`) + retry button + collapsible "technical detail" (`<details>`) containing the raw message/stack. Scene-load failure replaces the viewport (not a toast) and keeps the last-known-good scene offer when one exists (`Roll back to last published scene`).

### 5.14 POI search results
Combobox pattern (`role="combobox"` + `aria-expanded` + listbox). Result row 44 px: category icon | label (13/600) + mono subline `ROOM · 0.99 · OPERATOR` (category · confidence · source) | chevron. Selected: lime wash + 2 px lime rule + `aria-selected`. Keyboard ↑/↓/Enter/Esc; `⌘K` focuses. Subline **always shows source** (`OPERATOR / MODEL / SYNTHETIC`) — provenance travels with the data. Empty: "No destinations match **x**. Try a room name or alias." Zero-result ≠ error (no red).

### 5.15 Destination detail panel
Card: title row (label + category tag + confidence), description body, mono kv block (`APPROACH POINT  x, z` / `ROOM` / `SOURCE`), actions: primary `Plot route` (cobalt secondary-style + Route icon) and `Jump to view` (secondary). Unreachable state: inline warning row `▲ No walkable route — destination cell unreachable (blocked)`; missing-nav scene: both actions disabled + one-line reason. Deselect = Esc, clears 3D selection.

### 5.16 Route status
After `Plot route`: strip above actions — mono `ROUTE · 24 m · 11 cells · A*` + status glyph; clear (×) and re-plot. In-scene: ink-cased lime tape (§6.4). Failure: uses A*'s returned `detail` verbatim as copy. Route strip animates only on value change (tabular numerals, no width jump).

### 5.17 Camera / pairing states (LIVE SCAN)
State machine rendered as a vertical **stage rail** (mono stage names + glyph + timestamps): `IDLE → PAIRING → LIVE → CAPTURING → STAGED → OFFLINE/ERROR`. Each stage: hollow circle (pending, `--line-strong`), filled lime (active), check (done), ✕ (failed) — shape carries the state, color reinforces. Camera preview: 16:9, `--surface-inset` bed, real `<video>` (mirrored), 1 px `--line` frame, corner brackets (4× 12 px L-strokes, ink) as the "instrument viewport" motif. Permission-denied / no-device states are empty-state variants with the exact browser remedy ("Allow camera access in the address bar, then retry").

### 5.18 QR pairing card
`--surface-2` card, 8 px quiet zone, QR rendered **black modules on pure white** (scan reliability is non-negotiable — no tinting, no logo, no rounded modules), min 160 px, ECC level M. Beside it mono kv: `SESSION  NS-4F2A`, `EXPIRES  12:41` (countdown, tabular), `NETWORK  nammaspace.local` + honest caveat 11 px: "This device and the phone must be on the same local network." Countdown < 60 s flips to `--warning` + Refresh button. Never auto-refreshes under the scanning phone silently — refresh is explicit, with a 1-frame flash.

### 5.19 Simulated-vs-real labeling (cross-cutting)
Every surface showing pipeline/3D/camera data carries a source chip derived from data: `◇ SIMULATED` (fixture/synthetic per `sceneKind`/`source`), `◇ MODEL-DERIVED`, `● MEASURED`. Placement: viewport top-left HUD chip, capture panel header, processing stage list. This chip is never dismissible.

---

## 6. Layout system

### 6.1 App shell grid

```
┌──────────────────────────────────────────────────────────────┐
│ TOP NAV 56px  [mark·wordmark│project/space▾│scene state│tabs│session] │
├──────────────────────────────────────────────────────────────┤
│ WORKSPACE REGION (fills viewport, own scroll)                │
└──────────────────────────────────────────────────────────────┘
```

- Top nav: fixed 56 px, `--surface-1`, bottom `--border`. Left: mark 24 px + wordmark + descriptor. Center-left: project/space `<select>` + scene/processing state pill (live region). Center-right: the three numbered tabs. Right: session state (`● LOCAL` / `◇ OFFLINE`) + settings icon. ≤1024: descriptor + project label collapse to icon+tooltip; ≤560: tabs move to a bottom bar (§6.3).
- Workspaces are full-bleed regions, **not** the old 1560 px centered page. Max content width 1680 px applies only to CAPTURE STUDIO's rails; the 3D viewport is never width-capped.

### 6.2 Per-workspace grids

**01 CAPTURE STUDIO** — `grid-template-columns: 264px 1fr 328px;` gap 12, padding 16.
Left rail: rooms list (+ New room), coverage indicator pinned bottom. Center: view-group chip bar (sticky) over thumbnail grid, selection toolbar appears above grid on multi-select. Right inspector: tabs `[Details | Group | Provenance]` → kv blocks, PREPARE CAPTURE (signal) + Export bundle (secondary) pinned to inspector foot.

**02 SPATIAL VIEWER** — viewport-dominant:
```
grid-template-columns: 1fr 336px;  grid-template-rows: 1fr;
```
Canvas fills row 1 col 1 **edge-to-edge under the top nav** (canvas area ≈ 100 % of region). Right rail: search/results, destination detail, route status, scene dossier kv — one scrolling column of panels with sticky section headers, collapsible to a 40 px icon strip (`[»]`). Over the canvas, HUD chips only (all `pointer-events: none` except their own buttons): top-left scene label + `◇ SIMULATED` chip; top-right compass (mono `N ↑` + 32 px SVG rose) + coordinates readout `X 4.20 · Z −3.30` (tabular); bottom-left control hints (`W A S D` kbd + "click to look" + `Esc` to exit, auto-hides 4 s after pointer-lock entry); bottom-right walkthrough button + reset. **Canvas takes click-first interaction; chrome never covers > 15 % of viewport area in the default state.**

**03 LIVE SCAN** — `grid-template-columns: 1fr 400px;` gap 12, padding 16.
Left: camera preview (aspect-video, max-height 62 vh) above the Three.js coverage visualizer panel (its own `<canvas>`, `--surface-inset` bed, shows real frame poses as frusta on a floor grid — honest: only staged frames appear, nothing is interpolated). Right: pairing card → stage rail → staged-frames kv → handoff actions (`Open in Capture Studio`).

### 6.3 Responsive breakpoints

| Breakpoint | Behavior |
|---|---|
| ≥1440 | full three-column layouts as above |
| 1280 | studio rails 240/300; viewer rail 320 |
| 1024 | **studio**: rails collapse — rooms become a slide-over, inspector becomes a bottom sheet; **viewer**: rail → overlay panel toggled by icon strip; **scan**: stacks vertically |
| 768 | everything single-column; viewer HUD chips shrink to icon+value; tabs show index only |
| ≤560 | tabs → fixed bottom bar (3 items, icon + index); viewer = full-viewport canvas + bottom-sheet rail (snap points 24 %/60 %/88 %); no pointer lock on touch — one-finger look-drag, pinch zoom off, `Jump to` uses tween; pairing QR becomes the primary full-screen card |

Viewer canvas resizes via the existing `ResizeObserver`; rails animate width only in the ≥1024 case (never below — sheets replace width animation with transform).

### 6.4 In-scene overlay rendering rules (engine side)

- **Route tape:** flat ribbon along returned path: lime fill (80 % opacity, `depthTest` off, `alwaysOnTop`) + ink 1.5 px edge strokes + a 1 px paper center dash every 12 px. The triple-layer guarantees ≥ 3:1 silhouette against dark scenes (paper/lime), bright scenes (ink), so mid-luminance scenes are carried by the dashes. Never a glowing neon line.
- **POI markers:** ink pin silhouette + 4 px lime core; selected adds 2 px cobalt ring. Marker labels are DOM HUD chips (projected), inheriting the ≥ 12.3:1 chip guarantee — never render text into the 3D scene.
- **Route/selection fades** tween the material opacity via the engine API, not CSS.

---

## 7. Motion

### 7.0 Dependency reality

Micro-interactions (hover, press, focus, chip toggles, skeletons, dots) are **pure CSS transitions** on tokens — zero JS. The choreography layer (workspace transitions, staggers, camera-synced moments) uses **GSAP**, which must be added first: `npm i gsap @gsap/react` (not currently in `package.json`). Wrap every animation in `useGSAP(() => {…}, { scope: ref })` (auto-revert on unmount). Every moment below lists its **no-GSAP fallback** — if the dependency can't land before the finale, the fallback is what ships, and it is visually acceptable by design.

### 7.1 Motion tokens (single source of truth)

```ts
// src/styles/motion.ts  (mirrored in tokens.css as custom properties)
export const M = {
  dur:   { instant: 0.09, fast: 0.14, base: 0.22, panel: 0.32, workspace: 0.42, scene: 0.9 },
  ease:  { out: 'power3.out', inOut: 'power2.inOut', standard: 'power1.inOut',
           settle: 'expo.out', pop: 'back.out(1.4)' },   // pop: dots/badges ONLY
  stagger: 0.028,
  entrance: { from: { y: 8, opacity: 0 } },
} as const;
```

CSS mirrors: `--dur-fast: 140ms; --dur-base: 220ms; --dur-panel: 320ms; --dur-workspace: 420ms;` with `--ease-out: cubic-bezier(0.22,1,0.36,1); --ease-in-out: cubic-bezier(0.65,0,0.35,1);`.

### 7.2 Principles

1. Motion reports **state**, never decorates idle UI. Nothing loops except skeletons, the live dot, and active-processing indicators.
2. Chrome moves small and fast; the scene moves slow and smooth; they never move at the same time in the same direction.
3. Stagger is for **lists entering once**, not for re-renders.
4. `prefers-reduced-motion: reduce` → all durations clamp to 1 ms, staggers off, camera tweens become **instant cuts with a 120 ms crossfade**, skeleton sweep becomes a static fill, the live dot stops pulsing. Implementation: one `const RM = matchMedia('(prefers-reduced-motion: reduce)')` gate + `gsap.matchMedia()`; CSS `@media` block clamps the custom properties so CSS paths are covered automatically.

### 7.3 Choreography — named product moments

| Moment | Choreography | Tokens | Reduced-motion | No-GSAP fallback |
|---|---|---|---|---|
| **Workspace reveal** (tab switch) | Outgoing panel: opacity→0, x ∓ 8 px, 140 ms; incoming: opacity 0→1, x ± 8→0, 420 ms `settle`; tab underline slides via `Flip`/FLIP on the shared lime element | fast out / workspace in | instant swap + 120 ms opacity crossfade | CSS: `@starting-style`/keyframe on panel mount + `hidden` unmount |
| **Room creation** | New row enters at list top: height 0→40 (FLIP), `y:8→0`, lime left-rule draws 0→40 px, name field auto-focuses at 60 % of tween | base, `out`, stagger n/a | row appears, focus immediate | CSS grid `0fr→1fr` transition |
| **Image → group assignment** | Thumbnail flies a ghost tile to the group chip (FLIP); chip pulses lime (`scale 1→1.06→1`, `pop`); count digit rolls (tabular, 140 ms) | base + pop | chip flashes wash 120 ms; count updates instantly | chip pulse = CSS keyframe; ghost skipped |
| **Coverage state change** | Segment fills hollow→lime with a 140 ms left-to-right wipe; if it crosses the group threshold, the header count digit flips | fast | instant fill | CSS `scaleX` wipe |
| **Scene transition** (load new bundle) | Old scene: engine crossfade 200 ms; skeleton + real stage lines; on ready: camera eases from slightly elevated pose to `startPosition` over 900 ms `settle`, HUD chips rise 8 px staggered 28 ms | scene + stagger | 120 ms crossfade, camera at start pose instantly | engine-side `lerp` already exists; HUD rise = CSS |
| **POI select** | Row: lime rule 0→40; marker core `scale 1→1.5→1` (`pop`, 220 ms) **single pulse**; detail panel content fades in 140 ms; **no camera move on select** | base/pop | no pulse; static ring | CSS + engine `selectPoi` (already exists) |
| **Camera jump-to** | Engine `jumpTo` tweens position+yaw to approach point, 700 ms `settle`, pitch levels to 0°; HUD coordinate readout counts through (tabular) | scene-ish | **instant cut + 120 ms crossfade** | engine tween (add to `PlayCanvasViewer`) |
| **Route reveal** | Tape draws start→end via progressive vertex reveal 600 ms `inOut`; route strip slides down 220 ms with measured values | panel + base | tape appears complete instantly | engine draw-progress uniform (no GSAP needed) |
| **Pairing states** | Stage rail advance: circle fills lime (`pop`), connector line draws 220 ms; QR card crossfades on refresh with 120 ms flash | base | instant | CSS |
| **Processing stages** (reconstruction etc.) | Active stage: hollow→fill + mono elapsed timer (tabular, 1 s tick); completed: check draws 180 ms; failed: ✕ + error wash, no shake | fast | instant | CSS |
| **Toast / modal** | Toast y 8→0 + fade 220; modal backdrop 140 + dialog y 12→0 with `--shadow-3` 220 | base | fade only | CSS keyframes |

### 7.4 Known lifecycle defects — explicit warnings for the developer

1. **Repeated entrance animations on re-render.** Never run entrance tweens in a bare `useEffect` keyed on data: selecting a room, filtering, or a websocket update will replay the stagger and make the tool feel broken. Rule: entrance timelines run **once per mount** (or once per explicit list-identity change, keyed by a `listKey`), inside `useGSAP` with a ref on the container.
2. **Uncleaned timelines.** Every `gsap.timeline()`/camera tween gets a kill path: `useGSAP` scope revert on unmount; camera tweens additionally `kill()` on pointer-lock entry and on any WASD/arrow keydown — **camera motion must never fight user input** (double-control is the single worst viewer bug; the engine currently owns the camera, so all camera animation goes through one owner).
3. **Layout shift from animated layout properties.** Animate `transform`/`opacity` only; FLIP via `gsap.utils.batch`/`Flip` for reorders; never animate `height/top/left` directly outside the FLIP helper. Reserve thumbnail aspect boxes before load.
4. **Animating during pointer lock.** No HUD transitions start while `document.pointerLockElement` is set except the auto-hide fade; restore chrome on `pointerlockchange` (the existing React listener is the hook point).
5. **PlayCanvas + React double-mount (StrictMode).** The viewer must be idempotent: `destroy()` before re-create; guard the `Application` in a ref; never tween an entity after destroy (guard callbacks with a `disposed` flag).
6. **Tab-switch zombie canvas.** Leaving SPATIAL VIEWER destroys the app (D-012 lazy boundary); returning re-creates it. Persist camera pose in workspace state so the reveal tween has a meaningful start.

---

## 8. Accessibility requirements (baked in, not retrofitted)

1. **Focus visibility:** cobalt 2 px ring + 2 px offset everywhere; over-scene controls add the paper halo (§4.3). Never `outline: none` without a replacement.
2. **Non-color-only status:** every semantic state = color **+ glyph + text** (§5.8); coverage uses fill/hollow/hatch shapes; POI categories carry distinct icons + text.
3. **Tabs:** full `tablist/tab/tabpanel` pattern with roving tabindex, ←/→/Home/End, `aria-selected` (§5.3).
4. **ARIA live regions:** scene/processing state pill in the top nav = `aria-live="polite"` (stage changes only, not sub-second ticks); toast region `polite`/`assertive` per severity; pairing countdown is *not* live (would spam) — only state transitions announce; route status strip `polite`.
5. **Pointer lock:** `Esc` exits (browser-guaranteed) and is echoed in the hint chip; on `pointerlockchange` → exit, chrome restores and focus returns to the walkthrough button. Screen-reader users get an equivalent "Jump to view" path that never requires pointer lock.
6. **Upload affordances:** the drop/choose zone is a real `<label>` wrapping a visually-hidden `<input type="file">` (keyboard-focusable, Enter/Space opens picker); drag-drop is progressive enhancement only. Progress announcements at 25/50/75/100 % via `polite`.
7. **Combobox search** per §5.14 (aria-expanded/activedescendant). `⌘K` documented in-UI.
8. **Canvas:** `role="application"` + `aria-label="First person scene viewer"` + an adjacent visually-hidden text alternative listing current position and selected POI (updated `polite`, throttled 2 s).
9. **Contrast:** all shipped pairs AA+ (§3.1); HUD chips provably AA over any scene.
10. **Touch:** 44 px targets in scan/touch layouts; no hover-dependent info.
11. **Reduced motion:** §7.2, honored in both CSS and GSAP paths.
12. **Zoom:** 200 % browser zoom keeps all workflow actions reachable (rails scroll, sheets grow).

---

## 9. Copy & voice guide

**Voice:** terse, technical, operational. Sentences under ~14 words. Verbs name the real operation (`Stage`, `Prepare`, `Reconstruct`, `Validate`, `Publish`, `Plot`, `Jump`). Numbers are exact and tabular. Uncertainty is stated, not smoothed.

**Allowed register examples:** "14 images staged · 62.4 MB." / "Navigation grid unavailable — visual exploration only." / "Blocked: COLMAP not found on this machine." / "Simulated fixture. Not a phone reconstruction."

### 9.1 Anti-patterns (banned, with the honest replacement)

| Banned | Replace with |
|---|---|
| "AI magic", "instantly transformed", "one-click twin" | "Runs COLMAP sparse reconstruction (~40 min on M2 for 120 frames)". |
| Fake telemetry: animated progress %, invented FPS/coverage numbers, "AI is thinking" | Real stage names from the job report, elapsed time, real counts. If a number isn't measured, don't render it. |
| "Reconstructed" for staged/prepared media | "Prepared" / "Staged" — reconstruction is claimed only when a reconstruction-report exists. |
| "Coverage 92 %" (geometric implication) | "View groups 7/9 — category occupancy, not geometric coverage." |
| "Seamless", "perfect", "photorealistic (guaranteed)" | State the asset kind: "GLB · textured mesh · 12 MB." |
| "Error 500" / naked stack traces | "Scene bundle failed validation" + technical detail in `<details>`. |
| Blaming the user ("Invalid input!") | "This file is HEIC — export JPG or run the prepare script." |

### 9.2 Canonical state names (map 1:1 onto schema enums; never synonyms)

| UI state | Meaning | Schema anchor |
|---|---|---|
| `QUEUED` | job accepted, not started | job manifest |
| `PREPROCESSING` | frame prep/dedup running | `prepare_capture.py` |
| `RECONSTRUCTION` | sparse/dense poses running | `reconstruction-report.json` |
| `GEOMETRY` | mesh/occupancy branch | geometry report |
| `VALIDATION` | bundle/schema checks | `validate_scene.py` |
| `PUBLISHED` | promoted, walkable | `readiness: validated/navigation_ready` |
| `PARTIAL` | visual only, nav untrusted | `readiness: visual_ready/partial` |
| `BLOCKED` | dependency missing (COLMAP/GPU) | blocked report / `readiness: blocked` |
| `FAILED` | stage returned failure, log attached | `status: failed` |

Scene/provenance chip states: `MEASURED` / `MODEL-DERIVED` / `SIMULATED` (from `provenance.source`, `sceneKind`). Quality: `VALIDATED ✓` / `NEEDS REVIEW ▲` / `FAILED ✕`. Terminology: *space* (project) → *room* → *view group* → *images*; *destination* = POI in UI, "POI" only in technical detail.

---

## 10. Developer handoff

### modules_impacted
`src/styles.css` (gutted → `styles/tokens.css` + `styles/base.css`), `src/App.tsx` (monolith → shell + workspace router + tab a11y), `src/components/StatusPill.tsx` (tone prop → semantic `state` prop w/ glyph+text, §5.8), new `src/components/icons/icons.tsx`, new per-workspace folders `src/components/capture|viewer|scan/`, `src/engine/PlayCanvasViewer.ts` (additive only: camera-tween + tape-progress API hooks, no control-flow change), `src/styles/motion.ts` (new), `index.html` (font preload).

### Acceptance criteria (visual — verify before calling done)
1. No amber/graphite/Manrope/DM Mono token remains; no glyph-icons (`⌂ ↻ ⌕ ✦ ＋`) remain.
2. Every text pair matches §3.1 ratios within ±0.1 (spot-check with DevTools contrast picker).
3. HUD chips over a pure-white and a pure-black test scene both pass AA for ink and muted (the 92 % opacity rule is load-bearing — do not lower it).
4. Status is legible in grayscale screenshots (glyph+text present).
5. Coverage UI shows occupancy counts only; zero percentage rings exist in the DOM.
6. `prefers-reduced-motion` demo: no translation, no stagger, instant camera cuts, static skeletons.
7. Tab keyboard loop works with pointer hidden; `1/2/3` and `⌘1..3` switch workspaces.
8. Viewer default state keeps chrome ≤ 15 % of viewport area.
9. All digit runs use tabular numerals (toggle `font-variant-numeric` off → widths must not change on hover).

### architecture_risks
1. **GSAP not installed** (§7.0) — choreography blocked until added; fallbacks specified but weaker (no FLIP reorders).
2. **StrictMode double-mount vs PlayCanvas** — destroy/recreate must be idempotent or entrance/camera tweens will fire twice and leak an `Application`.
3. **Camera ownership** — if UI tweens the camera outside `PlayCanvasViewer`, it will fight WASD/mouse-look; single-owner rule (§7.4-2).
4. **`backdrop-filter` on low-end demo GPU** — HUD blur may cost FPS over the WebGL canvas; fallback is opaque `--hud-bg-strong` (contrast guarantee unchanged).
5. **Offline finale vs webfonts** — self-host woff2 or accept system fallback; never block first paint on fonts.

### irreversible_decisions_flagged
1. **Palette direction A chosen over B/C** — replacing the entire visual identity; revisit only with founder evidence, not taste drift.
2. **Light HUD over dark 3D content** — the 92 %-opacity chip system is the identity; per-scene dark scrims are a regression.
3. **Font pair Archivo + IBM Plex Mono** — swapping later changes every metric (spacing, line-heights, tabular widths) documented here.
4. **Naming the system GROUNDTRUTH** — appears in descriptors; renaming touches copy tokens.
