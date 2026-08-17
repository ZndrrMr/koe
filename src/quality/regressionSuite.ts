import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  FEEDBACK_PROMPT_VERSION,
  TUTOR_PROMPT_VERSION,
  feedbackPrompt,
  tutorSystemPrompt,
} from "../../shared/conversationPrompts";
import {
  CONVERSATION_QUALITY_SCHEMA_VERSION,
  CONVERSATION_QUALITY_SUITE_VERSION,
  QUALITY_DIMENSIONS,
  QUALITY_EVALUATOR_ID,
  QUALITY_EVALUATOR_PROMPT_VERSION,
  qualityEvaluatorPrompt,
  type QualityDialogueTurn,
  type QualityEvaluationInput,
} from "../../shared/conversationQuality";
import {
  INWORLD_ROUTER_AUDIO_CONTRACT,
  INWORLD_STANDALONE_AUDIO_CONTRACT,
} from "../../shared/inworld";
import {
  decodeBase64Audio,
  validateInworldRouterChunk,
  validateInworldStandaloneMP3,
} from "../services/audioContract";

const FIXTURE_ROOT = "shared/fixtures/conversation-quality";
const SPOKEN_MANIFEST = "shared/fixtures/spoken/manifest.json";
const AUDIO_CONTRACT_FIXTURE = "shared/fixtures/inworldAudioContract.json";

type ExpectedLanguage = "ja" | "en" | "mixed" | "none";
type CorrectionPolicy = "none" | "optional-single" | "required-single";

type ScenarioTurnContract = {
  expectedLanguage: ExpectedLanguage;
  teachingRequested: boolean;
  correctionPolicy: CorrectionPolicy;
  transcriptUncertain: boolean;
  expectedAction: "reply" | "no-reply";
  requiredReplyTerms: string[];
  requiredHistoryTerms?: string[];
  forbiddenReplyTerms?: string[];
};

type QualityScenario = {
  id: string;
  description: string;
  coverage: string[];
  turns: Array<{
    fixtureId: string;
    contracts: ScenarioTurnContract;
  }>;
};

type ScenarioManifest = {
  schemaVersion: number;
  suiteVersion: string;
  requiredCoverage: string[];
  scenarios: QualityScenario[];
};

type SpokenAsset = {
  id: string;
  file: string;
  expectedTranscript: string;
  sha256: string;
  encoding: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  byteCount: number;
};

type SpokenManifest = {
  assets: SpokenAsset[];
};

type Feedback = {
  translations: { user?: string; tutor?: string };
  corrections: {
    particles: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
    register: { consistent: boolean; note?: string | null };
    other: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
  };
};

type ProviderTraceEntry = {
  stage: string;
  provider: string;
  model: string;
  status: number;
  mode: string;
  requestId?: string;
};

type ReplyAudio = {
  path: string;
  sha256: string;
  encoding: string;
  sampleRate: number;
  channels: number;
  byteCount: number;
  provenance: string;
};

type RecordedTurn = {
  replyText: string;
  replyAudio?: ReplyAudio | null;
  providerTrace?: ProviderTraceEntry[];
  lifecycleTrace?: string[];
  feedback: Feedback;
  gradeEvidence: string;
  scores?: Record<string, number>;
};

type RecordedResults = {
  schemaVersion: number;
  suiteVersion: string;
  provenance: string;
  recordedEvaluator: {
    id: string;
    model: string;
    modelVersion: string;
    promptVersion: string;
    recordedAt: string;
  };
  promptContractHashes: {
    tutor: string;
    feedbackTemplate: string;
    evaluatorTemplate: string;
  };
  replyAudioFixture: ReplyAudio & { jsonPointer: string };
  standardLifecycleTrace: string[];
  standardProviderTrace: ProviderTraceEntry[];
  defaultPassingScores: Record<string, number>;
  results: Array<{ scenarioId: string; turns: RecordedTurn[] }>;
};

export type ContractCheck = {
  id: string;
  pass: boolean;
  evidence: string;
};

export type QualityTurnArtifact = {
  turn: number;
  fixtureId: string;
  inputAudio: {
    path: string;
    sha256: string;
    encoding: string;
    sampleRate: number;
    channels: number;
    durationMs: number;
    byteCount: number;
  };
  transcript: string;
  history: QualityDialogueTurn[];
  prompts: {
    tutor: { version: string; sha256: string; text: string };
    feedback: { version: string; sha256: string; text: string };
    evaluator: { version: string; sha256: string; text: string };
  };
  providerTrace: ProviderTraceEntry[];
  replyText: string;
  replyAudio: ReplyAudio | null;
  feedback: Feedback;
  lifecycleTrace: string[];
  deterministicChecks: ContractCheck[];
  modelGrade: {
    evaluator: {
      id: string;
      model: string;
      modelVersion: string;
      promptVersion: string;
      promptSha256: string;
      recordedAt?: string;
      providerRequestId?: string;
    };
    scores: Record<string, number>;
    criticalViolations: string[];
    evidence: string;
    pass: boolean;
  };
  verdict: {
    deterministicPass: boolean;
    modelGradePass: boolean;
    pass: boolean;
  };
};

