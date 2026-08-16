import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = join(repositoryRoot, "shared/fixtures/spoken");
const recipePath = join(corpusRoot, "recipes.json");
const manifestPath = join(corpusRoot, "manifest.json");
const argumentsSet = new Set(process.argv.slice(2));
const allowProviderSpend = argumentsSet.has("--allow-provider-spend");
const force = argumentsSet.has("--force");
const workerUrl = (process.env.KOE_FIXTURE_WORKER_URL ?? "").replace(
  /\/+$/,
  "",
);

if (!allowProviderSpend) {
  throw new Error(
    "Refusing to synthesize: pass --allow-provider-spend to acknowledge one-time provider usage. Ordinary tests never run this command.",
  );
}
if (!workerUrl || !/^https:\/\//.test(workerUrl)) {
  throw new Error(
    "Set KOE_FIXTURE_WORKER_URL to Koe's deployed HTTPS Worker URL. The URL is intentionally not committed.",
  );
}

const recipe = JSON.parse(await readFile(recipePath, "utf8"));
const generatedAt = new Date().toISOString();
const audioDirectory = join(corpusRoot, "audio");
await mkdir(audioDirectory, { recursive: true });

if (!force) {
  const existing = await stat(manifestPath).catch(() => undefined);
  if (existing) {
    throw new Error(
      "The spoken corpus is already versioned. Pass --force only when intentionally publishing a new corpus version.",
    );
  }
} else {
  await rm(audioDirectory, { recursive: true, force: true });
  await mkdir(audioDirectory, { recursive: true });
}

requireTool("ffmpeg");
requireTool("ffprobe");
const ffmpegVersion = toolVersion("ffmpeg");
const assets = [];
const assetsById = new Map();

