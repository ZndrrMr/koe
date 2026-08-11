import assert from "node:assert/strict";
import test from "node:test";
import { VoiceLatencyTracker, voiceError, VOICE_PHASE_COPY } from "./lifecycle";

test("every lifecycle phase has deterministic UI copy", () => {
  assert.deepEqual(Object.keys(VOICE_PHASE_COPY).sort(), [
    "correction",
    "firstReply",
    "idle",
    "interimTranscript",
    "interrupted",
    "listening",
    "recoverableError",
    "retry",
    "speaking",
    "success",
    "understanding",
  ]);
});

test("recoverable errors select a concrete action", () => {
  assert.equal(voiceError("permissionDenied").recovery, "openSettings");
  assert.equal(voiceError("sttFailure").recovery, "listenAgain");
  assert.equal(voiceError("providerTimeout").recovery, "retryResponse");
  assert.equal(voiceError("audioInterruption").recovery, "resume");
});

test("latency tracker reports three independent stages", () => {
  const ticks = [100, 145, 200, 260, 300];
  const tracker = new VoiceLatencyTracker(() => ticks.shift()!);
  tracker.listeningStarted();
  tracker.transcriptReceived();
  tracker.transcriptCommitted();
  tracker.firstTextReceived();
  tracker.firstAudioPlayed();

  assert.deepEqual(tracker.snapshot(), {
    listeningToTranscriptMs: 45,
    transcriptToFirstTextMs: 60,
    firstTextToFirstAudioMs: 40,
  });
});
