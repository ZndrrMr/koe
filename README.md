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

## Shipping product structure

```text
app/index.tsx          conversation home
app/onboarding/        immediate first spoken exchange
app/session/[id].tsx  live voice conversation, feedback, and retry
app/preferences.tsx   optional reply style, coaching, focus, and voice

src/services/         STT, conversation, TTS, pitch, and furigana primitives
src/stores/           minimal settings and live-session state
src/db/               conversation, turn, feedback, retry, and audio persistence
worker/               provider proxy, streaming conversation, and feedback
```

Koe has no Learn, Review, drill, scenario-catalog, dictionary, Library, XP, streak, or SRS product surface.

## Commands

```bash
npm run typecheck
npm run test:prompts
npm run test:voice
npm run test:sessions
npm run ios
npm run worker:dev
```

The repository also contains isolated research/proof routes for the current voice direction and later Pencil exploration. They are not top-level product navigation or curricular modes.