for (const fixture of recipe.baseFixtures) {
  const destination = join(corpusRoot, fixture.file);
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(`${workerUrl}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": `koe-spoken-corpus-${recipe.corpusVersion}`,
      "X-Koe-Session-Id": `fixture-${fixture.id}`,
      "X-Koe-Turn-Id": fixture.id,
      "X-Koe-Response-Run-Id": generatedAt,
    },
    body: JSON.stringify({ text: fixture.sourceText, speed: 1 }),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 240);
    throw new Error(
      `Koe /tts failed for ${fixture.id}: ${response.status} ${body}`,
    );
  }
  const responseContractHeaders = assertProviderHeaders(
    response,
    recipe.voiceId,
    fixture.id,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  const media = inspectDecodableMP3(destination);
  const asset = await spokenAsset({
    fixture,
    recipe,
    generatedAt,
    destination,
    media,
    provenance: {
      kind: "project-configured-inworld-route",
      route: "koe-worker:/tts",
      providerRequestId:
        response.headers.get("X-Koe-Provider-Request-Id") ?? "unavailable",
      providerDurationMs: numberOrNull(response.headers.get("X-Duration-Ms")),
      responseContractHeaders,
    },
  });
  assets.push(asset);
  assetsById.set(asset.id, asset);
  process.stdout.write(`generated ${fixture.id}\n`);
}

for (const fixture of recipe.derivedFixtures) {
  const destination = join(corpusRoot, fixture.file);
  await mkdir(dirname(destination), { recursive: true });
  const sourceAsset = fixture.from ? assetsById.get(fixture.from) : undefined;
  const sourcePath = sourceAsset
    ? join(corpusRoot, sourceAsset.file)
    : undefined;
  const transform = await createDerivedFixture(
    fixture,
    sourcePath,
    destination,
  );
  const decodeExpectation = transform.decodeExpectation;
  const media =
    decodeExpectation === "pass"
      ? inspectDecodableMP3(destination)
      : inspectExpectedDecodeFailure(destination);
  const sourceRecipe = fixture.from
    ? recipe.baseFixtures.find((candidate) => candidate.id === fixture.from)
    : undefined;
  const sourceText = sourceRecipe?.sourceText ?? "";
  const language = sourceRecipe?.language ?? "und";
  const expectedTranscript = sourceRecipe?.expectedTranscript ?? "";
  const details = await fileDetails(destination);
  const asset = {
    id: fixture.id,
    file: fixture.file,
    scenario: "isolated-edge-case",
    sourceText,
    language,
    categories: fixture.categories,
    intendedBehavior: fixture.intendedBehavior,
    voiceId: sourceAsset ? recipe.voiceId : "none",
    provider: sourceAsset
      ? "Local transform of Inworld fixture"
      : "Local synthetic fixture",
    model: `ffmpeg/${ffmpegVersion}`,
    generationDate: generatedAt,
    encoding: media?.encoding ?? "undecodable",
    sampleRate: media?.sampleRate ?? null,
    channels: media?.channels ?? null,
    durationMs: media?.durationMs ?? null,
    byteCount: details.byteCount,
    sha256: details.sha256,
    licenseUsageScope: recipe.licenseUsageScope,
    expectedTranscript,
    expectedIntent: fixture.expectedIntent,
    assertions: assertionsForDerived(
      fixture,
      decodeExpectation,
      expectedTranscript,
    ),
    provenance: {
      kind: "local-controlled-variant",
      tool: `ffmpeg/${ffmpegVersion}`,
      transform: transform.description,
      inputFile: sourceAsset?.file ?? null,
      inputSha256: sourceAsset?.sha256 ?? null,
      upstreamProvider: sourceAsset ? recipe.provider : null,
      upstreamModel: sourceAsset ? recipe.model : null,
      upstreamVoiceId: sourceAsset ? recipe.voiceId : null,
    },
  };
  assets.push(asset);
  assetsById.set(asset.id, asset);
  process.stdout.write(`derived ${fixture.id}\n`);
}

const manifest = {
  schemaVersion: recipe.schemaVersion,
  corpusVersion: recipe.corpusVersion,
  generatedAt,
  privacy:
    "All source phrases were authored for this test corpus. No private user recording or user transcript was sent to Inworld.",
  providerContract: {
    route: "koe-worker:/tts",
    provider: recipe.provider,
    model: recipe.model,
    voiceId: recipe.voiceId,
    encoding: "mp3",
    sampleRate: 24000,
    channels: 1,
  },
  generationPolicy: {
    providerSpendGuard: "--allow-provider-spend",
    ordinaryValidationUsesNetwork: false,
    regenerationRequiresForce: true,
  },
  licenseUsageScope: recipe.licenseUsageScope,
  requiredCoverage: recipe.requiredCoverage,
  conversationScripts: recipe.conversationScripts,
  assets,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `wrote ${relative(repositoryRoot, manifestPath)} with ${assets.length} assets\n`,
);

function assertProviderHeaders(response, voiceId, fixtureId) {
  const expected = {
    "content-type": "audio/mpeg",
    "x-koe-audio-encoding": "mp3",
    "x-koe-audio-sample-rate": "24000",
    "x-koe-audio-channels": "1",
    "x-koe-voice-id": voiceId,
  };
  for (const [header, value] of Object.entries(expected)) {
    const observed = response.headers.get(header);
    if (header !== "content-type" && observed === null) continue;
    if (
      header === "content-type"
        ? !observed?.toLowerCase().startsWith(value)
        : observed !== value
    ) {
      throw new Error(
        `${fixtureId}: expected ${header}=${value}, received ${observed ?? "missing"}`,
      );
    }
  }
  return Object.fromEntries(
    Object.keys(expected).map((header) => [
      header,
      response.headers.get(header) ?? "missing-on-deployed-route",
    ]),
  );
}

async function spokenAsset({
  fixture,
  recipe,
  generatedAt,
  destination,
  media,
  provenance,
}) {
  const details = await fileDetails(destination);
  return {
    id: fixture.id,
    file: fixture.file,
    scenario: "spoken-input",
    sourceText: fixture.sourceText,
    language: fixture.language,
    categories: fixture.categories,
    intendedBehavior: fixture.intendedBehavior,
    voiceId: recipe.voiceId,
    provider: recipe.provider,
    model: recipe.model,
    generationDate: generatedAt,
    encoding: media.encoding,
    sampleRate: media.sampleRate,
    channels: media.channels,
    durationMs: media.durationMs,
    byteCount: details.byteCount,
    sha256: details.sha256,
    licenseUsageScope: recipe.licenseUsageScope,
    expectedTranscript: fixture.expectedTranscript,
    expectedIntent: fixture.expectedIntent,
    assertions: {
      decode: "pass",
      ingestion: "pass",
      transcript: {
        mode: "equivalent",
        expected: fixture.expectedTranscript,
        ignorePunctuationAndWhitespace: true,
        maxNormalizedEditDistance: 0.12,
      },
      tutor: fixture.tutorAssertions,
    },
    provenance,
  };
}

function assertionsForDerived(fixture, decodeExpectation, expectedTranscript) {
  const rejectionKind =
    fixture.kind === "malformed-bytes"
      ? "decode-failed"
      : fixture.kind === "truncated-frame"
        ? "truncated-audio"
        : fixture.kind === "silence"
          ? "silence"
          : null;
  const ingestion = rejectionKind
    ? "fail-recoverably"
    : "pass-or-recoverably-fail";
  const transcriptMode =
    fixture.kind === "truncated-utterance"
      ? "nonempty-prefix-or-recoverable-silence"
      : rejectionKind
        ? "none"
        : "equivalent-with-acoustic-tolerance";
  return {
    decode: decodeExpectation,
    ingestion,
    expectedFailureKind: rejectionKind,
    transcript: {
      mode: transcriptMode,
      expected: rejectionKind ? "" : expectedTranscript,
      ignorePunctuationAndWhitespace: true,
      maxNormalizedEditDistance: rejectionKind ? null : 0.3,
    },
    tutor: fixture.tutorAssertions,
  };
}

async function createDerivedFixture(fixture, sourcePath, destination) {
  const commonOutput = [
    "-ar",
    "24000",
    "-ac",
    "1",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    destination,
  ];
  switch (fixture.kind) {
    case "quiet":
      requireSource(sourcePath, fixture.id);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-af",
        "volume=0.035",
        ...commonOutput,
      ]);
      return { decodeExpectation: "pass", description: "volume=0.035" };
    case "fast":
      requireSource(sourcePath, fixture.id);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-af",
        "atempo=1.65",
        ...commonOutput,
      ]);
      return { decodeExpectation: "pass", description: "atempo=1.65" };
    case "long-pauses":
      requireSource(sourcePath, fixture.id);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-af",
        "adelay=2500,apad=pad_dur=3",
        ...commonOutput,
      ]);
      return {
        decodeExpectation: "pass",
        description: "2.5s leading silence and 3s trailing silence",
      };
    case "noise":
      requireSource(sourcePath, fixture.id);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-filter_complex",
        "[0:a]volume=0.9[speech];anoisesrc=color=pink:amplitude=0.045:sample_rate=24000:seed=904[noise];[speech][noise]amix=inputs=2:duration=first:normalize=0[out]",
        "-map",
        "[out]",
        ...commonOutput,
      ]);
      return {
        decodeExpectation: "pass",
        description: "deterministic-amplitude pink noise mixed at 0.045",
      };
    case "clipped":
      requireSource(sourcePath, fixture.id);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-af",
        "volume=20dB,asoftclip=type=hard:threshold=0.25:output=4",
        ...commonOutput,
      ]);
      return {
        decodeExpectation: "pass",
        description: "20dB gain into hard clip at threshold 0.25",
      };
    case "truncated-utterance":
      requireSource(sourcePath, fixture.id);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-t",
        "0.75",
        ...commonOutput,
      ]);
      return {
        decodeExpectation: "pass",
        description: "decoded speech re-encoded after a 0.75s cutoff",
      };
    case "silence":
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=24000:cl=mono",
        "-t",
        "2.5",
        ...commonOutput,
      ]);
      return {
        decodeExpectation: "pass",
        description: "2.5s generated digital silence",
      };
    case "malformed-bytes":
      await writeFile(
        destination,
        Buffer.from("KOE_INTENTIONALLY_NOT_AUDIO\n"),
      );
      return {
        decodeExpectation: "fail",
        description: "non-audio sentinel bytes with an MP3 extension",
      };
    case "truncated-frame": {
      requireSource(sourcePath, fixture.id);
      const sourceBytes = await readFile(sourcePath);
      await writeFile(destination, sourceBytes.subarray(0, 96));
      return {
        decodeExpectation: "fail",
        description: "source MP3 truncated to its first 96 bytes",
      };
    }
    default:
      throw new Error(`Unknown derived fixture kind: ${fixture.kind}`);
  }
}

function inspectDecodableMP3(path) {
  const probe = probeAudio(path);
  if (!probe) throw new Error(`${basename(path)} did not decode as audio`);
  if (probe.encoding !== "mp3") {
    throw new Error(`${basename(path)} decoded as ${probe.encoding}, not mp3`);
  }
  if (probe.sampleRate !== 24000 || probe.channels !== 1) {
    throw new Error(
      `${basename(path)} was ${probe.sampleRate}Hz/${probe.channels}ch; expected 24000Hz/1ch`,
    );
  }
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path,
    "-f",
    "null",
    "-",
  ]);
  return probe;
}

function inspectExpectedDecodeFailure(path) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path,
    "-f",
    "null",
    "-",
  ]);
  if (result.status === 0) {
    throw new Error(`${basename(path)} unexpectedly decoded successfully`);
  }
  return null;
}

function probeAudio(path) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels:format=duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  const payload = JSON.parse(result.stdout);
  const stream = payload.streams?.[0];
  const duration = Number(payload.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) return null;
  return {
    encoding: stream.codec_name,
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    durationMs: Math.round(duration * 1000),
  };
}

async function fileDetails(path) {
  const bytes = await readFile(path);
  return {
    byteCount: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function numberOrNull(value) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireSource(sourcePath, fixtureId) {
  if (!sourcePath)
    throw new Error(`${fixtureId} is missing its source fixture`);
}

function requireTool(command) {
  const result = spawnSync(command, ["-version"], { stdio: "ignore" });
  if (result.status !== 0) throw new Error(`${command} is required`);
}

function toolVersion(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} is required`);
  return result.stdout.split("\n")[0].split(" ")[2] ?? "unknown";
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${(result.stderr || result.stdout).slice(-800)}`,
    );
  }
}
