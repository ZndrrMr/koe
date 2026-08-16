# Spoken conversation fixture corpus

`manifest.json` is the source of truth for the versioned audio in `audio/`.
It records each file's authored source text, language, intended behavior,
voice/provider/model provenance, generation timestamp, media properties, hash,
usage scope, expected transcript/intent, and explicit decode/ingestion/tutor
assertions. `conversationScripts` maps ordinary fixtures into ordered multi-turn
runs; the remaining assets are isolated acoustic and failure cases.

Run `npm run test:spoken-fixtures` to hash and fully decode every valid MP3 and
to prove the deliberately malformed assets fail decoding. Validation is local
and makes no network requests, so normal tests never consume provider credits.

Regeneration is intentionally separate and guarded. It requires the uncommitted
`KOE_FIXTURE_WORKER_URL`, `--allow-provider-spend`, and (after the first
published version) `--force`. The generator sends only the authored phrases in
`recipes.json`; it never reads a microphone recording or user data. Controlled
quiet, fast, pause, noise, clipping, truncation, silence, and malformed variants
are produced locally from the checked provider output.
