import assert from "node:assert/strict";
import test from "node:test";

import {
  MOTION_STUDY_STAGES,
  nextMotionStage,
  STUDY_LEARNER_LINE,
  STUDY_MODES,
} from "./motionStudy";

test("the prototype exercises the complete voice loop in product order", () => {
  assert.deepEqual(
    MOTION_STUDY_STAGES.map((stage) => stage.id),
    [
      "enter",
      "listen",
      "interim",
      "understand",
      "firstReply",
      "speak",
      "bargeIn",
      "feedback",
      "retry",
      "compare",
      "continue",
    ],
  );
  assert.equal(nextMotionStage(MOTION_STUDY_STAGES.length - 1), 0);
});

test("product feedback remains after the reply and outside the transcript check", () => {
  const reply = MOTION_STUDY_STAGES.findIndex((stage) => stage.id === "speak");
  const feedback = MOTION_STUDY_STAGES.findIndex(
    (stage) => stage.id === "feedback",
  );
  const retry = MOTION_STUDY_STAGES.findIndex((stage) => stage.id === "retry");

  assert.ok(reply < feedback);
  assert.ok(feedback < retry);
  assert.equal(MOTION_STUDY_STAGES[feedback].phase, "feedback");
  assert.equal(
    MOTION_STUDY_STAGES.some((stage) => stage.phase === "transcriptCheck"),
    false,
  );
});

test("mode comparisons hold content constant and preserve conversation flow", () => {
  assert.deepEqual(
    STUDY_MODES.map((mode) => mode.id),
    ["neutral", "strictCoach", "roleplay"],
  );
  for (const mode of STUDY_MODES) {
    assert.ok(mode.reply.length > 0);
    assert.match(mode.correction, /映画|えいが/);
    assert.equal(mode.correction.includes("score"), false);
  }
  assert.equal(STUDY_LEARNER_LINE, "昨日、友達と映画を見ました。");
});

test("silent-state labels and titles stay independently recognizable", () => {
  assert.equal(
    new Set(MOTION_STUDY_STAGES.map((stage) => stage.label)).size,
    MOTION_STUDY_STAGES.length,
  );
  for (const stage of MOTION_STUDY_STAGES) {
    assert.ok(stage.title.length > 0);
    assert.ok(stage.detail.length > 0);
    assert.ok(stage.nextAction.length > 0);
  }
});
