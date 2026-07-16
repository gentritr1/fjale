---
name: FJALË
description: A crisp five-minute Albanian language ritual.
colors:
  background: "oklch(1 0 0)"
  surface: "oklch(0.972 0 0)"
  surface-strong: "oklch(0.93 0.004 75)"
  ink: "oklch(0.19 0.014 65)"
  ink-soft: "oklch(0.34 0.014 65)"
  muted: "oklch(0.47 0.012 65)"
  line: "oklch(0.86 0.006 75)"
  honey: "oklch(0.68 0.146 74.6)"
  honey-deep: "oklch(0.52 0.14 68)"
  correct: "oklch(0.5 0.125 145)"
  present: "oklch(0.62 0.14 75)"
  absent: "oklch(0.43 0.018 252)"
  focus: "oklch(0.55 0.18 252)"
typography:
  headline:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 840
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 790
    lineHeight: 1.25
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 780
    lineHeight: 1.4
rounded:
  sm: "7px"
  md: "11px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.background}"
    rounded: "{rounded.sm}"
    padding: "0 17px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 17px"
    height: "46px"
  tool-pill:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "44px"
  game-tile:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "60px"
  keyboard-key:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "48px"
---

# Design System: FJALË

## Overview

**Creative North Star: "The Bright Coffee Break"**

FJALË is designed for a bilingual commuter opening the game on a phone during a five-minute coffee break in bright ambient light. The surface is literal white, the board is immediate, and a single honey note gives the ritual a recognizable voice. The interface feels lively through response and language—not through decorative layers.

This is a product surface with restrained density. The game board and Albanian keyboard command the main column; explanations form a quiet reference rail on larger screens and a readable continuation on mobile. Borders and tonal steps provide structure. The system explicitly rejects flag-and-folklore souvenir styling, casino-style reward chrome, and generic Wordle imitation.

**Key Characteristics:**

- Pure, high-contrast surfaces with one scarce honey brand accent.
- Compact system typography that disappears into the task.
- Correct Albanian digraphs treated as first-class controls.
- Flat-by-default components with fast, state-driven motion.
- Progress and celebration that appear only after earned actions.

## Colors

The palette is restrained: neutral architecture, honey identity, and three unmistakable semantic states.

### Primary

- **Coffee Honey:** The brand voice for the wordmark, current navigation, passport progress, and earned emphasis. It never becomes a background wash.
- **Toasted Honey:** The darker companion for readable links and text-level accent on white.

### Secondary

- **Answer Green:** Correct letters and successful state copy only.
- **Position Gold:** Letters present in the answer but placed elsewhere.
- **Slate Mark:** Absent letters, kept neutral so it does not compete with useful feedback.

### Neutral

- **Literal White:** The canonical light background. Warmth belongs to honey, not the page surface.
- **Quiet Step / Key Step:** Two tonal layers for helper circles, keyboard keys, and non-interactive grouping.
- **Coffee Ink:** Primary text and filled actions; it carries at least 7:1 contrast against the background.
- **Soft Ink / Muted Ink:** Supporting copy, metadata, and secondary labels.

**The One Honey Rule.** Honey is limited to identity, selection, and earned progress; it never decorates inactive surfaces.

**The Three-State Rule.** Correct, present, and absent colors are semantic. Each is paired with `✓`, `•`, or `×`, so meaning never depends on hue alone.

**The State-Ink Rule.** Honey and gold use dark ink; dark-mode green also uses dark ink. Slate and light-mode green use white. Every filled state preserves at least WCAG AA contrast instead of assuming white is readable on any saturated color.

## Typography

**Display Font:** System UI sans-serif
**Body Font:** System UI sans-serif
**Label Font:** System UI sans-serif

**Character:** One familiar sans family keeps the product fast and native-feeling. Personality comes from weight, Albanian copy, and the compact `Ë` mark rather than from a decorative display face.

### Hierarchy

- **Headline** (840, 1.35rem, 1.2): dialog titles and the post-game answer.
- **Title** (790, 0.92rem, 1.25): side-rail explanations and result headings.
- **Body** (400, 1rem, 1.5): instructions and definitions, capped by their narrow containers.
- **Label** (780, 0.78rem, 1.4): tabs, buttons, metadata, and keyboard context.
- **Tile Letter** (860, up to 1.72rem, 1): a compact uppercase game glyph; digraphs step down optically to fit without touching.

