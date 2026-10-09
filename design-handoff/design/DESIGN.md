---
name: Editorial Verification
colors:
  surface: '#fbf9f1'
  surface-dim: '#dbdad2'
  surface-bright: '#fbf9f1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f4eb'
  surface-container: '#f0eee5'
  surface-container-high: '#eae8e0'
  surface-container-highest: '#e4e3da'
  on-surface: '#1b1c17'
  on-surface-variant: '#444748'
  inverse-surface: '#30312b'
  inverse-on-surface: '#f2f1e8'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#111111'
  on-primary: '#ffffff'
  primary-container: '#262626'
  on-primary-container: '#8e8d8c'
  inverse-primary: '#c8c6c5'
  secondary: '#386091'
  on-secondary: '#ffffff'
  secondary-container: '#a2c9ff'
  on-secondary-container: '#2a5484'
  tertiary: '#6d5e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#bfab48'
  on-tertiary-container: '#4a3f00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e4e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1b1c1c'
  on-primary-fixed-variant: '#474746'
  secondary-fixed: '#d3e4ff'
  secondary-fixed-dim: '#a2c9ff'
  on-secondary-fixed: '#001c38'
  on-secondary-fixed-variant: '#1c4877'
  tertiary-fixed: '#f9e379'
  tertiary-fixed-dim: '#dcc761'
  on-tertiary-fixed: '#211b00'
  on-tertiary-fixed-variant: '#524600'
  background: '#fbf9f1'
  on-background: '#1b1c17'
  surface-variant: '#e4e3da'
typography:
  display:
    fontFamily: Work Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-mobile:
    fontFamily: Work Sans
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Work Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Work Sans
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Work Sans
    fontSize: 17px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Work Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Work Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Work Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  mono-index:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.02em
  mono-meta:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.04em
  editorial-badge:
    fontFamily: Work Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.875rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies the quiet, meticulous rigor of traditional editorial proofreading brought into a modern digital interface. It rejects the hyperactive idioms of modern SaaS dashboards—dispensing entirely with binary red/green evaluation paradigms, gamified completion bars, floating glass cards, and simulated AI chatbot personas.

The visual philosophy draws directly from the physical artifact of an editor’s desk: archival warm ivory papers, charcoal carbon ink, delicate structural hairlines, and restrained editorial marginalia. The interface operates as an objective, non-judgmental workspace for Korean document review. It treats text not as arbitrary data inputs, but as composed literature requiring clarity, balance, and deliberate reading cadences. 

Visual characteristics include:
- **Quiet Tactility:** High-fidelity tactile paper layers, precise 1px rules, and quiet editorial callouts.
- **Objective Evaluation:** Rejection of alarmist traffic-light signifiers (no punitive reds or celebratory greens). Status is communicated strictly through typographic weight, restrained glyph indicators (such as open circles, em-dashes, and filled dots), and precise editorial labeling.
- **Deliberate Marginalia:** Critical meta-information, cross-references, and verification flags live in the gutters and margins like authentic publisher proof marks, leaving the document core legible and uncluttered.

## Colors

The palette is anchored in physical printmaking: light-absorbing carbon inks against light-diffusing unbleached paper sheets. High-saturation digital alerts are strictly forbidden.

### Core Roles
- **Canvas / Desk Background (`#F8F7F2`):** A warm, low-fatigue ivory representing the workspace table.
- **Surface / Document Paper (`#FFFEFA`):** An optical off-white simulating high-grade warm bond paper. All document editing and reading happens on this plane.
- **Ink Primary (`#262626`):** Deep charcoal ink for high-priority reading, headlines, and finalized body copy. Never pure digital black (`#000000`).
- **Ink Secondary (`#777770`):** Muted lead tone for secondary descriptions, criteria explanations, and editorial timestamps.
- **Ink Tertiary (`#9E9D95`):** Lightened graphite for metadata labels, subtle hints, and baseline structural numbers.
- **Annotation Blue (`#426A9B`):** Muted indigo proof blue. Used strictly for verification callouts, editorial suggestions, and marginal reference indices.
- **Proof Highlight (`#F5DF76`):** Soft, non-fluorescent pastel yellow. Applied as an underlay marker or inline highlight behind flagged text spans; never as a solid background for buttons or primary controls.
- **Rules & Dividers (`#DEDDD6` / `#EAE8E1`):** Precise tactile hairlines that segment editorial sections without card containers.

## Typography

The typographic scale accommodates complex Korean CJK typesetting alongside Latin alphanumeric tracking. 

For real-world implementations, prioritize standard Korean system rendering: `font-family: "Pretendard", "SUIT", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`. For alphanumeric indices, document revisions, and proof markers, fall back to `"JetBrains Mono", "SF Mono", "Menlo", monospace`.

### Typesetting Rules
- **Line Heights:** Body line-height must remain relaxed (1.6 to 1.7× font size) to support Korean syllabic block legibility and prevent visual clashing between descenders and ascenders.
- **Letter Spacing:** Maintain subtle negative tracking (`-0.01em` to `-0.02em`) on display headlines to compact Korean word clusters, while keeping monospace labels slightly tracked out (`0.02em` to `0.04em`) to establish crisp index markers.
- **Index Monospace Pairing:** Structural numbering (e.g., `01`, `02`, `REV-04`, `v2.2`) must always render in the monospace role to preserve tabular alignment along document hairlines.

