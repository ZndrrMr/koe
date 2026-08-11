import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutoSendFirstTranscript } from "./firstExchange";

test("the first recognized line enters conversation without a confirmation gate", () => {
  assert.equal(
    shouldAutoSendFirstTranscript({
      intro: "1",
      existingTurnCount: 0,
      transcript: "  こんにちは  ",
    }),
    true,
  );
});

test("later lines and empty recognition keep the editable transcript path", () => {
  assert.equal(
    shouldAutoSendFirstTranscript({
      intro: "1",
      existingTurnCount: 2,
      transcript: "今日はいい天気ですね。",
    }),
    false,
  );
  assert.equal(
    shouldAutoSendFirstTranscript({
      intro: undefined,
      existingTurnCount: 0,
      transcript: "こんにちは",
    }),
    false,
  );
  assert.equal(
    shouldAutoSendFirstTranscript({
      intro: "1",
      existingTurnCount: 0,
      transcript: "   ",
    }),
    false,
  );
});
