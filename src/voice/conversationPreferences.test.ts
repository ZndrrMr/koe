import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationTopicForGoal,
  responseGuidanceForLevel,
} from "./conversationPreferences";

test("optional response levels describe style without course metadata", () => {
  assert.match(responseGuidanceForLevel("starting"), /short replies/);
  assert.match(responseGuidanceForLevel("everyday"), /everyday conversation/);
  assert.match(responseGuidanceForLevel("full-speed"), /unrestricted/);
});

test("the default goal stays neutral while chosen goals add light context", () => {
  assert.equal(conversationTopicForGoal("just-because"), undefined);
  assert.match(conversationTopicForGoal("travel") ?? "", /travel/);
});
