import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = join(repositoryRoot, "shared/fixtures/spoken");
const manifest = JSON.parse(
  await readFile(join(corpusRoot, "manifest.json"), "utf8"),
);
const requiredAssetFields = [
  "id",
  "file",
  "sourceText",
  "language",
  "categories",
  "intendedBehavior",
  "voiceId",
  "provider",
  "model",
  "generationDate",
  "encoding",
  "sampleRate",
  "channels",
  "durationMs",
  "byteCount",
  "sha256",
  "licenseUsageScope",
  "expectedTranscript",
  "expectedIntent",
  "assertions",
  "provenance",
];

assert(manifest.schemaVersion === 1, "unsupported manifest schema");
assert(manifest.corpusVersion, "corpus version is required");
assert(
  manifest.generationPolicy?.ordinaryValidationUsesNetwork === false,
  "ordinary validation must be network-free",
);
assert(
  Array.isArray(manifest.assets) && manifest.assets.length >= 20,
  "corpus must contain at least 20 assets",
);
assert(
  Array.isArray(manifest.conversationScripts) &&
    manifest.conversationScripts.length >= 2,
  "corpus must contain multiple multi-turn scripts",
);

const ids = new Set();
const files = new Set();
const coveredCategories = new Set();
for (const asset of manifest.assets) {
  for (const field of requiredAssetFields) {
    assert(
      Object.hasOwn(asset, field),
      `${asset.id ?? "unknown"} is missing ${field}`,
    );
  }
  assert(!ids.has(asset.id), `duplicate fixture id: ${asset.id}`);
  assert(!files.has(asset.file), `duplicate fixture file: ${asset.file}`);
  ids.add(asset.id);
  files.add(asset.file);
  for (const category of asset.categories) coveredCategories.add(category);
  assert(
    asset.licenseUsageScope === manifest.licenseUsageScope,
    `${asset.id} has inconsistent usage scope`,
  );
  assert(
    !/(authorization\s*[:=]|basic\s+[a-z0-9+/=]{16,}|bearer\s+[a-z0-9._-]{16,})/i.test(
      JSON.stringify(asset),
    ),
    `${asset.id} appears to contain a credential`,
  );

  const path = join(corpusRoot, asset.file);
  const details = await stat(path);
  const bytes = await readFile(path);
  assert(details.isFile(), `${asset.file} is not a file`);
  assert(
    bytes.byteLength === asset.byteCount,
    `${asset.file} byte count changed`,
  );
  assert(
    createHash("sha256").update(bytes).digest("hex") === asset.sha256,
    `${asset.file} hash changed`,
  );

  const decode = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", path, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  if (asset.assertions.decode === "pass") {
    assert(
      decode.status === 0,
      `${asset.file} failed full decode: ${decode.stderr.slice(-240)}`,
    );
    const media = probe(path);
    assert(
      media?.encoding === asset.encoding,
      `${asset.file} encoding changed`,
    );
    assert(
      media?.sampleRate === asset.sampleRate,
      `${asset.file} sample rate changed`,
    );
    assert(
      media?.channels === asset.channels,
      `${asset.file} channel count changed`,
    );
    assert(
      Math.abs(media.durationMs - asset.durationMs) <= 1,
      `${asset.file} duration changed`,
    );
  } else if (asset.assertions.decode === "fail") {
    assert(
      decode.status !== 0,
      `${asset.file} is expected to be malformed but decoded`,
    );
    assert(
      asset.encoding === "undecodable",
      `${asset.file} must record undecodable encoding`,
    );
  } else {
    throw new Error(`${asset.id} has an unknown decode assertion`);
  }
}

for (const category of manifest.requiredCoverage) {
  assert(
    coveredCategories.has(category),
    `missing required coverage: ${category}`,
  );
}

for (const script of manifest.conversationScripts) {
  assert(script.turnFixtureIds.length >= 3, `${script.id} is not multi-turn`);
  for (const id of script.turnFixtureIds) {
    assert(ids.has(id), `${script.id} references missing fixture ${id}`);
  }
  assert(
    script.assertions.length > 0,
    `${script.id} is missing pass/fail assertions`,
  );
}

const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const short = assetById.get("natural-short-ja");
const quiet = assetById.get("acoustic-quiet");
const fastSource = assetById.get("numbers-names-counters");
const fast = assetById.get("acoustic-fast");
const pauseSource = assetById.get("hesitation-self-correction");
const paused = assetById.get("acoustic-long-pauses");
const clipped = assetById.get("failure-clipped");
const silence = assetById.get("failure-silence");
const truncated = assetById.get("failure-truncated-utterance");

const shortVolume = volumeStats(join(corpusRoot, short.file));
const quietVolume = volumeStats(join(corpusRoot, quiet.file));
assert(
  quietVolume.meanDb <= shortVolume.meanDb - 20,
  "quiet fixture is not at least 20 dB below its source",
);
assert(
  fast.durationMs <= fastSource.durationMs * 0.65,
  "fast fixture is not sufficiently time-compressed",
);
assert(
  paused.durationMs >= pauseSource.durationMs + 5_400,
  "long-pause fixture does not add the controlled silence budget",
);
const clippedVolume = volumeStats(join(corpusRoot, clipped.file));
assert(
  clippedVolume.maxDb >= -0.1 && clippedVolume.meanDb >= -4,
  "clipped fixture does not retain the intended hard-clipped level",
);
const silenceVolume = volumeStats(join(corpusRoot, silence.file));
assert(silenceVolume.maxDb <= -80, "silence fixture contains audible signal");
assert(
  truncated.durationMs === 750,
  "valid truncated utterance must remain exactly 750 ms",
);

const audioFiles = (await readdir(join(corpusRoot, "audio")))
  .map((file) => `audio/${file}`)
  .sort();
assert(
  JSON.stringify(audioFiles) === JSON.stringify([...files].sort()),
  "audio directory and manifest do not contain the same files",
);

process.stdout.write(
  `validated ${manifest.assets.length} local spoken fixtures, ${coveredCategories.size} coverage categories, and ${manifest.conversationScripts.length} multi-turn scripts without network access\n`,
);

function probe(path) {
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
  if (!stream || !Number.isFinite(duration)) return null;
  return {
    encoding: stream.codec_name,
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    durationMs: Math.round(duration * 1000),
  };
}

function volumeStats(path) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  assert(result.status === 0, `${path} could not be measured`);
  const mean = /mean_volume:\s*(-?[0-9.]+) dB/.exec(result.stderr);
  const max = /max_volume:\s*(-?[0-9.]+) dB/.exec(result.stderr);
  assert(mean && max, `${path} has no volume statistics`);
  return { meanDb: Number(mean[1]), maxDb: Number(max[1]) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
