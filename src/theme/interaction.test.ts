import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSATION_TARGET,
  meetsMinimumTouchTarget,
} from "@/theme/interaction";

test("every named conversation control meets the 44 point minimum", () => {
  for (const [name, size] of Object.entries(CONVERSATION_TARGET)) {
    assert.equal(
      meetsMinimumTouchTarget(size),
      true,
      `${name} must remain at least 44 points`,
    );
  }
});