## Layout & Spacing

Layout centers around a single continuous "Proof Sheet"—a centralized column of `#FFFEFA` placed over the desk background `#F8F7F2`. 

### Layout Model
- **Desktop (1024px+):** Fixed-width central document column (maximum 780px) flanked by an editorial marginalia gutter (260px) on the right side. The right gutter holds proof tags, contextual suggestions, and status marks horizontally aligned with the line of Korean text they annotate.
- **Mobile / Narrow (390px - 768px):** Collapses into a single fluid column with a continuous margin of `1.25rem` (`20px`). Marginalia notes tuck directly underneath the annotated paragraph using subtle left-border indentations rather than floating overlays.
- **Rhythm:** Spacing follows vertical hairlines and horizontal rules rather than boxed cards. Structural separation relies on `space-lg` (24px) and `space-xl` (40px) vertical margins intersected by `1px solid #DEDDD6`.

## Elevation & Depth

This system avoids floating SaaS shadows, multi-tier elevation blur, and simulated 3D physical surfaces. Depth is established purely through planar layering and hairlines.

### Stratification
1. **The Desk Plane (Base):** Background canvas rendered in `#F8F7F2`.
2. **The Document Plane (Paper):** Placed directly on the canvas with `#FFFEFA`. Visual separation is achieved not through dropped blur shadows, but via a crisp, hairline edge: `1px solid #EAE8E1` supplemented by a single ambient feathering token: `box-shadow: 0 1px 3px 0 rgba(38, 38, 38, 0.04)`.
3. **Marginalia & Insets:** Subtle indentations or side notes are etched into the paper plane with a left hairline border (`1.5px solid #426A9B` or `1px solid #DEDDD6`).
4. **Highlights:** Overlays do not exist in the z-axis; instead, editorial selections exist on the reading surface through a soft color wash (`background-color: #F5DF76` at 50% opacity under the text).

## Shapes

The shape system adopts a sharp, book-bound aesthetic (`roundedness: 0`). 

- **Corners:** Components, input fields, badges, and document frames utilize sharp corners (`0px` border-radius) or microscopic, printing-plate rounding (`1px` to `2px` max) to reflect trimmed paper sheets.
- **Borders:** Structural integrity relies on 1px crisp lines. Rounded bubbly chips, pill toggles, and circular floating action buttons are excluded.
- **Highlight Shapes:** Marked Korean phrases are highlighted using an inline, full-height rectangular box with square terminals, replicating an analog highlighter swipe.

## Components

### 1. Document Sheet Container
The core viewport container. It features a continuous `#FFFEFA` surface surrounded by a subtle hairline border (`1px solid #EAE8E1`). Padding is generous (`space-xl` top/bottom, `space-lg` left/right on desktop) to ensure uninhibited reading flow.

### 2. Buttons & Actions
- **Primary Action (Confirm / Verify):** Solid `#262626` background, `#FFFEFA` typography, sharp `0px` radius, padded at `0.625rem 1.25rem`. Zero shadow. Hover state shifts to `#3E3E3E`.
- **Editorial Action (Annotate / Note):** Transparent background with `1px solid #262626` border, `#262626` text. Hover fills with `#F8F7F2`.
- **Text Action:** Clean underlined text in `#426A9B` with a 1px border-bottom offset by 3px.

### 3. Status Badges (Non-Judgmental Editorial Indicators)
Never use green (success) or red (error). Replace binary validations with editorial verification stages:
- **Verified / Clean:** Neutral `#262626` text preceded by a filled typographic dot (`•`), enclosed in a light hairline box (`1px solid #DEDDD6`), `#FFFEFA` background.
- **Review Recommended:** Muted Indigo `#426A9B` text preceded by a hollow circle (`○`), accompanied by an index number in monospace (`[01]`).
- **Deferred / Excluded:** Muted `#777770` text preceded by an em-dash (`—`), borderless with subtle underline.

### 4. Text Highlighter & Marginal Annotations
- **Highlighted Text:** Inline span wrapped in `background-color: rgba(245, 223, 118, 0.45); border-bottom: 1px solid #DEDDD6;`.
- **Marginal Proof Note:** A structural block placed in the margin on desktop, or nested inline on mobile. Styled with a `2px solid #426A9B` left border, indented by `space-sm`, featuring monospace item metadata (`mono-meta`) in `#426A9B` above the note copy in `#262626`.

### 5. Input Fields & Editorial Textareas
Clean, uninterrupted writing fields. 
- Background: `#FFFEFA`.
- Border: Single bottom rule `1px solid #DEDDD6` in rest state; transitions cleanly to `1px solid #262626` on focus. No glowing blue rings or full outline boxes.
- Text: `#262626`, placeholder in `#9E9D95`.

### 6. Verification Criterion Row
Instead of modern card tiles, criteria are rendered as an editorial checklist:
- Continuous list separated by `1px solid #EAE8E1`.
- Left-aligned monospace code (e.g., `§ 02.1`).
- Center body describing the stylistic or typographic rule.
- Right-aligned typographic status token.