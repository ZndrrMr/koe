# Koe image family — Blue Marginalia / 声の余白

This directory is the production-art handoff for ZAN-910. The accepted family is one visual sentence: open, page-like voice contours exchange a single thread; recovery interrupts it; coda resolves it into three marginal fragments.

The runtime exports are in `assets/illustrations/koe/`. `proof.html` composites every candidate into a 390×844 phone composition and shows the accepted family at 390×844 in light/dark plus 375×667 compact light. `prompts.md` records generation provenance and prompts. `scripts/process-koe-image-family.sh` derives exact transparent sRGB exports from the accepted built-in ImageGen sources.

## Production inventory

| Asset                                    | Named screen/state/placement                                                       | Export                                      | Runtime treatment                                                                                        | Accessibility                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `microphone-education-{light,dark}.webp` | Launch seam when microphone permission is unresolved; 310×240 pt at top of content | 1200×960 px, 5:4, transparent lossless WebP | `contain`; no crop; focal form within central 62%; ≥18% clear on every edge; lower 35% calm              | Meaningful image: “Two engraved voice contours turn toward one another.”                          |
| `home-start-{light,dark}.webp`           | Home/start at 310×248 pt; ending reuses it at 120×96 pt                            | 1200×960 px, 5:4, transparent lossless WebP | `contain`; no crop; focal form within central 62%; ≥18% clear on every edge; lower 35% calm              | Meaningful image: “Two engraved voice contours exchange a single thread.”                         |
| `recovery-{light,dark}.webp`             | Recoverable error at 144×144 pt                                                    | 600×600 px, 1:1, transparent lossless WebP  | `contain`; no crop; 18–82% safe box; the diagonal break survives at placement size                       | Decorative/accessibility-hidden. Live cause, Try again, and safe exit fully communicate recovery. |
| `coda-{light,dark}.webp`                 | Ended/coda at 280×180 pt when saved moments exist                                  | 1200×960 px, 5:4, transparent lossless WebP | centered `cover` to 14:9; visible source rect `[0, 0.0982, 1, 0.8036]`; every fragment survives the crop | Decorative/accessibility-hidden because saved moments remain live text.                           |

Exact machine-readable values live in `assets/illustrations/koe/manifest.json`.

## Runtime boundary

- Listening, understanding, and tutor-speaking plates are deterministic code-native vectors, not generated images.
- Compact feedback has no hero art.
- Ending does not introduce a fifth raster; it reuses the home plate at 120×96 pt.
- Coda is omitted when there are no saved moments.
- Generated images contain no words, letters, Japanese characters, UI, device chrome, controls, logos, frames, shadows, gradients, or false acoustic data.

## Color and appearance

- Light: cobalt `#2F5F8F` alpha artwork on app canvas `#F4EFE4`.
- Dark: pale blue `#A9C6D5` alpha artwork on app canvas `#111B25`.
- Both appearances use the same alpha, crop, scale, and composition. Dark is a recolor, not a separately generated scenic family.
- Exports are stripped sRGB, straight-alpha, lossless WebP. The eight runtime files total 359,604 bytes. The largest individual export is 85,784 bytes. No animation, decode-time blur, shader, mask, or runtime color transform is required.

## Curation record

Four built-in ImageGen proof sheets produced sixteen candidate concepts before the final edits.

- Microphone education carried forward candidate B’s paired open planes. A suggested facial anatomy, C suggested an ocean wave, and D vanished at 310×240 pt.
- Home carried forward candidate B’s asymmetric folds and exchanged thread. A read as a literal book, C was too dense/sculptural, and D was too slight beside the proposition.
- Recovery rejected the initial circular candidates as loading indicators, the first split-thread edit because it collapsed to about 7 pt high, and an invented leaf. The accepted V2 recomposes the approved home contours around a diagonal break and occupies roughly 58% of the 144×144 placement in each dimension.
- Coda carried forward candidate A’s three threaded fragments. B looked like literal paper with grounding shadows, C like a braid, and D like a landscape wave.

No candidate contained typography that was accepted into production. No anatomy is present in the accepted family. `proof.html?view=candidates` preserves the 390×844 comparison; `proof.html?view=finals` preserves accepted light/dark/compact comparisons.

## Provenance

- Direction source: ZAN-909, “Blue Marginalia / 声の余白,” committed in `inspo/koe-visual-system.html`.
- Reference corpus: `inspo/pinterest/`, with `008-book-app-phone-screens.jpg` as the primary reference-only composition. It supplied restraint, cream paper, blue engraving, quiet ochre, and image/type balance.
- Protected reference images were visually reviewed but were **not** passed into ImageGen. No source pixels or named artist style prompt were used. Every model-side edit target was an image generated in this ZAN-910 session.
- Generation path: built-in ImageGen (the image-generation skill’s default mode), then deterministic local alpha extraction, exact sizing, color normalization, and lossless WebP export.
- The original proof sheets and accepted/rejected generated sources are retained under `candidates/` and `sources/` for auditability. They are design evidence only and are not referenced by the app.

Accepted generated-source SHA-256:

| Source                               | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `microphone-education-generated.png` | `8c0c27ed281bd2f6909c8f87431bc69b11d0ce367b0a4ad2cd0557956b017c0b` |
| `home-start-generated.png`           | `ee466468cd1e2b98ac41f2b7db6f93dc50bbb3b2d69029493b978c3c0b0ef904` |
| `recovery-generated-v2.png`          | `f6a2d111b25eaab81cdefa6b0ee828d3f861a1acc5cedbb56ddaa985772a761a` |
| `coda-generated.png`                 | `10a041263466a2e4d8daf6000fe209fe941c1c800b5c589be01f75cfffc1d870` |

## Export reproducibility

Run:

```sh
bash scripts/process-koe-image-family.sh
```

The script fits each generated source to its canonical master, extracts the cobalt-vs-cream signal into alpha while retaining hatch irregularity, places it inside the approved safe region, emits exact light/dark ink colors, strips metadata, and writes lossless WebP exports.

For native review, start Metro with `EXPO_PUBLIC_KOE_REVIEW_ROUTE=art-family`. In development only, the normal index route renders `src/art/ArtFamilyProofScreen.tsx`, a horizontally paged 390×844 light/dark composite sequence. No extra Expo Router route is added to the release product.
