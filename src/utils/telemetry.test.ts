import assert from "node:assert/strict";
import test from "node:test";

import { serializeVoiceEvent } from "./telemetry";

test("voice telemetry preserves correlation but strips private payload fields", () => {
  const parsed = JSON.parse(
    serializeVoiceEvent(
      "stt_final",
      {
        sessionId: "session-1",
        turnId: "turn-1",
        responseRunId: "run-1",
      },
      {
        transcriptChars: 12,
        byteCount: 9_600,
        tutorPromptVersion: "koe-tutor-test",
        genericFollowUpOffer: true,
        transcript: "private words",
        audioBase64: "private-audio",
        authorization: "private-secret",
      } as never,
    ),
  );

  assert.equal(parsed.sessionId, "session-1");
  assert.equal(parsed.turnId, "turn-1");
  assert.equal(parsed.responseRunId, "run-1");
  assert.equal(parsed.transcriptChars, 12);
  assert.equal(parsed.byteCount, 9_600);
  assert.equal(parsed.tutorPromptVersion, "koe-tutor-test");
  assert.equal(parsed.genericFollowUpOffer, true);
  assert.equal(parsed.transcript, undefined);
  assert.equal(parsed.audioBase64, undefined);
  assert.equal(parsed.authorization, undefined);
  assert.doesNotMatch(JSON.stringify(parsed), /private/);
});

test("diagnostic events distinguish each user-visible voice failure boundary", () => {
  const trace = {
    sessionId: "session-1",
    turnId: "turn-1",
    responseRunId: "run-1",
  };
  const cases = [
    ["stt_failed", "recognition"],
    ["provider_failed", "provider"],
    ["audio_decode_failed", "decode"],
    ["audio_session_failed", "audio-session"],
    ["playback_failed", "playback"],
  ] as const;

  const parsed = cases.map(([event, failureKind]) =>
    JSON.parse(serializeVoiceEvent(event, trace, { failureKind }, "error")),
  );
  assert.deepEqual(
    parsed.map((item) => [item.event, item.failureKind]),
    cases,
  );
  assert.ok(
    parsed.every(
      (item) =>
        item.sessionId === trace.sessionId &&
        item.turnId === trace.turnId &&
        item.responseRunId === trace.responseRunId,
    ),
  );
});