export type QualityScenarioArtifact = {
  schemaVersion: number;
  suiteVersion: string;
  lane: "recorded" | "live";
  scenarioId: string;
  description: string;
  coverage: string[];
  fixtureSources: string[];
  reproduction: string;
  turns: QualityTurnArtifact[];
  verdict: { pass: boolean; failedTurnNumbers: number[] };
};

export type QualitySuiteSummary = {
  schemaVersion: number;
  suiteVersion: string;
  lane: "recorded" | "live";
  scenarioCount: number;
  turnCount: number;
  passedScenarios: number;
  failedScenarios: string[];
  outputDirectory?: string;
  pass: boolean;
};

export type LoadedQualityFixtures = {
  repositoryRoot: string;
  manifest: ScenarioManifest;
  spokenManifest: SpokenManifest;
  recorded: RecordedResults;
};

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function loadQualityFixtures(
  repositoryRoot = process.cwd(),
): Promise<LoadedQualityFixtures> {
  const root = resolve(repositoryRoot);
  const [manifest, spokenManifest, recorded] = await Promise.all([
    readJson<ScenarioManifest>(join(root, FIXTURE_ROOT, "scenarios.json")),
    readJson<SpokenManifest>(join(root, SPOKEN_MANIFEST)),
    readJson<RecordedResults>(
      join(root, FIXTURE_ROOT, "recorded-provider-results.json"),
    ),
  ]);
  return { repositoryRoot: root, manifest, spokenManifest, recorded };
}

function countCorrections(feedback: Feedback): number {
  return (
    feedback.corrections.particles.length +
    feedback.corrections.other.length +
    (feedback.corrections.register.consistent ? 0 : 1)
  );
}

function isCompactCorrection(feedback: Feedback): boolean {
  const notes = [
    ...feedback.corrections.particles.map((item) => item.explanation),
    ...feedback.corrections.other.map((item) => item.explanation),
    ...(!feedback.corrections.register.consistent &&
    feedback.corrections.register.note
      ? [feedback.corrections.register.note]
      : []),
  ];
  return notes.length <= 1 && notes.every((note) => note.length <= 100);
}

function languageCheck(reply: string, expected: ExpectedLanguage): boolean {
  if (expected === "none") return reply.length === 0;
  const japaneseCharacters =
    reply.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)
      ?.length ?? 0;
  if (expected === "ja") return japaneseCharacters >= 3;
  if (expected === "en")
    return japaneseCharacters === 0 && /[A-Za-z]{3}/.test(reply);
  return japaneseCharacters > 0 && /[A-Za-z]{2}/.test(reply);
}

function orderedSubsequence(values: string[], expected: string[]): boolean {
  let cursor = 0;
  for (const value of values) {
    if (value === expected[cursor]) cursor += 1;
    if (cursor === expected.length) return true;
  }
  return expected.length === 0;
}

