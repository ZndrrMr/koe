import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationTopicForGoal,
  levelToJlpt,
} from "./conversationPreferences";

test("optional levels map to the conversation context", () => {
  assert.equal(levelToJlpt("beginner"), 5);
  assert.equal(levelToJlpt("n4"), 4);
  assert.equal(levelToJlpt("n2plus"), 2);
});

test("the default goal stays neutral while chosen goals add light context", () => {
  assert.equal(conversationTopicForGoal("just-because"), undefined);
  assert.match(conversationTopicForGoal("travel") ?? "", /travel/);
});
