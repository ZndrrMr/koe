# Koe — Japanese Pitch-First Speaking App

**Product**: A React Native (Expo) cross-platform app that teaches Japanese with pitch accent integrated into every interaction. Listen to native-quality TTS, shadow it, see your pitch contour vs target, and practice conversation with an AI tutor that corrects pronunciation, particles, and register.

**Working codename**: Koe (声 — "voice")

**Audience for this doc**: Claude Code. Implement everything below. When a decision seems missing, the decision is already made below — re-read. When you hit a genuine fork not covered here, pick the option that requires less code and defer the other to a follow-up PR.

---

## 0. Operating principles for Claude Code

1. **Build the minimum end-to-end loop first.** Prefer a working ugly version of the whole app over a polished version of one screen. The success criterion for v1 is "Zander can open this and study Japanese for 30 minutes without hitting a crash or a missing feature."
2. **No accounts, no auth, no backend database, no payments in v1.** Everything local first. Supabase can come later.
3. **Make it work on iOS first, Android second, web third.** Expo handles this, but when a native module is iOS-only, ship iOS-only and log a TODO. Do not block on Android parity.
4. **Ship the commercial API path before the on-device ML path.** The pitch classifier is v2. v1 uses the Inworld pipeline + F0 contour visualization (no ML training required for contours — just pyin/YIN on-device).
5. **When stuck between two libraries, pick the one with more GitHub stars and more recent commits.** Do not evaluate three options in prose; pick one and move on.
6. **Use TypeScript strict mode.** No `any` without a `// TODO: type this` comment.
7. **One file per screen, one file per domain model, no premature abstraction.** Resist making a "component library."
8. **Every async function wraps errors.** No unhandled promises. Log to console with `[Koe]` prefix.
9. **All Japanese text in the codebase is UTF-8 and committed as-is.** No escape sequences.
10. **Commit frequently with conventional commit messages.** `feat: ...`, `fix: ...`, `chore: ...`.

---

## 1. Stack decisions (final — do not deliberate)

| Layer | Choice | Why (for your reference, do not debate) |
|---|---|---|
| Framework | **Expo SDK 52+ with React Native 0.76+** | Best DX, prebuild for custom native modules, EAS for builds |
| Language | **TypeScript strict** | Non-negotiable |
| Navigation | **Expo Router (file-based)** | Replaces React Navigation boilerplate |
| State | **Zustand** for app state, **TanStack Query** for server state | No Redux |
| Local storage | **expo-sqlite** (Drizzle ORM on top) for structured data, **MMKV** (`react-native-mmkv`) for key-value | SQLite for vocab/progress, MMKV for settings/cache |
| Audio playback | **expo-audio** (new API, not expo-av) | Required for low-latency TTS playback |
| Audio recording | **expo-audio** with `AudioModule.requestRecordingPermissionsAsync()` | Same module |
| Pitch extraction | **pitchy** (npm, YIN/pyin in JS) for v1 contour | Zero native deps, runs on web too. Port to WORLD/CREPE CoreML later. |
| TTS provider | **Inworld TTS-1.5 Max** via REST for synthesis, streaming where supported | Ranked #1 on Artificial Analysis, Japanese supported, $10/1M chars |
| STT provider | **Soniox streaming WebSocket API** | Best Japanese accuracy + handles code-switching (learner mixes English/JP) |
| LLM for conversation | **Anthropic Claude Sonnet 4.5** via official SDK | User already has the $200 Max plan; good JP handling; prompt-driven register control |
| LLM for cheap bulk tasks (furigana, grading) | **Google Gemini 2.5 Flash** via REST | Cheapest for high-volume token work |
| Realtime voice loop | **NOT Realtime API in v1.** STT → LLM → TTS pipeline. | Lets us inject pitch/particle/keigo correction layers. Add OpenAI/Inworld Realtime as optional "live talk" mode in v2. |
| Styling | **NativeWind (Tailwind for RN)** | Faster than StyleSheet, matches user's iOS/SwiftUI muscle memory vs raw RN styles |
| Icons | **lucide-react-native** | Already in user's mental model |
| Fonts | **Noto Sans JP** (Google Fonts via `expo-font`) + **Inter** for UI | Noto Sans JP renders furigana correctly |
| Furigana rendering | Custom component with absolutely-positioned ruby text | React Native has no native `<ruby>` support — we build one |
| SRS algorithm | **FSRS-4.5** via `ts-fsrs` npm package | Supersedes SM-2; Anki is migrating to it |
| Dictionary data | **JMdict (EDICT2)** + **KANJIDIC2** + **Kanjium** (pitch) — bundled as SQLite DB built at build time | Ship 40–80MB DB inside the app, no network calls for lookup |
| Stroke order | **KanjiVG SVGs** bundled, animated via `react-native-svg` + Reanimated | CC-BY-SA, works cross-platform |
| Analytics / crash | **Sentry** (`@sentry/react-native`) + `expo-application` for basic counters | Skip PostHog until we have users |
| Secret management | **.env.local** (gitignored) + `expo-constants` extra | No cloud secret manager in v1 |

