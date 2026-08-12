import assert from "node:assert/strict";
import test from "node:test";
import { VoiceLatencyTracker, voiceError, VOICE_PHASE_COPY } from "./lifecycle";

test("every lifecycle phase has deterministic UI copy", () => {
  assert.deepEqual(Object.keys(VOICE_PHASE_COPY).sort(), [
    "comparing",
    "feedback",
    "firstReply",
    "idle",
    "interimTranscript",
    "interrupted",
    "listening",
    "recoverableError",
    "responseRetry",
    "retryListening",
    "speaking",
    "success",
    "transcriptCheck",
    "understanding",
  ]);
});

test("transcript recovery and product feedback are separate states", () => {
  assert.match(VOICE_PHASE_COPY.transcriptCheck.detail, /misheard/i);
  assert.match(VOICE_PHASE_COPY.feedback.detail, /continue/i);
  assert.match(VOICE_PHASE_COPY.retryListening.detail, /highlighted phrase/i);
  assert.match(VOICE_PHASE_COPY.responseRetry.detail, /provider/i);
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
