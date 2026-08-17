# Koe 声

Koe is a voice-first Japanese conversation partner. Speak in Japanese or English, hear a natural response, and get pronunciation or correction feedback without entering a lesson, choosing a scenario, or managing a course.

The client is React Native with Expo Router and TypeScript. Conversation runs through a Cloudflare Worker that keeps provider credentials off-device and connects Inworld TTS, Soniox STT, and Gemini conversation feedback. Local SQLite persistence restores interrupted conversations and retains the audio, pronunciation alignment, retry lineage, and learning moments the voice loop actively uses.

## Quickstart

```bash
npm install
cp .env.example .env.local
npm run ios
```

Set `EXPO_PUBLIC_WORKER_URL` in `.env.local` to the deployed Worker URL. This app uses native audio, storage, and speech-recognition modules, so use a development build rather than Expo Go.

To run the Worker locally:

```bash
cd worker
npm install
npx wrangler dev
```

The Worker expects `INWORLD_API_KEY`, `SONIOX_API_KEY`, and `GEMINI_API_KEY` secrets plus the rate-limit/model variables in `worker/wrangler.toml`.

## Voice and audio contract

Koe V1 uses one Inworld voice everywhere: `Asuka`. Router voice responses are
validated as raw signed 16-bit little-endian PCM, 48,000 Hz, mono. Standalone
Inworld TTS is requested and validated as MP3, 24,000 Hz, mono. The canonical
values live in `shared/inworld.ts`; app and Worker tests import the same values
so a voice, encoding, sample-rate, or channel disagreement fails the build.
Streaming PCM chunks are converted to native audio buffers and fed to one
gapless queue; the completed stream is saved as one WAV only after every chunk
has arrived. The app also understands the deployed Worker's older JSON reply
shape by validating and directly playing its 24 kHz mono MP3. A text-only
reply deliberately uses standalone `Asuka` TTS, and a missing or malformed
fallback remains a recoverable error rather than a silent successful turn.

Every voice turn also carries `sessionId`, `turnId`, and `responseRunId` from
the app to the Worker. Structured logs record lifecycle and failure categories,
provider status/request ID, SSE event kind, declared and observed audio format,
byte counts, queue depth, fallback, timeout, cancellation, retry, playback, and
persistence. Logs intentionally omit transcript text, request bodies, audio
payloads, authorization data, and secrets. Search one of the three correlation
IDs to reconstruct a turn without exposing what the learner said.

The checked-in audio fixture contains non-silent Japanese speech for decoder
and framing tests and labels its provenance explicitly. It is not claimed to be
a provider capture; refreshing real Inworld evidence requires an authenticated
provider or deployed Worker configuration.

For a development-only recorded-input trace, point `EXPO_PUBLIC_WORKER_URL` at
the Worker, set `EXPO_PUBLIC_KOE_REVIEW_ROUTE=session`, and set
`EXPO_PUBLIC_KOE_INJECT_AUDIO_URI` to a local or HTTP(S) MP3, M4A, or WAV.
Use `EXPO_PUBLIC_KOE_INJECT_AUDIO_URIS` with pipe-separated URLs to exercise a
multi-turn fixture sequence; each URL must end in its truthful filename.
Optionally set `EXPO_PUBLIC_KOE_INJECT_AUDIO_FILENAME` and
`EXPO_PUBLIC_KOE_INJECT_AUDIO_MIME_TYPE` when the URI does not carry truthful
values. An iPhone Simulator Debug build decodes the file with the native audio
stack, preserves its filename/MIME/rate/channels/duration, sends its bytes
through the Worker's real Soniox file-transcription endpoint, and enters the
same conversation-engine finalization used by a microphone turn. Reply audio,
feedback, pronunciation analysis, and SQLite persistence are not mocked or
bypassed. Invalid metadata, empty/truncated input, files over 20 MiB, recordings
over five minutes, and unsupported containers fail as recoverable STT errors.

The recorded-input adapter is omitted when `__DEV__` is false, the session
autorun caller is development-gated, and the engine independently rejects an
injection call when that adapter is absent. Release builds therefore cannot
activate the file source even if an injection environment variable is present.

## Shipping product structure

```text
app/index.tsx          conversation home
app/onboarding/        immediate first spoken exchange
app/session/[id].tsx  live voice conversation, feedback, and retry

src/services/         STT, conversation, TTS, pitch, and furigana primitives
src/product/v1.ts     the fixed route, lifecycle, voice, and correction contract
src/stores/           first-use and live-session state
src/db/               conversation, turn, feedback, retry, and audio persistence
worker/               provider proxy, streaming conversation, and feedback
```

Koe has no Learn, Review, drill, scenario-catalog, dictionary, Library, XP, streak, or SRS product surface.

## Commands

```bash
npm run typecheck
npm run test:product
npm run test:prompts
npm run test:voice
npm run test:sessions
npm run ios
npm run worker:dev
```
