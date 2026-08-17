import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CONTROL_MAX_FONT_SIZE_MULTIPLIER,
  CONVERSATION_TARGET,
  meetsMinimumTouchTarget,
  resolveSafeAreaInsets,
  WHOLE_AFFORDANCE_HIT_SLOP,
} from "@/theme/interaction";
import { colors } from "@/theme/colors";

function relativeLuminance(hex: string): number {
  const channels = hex
    .match(/\w{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );

  return (lighter + 0.05) / (darker + 0.05);
}

test("every named conversation control meets the 44 point minimum", () => {
  for (const [name, size] of Object.entries(CONVERSATION_TARGET)) {
    assert.equal(
      meetsMinimumTouchTarget(size),
      true,
      `${name} must remain at least 44 points`,
    );
  }
});

test("full-screen modal insets never collapse below actual window metrics", () => {
  assert.deepEqual(
    resolveSafeAreaInsets(
      { top: 0, right: 0, bottom: 0, left: 0 },
      { top: 59, right: 0, bottom: 34, left: 0 },
    ),
    { top: 59, right: 0, bottom: 34, left: 0 },
  );
  assert.deepEqual(
    resolveSafeAreaInsets(
      { top: 62, right: 0, bottom: 36, left: 0 },
      { top: 59, right: 0, bottom: 34, left: 0 },
    ),
    { top: 62, right: 0, bottom: 36, left: 0 },
  );
});

test("whole-affordance responder expansion covers every visible edge", () => {
  for (const inset of Object.values(WHOLE_AFFORDANCE_HIT_SLOP)) {
    assert.ok(inset > 0);
  }
});

test("control copy can grow without escaping its fixed affordance", () => {
  assert.ok(CONTROL_MAX_FONT_SIZE_MULTIPLIER > 1);
  assert.ok(CONTROL_MAX_FONT_SIZE_MULTIPLIER <= 2);
});

test("interactive copy keeps AA contrast in both appearances", () => {
  for (const palette of Object.values(colors.conversation)) {
    for (const foreground of [
      palette.ink,
      palette.muted,
      palette.seam,
      palette.proof,
      palette.error,
    ]) {
      assert.ok(contrastRatio(foreground, palette.canvas) >= 4.5);
      assert.ok(contrastRatio(foreground, palette.raised) >= 4.5);
      assert.ok(contrastRatio(foreground, palette.seamSoft) >= 4.5);
    }

    assert.ok(contrastRatio(palette.controlText, palette.control) >= 4.5);
  }
});

test("every production control uses the shared whole-region responder", async () => {
  const relativePaths = [
    "app/index.tsx",
    "app/onboarding/welcome.tsx",
    "app/session/[id].tsx",
    "src/components/MicButton.tsx",
    "src/components/PronunciationFeedbackCard.tsx",
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) =>
      readFile(path.resolve(process.cwd(), relativePath), "utf8"),
    ),
  );

  for (const [index, source] of sources.entries()) {
    assert.match(source, /WholeAffordancePressable/, relativePaths[index]);
    assert.doesNotMatch(source, /<Pressable\b/, relativePaths[index]);
  }

  const responder = await readFile(
    path.resolve(process.cwd(), "src/components/WholeAffordancePressable.tsx"),
    "utf8",
  );
  assert.match(responder, /pointerEvents = "box-only"/);
  assert.match(responder, /accessible = true/);
  assert.match(responder, /collapsable = false/);
  assert.match(responder, /const resolvedStyle/);
  assert.match(responder, /style=\{resolvedStyle\}/);
  assert.match(responder, /onPressIn=/);
  assert.match(responder, /onHoverIn=/);
});

test("all full-screen roots apply measured and initial safe-area metrics", async () => {
  const [layout, home, onboarding, session, safeArea] = await Promise.all(
    [
      "app/_layout.tsx",
      "app/index.tsx",
      "app/onboarding/welcome.tsx",
      "app/session/[id].tsx",
      "src/components/SafeAreaScreen.tsx",
    ].map((relativePath) =>
      readFile(path.resolve(process.cwd(), relativePath), "utf8"),
    ),
  );

  assert.match(layout, /initialMetrics=\{initialWindowMetrics\}/);
  assert.match(home, /<SafeAreaScreen/);
  assert.match(onboarding, /<SafeAreaScreen/);
  assert.equal(session.match(/<SafeAreaScreen/g)?.length, 2);
  assert.match(safeArea, /useSafeAreaInsets\(\)/);
  assert.match(safeArea, /initialWindowMetrics\?\.insets/);
  assert.match(safeArea, /resolveSafeAreaInsets/);
});
