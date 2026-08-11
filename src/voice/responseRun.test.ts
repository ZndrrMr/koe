import assert from "node:assert/strict";
import test from "node:test";
import { ResponseRunController } from "./responseRun";

test("barge-in aborts the active response and accepts a new turn", () => {
  const controller = new ResponseRunController();
  const first = controller.start("assistant-1");

  assert.equal(controller.interrupt(), "assistant-1");
  assert.equal(first.signal.aborted, true);
  assert.equal(controller.hasActiveRun(), false);

  const second = controller.start("assistant-2");
  assert.equal(second.signal.aborted, false);
  assert.equal(controller.isCurrent("assistant-2"), true);
  assert.equal(controller.isLatest(first.token), false);
  assert.equal(controller.isLatest(second.token), true);
});

test("a stale completion cannot clear the newer response", () => {
  const controller = new ResponseRunController();
  controller.start("assistant-1");
  controller.start("assistant-2");

  assert.equal(controller.complete("assistant-1"), false);
  assert.equal(controller.isCurrent("assistant-2"), true);
  assert.equal(controller.complete("assistant-2"), true);
  assert.equal(controller.hasActiveRun(), false);
});