export function deterministicChecks(input: {
  scenario: QualityScenario;
  contract: ScenarioTurnContract;
  asset: SpokenAsset;
  actualInputHash: string;
  transcript: string;
  history: QualityDialogueTurn[];
  replyText: string;
  replyAudio: ReplyAudio | null;
  feedback: Feedback;
  providerTrace: ProviderTraceEntry[];
  lifecycleTrace: string[];
  prompts: QualityTurnArtifact["prompts"];
}): ContractCheck[] {
  const {
    contract,
    asset,
    actualInputHash,
    transcript,
    history,
    replyText,
    replyAudio,
    feedback,
    providerTrace,
    lifecycleTrace,
    prompts,
  } = input;
  const correctionCount = countCorrections(feedback);
  const shouldReply = contract.expectedAction === "reply";
  const requiredLifecycle = shouldReply
    ? [
        "stt_final",
        "understanding",
        "provider_response",
        "speaking",
        "resuming",
      ]
    : ["no_speech", "resuming", "listening"];
  const expectedProviderStages = ["transcription", "conversation", "feedback"];
  const sentenceCount =
    replyText.match(/[。！？]|[.!?](?:\s|$)/g)?.length ?? (replyText ? 1 : 0);
  const forcedRetry =
    /もう一度(?:言|繰り返)|繰り返して|repeat after me|try again|say it again/i.test(
      `${replyText} ${JSON.stringify(feedback)}`,
    );
  const unsolicitedLesson =
    !contract.teachingRequested &&
    /練習しましょう|文法のレッスン|今日の課題|lesson for today|quiz/i.test(
      replyText,
    );
  const forbiddenTerms = contract.forbiddenReplyTerms ?? [];
  const retainedHistory = history.map(({ content }) => content).join("\n");
  const requiredHistoryTerms = contract.requiredHistoryTerms ?? [];

  return [
    {
      id: "input-audio-hash",
      pass: actualInputHash === asset.sha256,
      evidence: `${actualInputHash} matches manifest ${asset.sha256}`,
    },
    {
      id: "transcript-retained",
      pass: transcript === asset.expectedTranscript,
      evidence: transcript || "empty transcript retained for silence",
    },
    {
      id: "prompts-versioned-and-retained",
      pass:
        prompts.tutor.version === TUTOR_PROMPT_VERSION &&
        prompts.feedback.version === FEEDBACK_PROMPT_VERSION &&
        prompts.evaluator.version === QUALITY_EVALUATOR_PROMPT_VERSION &&
        prompts.tutor.sha256 === sha256(prompts.tutor.text) &&
        prompts.feedback.sha256 === sha256(prompts.feedback.text) &&
        prompts.evaluator.sha256 === sha256(prompts.evaluator.text),
      evidence: `${prompts.tutor.version}; ${prompts.feedback.version}; ${prompts.evaluator.version}`,
    },
    {
      id: "reply-presence",
      pass: shouldReply
        ? replyText.trim().length > 0 && Boolean(replyAudio?.sha256)
        : replyText === "" && replyAudio === null,
      evidence: shouldReply
        ? `${replyText.length} reply characters with retained audio`
        : "silence produced no text or audio",
    },
    {
      id: "provider-trace",
      pass: shouldReply
        ? providerTrace.length === expectedProviderStages.length &&
          providerTrace.every(
            (entry, index) =>
              entry.stage === expectedProviderStages[index] &&
              entry.status >= 200 &&
              entry.status < 300 &&
              Boolean(entry.model) &&
              Boolean(entry.requestId),
          )
        : providerTrace.length === 0,
      evidence: providerTrace.length
        ? providerTrace
            .map(({ stage, model }) => `${stage}:${model}`)
            .join(", ")
        : "no provider was called",
    },
    {
      id: "lifecycle-order",
      pass: orderedSubsequence(lifecycleTrace, requiredLifecycle),
      evidence: lifecycleTrace.join(" -> "),
    },
    {
      id: "language-choice",
      pass: languageCheck(replyText, contract.expectedLanguage),
      evidence: `expected ${contract.expectedLanguage}`,
    },
    {
      id: "response-relevance",
      pass: contract.requiredReplyTerms.every((term) =>
        replyText.includes(term),
      ),
      evidence: `required terms: ${contract.requiredReplyTerms.join(", ") || "none"}`,
    },
    {
      id: "conversational-continuity",
      pass: shouldReply ? replyText.trim().length > 0 && !forcedRetry : true,
      evidence: shouldReply
        ? "reply continues or directly resolves the exchange without a forced retry"
        : "silence leaves the exchange open without inventing a turn",
    },
    {
      id: "stable-context",
      pass: requiredHistoryTerms.every((term) =>
        retainedHistory.includes(term),
      ),
      evidence: requiredHistoryTerms.length
        ? `retained history terms: ${requiredHistoryTerms.join(", ")}`
        : "no additional prior fact required for this turn",
    },
    {
      id: "no-fabricated-transcript-claim",
      pass: forbiddenTerms.every((term) => !replyText.includes(term)),
      evidence: forbiddenTerms.length
        ? `absent: ${forbiddenTerms.join(", ")}`
        : "no scenario-specific fabricated claim pattern",
    },
    {
      id: "correction-policy",
      pass:
        contract.correctionPolicy === "none"
          ? correctionCount === 0
          : contract.correctionPolicy === "required-single"
            ? correctionCount === 1
            : correctionCount <= 1,
      evidence: `${correctionCount} correction(s) for ${contract.correctionPolicy}`,
    },
    {
      id: "compact-feedback",
      pass: correctionCount <= 1 && isCompactCorrection(feedback),
      evidence: "at most one correction with a one-sentence note",
    },
    {
      id: "no-forced-retry-or-drill",
      pass: !forcedRetry && !unsolicitedLesson,
      evidence:
        "no forced retry, quiz, assignment, or unsolicited lesson marker",
    },
    {
      id: "natural-reply-shape",
      pass:
        !/(^|\n)\s*(?:#{1,6}|[-*]\s|```)|\*\*/m.test(replyText) &&
        (contract.teachingRequested || sentenceCount <= 2) &&
        !/^(?:Assistant|Koe|Tutor):/i.test(replyText),
      evidence: contract.teachingRequested
        ? "explicit teaching may use added detail"
        : `${sentenceCount} conversational sentence(s)`,
    },
  ];
}

export function qualityEvaluationInput(input: {
  scenario: QualityScenario;
  contract: ScenarioTurnContract;
  history: QualityDialogueTurn[];
  transcript: string;
  replyText: string;
  feedback: Feedback;
}): QualityEvaluationInput {
  return {
    scenarioId: input.scenario.id,
    scenarioDescription: input.scenario.description,
    coverage: input.scenario.coverage,
    history: input.history,
    transcript: input.transcript,
    replyText: input.replyText,
    feedback: input.feedback,
    expectedLanguage: input.contract.expectedLanguage,
    teachingRequested: input.contract.teachingRequested,
    correctionPolicy: input.contract.correctionPolicy,
    transcriptUncertain: input.contract.transcriptUncertain,
  };
}

export function retainedPrompts(input: QualityEvaluationInput) {
  const tutor = tutorSystemPrompt();
  const feedback = feedbackPrompt({
    history: input.history,
    userTurn: input.transcript,
    tutorReply: input.replyText,
  });
  const evaluator = qualityEvaluatorPrompt(input);
  return {
    tutor: {
      version: TUTOR_PROMPT_VERSION,
      sha256: sha256(tutor),
      text: tutor,
    },
    feedback: {
      version: FEEDBACK_PROMPT_VERSION,
      sha256: sha256(feedback),
      text: feedback,
    },
    evaluator: {
      version: QUALITY_EVALUATOR_PROMPT_VERSION,
      sha256: sha256(evaluator),
      text: evaluator,
    },
  };
}

function validateModelScores(scores: Record<string, number>): boolean {
  return QUALITY_DIMENSIONS.every((dimension) => {
    const score = scores[dimension];
    return Number.isInteger(score) && score >= 4 && score <= 5;
  });
}

async function validateFixtureSet(fixtures: LoadedQualityFixtures) {
  const { manifest, recorded, spokenManifest, repositoryRoot } = fixtures;
  invariant(
    manifest.schemaVersion === CONVERSATION_QUALITY_SCHEMA_VERSION &&
      recorded.schemaVersion === CONVERSATION_QUALITY_SCHEMA_VERSION,
    "conversation quality fixture schema version is unsupported",
  );
  invariant(
    manifest.suiteVersion === CONVERSATION_QUALITY_SUITE_VERSION &&
      recorded.suiteVersion === CONVERSATION_QUALITY_SUITE_VERSION,
    "conversation quality fixture suite version drifted",
  );
  invariant(
    recorded.recordedEvaluator.id === QUALITY_EVALUATOR_ID &&
      recorded.recordedEvaluator.promptVersion ===
        QUALITY_EVALUATOR_PROMPT_VERSION &&
      recorded.recordedEvaluator.model.length > 0 &&
      recorded.recordedEvaluator.modelVersion.length > 0,
    "recorded evaluator metadata is incomplete or stale",
  );
  const canonicalQualityInput: QualityEvaluationInput = {
    scenarioId: "__SCENARIO__",
    scenarioDescription: "__DESCRIPTION__",
    coverage: ["__COVERAGE__"],
    history: [],
    transcript: "__TRANSCRIPT__",
    replyText: "__REPLY__",
    feedback: {},
    expectedLanguage: "ja",
    teachingRequested: false,
    correctionPolicy: "none",
    transcriptUncertain: false,
  };
  invariant(
    recorded.promptContractHashes.tutor === sha256(tutorSystemPrompt()) &&
      recorded.promptContractHashes.feedbackTemplate ===
        sha256(
          feedbackPrompt({
            history: [],
            userTurn: "__TRANSCRIPT__",
            tutorReply: "__REPLY__",
          }),
        ) &&
      recorded.promptContractHashes.evaluatorTemplate ===
        sha256(qualityEvaluatorPrompt(canonicalQualityInput)),
    "a production or evaluator prompt changed without an approved quality baseline refresh",
  );
  const coverage = new Set(manifest.scenarios.flatMap((item) => item.coverage));
  for (const requirement of manifest.requiredCoverage) {
    invariant(
      coverage.has(requirement),
      `missing quality coverage: ${requirement}`,
    );
  }
  const scenarioIds = manifest.scenarios.map(({ id }) => id);
  invariant(
    new Set(scenarioIds).size === scenarioIds.length,
    "quality scenario IDs must be unique",
  );
  invariant(
    JSON.stringify(scenarioIds) ===
      JSON.stringify(recorded.results.map(({ scenarioId }) => scenarioId)),
    "recorded results must exactly match scenario order",
  );
  const assetById = new Map(
    spokenManifest.assets.map((asset) => [asset.id, asset]),
  );
  for (const scenario of manifest.scenarios) {
    const result = recorded.results.find(
      (item) => item.scenarioId === scenario.id,
    );
    invariant(result, `${scenario.id} has no recorded provider result`);
    invariant(
      result.turns.length === scenario.turns.length,
      `${scenario.id} recorded turn count drifted`,
    );
    for (const turn of scenario.turns) {
      invariant(
        assetById.has(turn.fixtureId),
        `${turn.fixtureId} is not in spoken corpus`,
      );
    }
  }
  const audioContract = await readJson<{
    routerStream: { audioBase64: string; sha256: string; byteCount: number };
  }>(join(repositoryRoot, AUDIO_CONTRACT_FIXTURE));
  const audioBytes = Buffer.from(
    audioContract.routerStream.audioBase64,
    "base64",
  );
  invariant(
    sha256(audioBytes) === recorded.replyAudioFixture.sha256 &&
      audioContract.routerStream.sha256 === recorded.replyAudioFixture.sha256 &&
      audioBytes.byteLength === recorded.replyAudioFixture.byteCount,
    "recorded reply audio fixture hash or byte count drifted",
  );
}

export async function buildRecordedQualityArtifacts(
  fixtures: LoadedQualityFixtures,
): Promise<QualityScenarioArtifact[]> {
  await validateFixtureSet(fixtures);
  const { repositoryRoot, manifest, spokenManifest, recorded } = fixtures;
  const assetById = new Map(
    spokenManifest.assets.map((asset) => [asset.id, asset]),
  );
  const artifacts: QualityScenarioArtifact[] = [];

  for (const scenario of manifest.scenarios) {
    const result = recorded.results.find(
      (item) => item.scenarioId === scenario.id,
    )!;
    const history: QualityDialogueTurn[] = [];
    const turns: QualityTurnArtifact[] = [];
    for (let index = 0; index < scenario.turns.length; index += 1) {
      const scenarioTurn = scenario.turns[index]!;
      const recordedTurn = result.turns[index]!;
      const asset = assetById.get(scenarioTurn.fixtureId)!;
      const inputBytes = await readFile(
        join(repositoryRoot, "shared/fixtures/spoken", asset.file),
      );
      const actualInputHash = sha256(inputBytes);
      const turnHistory = history.map((turn) => ({ ...turn }));
      const evaluationInput = qualityEvaluationInput({
        scenario,
        contract: scenarioTurn.contracts,
        history: turnHistory,
        transcript: asset.expectedTranscript,
        replyText: recordedTurn.replyText,
        feedback: recordedTurn.feedback,
      });
      const prompts = retainedPrompts(evaluationInput);
      const providerTrace = (
        recordedTurn.providerTrace ?? recorded.standardProviderTrace
      ).map((entry) => ({
        ...entry,
        requestId:
          entry.requestId ??
          `fixture:${scenario.id}:${index + 1}:${entry.stage}`,
      }));
      const replyAudio =
        recordedTurn.replyAudio === null
          ? null
          : {
              ...(recordedTurn.replyAudio ?? recorded.replyAudioFixture),
              path: recorded.replyAudioFixture.path,
            };
      const lifecycleTrace =
        recordedTurn.lifecycleTrace ?? recorded.standardLifecycleTrace;
      const checks = deterministicChecks({
        scenario,
        contract: scenarioTurn.contracts,
        asset,
        actualInputHash,
        transcript: asset.expectedTranscript,
        history: turnHistory,
        replyText: recordedTurn.replyText,
        replyAudio,
        feedback: recordedTurn.feedback,
        providerTrace,
        lifecycleTrace,
        prompts,
      });
      const scores = recordedTurn.scores ?? recorded.defaultPassingScores;
      const deterministicPass = checks.every((check) => check.pass);
      const modelGradePass = validateModelScores(scores);
      const turn: QualityTurnArtifact = {
        turn: index + 1,
        fixtureId: asset.id,
        inputAudio: {
          path: join("shared/fixtures/spoken", asset.file),
          sha256: asset.sha256,
          encoding: asset.encoding,
          sampleRate: asset.sampleRate,
          channels: asset.channels,
          durationMs: asset.durationMs,
          byteCount: asset.byteCount,
        },
        transcript: asset.expectedTranscript,
        history: turnHistory,
        prompts,
        providerTrace,
        replyText: recordedTurn.replyText,
        replyAudio,
        feedback: recordedTurn.feedback,
        lifecycleTrace,
        deterministicChecks: checks,
        modelGrade: {
          evaluator: {
            ...recorded.recordedEvaluator,
            promptSha256: prompts.evaluator.sha256,
          },
          scores,
          criticalViolations: [],
          evidence: recordedTurn.gradeEvidence,
          pass: modelGradePass,
        },
        verdict: {
          deterministicPass,
          modelGradePass,
          pass: deterministicPass && modelGradePass,
        },
      };
      turns.push(turn);
      if (asset.expectedTranscript) {
        history.push({ role: "user", content: asset.expectedTranscript });
      }
      if (recordedTurn.replyText) {
        history.push({ role: "assistant", content: recordedTurn.replyText });
      }
    }
    const failedTurnNumbers = turns
      .filter((turn) => !turn.verdict.pass)
      .map((turn) => turn.turn);
    artifacts.push({
      schemaVersion: CONVERSATION_QUALITY_SCHEMA_VERSION,
      suiteVersion: CONVERSATION_QUALITY_SUITE_VERSION,
      lane: "recorded",
      scenarioId: scenario.id,
      description: scenario.description,
      coverage: scenario.coverage,
      fixtureSources: [
        `${FIXTURE_ROOT}/scenarios.json`,
        `${FIXTURE_ROOT}/recorded-provider-results.json`,
        SPOKEN_MANIFEST,
        ...turns.map((turn) => turn.inputAudio.path),
      ],
      reproduction: `npm run test:quality:recorded -- --scenario ${scenario.id}`,
      turns,
      verdict: { pass: failedTurnNumbers.length === 0, failedTurnNumbers },
    });
  }
  return artifacts;
}

export function summarizeQualityArtifacts(
  artifacts: QualityScenarioArtifact[],
  lane: "recorded" | "live",
  outputDirectory?: string,
): QualitySuiteSummary {
  const failedScenarios = artifacts
    .filter((artifact) => !artifact.verdict.pass)
    .map((artifact) => artifact.scenarioId);
  return {
    schemaVersion: CONVERSATION_QUALITY_SCHEMA_VERSION,
    suiteVersion: CONVERSATION_QUALITY_SUITE_VERSION,
    lane,
    scenarioCount: artifacts.length,
    turnCount: artifacts.reduce(
      (count, artifact) => count + artifact.turns.length,
      0,
    ),
    passedScenarios: artifacts.length - failedScenarios.length,
    failedScenarios,
    outputDirectory,
    pass: failedScenarios.length === 0,
  };
}

export async function writeQualityArtifacts(
  outputDirectory: string,
  artifacts: QualityScenarioArtifact[],
): Promise<QualitySuiteSummary> {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  for (const artifact of artifacts) {
    await writeFile(
      join(directory, `${artifact.scenarioId}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
  }
  const summary = summarizeQualityArtifacts(
    artifacts,
    artifacts[0]?.lane ?? "recorded",
    directory,
  );
  await writeFile(
    join(directory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  return summary;
}

export async function runRecordedQualitySuite(
  options: {
    repositoryRoot?: string;
    outputDirectory?: string;
    scenarioId?: string;
  } = {},
): Promise<{
  artifacts: QualityScenarioArtifact[];
  summary: QualitySuiteSummary;
}> {
  const fixtures = await loadQualityFixtures(options.repositoryRoot);
  let artifacts = await buildRecordedQualityArtifacts(fixtures);
  if (options.scenarioId) {
    artifacts = artifacts.filter(
      (artifact) => artifact.scenarioId === options.scenarioId,
    );
    invariant(
      artifacts.length === 1,
      `unknown scenario: ${options.scenarioId}`,
    );
  }
  const summary = options.outputDirectory
    ? await writeQualityArtifacts(options.outputDirectory, artifacts)
    : summarizeQualityArtifacts(artifacts, "recorded");
  return { artifacts, summary };
}

function providerError(stage: string, response: Response, body: string): Error {
  return new Error(
    `${stage} failed with HTTP ${response.status}: ${body.slice(0, 500)}`,
  );
}

function parseProviderSSE(body: string): {
  replyText: string;
  audio: Uint8Array;
} {
  const audioChunks: Uint8Array[] = [];
  let replyText = "";
  let sawDone = false;
  for (const block of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const payload = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload) continue;
    if (payload === "[DONE]") {
      sawDone = true;
      continue;
    }
    const event = JSON.parse(payload) as {
      choices?: Array<{
        delta?: {
          content?: string;
          audio?: { data?: string; transcript?: string };
        };
      }>;
    };
    const delta = event.choices?.[0]?.delta;
    replyText += delta?.audio?.transcript ?? delta?.content ?? "";
    if (delta?.audio?.data) {
      audioChunks.push(Buffer.from(delta.audio.data, "base64"));
    }
  }
  invariant(sawDone, "live provider stream ended without [DONE]");
  const byteCount = audioChunks.reduce(
    (count, chunk) => count + chunk.length,
    0,
  );
  const audio = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of audioChunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  return { replyText: replyText.trim(), audio };
}

export function parseLiveConversationResponse(
  body: string,
  headers: Headers,
): {
  replyText: string;
  audio: Uint8Array;
  encoding: string;
  sampleRate: number;
  channels: number;
  provenance: string;
} {
  const contentType = headers.get("Content-Type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = JSON.parse(body) as {
      text?: string;
      audioBase64?: string;
      audioFormat?: string;
      ttsError?: string;
    };
    invariant(
      payload.audioBase64,
      `live provider JSON response had no audio: ${payload.ttsError ?? "missing audio"}`,
    );
    invariant(
      payload.audioFormat?.toLowerCase() ===
        INWORLD_STANDALONE_AUDIO_CONTRACT.encoding,
      `live provider JSON response declared ${payload.audioFormat ?? "no audio format"}`,
    );
    const audio = decodeBase64Audio(payload.audioBase64);
    const observation = validateInworldStandaloneMP3(
      audio,
      INWORLD_STANDALONE_AUDIO_CONTRACT.contentType,
    );
    return {
      replyText: payload.text?.trim() ?? "",
      audio,
      encoding: observation.observedEncoding,
      sampleRate: observation.sampleRate,
      channels: observation.channels,
      provenance: "live-provider-json-compat",
    };
  }

  const parsed = parseProviderSSE(body);
  const declared = {
    encoding: headers.get("X-Koe-Audio-Encoding") ?? "",
    sampleRate: Number(headers.get("X-Koe-Audio-Sample-Rate")),
    channels: Number(headers.get("X-Koe-Audio-Channels")),
  };
  const observation = validateInworldRouterChunk(
    Buffer.from(parsed.audio).toString("base64"),
    declared,
  );
  return {
    ...parsed,
    encoding: observation.observedEncoding,
    sampleRate: observation.sampleRate,
    channels: observation.channels,
    provenance: "live-provider-sse",
  };
}

/**
 * Explicit spend-bearing lane. It is impossible to enter accidentally: the
 * caller must supply both the Worker URL and allowProviderSpend=true.
 */
export async function runLiveQualitySuite(options: {
  repositoryRoot?: string;
  outputDirectory: string;
  workerUrl: string;
  allowProviderSpend: boolean;
  scenarioId?: string;
}): Promise<{
  artifacts: QualityScenarioArtifact[];
  summary: QualitySuiteSummary;
}> {
  invariant(
    options.allowProviderSpend,
    "live quality lane requires --allow-provider-spend",
  );
  const workerUrl = options.workerUrl.replace(/\/+$/, "");
  invariant(
    /^https:\/\//.test(workerUrl),
    "live quality lane requires an HTTPS Worker URL",
  );
  const fixtures = await loadQualityFixtures(options.repositoryRoot);
  await validateFixtureSet(fixtures);
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(join(outputDirectory, "audio"), { recursive: true });
  const assetById = new Map(
    fixtures.spokenManifest.assets.map((asset) => [asset.id, asset]),
  );
  let scenarios = fixtures.manifest.scenarios;
  if (options.scenarioId) {
    scenarios = scenarios.filter(({ id }) => id === options.scenarioId);
    invariant(
      scenarios.length === 1,
      `unknown scenario: ${options.scenarioId}`,
    );
  }
  const artifacts: QualityScenarioArtifact[] = [];

  for (const scenario of scenarios) {
    const history: QualityDialogueTurn[] = [];
    const turns: QualityTurnArtifact[] = [];
    for (let index = 0; index < scenario.turns.length; index += 1) {
      const scenarioTurn = scenario.turns[index]!;
      const contract = scenarioTurn.contracts;
      const asset = assetById.get(scenarioTurn.fixtureId)!;
      const inputPath = join(
        fixtures.repositoryRoot,
        "shared/fixtures/spoken",
        asset.file,
      );
      const inputBytes = await readFile(inputPath);
      const actualInputHash = sha256(inputBytes);
      const traceId = `quality-${scenario.id}-${index + 1}`;
      const traceHeaders = {
        "X-Koe-Session-Id": `quality-${scenario.id}`,
        "X-Koe-Turn-Id": traceId,
        "X-Koe-Response-Run-Id": `${traceId}-run`,
      };
      const providerTrace: ProviderTraceEntry[] = [];
      let transcript = "";
      let replyText = "";
      let replyAudio: ReplyAudio | null = null;
      let feedback: Feedback = {
        translations: {},
        corrections: {
          particles: [],
          register: { consistent: true },
          other: [],
        },
      };
      const lifecycleTrace = ["recorded_audio_validated"];
      const turnHistory = history.map((turn) => ({ ...turn }));

      if (contract.expectedAction === "reply") {
        const sttResponse = await fetch(
          `${workerUrl}/stt/transcribe?lang=ja,en`,
          {
            method: "POST",
            headers: {
              "Content-Type": "audio/mpeg",
              "X-Koe-Audio-Filename": encodeURIComponent(basename(asset.file)),
              "X-Koe-Audio-Sample-Rate": String(asset.sampleRate),
              "X-Koe-Audio-Channels": String(asset.channels),
              "X-Koe-Audio-Duration-Ms": String(asset.durationMs),
              ...traceHeaders,
            },
            body: inputBytes,
          },
        );
        const sttBody = await sttResponse.text();
        if (!sttResponse.ok)
          throw providerError("live STT", sttResponse, sttBody);
        transcript =
          (JSON.parse(sttBody) as { text?: string }).text?.trim() ?? "";
        providerTrace.push({
          stage: "transcription",
          provider: "Soniox",
          model: "stt-async-v5",
          status: sttResponse.status,
          mode: "live-provider",
          requestId: `${traceId}:stt`,
        });
        lifecycleTrace.push(
          "stt_final",
          "understanding",
          "provider_request_started",
        );

        const chatResponse = await fetch(`${workerUrl}/llm/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...traceHeaders },
          body: JSON.stringify({
            system: tutorSystemPrompt(),
            messages: [...turnHistory, { role: "user", content: transcript }],
            model: "auto",
            maxTokens: 300,
            stream: true,
          }),
        });
        const chatBody = await chatResponse.text();
        if (!chatResponse.ok)
          throw providerError("live conversation", chatResponse, chatBody);
        const parsed = parseLiveConversationResponse(
          chatBody,
          chatResponse.headers,
        );
        replyText = parsed.replyText;
        const audioExtension =
          parsed.encoding === INWORLD_STANDALONE_AUDIO_CONTRACT.encoding
            ? "mp3"
            : "pcm";
        const relativeAudioPath = join(
          "audio",
          `${scenario.id}-${index + 1}.${audioExtension}`,
        );
        const audioPath = join(outputDirectory, relativeAudioPath);
        await writeFile(audioPath, parsed.audio);
        replyAudio = {
          path: relativeAudioPath,
          sha256: sha256(parsed.audio),
          encoding: parsed.encoding,
          sampleRate: parsed.sampleRate,
          channels: parsed.channels,
          byteCount: parsed.audio.byteLength,
          provenance: parsed.provenance,
        };
        providerTrace.push({
          stage: "conversation",
          provider: "Inworld Router",
          model: "auto",
          status: chatResponse.status,
          mode: "live-provider",
          requestId:
            chatResponse.headers.get("X-Koe-Provider-Request-Id") ??
            `${traceId}:conversation`,
        });
        lifecycleTrace.push("provider_response", "speaking");

        const feedbackResponse = await fetch(`${workerUrl}/llm/flash`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...traceHeaders },
          body: JSON.stringify({
            task: "feedback",
            history: turnHistory,
            userTurn: transcript,
            tutorReply: replyText,
          }),
        });
        const feedbackBody = await feedbackResponse.text();
        if (!feedbackResponse.ok)
          throw providerError("live feedback", feedbackResponse, feedbackBody);
        feedback = JSON.parse(feedbackBody) as Feedback;
        providerTrace.push({
          stage: "feedback",
          provider: "Gemini",
          model: "gemini-3.1-flash-lite-preview",
          status: feedbackResponse.status,
          mode: "live-provider",
          requestId: `${traceId}:feedback`,
        });
        lifecycleTrace.push("feedback", "resuming");
      } else {
        lifecycleTrace.push("no_speech", "resuming", "listening");
      }

      const evaluationInput = qualityEvaluationInput({
        scenario,
        contract,
        history: turnHistory,
        transcript,
        replyText,
        feedback,
      });
      const prompts = retainedPrompts(evaluationInput);
      const qualityResponse = await fetch(`${workerUrl}/llm/quality`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...traceHeaders },
        body: JSON.stringify(evaluationInput),
      });
      const qualityBody = await qualityResponse.text();
      if (!qualityResponse.ok)
        throw providerError("live quality grade", qualityResponse, qualityBody);
      const quality = JSON.parse(qualityBody) as {
        evaluator: {
          id: string;
          model: string;
          promptVersion: string;
          promptSha256: string;
          providerRequestId: string;
        };
        verdict: {
          scores: Record<string, number>;
          criticalViolations: string[];
          evidence: string;
          pass: boolean;
        };
      };
      const checks = deterministicChecks({
        scenario,
        contract,
        asset,
        actualInputHash,
        transcript,
        history: turnHistory,
        replyText,
        replyAudio,
        feedback,
        providerTrace,
        lifecycleTrace,
        prompts,
      });
      const deterministicPass = checks.every((check) => check.pass);
      const modelGradePass =
        quality.evaluator.id === QUALITY_EVALUATOR_ID &&
        quality.evaluator.promptVersion === QUALITY_EVALUATOR_PROMPT_VERSION &&
        quality.evaluator.promptSha256 === prompts.evaluator.sha256 &&
        quality.verdict.pass &&
        quality.verdict.criticalViolations.length === 0 &&
        validateModelScores(quality.verdict.scores);
      turns.push({
        turn: index + 1,
        fixtureId: asset.id,
        inputAudio: {
          path: join("shared/fixtures/spoken", asset.file),
          sha256: asset.sha256,
          encoding: asset.encoding,
          sampleRate: asset.sampleRate,
          channels: asset.channels,
          durationMs: asset.durationMs,
          byteCount: asset.byteCount,
        },
        transcript,
        history: turnHistory,
        prompts,
        providerTrace,
        replyText,
        replyAudio,
        feedback,
        lifecycleTrace,
        deterministicChecks: checks,
        modelGrade: {
          evaluator: {
            ...quality.evaluator,
            modelVersion: quality.evaluator.model,
          },
          ...quality.verdict,
          pass: modelGradePass,
        },
        verdict: {
          deterministicPass,
          modelGradePass,
          pass: deterministicPass && modelGradePass,
        },
      });
      if (transcript) history.push({ role: "user", content: transcript });
      if (replyText) history.push({ role: "assistant", content: replyText });
    }
    const failedTurnNumbers = turns
      .filter((turn) => !turn.verdict.pass)
      .map((turn) => turn.turn);
    artifacts.push({
      schemaVersion: CONVERSATION_QUALITY_SCHEMA_VERSION,
      suiteVersion: CONVERSATION_QUALITY_SUITE_VERSION,
      lane: "live",
      scenarioId: scenario.id,
      description: scenario.description,
      coverage: scenario.coverage,
      fixtureSources: [
        `${FIXTURE_ROOT}/scenarios.json`,
        SPOKEN_MANIFEST,
        ...turns.map((turn) => turn.inputAudio.path),
      ],
      reproduction: `npm run test:quality:live -- --allow-provider-spend --scenario ${scenario.id}`,
      turns,
      verdict: { pass: failedTurnNumbers.length === 0, failedTurnNumbers },
    });
  }
  const summary = await writeQualityArtifacts(outputDirectory, artifacts);
  return { artifacts, summary };
}

export const qualityFixturePaths = {
  scenarios: join(FIXTURE_ROOT, "scenarios.json"),
  recordedResults: join(FIXTURE_ROOT, "recorded-provider-results.json"),
  spokenManifest: SPOKEN_MANIFEST,
};
