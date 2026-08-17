# Conversation and tutoring quality regression corpus

This corpus verifies that Koe understands a spoken turn, answers naturally,
and uses tutoring judgment without converting ordinary conversation into a
lesson. `scenarios.json` defines eight short and multi-turn flows backed by the
versioned spoken MP3 corpus. `recorded-provider-results.json` stores approved
golden provider-shaped outputs and recorded model grades for cheap, offline
replay.

The recorded lane expands one self-contained JSON artifact per scenario. Each
turn retains the input audio path and SHA-256, transcript, complete tutor,
feedback, and evaluator prompts with versions and hashes, provider trace, reply
text and audio reference, feedback, lifecycle trace, deterministic checks,
model-grade metadata, and final verdict. Failed artifacts include the exact
scenario command needed to replay them from the checked-in sources.

Run the required zero-network gate with:

```sh
npm run test:quality
npm run test:quality:recorded
```

The second command writes expanded artifacts to
`.artifacts/conversation-quality/recorded`. `npm run test:prompts` also runs
the quality contracts, and `npm run test:acceptance` makes that combined prompt
and quality gate mandatory for later acceptance work.

The live lane is deliberately impossible to enter by accident. It replays the
actual MP3 bytes through the Worker STT route, streams conversation text and
PCM reply audio, requests quiet feedback, and calls the versioned quality
grader. It requires an uncommitted HTTPS Worker URL and an explicit spend flag:

```sh
KOE_QUALITY_WORKER_URL=https://your-koe-worker.example \
  npm run test:quality:live -- --allow-provider-spend
```

Use `--scenario <id>` to limit either lane and `--output <directory>` to choose
an artifact directory. Live output includes the exact PCM bytes returned for
each reply. Never refresh the recorded results merely to make a regression
green: inspect the saved failing artifact, decide whether the prompt or output
is correct, bump the affected prompt/suite version, and review the replacement
golden result and model grade together.
