import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { KOE_V1_PRODUCT_CONTRACT } from "./v1";
import { KOE_V1_VOICE_ID } from "../../shared/inworld";

const appDirectory = path.resolve(process.cwd(), "app");

async function productionRouteFiles(
  directory = appDirectory,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const routes = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return productionRouteFiles(absolute);
      if (!entry.name.endsWith(".tsx") || entry.name.startsWith("_layout")) {
        return [];
      }
      return [path.relative(appDirectory, absolute)];
    }),
  );
  return routes.flat().sort();
}

test("Release exposes only the three V1 route files", async () => {
  assert.deepEqual(
    await productionRouteFiles(),
    [...KOE_V1_PRODUCT_CONTRACT.routeFiles].sort(),
  );
});

test("the root navigator registers only the V1 stack", async () => {
  const layout = await readFile(path.join(appDirectory, "_layout.tsx"), "utf8");
  const registered = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(
    registered,
    [...KOE_V1_PRODUCT_CONTRACT.stackScreens].sort(),
  );
});

test("V1 has one default conversation and no setup choices", () => {
  assert.deepEqual(KOE_V1_PRODUCT_CONTRACT.setupChoices, []);
  assert.deepEqual(KOE_V1_PRODUCT_CONTRACT.lifecycle, [
    "open",
    "start",
    "converse-hands-free",
    "hear-koe",
    "receive-optional-compact-correction",
    "continue",
    "end",
  ]);
  assert.deepEqual(KOE_V1_PRODUCT_CONTRACT.conversation, {
    provider: "inworld",
    voice: KOE_V1_VOICE_ID,
    feedback: "essential-only",
  });
});

test("production seams expose no hidden conversation preferences", async () => {
  const sources = await Promise.all(
    [
      "app/_layout.tsx",
      "app/index.tsx",
      "app/session/[id].tsx",
      "src/services/llm.ts",
      "src/services/tts.ts",
      "worker/src/index.ts",
    ].map(async (relativePath) => ({
      relativePath,
      source: await readFile(path.resolve(process.cwd(), relativePath), "utf8"),
    })),
  );

  for (const { relativePath, source } of sources) {
    assert.doesNotMatch(source, /useSettings|\/preferences/iu, relativePath);
  }

  const llm = sources.find(({ relativePath }) =>
    relativePath.endsWith("services/llm.ts"),
  )?.source;
  const tts = sources.find(({ relativePath }) =>
    relativePath.endsWith("services/tts.ts"),
  )?.source;
  const worker = sources.find(({ relativePath }) =>
    relativePath.endsWith("worker/src/index.ts"),
  )?.source;

  assert.ok(llm && tts && worker);
  assert.doesNotMatch(llm, /correctionStyle|responseLevel|KoeVoice/);
  assert.doesNotMatch(tts, /TTSVoice|ja-female-2|ja-male-1/);
  assert.doesNotMatch(
    worker,
    /correctionStyle|responseLevel|ja-female-2|ja-male-1|Ashley|Satoshi/,
  );
});

test("home has no alternate product entry points or setup prompts", async () => {
  const home = await readFile(path.join(appDirectory, "index.tsx"), "utf8");
  const forbidden = [
    "lesson",
    "scenario",
    "persona",
    "register",
    "goal",
    "drill",
    "proof mode",
    "-proof",
    "/preferences",
  ];

  for (const term of forbidden) {
    assert.doesNotMatch(home, new RegExp(term, "i"));
  }
});
