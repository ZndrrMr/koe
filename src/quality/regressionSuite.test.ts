import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  QUALITY_DIMENSIONS,
  QUALITY_EVALUATOR_ID,
  QUALITY_EVALUATOR_PROMPT_VERSION,
  qualityEvaluatorPrompt,
} from "../../shared/conversationQuality";
import { INWORLD_ROUTER_AUDIO_CONTRACT } from "../../shared/inworld";
import {
  deterministicChecks,
  endsWithGenericFollowUpOffer,
  loadQualityFixtures,
  parseLiveConversationResponse,
  runLiveQualitySuite,
  runRecordedQualitySuite,
} from "./regressionSuite";

test("recorded quality lane covers every required behavior without network access", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("the recorded quality lane must never use the network");
  };
  try {
    const fixtures = await loadQualityFixtures();
    const { artifacts, summary } = await runRecordedQualitySuite();
    const actualCoverage = new Set(
      artifacts.flatMap((artifact) => artifact.coverage),
    );

    assert.equal(networkCalls, 0);
    assert.equal(summary.pass, true);
    assert.equal(summary.scenarioCount, fixtures.manifest.scenarios.length);
    assert.equal(summary.turnCount, 16);
    assert.deepEqual(summary.failedScenarios, []);
    fixtures.manifest.requiredCoverage.forEach((requirement) =>
      assert.ok(actualCoverage.has(requirement), requirement),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("each expanded artifact is self-contained, reproducible, and fully versioned", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "koe-conversation-quality-"),
  );
  try {
    const { artifacts, summary } = await runRecordedQualitySuite({
      outputDirectory,
    });
    assert.equal(summary.pass, true);
    for (const artifact of artifacts) {
      assert.match(artifact.reproduction, new RegExp(artifact.scenarioId));
      assert.ok(artifact.fixtureSources.length >= 4);
      assert.equal(artifact.verdict.pass, true);
      const saved = JSON.parse(
        await readFile(
          join(outputDirectory, `${artifact.scenarioId}.json`),
          "utf8",
        ),
      ) as typeof artifact;
      assert.equal(saved.scenarioId, artifact.scenarioId);

      for (const turn of saved.turns) {
        assert.match(turn.inputAudio.sha256, /^[a-f0-9]{64}$/);
        assert.equal(typeof turn.transcript, "string");
        assert.ok(turn.prompts.tutor.text.length > 500);
        assert.ok(turn.prompts.feedback.text.length > 500);
        assert.ok(turn.prompts.evaluator.text.length > 500);
        assert.match(turn.prompts.tutor.sha256, /^[a-f0-9]{64}$/);
        assert.match(turn.prompts.feedback.sha256, /^[a-f0-9]{64}$/);
        assert.match(turn.prompts.evaluator.sha256, /^[a-f0-9]{64}$/);
        assert.equal(turn.modelGrade.evaluator.id, QUALITY_EVALUATOR_ID);
        assert.equal(
          turn.modelGrade.evaluator.promptVersion,
          QUALITY_EVALUATOR_PROMPT_VERSION,
        );
        assert.ok(turn.modelGrade.evaluator.model.length > 0);
        assert.ok(turn.modelGrade.evaluator.modelVersion.length > 0);
        assert.equal(
          turn.modelGrade.evaluator.promptSha256,
          turn.prompts.evaluator.sha256,
        );
        assert.ok(turn.providerTrace.every((entry) => entry.requestId));
        assert.ok(turn.lifecycleTrace.length > 0);
        assert.ok(turn.deterministicChecks.every((check) => check.pass));
        const checkIds = new Set(
          turn.deterministicChecks.map((check) => check.id),
        );
        for (const contract of [
          "response-relevance",
          "language-choice",
          "conversational-continuity",
          "correction-policy",
          "no-forced-retry-or-drill",
          "no-fabricated-transcript-claim",
          "stable-context",
        ]) {
          assert.ok(
            checkIds.has(contract),
            `${artifact.scenarioId}: ${contract}`,
          );
        }
        assert.deepEqual(
          Object.keys(turn.modelGrade.scores).sort(),
          [...QUALITY_DIMENSIONS].sort(),
        );
        assert.ok(
          Object.values(turn.modelGrade.scores).every(
            (score) => Number.isInteger(score) && score >= 4,
          ),
        );
        assert.equal(turn.verdict.pass, true);
      }
    }
    const savedSummary = JSON.parse(
      await readFile(join(outputDirectory, "summary.json"), "utf8"),
    ) as typeof summary;
    assert.equal(savedSummary.pass, true);
    assert.equal(savedSummary.turnCount, 16);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("deterministic contracts reject prompt drift, generic offers, drills, and excess correction", async () => {
  const fixtures = await loadQualityFixtures();
  const { artifacts } = await runRecordedQualitySuite();
  const scenario = fixtures.manifest.scenarios.find(
    ({ id }) => id === "tactful-beginner-correction",
  )!;
  const scenarioTurn = scenario.turns[0]!;
  const asset = fixtures.spokenManifest.assets.find(
    ({ id }) => id === scenarioTurn.fixtureId,
  )!;
  const artifactTurn = artifacts.find(
    ({ scenarioId }) => scenarioId === scenario.id,
  )!.turns[0]!;
  const badFeedback = structuredClone(artifactTurn.feedback);
  badFeedback.corrections.other.push({
    original: "楽しいでした",
    corrected: "楽しかったです",
    explanation: "イ形容詞の過去形です。",
  });
  const badPrompts = structuredClone(artifactTurn.prompts);
  badPrompts.tutor.text += " hidden regression";

  const checks = deterministicChecks({
    scenario,
    contract: scenarioTurn.contracts,
    asset,
    actualInputHash: "0".repeat(64),
    transcript: artifactTurn.transcript,
    history: artifactTurn.history,
    replyText: "Repeat after me. Try again.",
    replyAudio: null,
    feedback: badFeedback,
    providerTrace: [],
    lifecycleTrace: ["speaking"],
    prompts: badPrompts,
  });
  const failed = new Set(
    checks.filter((check) => !check.pass).map((check) => check.id),
  );

  assert.ok(failed.has("input-audio-hash"));
  assert.ok(failed.has("prompts-versioned-and-retained"));
  assert.ok(failed.has("reply-presence"));
  assert.ok(failed.has("provider-trace"));
  assert.ok(failed.has("lifecycle-order"));
  assert.ok(failed.has("language-choice"));
  assert.ok(failed.has("response-relevance"));
  assert.ok(failed.has("correction-policy"));
  assert.ok(failed.has("compact-feedback"));
  assert.ok(failed.has("no-forced-retry-or-drill"));

  const genericOfferChecks = deterministicChecks({
    scenario,
    contract: scenarioTurn.contracts,
    asset,
    actualInputHash: artifactTurn.inputAudio.sha256,
    transcript: artifactTurn.transcript,
    history: artifactTurn.history,
    replyText: "友達と映画を見たんですね。ほかに何か知りたいことはありますか？",
    replyAudio: artifactTurn.replyAudio,
    feedback: artifactTurn.feedback,
    providerTrace: artifactTurn.providerTrace,
    lifecycleTrace: artifactTurn.lifecycleTrace,
    prompts: artifactTurn.prompts,
  });
  const genericOfferFailures = new Set(
    genericOfferChecks.filter((check) => !check.pass).map((check) => check.id),
  );

  assert.ok(genericOfferFailures.has("conversational-continuity"));
  assert.ok(genericOfferFailures.has("no-generic-follow-up-offer"));
});

test("generic follow-up offer detection covers English and Japanese turn endings", () => {
  for (const reply of [
    "That's the difference. Is there anything else you'd like to know?",
    "Anything else?",
    "Would you like to know anything else?",
    "That form is more natural. What else would you like to ask about?",
    "Any other questions?",
    "How else can I help?",
    "Let me know if you have any more questions.",
    "この形が自然です。ほかに何か知りたいことはありますか？",
    "この形が自然です。他にご質問はございますか。",
    "この形が自然です。他に何かありますか？",
    "もちろんです。何について話したいですか？",
  ]) {
    assert.equal(endsWithGenericFollowUpOffer(reply), true, reply);
  }

  for (const reply of [
    "That's the difference.",
    "You mentioned a busy morning. What made work enjoyable?",
    "この形が自然です。",
    "大阪のお好み焼きは、どんな味でしたか？",
    "ほかに食べたいものはありますか？",
  ]) {
    assert.equal(endsWithGenericFollowUpOffer(reply), false, reply);
  }
});

test("silence produces no fabricated transcript, provider request, reply, audio, or feedback", async () => {
  const { artifacts } = await runRecordedQualitySuite({
    scenarioId: "silence-then-recovery",
  });
  const [silence, recovery] = artifacts[0]!.turns;

  assert.equal(silence!.transcript, "");
  assert.equal(silence!.replyText, "");
  assert.equal(silence!.replyAudio, null);
  assert.deepEqual(silence!.providerTrace, []);
  assert.equal(silence!.history.length, 0);
  assert.equal(recovery!.history.length, 0);
  assert.match(recovery!.replyText, /緊張/);
  assert.equal(recovery!.verdict.pass, true);
});

test("live provider replay cannot start without the explicit spend guard", async () => {
  await assert.rejects(
    () =>
      runLiveQualitySuite({
        outputDirectory: ".artifacts/should-not-exist",
        workerUrl: "https://worker.invalid",
        allowProviderSpend: false,
      }),
    /--allow-provider-spend/,
  );
});

test("live conversation parsing matches SSE PCM and deployed JSON MP3 contracts", async () => {
  const sse = parseLiveConversationResponse(
    `data: ${JSON.stringify({ choices: [{ delta: { audio: { transcript: "こんにちは" } } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: "AAAAAA==" } } }] })}\n\n` +
      "data: [DONE]\n\n",
    new Headers({
      "Content-Type": "text/event-stream",
      "X-Koe-Audio-Encoding": "pcm_s16le",
      "X-Koe-Audio-Sample-Rate": "48000",
      "X-Koe-Audio-Channels": "1",
    }),
  );
  assert.equal(sse.replyText, "こんにちは");
  assert.equal(sse.encoding, INWORLD_ROUTER_AUDIO_CONTRACT.encoding);
  assert.equal(sse.audio.byteLength, 4);

  const contract = JSON.parse(
    await readFile("shared/fixtures/inworldAudioContract.json", "utf8"),
  ) as { standalone: { audioBase64: string } };
  const json = parseLiveConversationResponse(
    JSON.stringify({
      text: "そうなんですね。",
      audioBase64: contract.standalone.audioBase64,
      audioFormat: "mp3",
    }),
    new Headers({ "Content-Type": "application/json" }),
  );
  assert.equal(json.replyText, "そうなんですね。");
  assert.equal(json.encoding, "mp3");
  assert.equal(json.sampleRate, 24_000);
  assert.equal(json.channels, 1);
  assert.equal(json.provenance, "live-provider-json-compat");
});

test("guarded live lane retains real response bytes, traces, feedback, and model grade", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "koe-quality-live-"));
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const reply =
    "That sounds like a busy morning. Let's keep the Japanese low-pressure for a few minutes.";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/stt/transcribe?lang=ja,en")) {
      return Response.json({
        text: "I had a busy morning, but I would still like to practice Japanese for a few minutes.",
      });
    }
    if (url.endsWith("/llm/chat")) {
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { audio: { transcript: reply } } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: "AAAAAA==" } } }] })}\n\n` +
          "data: [DONE]\n\n",
        {
          headers: {
            "Content-Type": "text/event-stream",
            "X-Koe-Audio-Encoding": "pcm_s16le",
            "X-Koe-Audio-Sample-Rate": "48000",
            "X-Koe-Audio-Channels": "1",
            "X-Koe-Provider-Request-Id": "live-chat-request",
          },
        },
      );
    }
    if (url.endsWith("/llm/flash")) {
      return Response.json({
        translations: { user: "same", tutor: "same" },
        corrections: {
          particles: [],
          register: { consistent: true },
          other: [],
        },
      });
    }
    if (url.endsWith("/llm/quality")) {
      const evaluationInput = JSON.parse(String(init?.body));
      const promptSha256 = createHash("sha256")
        .update(qualityEvaluatorPrompt(evaluationInput))
        .digest("hex");
      return Response.json({
        evaluator: {
          id: QUALITY_EVALUATOR_ID,
          model: "gemini-live-test",
          promptVersion: QUALITY_EVALUATOR_PROMPT_VERSION,
          promptSha256,
          providerRequestId: "live-grade-request",
        },
        verdict: {
          scores: Object.fromEntries(
            QUALITY_DIMENSIONS.map((dimension) => [dimension, 5]),
          ),
          criticalViolations: [],
          evidence: "The English response is relevant and conversational.",
          pass: true,
        },
      });
    }
    throw new Error(`unexpected live lane request: ${url}`);
  };

  try {
    const { artifacts, summary } = await runLiveQualitySuite({
      outputDirectory,
      workerUrl: "https://worker.test",
      allowProviderSpend: true,
      scenarioId: "english-meta-request",
    });
    assert.equal(summary.pass, true);
    assert.equal(summary.lane, "live");
    assert.equal(artifacts[0]!.turns[0]!.replyAudio?.byteCount, 4);
    assert.equal(
      artifacts[0]!.turns[0]!.providerTrace[1]!.requestId,
      "live-chat-request",
    );
    assert.equal(
      artifacts[0]!.turns[0]!.modelGrade.evaluator.providerRequestId,
      "live-grade-request",
    );
    assert.equal(artifacts[0]!.turns[0]!.verdict.pass, true);
    assert.deepEqual(
      calls.map((url) => new URL(url).pathname),
      ["/stt/transcribe", "/llm/chat", "/llm/flash", "/llm/quality"],
    );
    const audio = await readFile(
      join(outputDirectory, artifacts[0]!.turns[0]!.replyAudio!.path),
    );
    assert.equal(audio.byteLength, 4);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