### Why not the things you might reach for

- **Do not use** `expo-av` (deprecated path), Redux, React Navigation directly, Styled Components, Moti (Reanimated covers it), `react-native-voice` (unmaintained, has native crashes), Whisper-RN (great but v2 — Soniox is better quality on JP out of the box), Realm, WatermelonDB (overkill for our data volume), Detox (flaky on Expo), AsyncStorage (use MMKV).
- **Do not try to bundle Kokoro TTS on-device in v1.** It's a v2 task. Use Inworld for everything.
- **Do not build a custom backend.** Every feature in v1 hits an API from the client directly through a thin edge proxy (see §5).

---

## 2. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  React Native (Expo) App                                    │
│                                                             │
│  Screens (Expo Router)                                      │
│   ├─ (tabs)/                                                │
│   │   ├─ learn       → today's study queue                  │
│   │   ├─ speak       → AI conversation mode                 │
│   │   ├─ pitch       → pitch accent drills                  │
│   │   └─ library     → vocab / saved sentences              │
│   ├─ onboarding/     → kana test, goals, JLPT level         │
│   └─ session/[id]    → a single conversation session        │
│                                                             │
│  Domain services (src/services)                             │
│   ├─ tts.ts          → Inworld synth + playback             │
│   ├─ stt.ts          → Soniox WebSocket streaming           │
│   ├─ llm.ts          → Claude + Gemini wrappers             │
│   ├─ pitch.ts        → pitchy-based F0 extraction + compare │
│   ├─ furigana.ts     → kanji→reading via Gemini + cache     │
│   ├─ srs.ts          → FSRS scheduler                       │
│   └─ dict.ts         → SQLite dictionary lookups            │
│                                                             │
│  Stores (src/stores)                                        │
│   ├─ useSettings     → Zustand, persisted via MMKV          │
│   ├─ useSession      → current conversation session         │
│   └─ useProgress     → streaks, XP, mastery                 │
│                                                             │
│  Local DB (expo-sqlite + Drizzle)                           │
│   ├─ words (JMdict entries with pitch)                      │
│   ├─ kanji (KANJIDIC2 + stroke SVG refs)                    │
│   ├─ cards (user's SRS cards)                               │
│   ├─ sessions (conversation history)                        │
│   └─ events (analytics-lite)                                │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Edge proxy (Cloudflare Worker — a single file)             │
│   - Holds Inworld / Soniox / Anthropic / Gemini keys        │
│   - Rate-limits per-device UUID                             │
│   - Streams responses through                               │
└─────────────────────────────────────────────────────────────┘
```

### Why the edge proxy

You will leak keys if you put them in the client. You will rate-limit yourself out of business if you don't have a throttle. A single Cloudflare Worker file (~200 lines) solves both. It is **the only backend code in v1**. Do not build a database behind it.

---

## 3. Data model

Everything in SQLite via Drizzle. Define schemas in `src/db/schema.ts`.

```ts
// Everything Claude Code should implement exactly as below.

export const words = sqliteTable('words', {
  id: integer('id').primaryKey(),           // JMdict ent_seq
  kanji: text('kanji'),                     // e.g. '食べる' — nullable
  kana: text('kana').notNull(),             // e.g. 'たべる'
  romaji: text('romaji').notNull(),         // computed at build time
  pos: text('pos').notNull(),               // part of speech, comma-separated
  gloss: text('gloss').notNull(),           // English meanings, pipe-separated
  jlpt: integer('jlpt'),                    // 5..1, nullable
  pitchAccents: text('pitch_accents'),      // JSON: [{mora: 0-indexed, pattern: 'atamadaka'|'heiban'|'nakadaka'|'odaka', dropMora: number|null}]
  freqRank: integer('freq_rank'),           // 1..N, from Kanjium/frequency list
});

export const kanji = sqliteTable('kanji', {
  literal: text('literal').primaryKey(),    // single char '食'
  onyomi: text('onyomi'),                   // comma-separated katakana
  kunyomi: text('kunyomi'),                 // comma-separated hiragana
  meanings: text('meanings'),               // pipe-separated English
  jlpt: integer('jlpt'),
  grade: integer('grade'),
  strokeCount: integer('stroke_count'),
  svgId: text('svg_id'),                    // maps to bundled KanjiVG file
});

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wordId: integer('word_id').references(() => words.id),
  kind: text('kind').notNull(),             // 'recognition' | 'production' | 'pitch' | 'listening'
  fsrsState: text('fsrs_state').notNull(),  // JSON serialized FSRS card state
  due: integer('due').notNull(),            // unix ms
  createdAt: integer('created_at').notNull(),
  lastReviewedAt: integer('last_reviewed_at'),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),              // uuid
  scenarioId: text('scenario_id').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  registerTarget: text('register_target').notNull(),  // 'casual' | 'teineigo' | 'keigo'
  jlptTarget: integer('jlpt_target').notNull(),       // 5..1
  turnCount: integer('turn_count').notNull().default(0),
});

