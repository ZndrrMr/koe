# Koe 声

**Japanese pitch-first speaking app** — listen to native TTS, shadow it, see your pitch contour vs the target, and practice conversation with an AI tutor that corrects pronunciation, particles, and register.

React Native (Expo SDK 52) · TypeScript strict · NativeWind · Zustand · Drizzle + expo-sqlite · Inworld TTS · Soniox STT · Anthropic Claude · Google Gemini · Cloudflare Worker proxy.

---

## Quickstart

### 1. Install client deps

```bash
npm install
```

### 2. Set up the Cloudflare Worker (edge proxy)

The client **never** calls third-party APIs directly — all traffic routes through a tiny Cloudflare Worker that holds secrets, rate-limits per device, and caches TTS/furigana.

```bash
cd worker
npm install

# Create a KV namespace and copy the id/preview_id into wrangler.toml.
npx wrangler kv namespace create koe_cache
npx wrangler kv namespace create koe_cache --preview

# Put your provider secrets:
npx wrangler secret put INWORLD_API_KEY      # https://inworld.ai
npx wrangler secret put SONIOX_API_KEY        # https://soniox.com
npx wrangler secret put ANTHROPIC_API_KEY     # https://console.anthropic.com
npx wrangler secret put GEMINI_API_KEY        # https://aistudio.google.com/apikey

# Deploy
npx wrangler deploy
```

Copy the resulting `https://koe-worker.<your-subdomain>.workers.dev` URL.

### 3. Point the client at the worker

```bash
cp .env.example .env.local
# Edit .env.local, set:
#   EXPO_PUBLIC_WORKER_URL=https://koe-worker.your-subdomain.workers.dev
```

### 4. Build the bundled dictionary (optional but recommended)

Without this the app still works with ~60 seeded N5 words. With it, you ship the full JMdict + KANJIDIC2 + Kanjium pitch + KanjiVG strokes inside the app.

```bash
npm run build:dict
```

This downloads ~30MB of source data, then produces `assets/dict.db` (~35–50MB) and `assets/strokes/*.svg`. Run it once per release.

### 5. Run the app

```bash
# iOS simulator (requires Xcode)
npm run ios

# Android emulator
npm run android

# Web (limited — no mic, no Skia shaders)
npm run web
```

Because the app uses native modules (expo-audio, react-native-mmkv, react-native-svg, bottom-sheet, reanimated), you need a **development build** — Expo Go is not sufficient. On first run `expo run:ios` will generate the native projects and build.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React Native (Expo Router) app                             │
│   app/(tabs)   learn / speak / pitch / library              │
│   app/session/[id]       conversation screen                │
│   app/pitch-drill/*      three drill modes                  │
│   app/onboarding/*       kana check + goals                 │
│                                                             │
│   src/services   tts · stt · llm · pitch · furigana · srs · dict │
│   src/stores     zustand + MMKV persistence                 │
│   src/db         drizzle + expo-sqlite                      │
│   src/components JapaneseText · PitchContour · WordDetailSheet · … │
└─────────────────────────────────────────────────────────────┘
                  │  ALL traffic via fetch + SSE
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (worker/src/index.ts)                    │
│   POST /tts        → Inworld TTS  (cached in KV up to 25MB) │
│   GET  /stt/token  → Soniox temp streaming token            │
│   POST /llm/chat   → Claude streaming (SSE)                 │
│   POST /llm/flash  → Gemini 2.5 Flash (suggestions/grading) │
│   POST /furigana   → Gemini furigana JSON (KV-cached 30d)   │
└─────────────────────────────────────────────────────────────┘
```

### Key decisions

- **No accounts, no backend DB, no payments.** Everything local. Supabase/account sync is v2.
- **STT → LLM → TTS pipeline** — not the Realtime API — so we can inject pitch/particle/keigo correction between transcript and reply.
- **Pitch extraction on-device** via [`pitchy`](https://www.npmjs.com/package/pitchy). WORLD/CREPE CoreML is v2.
- **FSRS-4.5** via `ts-fsrs` for spaced repetition.
- **`<JapaneseText>`** is the cornerstone: furigana ruby + pitch overline + per-mora color coding.

---

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_WORKER_URL` | `.env.local` (client) | Base URL of your deployed Worker |
| `SENTRY_DSN` | `.env.local` (client) | Optional; crash reporting |
| `INWORLD_API_KEY` | `wrangler secret put` | Inworld TTS-1.5 Max |
| `SONIOX_API_KEY` | `wrangler secret put` | Soniox streaming STT |
| `ANTHROPIC_API_KEY` | `wrangler secret put` | Claude Sonnet 4.5 tutor |
| `GEMINI_API_KEY` | `wrangler secret put` | Gemini 2.5 Flash for cheap bulk tasks |

---

## Commands

```
npm start                 # expo dev server
npm run ios               # run on iOS simulator (requires Xcode)
npm run android           # run on Android emulator
npm run web               # run in browser (reduced features)
npm run typecheck         # tsc --noEmit
npm run build:dict        # build assets/dict.db from JMdict/KANJIDIC2/Kanjium/KanjiVG
npm run worker:dev        # run worker locally (needs wrangler + secrets)
npm run worker:deploy     # deploy worker to CF
```

---

## Licenses

- **JMdict / EDICT** — © [EDRDG](https://www.edrdg.org/edrdg/licence.html), CC-BY-SA 4.0
- **KANJIDIC2** — © EDRDG, CC-BY-SA 4.0
- **KanjiVG** — by Ulrich Apel, CC-BY-SA 3.0
- **Kanjium pitch data** — by mifunetoshiro, CC0

See the in-app About screen for the full attributions.
