import { resolve } from "node:path";

import {
  runLiveQualitySuite,
  runRecordedQualitySuite,
} from "../src/quality/regressionSuite";

type Options = {
  lane: "recorded" | "live";
  allowProviderSpend: boolean;
  workerUrl?: string;
  outputDirectory?: string;
  scenarioId?: string;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    lane: "recorded",
    allowProviderSpend: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--allow-provider-spend") {
      options.allowProviderSpend = true;
      continue;
    }
    const value = argv[index + 1];
    if (argument === "--lane" && (value === "recorded" || value === "live")) {
      options.lane = value;
      index += 1;
    } else if (argument === "--worker-url" && value) {
      options.workerUrl = value;
      index += 1;
    } else if (argument === "--output" && value) {
      options.outputDirectory = value;
      index += 1;
    } else if (argument === "--scenario" && value) {
      options.scenarioId = value;
      index += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const outputDirectory = resolve(
    options.outputDirectory ??
      `.artifacts/conversation-quality/${options.lane}`,
  );
  const result =
    options.lane === "live"
      ? await runLiveQualitySuite({
          outputDirectory,
          workerUrl:
            options.workerUrl ?? process.env.KOE_QUALITY_WORKER_URL ?? "",
          allowProviderSpend: options.allowProviderSpend,
          scenarioId: options.scenarioId,
        })
      : await runRecordedQualitySuite({
          outputDirectory,
          scenarioId: options.scenarioId,
        });

  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  if (!result.summary.pass) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