export const turns = sqliteTable('turns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id),
  role: text('role').notNull(),              // 'user' | 'ai'
  textJa: text('text_ja').notNull(),
  textEn: text('text_en'),                   // AI translation (optional)
  furiganaJson: text('furigana_json'),       // [{ base: '食', reading: 'た' }, ...]
  audioUri: text('audio_uri'),               // local file path to TTS or user recording
  pitchDataJson: text('pitch_data_json'),    // { f0: number[], timestamps: number[] }
  feedbackJson: text('feedback_json'),       // { particleErrors, registerIssues, pitchScore, suggestions }
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

---

## 4. Screens & flows

### 4.1 Onboarding (one-time, skippable)
Three screens, dismissible.
1. **Welcome + single CTA**: "声. Speak Japanese. Hear yourself." Background video of an F0 contour animating. One button: "Start".
2. **Kana check**: display 5 hiragana + 5 katakana with multiple-choice romaji. If user scores 8+/10, mark kana as "known" and skip hiragana tutorial. Otherwise queue the kana primer as first lesson.
3. **Goal + level picker**: radio buttons for goal (Travel / Anime & manga / Work in Japan / JLPT / Just because) and self-reported level (Beginner / N5 / N4 / N3 / N2+). Store in settings.

Ship all three screens even if copy is rough. No email, no signup.

### 4.2 Tab: Learn (home)
Top: current streak (number + 🔥), XP this week (progress bar), "review due" count.

Main: a **single primary CTA card** that says "Start today's session (15 min)". Tapping it starts an auto-curated session:
- 5 min: SRS reviews due (recognition + production cards mixed)
- 5 min: new vocabulary (5 new words with audio + pitch)
- 5 min: AI conversation using the new vocab

Below the CTA: three secondary cards for "Pitch drill", "Shadowing practice", "Free conversation". These route to the other tabs but allow quick-start from Learn.

### 4.3 Tab: Speak (AI conversation)
Entry screen: grid of **10 scenario cards** with illustrated backgrounds.

Hardcode these 10 scenarios in `src/data/scenarios.ts`:
1. Konbini checkout (cashier asks about bags, points card, hot food)
2. Ordering at a ramen shop (ticket machine + counter)
3. Self-introduction (first day at work/school)
4. Asking directions to the station
5. Train ticket counter (reserved seat, fare adjustment)
6. Doctor's office (describing symptoms)
7. Izakaya with a friend (casual register)
8. Hotel check-in (keigo register)
9. Making small talk with a senpai (mixed register)
10. Phone call to make a reservation

Each scenario has: `id, title, titleJa, description, illustrationEmoji, registerTarget, difficulty (N5-N1), openingLine`.

**Conversation UI layout** (copy this from Aoi Speak / Speak):

```
┌─────────────────────────────────────────┐
│  ← End session       Konbini · N5 · 丁寧│  <- header with scenario + register
├─────────────────────────────────────────┤
│                                         │
│   🧑‍💼 いらっしゃいませ。                  │  <- AI bubble with furigana
│        (irasshaimase)                   │     tap shows English + word lookup
│   ━━━━━━━━━━━━━━ 🔊                   │     pitch contour visible on tap
│                                         │
│                                         │
│              あ、ビール二本ください  🧑  │  <- user bubble
│              [show: errors + pitch]     │
│                                         │
│   🧑‍💼 かしこまりました。温めますか？     │
│                                         │
├─────────────────────────────────────────┤
│  💡 Hint    [こちらです] [はい] [すみません] │  <- suggested replies + hint button
├─────────────────────────────────────────┤
│  [  🎤 Hold to speak  ]                 │  <- single giant button
└─────────────────────────────────────────┘
```

**Interaction rules** (implement exactly):
- Mic is **hold-to-talk**, NOT toggle. Release = send. If held <400ms, ignore (prevents ghost presses).
- While holding, show a waveform from the live mic input (use `pitchy` + a simple canvas-style view in Skia or just bar chart).
- After release, show user's text transcript in their bubble immediately (optimistic — come back to it if STT revises).
- AI reply streams in token-by-token (stream the Claude response) while TTS audio generates in parallel; play TTS as soon as first chunk is ready.
- Tap any word in any bubble → opens bottom sheet with dictionary entry, pitch, stroke order for kanji, "add to SRS" button.
- Tap the pitch-contour indicator → expands to a full contour view with the native line (Inworld TTS F0) overlaid with the user's F0 (from their recording).
- "End session" → summary screen (§4.7).

**Suggested replies** are 3 chips generated by Gemini Flash (cheap) in parallel with the AI's reply, using a prompt like: *"Given this Japanese conversation, give 3 plausible next-turn replies a JLPT {level} learner could say in {register} register. Return JSON: [{ja, en, hint}]"*. If Gemini is slow, show them after they arrive — do not block UI.

**Hint button** progressively reveals (3 taps to exhaust):
1. Topic hint in English: "You want to order a drink."
2. Grammar skeleton: `___を ___ください`
3. Full suggested sentence with furigana and translation.

### 4.4 Tab: Pitch (pitch accent drills)
Three drill modes on this screen:

**A. Minimal Pairs Test (Kotsu-style)**
Show a word (e.g. 箸/橋). Play audio. User taps the pattern they heard (atamadaka / heiban / nakadaka / odaka). Show native contour visualization after response. 20 words per session.

**B. Shadow Mode**
Show sentence with furigana + pitch marks. Tap to play native audio. User taps mic, repeats. Show side-by-side F0 contour overlay (native vs user, normalized for pitch range). Score: DTW distance between contours → 0–100.

**C. Accent Pattern Quiz**
Word flashcard. User is told the JLPT level and shown the kanji/kana. User picks or speaks the pitch pattern. Great for Anki-mining-style self-paced learning.

All three use words from the `words` table filtered by the user's JLPT level + freq rank.

### 4.5 Tab: Library
- **Vocabulary**: filterable list of words user has added to SRS. Search, JLPT filter, pitch-pattern filter.
- **Sessions**: list of past conversation sessions, tap to replay.
- **Kanji**: grid view with stroke-order animations on tap.

### 4.6 Word detail sheet (opens from anywhere)
A bottom sheet (`@gorhom/bottom-sheet`) with:
- Word (kanji + furigana)
- Pitch accent pattern visualized (overline+hook notation + color-coded mora + numeric index)
- Audio button (Inworld TTS)
- Meanings (English)
- JLPT + frequency rank
- Example sentences (2–3 generated at first view by Gemini Flash and cached)
- Kanji breakdown: each kanji expandable with stroke animation
- "Add to SRS" button (creates 2 cards: recognition + production)

### 4.7 Session summary
After AI conversation ends:
- Stats: turns, new words used, pitch accuracy %, register consistency %
- **Mistakes bank**: list of the 5 most notable errors (particle, register, pitch) with corrections and "practice this" button that adds to SRS
- "Replay with corrected version" button
- "Study the new words" button → goes to SRS for words that appeared

---

## 5. The edge proxy (Cloudflare Worker)

One file: `worker/index.ts`. Deploy via `wrangler`.

```ts
// Pseudocode — Claude Code: implement fully with Hono framework for routing.

// Routes:
// POST /tts        → proxies to Inworld, streams audio back
// GET  /stt/token  → returns a short-lived Soniox temp token (preferred over proxying WS)
// POST /llm/chat   → proxies to Anthropic Claude, streams SSE back
// POST /llm/flash  → proxies to Gemini 2.5 Flash (for furigana/suggestions/grading)
// POST /furigana   → Gemini: input Japanese text → output [{base, reading}] JSON (cached in KV)

// Rate limiting:
// - Read X-Device-Id header (client sends a persistent UUID from MMKV)
// - Per-device: 500 TTS requests/day, 200 LLM requests/day, 100k STT seconds/month
// - Use Cloudflare KV for counters with daily reset

// Caching:
// - Furigana results cached in KV keyed by sha256(text) — TTL 30 days
// - TTS audio cached in R2 keyed by sha256(text + voice_id) — TTL 90 days, saves huge costs on scenario opening lines

// Secrets (wrangler secret put):
// INWORLD_API_KEY, SONIOX_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
```

Client config: `app.config.ts` reads `EXPO_PUBLIC_WORKER_URL` from env. All network goes through this one URL.

---

## 6. Domain services — exact function signatures

Claude Code: implement each file below with these exact signatures.

### `src/services/tts.ts`
```ts
type TTSVoice = 'ja-female-1' | 'ja-female-2' | 'ja-male-1';

export async function synthesize(text: string, opts?: {
  voice?: TTSVoice;          // default 'ja-female-1'
  speed?: number;             // 0.5..1.5, default 1.0
  withTimestamps?: boolean;   // word-level timestamps for karaoke-style highlighting
}): Promise<{
  audioUri: string;           // local cached file URI
  durationMs: number;
  timestamps?: Array<{ word: string; startMs: number; endMs: number }>;
}>;

export async function play(audioUri: string, opts?: { rate?: number }): Promise<void>;
export async function stop(): Promise<void>;

// Implementation: call worker /tts, save resulting audio to FileSystem.cacheDirectory/tts/{sha}.mp3,
// use expo-audio's useAudioPlayer. Cache by text+voice hash.
```

### `src/services/stt.ts`
```ts
export type STTChunk = {
  text: string;
  isFinal: boolean;
  confidence: number;
};

export type STTHandle = {
  stop: () => Promise<{ fullText: string; durationMs: number; audioUri: string }>;
};

export async function startStreaming(opts: {
  onChunk: (chunk: STTChunk) => void;
  languageHint?: 'ja' | 'ja,en';  // default 'ja,en' for code-switching
}): Promise<STTHandle>;

// Implementation: fetch /stt/token from worker, open Soniox WebSocket directly,
// stream mic audio via expo-audio recording + AudioWorklet/AudioEngine.
// Save raw audio to cacheDirectory/recordings/{uuid}.m4a for pitch analysis.
```

### `src/services/llm.ts`
```ts
export type ConvoTurn = { role: 'user' | 'assistant'; content: string };

export async function* streamConversation(opts: {
  scenarioId: string;
  registerTarget: 'casual' | 'teineigo' | 'keigo';
  jlptTarget: 1 | 2 | 3 | 4 | 5;
  history: ConvoTurn[];
  userTurn: string;
}): AsyncGenerator<string, ConversationResult, void>;

export type ConversationResult = {
  fullText: string;
  corrections: {
    particles: Array<{ original: string; corrected: string; explanation: string }>;
    register: { consistent: boolean; note?: string };
    other: Array<{ original: string; corrected: string; explanation: string }>;
  };
  translation: string;
};

export async function generateSuggestedReplies(opts: {
  history: ConvoTurn[];
  registerTarget: string;
  jlptTarget: number;
}): Promise<Array<{ ja: string; en: string; hint: string }>>;

export async function gradePronunciation(opts: {
  targetText: string;
  userTranscript: string;
  nativePitchContour: number[];
  userPitchContour: number[];
}): Promise<{
  phonemeScore: number;     // 0..100
  pitchScore: number;        // 0..100
  overallScore: number;      // 0..100
  notes: string[];
}>;
```

**System prompts** live in `src/prompts/`. Claude Code: create these files:

`src/prompts/tutor.ts` — the main conversation system prompt. Include:
- "You are a patient, encouraging Japanese conversation tutor."
- The exact scenario description.
- "Speak in {registerTarget} register. If the user writes in a different register, gently note it and continue in the target register."
- "Target JLPT level is N{level}. Do not use grammar above N{level} unless the user does first."
- "After each user turn, respond naturally in Japanese. Then on a new line prefixed with `---CORRECTIONS---`, output JSON with any particle/register/grammar corrections. Then on another new line prefixed with `---TRANSLATION---`, output an English translation of your Japanese response."
- "Keep replies to 1–2 sentences. Ask open questions that keep the conversation going."

Client parses `---CORRECTIONS---` and `---TRANSLATION---` delimiters from the stream.

### `src/services/pitch.ts`
```ts
export async function extractContour(audioUri: string): Promise<{
  f0: number[];           // Hz, -1 for unvoiced
  timestamps: number[];   // ms
  voicedRatio: number;    // 0..1
}>;

export function compareContours(
  native: { f0: number[]; timestamps: number[] },
  user: { f0: number[]; timestamps: number[] }
): {
  dtwDistance: number;
  normalizedScore: number;  // 0..100
  alignmentPath: Array<[number, number]>;
};

// Implementation:
// - For extraction: decode audio to PCM via expo-audio buffer export,
//   run pitchy's YIN/pyin over 25ms windows, 10ms hop.
// - Normalize F0 to log-scale semitones, then subtract mean (so pitch range doesn't matter).
// - DTW via a small local implementation (20 lines).
```

### `src/services/furigana.ts`
```ts
export type FuriganaRun = { base: string; reading?: string };

export async function annotate(text: string): Promise<FuriganaRun[]>;

// Implementation:
// 1. Check local SQLite cache first (sha256(text) key).
// 2. If miss, call worker /furigana (Gemini Flash).
// 3. Store result locally.
// 4. Returns array like [{base:'今日', reading:'きょう'}, {base:'は'}, ...]
```

### `src/services/srs.ts`
```ts
import { createEmptyCard, Rating, type Card } from 'ts-fsrs';

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export async function getDueCards(limit?: number): Promise<CardWithWord[]>;
export async function reviewCard(cardId: number, grade: ReviewGrade): Promise<void>;
export async function addWordToSRS(wordId: number, kinds: CardKind[]): Promise<void>;
export async function getStats(): Promise<{
  total: number;
  dueToday: number;
  learnedThisWeek: number;
  masteryByJlpt: Record<1|2|3|4|5, number>;
}>;
```

### `src/services/dict.ts`
```ts
export async function searchWord(query: string): Promise<Word[]>;
export async function getWord(id: number): Promise<Word | null>;
export async function getKanji(literal: string): Promise<Kanji | null>;
export async function suggestExamples(wordId: number): Promise<string[]>;  // cached Gemini calls
```

---

## 7. UI components — specific patterns to build

### 7.1 `<JapaneseText>` component (the cornerstone)
Props:
```ts
type Props = {
  runs: FuriganaRun[];                      // from furigana service
  showFurigana?: 'always' | 'never' | 'known-hidden';  // default from settings
  showPitch?: boolean;                       // default from settings
  pitchAccents?: Record<string, PitchInfo>;  // lookup by base
  onWordPress?: (run: FuriganaRun) => void;
  fontSize?: number;                         // default 22
  color?: string;
};
```

Renders each run as a pressable element with ruby text positioned above. Pitch accent rendered as:
- An **overline** above the mora sequence (thin 1.5px line)
- A **downward hook** at the accent nucleus (where pitch drops)
- Optional color coding of the base text:
  - `atamadaka` → `#FF5A5F` (red)
  - `heiban` → `#3B82F6` (blue)
  - `nakadaka` → `#F59E0B` (orange)
  - `odaka` → `#EC4899` (pink)
- A small superscript number `[1]`, `[0]` next to the word (toggleable in settings)

This component is used everywhere. Build it as a Skia component (`@shopify/react-native-skia`) — gives you perfect control over overline placement and works on all platforms. If Skia integration blows up budget, fall back to `<View>` with absolutely-positioned `<Text>` overlays.

### 7.2 `<PitchContour>` component
Visualizes F0 over time. Two modes:
- **Single**: one native line.
- **Overlay**: native line (solid) + user line (dashed) aligned by DTW path.

Props:
```ts
type Props = {
  native: { f0: number[]; timestamps: number[] };
  user?: { f0: number[]; timestamps: number[] };
  height?: number;
  width?: number;
  showScore?: boolean;
};
```

Render with Skia path — smooth cubic through voiced regions, gaps in unvoiced. X axis: time. Y axis: log-F0 (semitones from mean). 40–80Hz total vertical range is enough.

### 7.3 `<ScenarioCard>` component
Big emoji hero, title in EN + JP, difficulty badge, register badge. 16:9 aspect ratio. Tap → haptic + scale animation via Reanimated, then navigate.

### 7.4 `<SuggestedReplyChips>` component
Three pill-shaped buttons along the bottom of the conversation view. Each: small JP text above, tiny EN translation below (50% opacity). Tap fills the mic area with this text and triggers TTS playback of the user's would-be line for them to mimic, then a send button appears. (The twist: we want users to *speak* their replies for the pitch practice, not just tap to send.)

### 7.5 `<KanjiStroke>` component
Animated stroke-order display using KanjiVG. Props: `literal: string, size: number`. Uses `react-native-svg` to parse the bundled SVG and animate each `<path>` via `strokeDasharray` + `strokeDashoffset` with Reanimated shared values. Tap = play, long-press = show numbered order static.

---

## 8. Bundled content — what ships inside the app

Build a script `scripts/build-dict.ts` that Claude Code runs during CI (and locally) to:
1. Download JMdict_e.gz, KANJIDIC2_e.gz from EDRDG.
2. Download Kanjium's `accents.txt` from GitHub.
3. Download KanjiVG (kanjivg-20220427-main.zip) and extract SVGs.
4. Generate `assets/dict.db` (SQLite) with the `words` and `kanji` tables populated.
5. Bundle the `assets/strokes/*.svg` files.
6. Copy the DB to `assets/dict.db` and `require()` it at app start (copy to docs dir on first launch).

Expected final bundle: ~35–50MB. Acceptable.

License notes for Claude Code to include in the About screen:
- JMdict/EDICT dictionary data from the Electronic Dictionary Research and Development Group, under [CC-BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html).
- KANJIDIC2 dictionary data, same license.
- KanjiVG stroke order data by Ulrich Apel, CC-BY-SA 3.0.
- Kanjium pitch accent data by mifunetoshiro, CC0.

### Seed content (v1)
Seed the SRS with the **N5 Tango 1000** frequency list and the first 80 kanji from WaniKani levels 1–3 pacing. Hardcode in `src/data/seed.ts`. User onboarding auto-adds the first 20 N5 words as their starter deck.

---

## 9. Design system

**Color tokens** (Tailwind config in `tailwind.config.js`):
```
primary:     #DC2626  (torii red, used sparingly)
bg:          #FAFAF7  (paper cream, light mode)
bg-dark:     #0E0E10  (sumi black, dark mode)
surface:     #FFFFFF / #1A1A1D
text:        #0E0E10 / #F5F5F0
muted:       #737373
accent:      #3B82F6  (indigo, for pitch/heiban)
success:     #10B981
warning:     #F59E0B
danger:      #FF5A5F
```

**Typography**:
- Japanese body: Noto Sans JP 400 / 600 / 700
- UI English: Inter 400 / 500 / 600
- Numbers (streaks, scores): Inter 700, tabular-nums
- Never use italic on Japanese text.

**Spacing**: Tailwind defaults, prefer multiples of 4.

**Corners**: `rounded-2xl` (16px) for cards, `rounded-full` for chips and the mic button.

**Haptics**: `expo-haptics.impactAsync(Light)` on every interactive tap. `Medium` on mic press. `Success` on correct answer. `Error` on wrong answer. This is non-optional — it is the main reason the app will feel premium vs Talkpal.

**Animations**: use Reanimated 3. No spring animations longer than 250ms. All transitions should feel instant-ish.

**Dark mode**: full support from day one. Use NativeWind's `dark:` prefix.

---

## 10. Permissions + native config

In `app.json`:
```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Koe needs the microphone to hear your Japanese so we can coach your pronunciation and pitch accent.",
        "UIBackgroundModes": ["audio"]
      }
    },
    "android": {
      "permissions": ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]
    },
    "plugins": [
      "expo-router",
      "expo-font",
      ["expo-sqlite", { "enableFTS": true }],
      "expo-audio",
      "@sentry/react-native/expo"
    ]
  }
}
```

Echo cancellation on iOS: set `AVAudioSession` category to `.playAndRecord` with `.allowBluetooth` and `.defaultToSpeaker` options, and `mode: .voiceChat`. This gives Core Audio's built-in AEC, which is essential when TTS output leaks into the mic.

---

## 11. Build order (concrete, in this order)

Claude Code: do these in order. Each milestone should be commited and verified before moving on.

### Milestone 1: Skeleton (target: half a day)
- [ ] `npx create-expo-app@latest koe -t expo-template-blank-typescript`
- [ ] Set up Expo Router, NativeWind, Zustand, Drizzle + expo-sqlite, MMKV, Sentry
- [ ] Four empty tabs (Learn, Speak, Pitch, Library) with placeholder screens
- [ ] Global theme provider, dark mode, fonts loaded
- [ ] Sample database with 10 hardcoded words for testing

### Milestone 2: Dictionary + bundled data (1 day)
- [ ] `scripts/build-dict.ts` producing `assets/dict.db`
- [ ] Migration logic that copies bundled DB to documents dir on first launch
- [ ] `dict.ts` service with working `searchWord` / `getWord` / `getKanji`
- [ ] Library tab shows searchable vocab list

### Milestone 3: TTS + JapaneseText component (1 day)
- [ ] Cloudflare Worker with `/tts` endpoint, deployed
- [ ] `tts.ts` service with caching
- [ ] `<JapaneseText>` component with furigana + pitch accent rendering
- [ ] Word detail sheet opening from library with audio playback

### Milestone 4: STT + pitch extraction (1–2 days)
- [ ] Worker `/stt/token` endpoint
- [ ] `stt.ts` service streaming from mic to Soniox WebSocket
- [ ] Recording persists to cache dir
- [ ] `pitch.ts` service extracting F0 via pitchy
- [ ] `<PitchContour>` component renders both native and user lines

### Milestone 5: AI conversation loop (2 days)
- [ ] Worker `/llm/chat` streaming proxy to Claude
- [ ] `llm.ts` service with `streamConversation` and `generateSuggestedReplies`
- [ ] Speak tab with scenario grid
- [ ] Session screen with full conversation UI: bubbles, hold-to-talk mic, suggested replies, hint button
- [ ] Session summary on exit

### Milestone 6: SRS + Learn tab (1 day)
- [ ] `srs.ts` service with FSRS scheduler
- [ ] Learn tab with streak/XP/due count
- [ ] Review flow: show card → grade buttons (Again/Hard/Good/Easy) → update FSRS
- [ ] Two card kinds: recognition (show JP, recall EN) and production (show EN, speak JP with pitch feedback)

### Milestone 7: Pitch drills (1 day)
- [ ] Pitch tab with three drill modes
- [ ] Minimal pairs test using seed word list
- [ ] Shadow mode with DTW-scored pitch comparison
- [ ] Accent pattern quiz

### Milestone 8: Polish + onboarding (1 day)
- [ ] Onboarding flow
- [ ] Haptics everywhere
- [ ] Error boundaries + Sentry wiring
- [ ] About / credits / licenses screen
- [ ] Build for iOS via `eas build -p ios --profile development`

**Total estimate**: 8–10 focused days, which matches the analysis from the research session (~2 weeks to usable v1).

---

## 12. Things explicitly deferred to v2 (do not build in v1)

1. On-device pitch accent classifier (the ML training path — real moat, but v2).
2. On-device Kokoro TTS offline mode.
3. OpenAI / Inworld Realtime API live-talk mode.
4. Signature voice fine-tune via Style-Bert-VITS2.
5. Accounts, cloud sync, multi-device.
6. Payments / paywall / IAP.
7. Leaderboards, friends, social.
8. Notifications (push for streak reminders is v1.5 at earliest).
9. Lesson authoring / user-generated scenarios.
10. Manga / article import (the Kiku-ish crossover — tempting but cut).
11. Translation practice mode.
12. Business Japanese / JLPT-exam-specific deck.

---

## 13. Tests

Minimum viable test coverage:
- Unit tests for `srs.ts` (FSRS state transitions), `furigana.ts` parser, `pitch.ts` DTW.
- A single Detox-lite E2E smoke test: open app → navigate to Speak → open a scenario → record 1s silence → verify a turn appears. Skip Detox if Expo integration is rough; use Maestro instead (one YAML file).
- No test for Inworld / Soniox / Claude responses — they're external.

---

## 14. Known gotchas and what to do about them

- **TTS echo into mic**: always configure `AVAudioSession` as above; additionally, pause TTS playback while the user is holding the mic button. Do not attempt to do full-duplex in v1.
- **Furigana for rare readings**: Gemini Flash sometimes gets readings wrong for proper nouns and unusual compounds. Check the JMdict first, only fall back to Gemini for words not in the dict. Store the Gemini results in the local cache so wrong ones can be corrected manually.
- **Pitch extraction on short audio**: < 500ms recordings produce unreliable F0. Reject recordings under 400ms silently and show "Please speak a bit longer."
- **Soniox + Japanese + code-switching**: set `language_hints: ["ja","en"]` and `enable_non_final_tokens: true`. Do not send `language_code: "ja"` exclusively — it's worse for learners who drop English words.
- **iOS AVAudioSession interruptions** (phone call, Siri): subscribe to `expo-audio`'s interruption events and pause cleanly. Don't leave the mic stream open.
- **Claude's streaming format**: parse SSE events carefully; `message_stop` is your signal to split text at `---CORRECTIONS---` / `---TRANSLATION---` markers.
- **Expo Go limitations**: you will need a development build (`expo run:ios`) for some native modules (Skia, Sentry). Do not try to ship Expo Go; always EAS.
- **iOS 18+ microphone indicator**: users see the orange dot while the app is recording — that's fine. Don't try to hide or work around it.

---

## 15. Out of the box, after `eas build`:

A user can:
1. Open the app, complete a 60-second onboarding.
2. Start a konbini scenario conversation in Japanese.
3. Hold the mic, speak a response (even broken), see their transcript appear with highlighted particle mistakes and pitch feedback.
4. Hear Inworld TTS reply in a natural Japanese voice with furigana + pitch visible.
5. Tap any word to see definition, pitch pattern, stroke order, and add it to SRS.
6. Review SRS cards that night with recognition + production practice.
7. Do a 5-minute pitch minimal-pairs drill and see their score improve over days.

That is the v1 target. If Claude Code has written something that meets those seven criteria, the app is shippable to TestFlight.

---

## 16. Cost estimate at v1 scale

At 100 weekly active users doing 20 min/day:
- Inworld TTS: ~$18/mo
- Soniox STT: ~$40/mo
- Claude (tutor): ~$35/mo
- Gemini Flash (furigana/suggestions): ~$4/mo
- Cloudflare Worker + KV + R2: $5/mo
- Total: **~$100/mo** for 100 WAU. Plenty of runway on the $200/mo Claude Max plan + a small Inworld/Soniox/Gemini float.

---

## 17. When you hit an ambiguity

Default choices, in order:
1. Match what Aoi Speak does.
2. Match what Speak (speak.com) does.
3. Match what Issen does.
4. Ship the simpler version and add a `TODO(decide)` comment.

Never stall on a decision. Commit the simpler path and move on — every screen and service listed above is worth more than any single detail.

---

**End of spec.** Begin with Milestone 1. Commit after each milestone with a message summarizing what shipped.
