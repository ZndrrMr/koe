import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  APP_STORE_COPY,
  CREATOR_LOOP,
  LAUNCH_COPY,
  MARKETING_CAPTURE,
  MARKETING_FRAMES,
  PRODUCT_PAGE_THESIS,
  PRODUCT_PAGE_VARIANTS,
} from "../src/marketing/launchSystem";

async function artifact(relativePath: string) {
  const bytes = await readFile(relativePath);
  const metadata = await stat(relativePath);
  return {
    path: relativePath,
    bytes: metadata.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const expectedArtifacts = [
  MARKETING_CAPTURE.generated.icon,
  ...MARKETING_CAPTURE.generated.screenshots,
  MARKETING_CAPTURE.generated.preview,
  MARKETING_CAPTURE.generated.contactSheet,
  MARKETING_CAPTURE.generated.landingProof,
];

async function main() {
  const manifest = {
    thesis: PRODUCT_PAGE_THESIS,
    appStore: APP_STORE_COPY,
    launchCopy: LAUNCH_COPY,
    capture: MARKETING_CAPTURE,
    story: MARKETING_FRAMES,
    variants: PRODUCT_PAGE_VARIANTS,
    creatorLoop: CREATOR_LOOP,
    artifacts: await Promise.all(expectedArtifacts.map(artifact)),
  };

  const outputPath = path.join("marketing", "launch-kit.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Wrote ${outputPath} with ${manifest.artifacts.length} verified artifacts.`,
  );
}

void main();
