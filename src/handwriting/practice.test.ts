import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDWRITING_TARGET_SIZE,
  assessHandwritingAttempt,
  getPracticeCharacter,
  practiceTargetsForText,
  type HandwritingObservation,
} from "./practice";

function observation(
  overrides: Partial<HandwritingObservation> = {},
): HandwritingObservation {
  return {
    hasInk: true,
    strokeCount: 2,
    candidates: [
      { text: "十", confidence: 0.91 },
      { text: "ナ", confidence: 0.31 },
    ],
    strokes: [
      { start: { x: 0.2, y: 0.47 }, end: { x: 0.81, y: 0.46 } },
      { start: { x: 0.51, y: 0.18 }, end: { x: 0.51, y: 0.83 } },
    ],
    contentBounds: { x: 0.2, y: 0.18, width: 0.61, height: 0.65 },
    ...overrides,
  };
}

test("saved expressions become a small, ordered, de-duplicated practice queue", () => {
  const targets = practiceTargetsForText("この人はいい人");
  assert.deepEqual(
    targets.map((target) => target.literal),
    ["こ", "人", "い"],
  );
});

test("a confident recognition and matching structure is ready", () => {
  const assessment = assessHandwritingAttempt(
    getPracticeCharacter("十")!,
    observation(),
  );
  assert.equal(assessment.verdict, "ready");
  assert.equal(assessment.recognition.state, "certain");
  assert.equal(assessment.strokeCount.state, "pass");
  assert.equal(assessment.direction.state, "pass");
  assert.equal(assessment.proportions.state, "pass");
});

test("close candidates remain visibly uncertain and can be corrected", () => {
  const uncertain = assessHandwritingAttempt(
    getPracticeCharacter("十")!,
    observation({
      candidates: [
        { text: "ナ", confidence: 0.64 },
        { text: "十", confidence: 0.59 },
      ],
    }),
  );
  assert.equal(uncertain.verdict, "close");
  assert.equal(uncertain.recognition.state, "uncertain");
  assert.match(uncertain.recognition.message, /not sure/);

  const corrected = assessHandwritingAttempt(
    getPracticeCharacter("十")!,
    observation({
      candidates: [
        { text: "ナ", confidence: 0.64 },
        { text: "十", confidence: 0.59 },
      ],
    }),
    "十",
  );
  assert.equal(corrected.verdict, "ready");
  assert.equal(corrected.recognition.state, "confirmed");
});

test("a reversed stroke produces a specific corrective direction", () => {
  const assessment = assessHandwritingAttempt(
    getPracticeCharacter("十")!,
    observation({
      strokes: [
        { start: { x: 0.81, y: 0.46 }, end: { x: 0.2, y: 0.47 } },
        { start: { x: 0.51, y: 0.18 }, end: { x: 0.51, y: 0.83 } },
      ],
    }),
  );
  assert.equal(assessment.verdict, "close");
  assert.equal(assessment.direction.state, "review");
  assert.equal(assessment.direction.strokeIndex, 0);
  assert.match(assessment.direction.message, /left to right/);
});

test("a confident mismatch is not silently graded as the target", () => {
  const assessment = assessHandwritingAttempt(
    getPracticeCharacter("十")!,
    observation({ candidates: [{ text: "ナ", confidence: 0.94 }] }),
  );
  assert.equal(assessment.verdict, "retry");
  assert.equal(assessment.recognition.state, "mismatch");
});

test("handwriting controls exceed the 44 point accessibility minimum", () => {
  assert.ok(HANDWRITING_TARGET_SIZE >= 44);
});
