import assert from "node:assert/strict";
import test from "node:test";

import {
  ACOUSTIC_MOTION_POLICY,
  ACOUSTIC_PRESENTATION,
} from "./acousticVisual";

test("the six voice plates carry distinct static meanings", () => {
  const primaryPhases = [
    "idle",
    "listening",
    "understanding",
    "speaking",
    "feedback",
    "recoverableError",
  ] as const;

  assert.equal(
    new Set(primaryPhases.map((phase) => ACOUSTIC_PRESENTATION[phase].plate))
      .size,
    primaryPhases.length,
  );
  assert.equal(ACOUSTIC_PRESENTATION.success.plate, "ready");
  assert.notEqual(
    ACOUSTIC_PRESENTATION.success.titleEn,
    ACOUSTIC_PRESENTATION.idle.titleEn,
  );
});

test("every lifecycle state remains understandable without motion", () => {
  for (const presentation of Object.values(ACOUSTIC_PRESENTATION)) {
    assert.ok(presentation.eyebrow.length > 0);
    assert.ok(presentation.titleJa.length > 0);
    assert.ok(presentation.titleEn.length > 0);
    assert.ok(presentation.accessibilityLabel.length > 0);
    assert.doesNotMatch(presentation.accessibilityLabel, /energy|responds/i);
  }
});

test("the acoustic surface has a zero continuous-update motion budget", () => {
  assert.deepEqual(ACOUSTIC_MOTION_POLICY, {
    mode: "static",
    continuousVisualUpdates: 0,
    transitionDurationMs: 0,
  });
});