**The Utility Voice Rule.** Buttons and labels use sentence case or the natural spelling of letters. Repeated tiny uppercase eyebrows are prohibited.

## Elevation

FJALË is flat by default. Structure comes from tonal layers and one-pixel dividers. Tiles use tight inset strokes because their boundary is functional; buttons choose either a stroke or a solid fill. Only native dialogs rise above the page.

### Shadow Vocabulary

- **Dialog Lift** (`0 22px 55px oklch(0.08 0 0 / 0.2)`): reserved for a modal sheet over the page backdrop.
- **Switch Thumb** (`0 1px 4px oklch(0.08 0 0 / 0.22)`): a tiny structural cue on the movable control only.

**The Flat-Until-Lifted Rule.** Resting page components have no ambient drop shadow. If a bordered card also has a broad soft shadow, the component is wrong.

## Components

### Buttons

- **Shape:** Gently squared controls (7px); compact tools may use a full pill.
- **Primary:** Coffee Ink fill, Literal White text, 46px height, and no border.
- **Hover / Focus:** A darker tonal shift on hover; a two-ring focus treatment using the page background and Focus Blue.
- **Secondary:** Transparent surface with a single structural stroke; no decorative shadow.

### Chips

- **Style:** Digraph stamps and small progress badges use 6px corners, strong labels, and a quiet neutral fill.
- **State:** A collected stamp changes to Coffee Honey plus a visible check mark.

### Cards / Containers

- **Corner Style:** Side-rail content is not carded; it is separated by one-pixel horizontal rules. Modal content uses 16px outer corners.
- **Background:** Page background for primary content; Quiet Step only for examples and explanatory notes.
- **Shadow Strategy:** None at rest. Dialog Lift is the only large shadow.
- **Border:** One-pixel neutral dividers; no colored side stripes.
- **Internal Padding:** 16–24px, varied by hierarchy rather than repeated as an identical grid.

### Inputs / Fields

- **Style:** Native select menus and 44×26px switches retain familiar behavior.
- **Focus:** The same high-contrast focus ring as every other interactive control.
- **Error / Disabled:** Disabled states retain legibility; gameplay explains why a locked action is unavailable.

### Navigation

The centered wordmark anchors a 56–62px header. Daily and endless modes use a familiar two-button mode row with one 2px honey indicator and pressed-state semantics. Desktop keeps help at the opposite edge from progress, statistics, and settings; mobile preserves all actions without an overflow menu.

### Albanian Tile and Keyboard

Each board tile represents one of the 36 Albanian letters, not one Unicode character. `DH`, `GJ`, `LL`, `NJ`, `RR`, `SH`, `TH`, `XH`, and `ZH` receive dedicated keys and an optically smaller tile size. Four compact keyboard rows keep every touch target at least 24px wide even at the 320px minimum viewport. Reveal states flip quickly, then expose a persistent symbol. Physical typing merges a digraph atomically and backspace removes it as one unit.

## Do's and Don'ts

### Do:

- **Do** keep the board and keyboard visible before any explanatory feature.
- **Do** use the canonical OKLCH tokens; manifest-only browser metadata may use its required sRGB fallback.
- **Do** pair every tile color with `✓`, `•`, or `×` and a full Albanian screen-reader label.
- **Do** reserve Coffee Honey for the wordmark, selected tab, passport progress, and other earned emphasis.
- **Do** keep motion between 120–360ms and provide the reduced-motion path.
- **Do** preserve 7px controls, 11px notes, and 16px dialogs; larger card radii are forbidden.

### Don't:

- **Don't** turn FJALË into a flag-and-folklore souvenir or use cliché national imagery as decoration.
- **Don't** add casino-style reward chrome, coins, gems, pop-ups, artificial urgency, or pay-to-win hints.
- **Don't** make an English Wordle reskin: Albanian digraphs, `Ë`, `Ç`, and Albanian-first copy are invariants.
- **Don't** use color-only feedback, inaccessible motion, obscure daily answers, or punitive dictionary rejection.
- **Don't** use gradient text, glass cards, colored side-stripe borders, nested cards, or border-plus-wide-shadow ghost cards.
- **Don't** add decorative motion to inactive surfaces; delight must answer a player action.
