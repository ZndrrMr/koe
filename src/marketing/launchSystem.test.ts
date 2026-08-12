import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_STORE_COPY,
  CREATOR_LOOP,
  LAUNCH_COPY,
  MARKETING_CAPTURE,
  MARKETING_FRAMES,
  PRODUCT_PAGE_VARIANTS,
  PRODUCT_PAGE_THESIS,
  previewElapsedMs,
} from "./launchSystem";

test("the primary App Store story is one complete causal loop", () => {
  assert.deepEqual(
    MARKETING_FRAMES.map((frame) => frame.id),
    ["speak", "reply", "tune", "compare", "keep"],
  );
  assert.deepEqual(
    MARKETING_FRAMES.map((frame) => frame.order),
    [1, 2, 3, 4, 5],
  );
  assert.equal(MARKETING_FRAMES[0].headline.includes("Speak Japanese"), true);
  assert.equal(MARKETING_FRAMES.at(-1)?.headline.includes("Keep"), true);
});

test("the silent preview proves conversation and coaching within five seconds", () => {
  assert.equal(previewElapsedMs("reply") < 5_000, true);
  assert.equal(previewElapsedMs("tune") < 5_000, true);
  assert.equal(MARKETING_FRAMES[1].phase, "speaking");
  assert.equal(MARKETING_FRAMES[2].phase, "feedback");
  assert.equal(MARKETING_CAPTURE.preview.durationMs, 13_000);
  assert.equal(MARKETING_CAPTURE.preview.firstCorrectionAtMs, 4_100);
});

test("product-page variants only reframe the same product evidence", () => {
  const canonical = new Set(MARKETING_FRAMES.map((frame) => frame.id));
  for (const variant of PRODUCT_PAGE_VARIANTS) {
    assert.equal(variant.frameIds.length, canonical.size);
    assert.deepEqual(new Set(variant.frameIds), canonical);
    assert.ok(variant.hypothesis.length > 30);
  }
});

test("store metadata stays inside Apple copy limits", () => {
  assert.ok(APP_STORE_COPY.name.length <= 30);
  assert.ok(APP_STORE_COPY.subtitle.length <= 30);
  assert.ok(APP_STORE_COPY.promotionalText.length <= 170);
  assert.ok(APP_STORE_COPY.keywords.length <= 100);
  assert.equal(APP_STORE_COPY.description[0], PRODUCT_PAGE_THESIS);
});

test("the creator system is grounded in Zander's work and explicit consent", () => {
  assert.equal(CREATOR_LOOP.recurringFormats.length, 5);
  assert.ok(
    CREATOR_LOOP.recurringFormats.every(
      (format) =>
        format.source.includes("Zander") || format.source.includes("Koe"),
    ),
  );
  assert.match(
    CREATOR_LOOP.consent.publicUserConversationRequires,
    /explicit.*recorded.*revocable/i,
  );
  assert.match(CREATOR_LOOP.consent.withoutConsent, /Do not publish/i);
  assert.match(CREATOR_LOOP.publishingRhythm, /real build-and-study loop/i);
  assert.match(LAUNCH_COPY.announcement.join(" "), /say the thing you meant/i);
  assert.match(LAUNCH_COPY.nativeCritiqueInvite, /accurate, tactful/i);
});
