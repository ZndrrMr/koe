# Koe image family prompts

All calls used the built-in ImageGen path. The Pinterest corpus and ZAN-909 renders were visual references for the human curation decision only; they were not image inputs. The only image inputs to edit calls were candidate sheets or accepted sources generated below.

## Locked candidate-proof constraints

Each placement prompt included this common direction:

```text
Use case: stylized-concept
Asset type: candidate proof sheet for a Koe product-art placement
Create four meaningfully different original candidate engravings arranged as a clean 2-by-2 proof sheet.
Scene/backdrop: perfectly flat uniform warm cream paper color #F4EFE4.
Style/medium: restrained single-color cobalt-blue #2F5F8F intaglio / wood-engraving linework; fine hand-printed irregularity and controlled sparse crosshatching; literary book-plate restraint.
Composition/framing: calm central compositions; focal exchange inside the central 62% width; at least 18% clear space on every edge; candidates do not touch.
Lighting/mood: flat printed ink, quiet literary warmth, no modeled lighting.
Color palette: exactly cobalt-blue ink on warm cream; no other colors.
Constraints: original abstract non-anatomical concepts; no words, letters, numerals, Japanese characters, interface, button, device, logo, border, frame, panel label, separator, or watermark.
Avoid: copying existing artwork; red sun, torii, ocean wave, cherry blossom, seal stamp, calligraphy brush, geisha, samurai; gradient, glow, shadow, 3D render, photorealism, faux antique damage, crowded detail.
```

Placement-specific candidate requests:

```text
MICROPHONE EDUCATION
Two offset abstract voice contours meeting in a quiet exchange: (1) open receiving contours bridged by one thread, (2) two folded page-like planes nearly touching, (3) paired breath contours interleaving without faces, and (4) one thread passing between two small engraved marks. Keep the lower 35% calm.

HOME / START
Voice as exchange: (1) a quiet thread rising between two open page-like planes, (2) two asymmetric engraved contours with a single exchanged filament, (3) folded speech without literal bubbles, formed by nested paper contours, and (4) two small marginal marks connected through a spacious central voice arc. Keep the lower 35% completely calm. Avoid rabbits, books, human faces, and hands.

RECOVERABLE ERROR
A restrained broken voice plate, truthful but not alarming: (1) an incomplete receiving contour with one clean gap, (2) two nested voice contours interrupted at different points, (3) a thread paused between two separated engraved marks, and (4) a circular page-like plate with one open seam and a small rejoining cue. Legible at 144×144 pt. No X, warning triangle, sad face, or red.

ENDED / CODA
Up to three abstract voice fragments arranged like marginal notes: (1) three small descending contour fragments joined by one barely visible thread, (2) three open page-like fragments in a spacious constellation, (3) a folded conversation thread resolving into three calm engraved marks, and (4) three asymmetric breath contours resting at different scales. Completion, not celebration. Must survive a centered 14:9 crop. No confetti, trophy, or checkmark.
```

## Locked production-edit constraints

Every accepted edit included:

```text
Use case: precise-object-edit
Scene/backdrop: perfectly flat uniform #F4EFE4 with no visible paper fibers or vignette.
Style/medium: exactly one cobalt-blue #2F5F8F intaglio / wood-engraving ink; restrained literary book-plate character matching the same contour-and-thread family.
Constraints: remove all unselected candidates. No anatomy, words, letters, numerals, Japanese characters, interface, device, border, frame, logo, watermark, shadow, gradient, glow, extra object, or extra color.
Avoid: speech bubbles, microphone icons, cultural symbols, faux antique damage, photorealism, dense black areas, sculptural 3D shading.
```

Final edit requests:

```text
MICROPHONE EDUCATION — input: candidates/microphone-education-proof.png, upper-right concept
Isolate and refine the paired offset open page-like voice contours facing across a narrow central gap. Reduce crosshatching density by about one third; retain subtle hand-printed irregularity. Use a 5:4 landscape canvas, place the exchange slightly above center, keep the form inside central 62%, preserve 18% clear on every edge, and leave the lower 35% calm. No crop of either contour.

HOME / START — input: candidates/home-start-proof.png, upper-right concept
Isolate and refine the two asymmetric folded voice contours and their one exchanged hairline thread. Make the thread’s shallow rhythm intentional and quiet. Reduce hatch density about one third and simplify folds for clarity at 310×248 pt. Exact 5:4; exchange in upper central field; central 62%; 18% edge safety; lower 35% completely calm.

RECOVERY V2 — input: accepted home-start-generated.png
Transform the paired home contours into a compact square recovery plate while preserving their exact cobalt intaglio family. Keep two smaller folded voice contours, one upper-left and one lower-right, angled toward each other. Their single connecting thread stops before center and resumes after a clear diagonal gap, with endpoints visibly misaligned. Simplify each fold to roughly half the home detail. Exact 1:1; full broken exchange occupies about 60% of width and height; at least 18% clear on every edge; break obvious at 144×144 pt. No circle, ring, spinner, X, warning triangle, sad face, leaf, or damage spectacle.

ENDED / CODA — input: candidates/coda-proof.png, upper-left concept
Isolate and refine exactly three small abstract folded voice fragments connected by a faint continuous thread. Arrange them as quiet marginal notes in a shallow descending rhythm; simplify hatching for 280×180 pt. Completion, not celebration. Exact 5:4 master for a centered 14:9 cover crop; every fragment and essential thread stays inside the middle 60% height and central 62% width; 18% clear on every edge.
```

## Rejected production iterations

Two recovery edits were explicitly discarded:

1. The upper-right nested-circle candidate was made asymmetric but still read as a loading spinner at phone scale.
2. The lower-left split-thread candidate avoided the spinner but exported to a mark only 27 px high in the 600 px master—about 6.5 pt at the intended 144 pt placement—and its endpoints suggested a cable rather than the approved folded voice contours.

The accepted V2 resolved both failures by editing the approved home source into a square, diagonally interrupted exchange.
