import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { KOE_V1_PRODUCT_CONTRACT } from "./v1";

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
    voice: "ja-female-1",
    correctionStyle: "essential",
  });
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
