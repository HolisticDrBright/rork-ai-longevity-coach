# White-Balance Reference Card — Placeholder

This is a placeholder for the printable white-balance reference card
mentioned in the patient capture instructions:

> "If you have the printed white-balance reference card, hold it next
>  to your face for the first shot."

## What needs to be designed

A single-page printable PDF with:

1. **White swatch** — pure #FFFFFF, large enough (≥3cm × 3cm) for the
   analyzer to use as a white reference for color correction.
2. **Neutral grey patch** — 18% grey (#808080) for exposure reference.
3. **Skin-tone gradient strip** — 6 tones from light to deep, used by
   the analyzer to gauge melanin range.
4. **Tongue-coat color reference** — yellow / white / grey patches the
   tongue analyzer can compare extracted coat color against.
5. **A QR code** linking to the patient-facing capture instructions
   (deep link into the app's new-session screen).
6. **Branding** — "AI Longevity Pro — Visual Diagnostics Reference"
   with revision number (start at v1) and printing instructions: "Print
   on matte paper at 100% scale, hold 4-6 inches from face."

## Where this is referenced

- `expo/app/(tabs)/visual-assessments/capture/[modality].tsx` — instructions
  string `whiteBalanceTip`.
- `docs/visual-diagnostics-demo.md` — "Known gaps" section.

## Action

Replace this file with `white-balance-reference-card.pdf` and update
the capture screen if the file name changes.
