import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionCloseout,
  withMomentDecision,
  type SessionTurnSnapshot,
} from "./sessionHistory";
import type { PronunciationFeedback } from "@/services/pitch";

function pronunciation(
  overall: number,
  scoreDelta: number,
  targetImproved: boolean,
): PronunciationFeedback {
  return {
    version: 1,
    status: "aligned",
    targetText: "京都へ行きます",
    units: [],
    reference: {
      f0: [120],
      timestamps: [0],
      rms: [0.1],
      voicedRatio: 1,
      durationMs: 300,
    },
    attempt: {
      f0: [122],
      timestamps: [0],
      rms: [0.1],
      voicedRatio: 1,
      durationMs: 300,
    },
    alignmentPath: [[0, 0]],
    scores: {
      pitch: overall,
      timing: overall,
      voicing: overall,
      overall,
    },
    firstCorrection: "Keep the middle mora level.",
    retry: {
      previousAttemptId: "first-try",
      scoreDelta,
      targetScoreDelta: scoreDelta,
      targetImproved,
    },
  };
}

const turns: SessionTurnSnapshot[] = [
  {
    id: "user-1",
    role: "user",
    textJa: "京都に行きます",
    textEn: "I am going to Kyoto.",
    audioUri: "file:///voice/user-1.m4a",
    createdAt: 1,
    corrections: {
      particles: [
        {
          original: "京都に",
          corrected: "京都へ",
          explanation: "へ emphasizes direction.",
        },
      ],
      register: { consistent: true },
      other: [],
    },
  },
  {
    id: "assistant-old",
    role: "assistant",
    textJa: "旅行は楽しみですね。",
    textEn: "Travel is exciting.",
    audioUri: "file:///voice/assistant-old.wav",
    createdAt: 2,
  },
  {
    id: "assistant-interrupted",
    role: "assistant",
    textJa: "それなら、",
    createdAt: 3,
    interrupted: true,
  },
  {
    id: "retry-1",
    role: "user",
    textJa: "京都へ行きます",
    retryOfTurnId: "user-1",
    attemptNumber: 2,
    pronunciation: pronunciation(82, 14, true),
    audioUri: "file:///voice/retry-1.m4a",
    createdAt: 4,
  },
  {
    id: "assistant-new",
    role: "assistant",
    textJa: "どのお寺を見たいですか？",
    textEn: "Which temple would you like to see?",
    audioUri: "file:///voice/assistant-new.wav",
    createdAt: 5,
  },
];

test("closeout keeps compact learning moments rather than a transcript", () => {
  const closeout = buildSessionCloseout("session-1", turns, 100);

  assert.equal(closeout.generatedAt, 100);
  assert.deepEqual(
    closeout.moments.map((moment) => moment.kind),
    ["expression", "expression", "correction", "retry"],
  );
  assert.equal(
    closeout.moments.some(
      (moment) => moment.sourceTurnId === "assistant-interrupted",
    ),
    false,
  );
  assert.equal(
    closeout.moments.find((moment) => moment.kind === "correction")?.textJa,
    "京都へ",
  );
  assert.match(
    closeout.moments.find((moment) => moment.kind === "retry")?.note ?? "",
    /82% match · \+14/,
  );
});

test("moment IDs are stable and a save decision updates only its moment", () => {
  const first = buildSessionCloseout("session-1", turns, 100);
  const second = buildSessionCloseout("session-1", turns, 200);
  assert.deepEqual(
    first.moments.map((moment) => moment.id),
    second.moments.map((moment) => moment.id),
  );

  const selected = first.moments[0];
  const updated = withMomentDecision(first, selected.id, "saved");
  assert.equal(updated.moments[0].decision, "saved");
  assert.ok(
    updated.moments.slice(1).every((moment) => moment.decision === "pending"),
  );
});

test("empty and partial turns do not manufacture closeout moments", () => {
  const closeout = buildSessionCloseout("empty", [
    {
      id: "empty-assistant",
      role: "assistant",
      textJa: "",
      streaming: true,
      createdAt: 1,
    },
  ]);
  assert.deepEqual(closeout.moments, []);
});
