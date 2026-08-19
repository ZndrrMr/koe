import assert from "node:assert/strict";
import test from "node:test";

import { serializeWorkerEvent } from "./telemetry";

test("Worker telemetry retains trace metadata and rejects private fields", () => {
  const line = serializeWorkerEvent(
    "provider_response",
    {
      sessionId: "session-1",
      turnId: "turn-1",
      responseRunId: "run-1",
    },
    {
      status: 200,
      providerRequestId: "provider-1",
      tutorPromptVersion: "koe-tutor-test",
      genericFollowUpOffer: true,
      transcript: "private-utterance",
      audioData: "private-audio",
      secret: "private-key",
    } as never,
  );
  const parsed = JSON.parse(line);

  assert.equal(parsed.status, 200);
  assert.equal(parsed.providerRequestId, "provider-1");
  assert.equal(parsed.tutorPromptVersion, "koe-tutor-test");
  assert.equal(parsed.genericFollowUpOffer, true);
  assert.equal(parsed.transcript, undefined);
  assert.equal(parsed.audioData, undefined);
  assert.equal(parsed.secret, undefined);
  assert.doesNotMatch(line, /private/);
});
