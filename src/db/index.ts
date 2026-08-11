import * as SQLite from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import { log } from "@/utils/log";
import * as schema from "./schema";
import { SEED_WORDS } from "@/data/seed";

const DB_NAME = "koe.db";

let _db: ReturnType<typeof drizzle> | null = null;
let _native: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<{
  db: ReturnType<typeof drizzle>;
  native: SQLite.SQLiteDatabase;
}> | null = null;

export async function openDb() {
  if (_db && _native) return { db: _db, native: _native };
  if (!_opening) {
    _opening = openDbOnce().finally(() => {
      _opening = null;
    });
  }
  return _opening!;
}

async function openDbOnce() {
  await ensureBundledDbCopied();

  const native = await SQLite.openDatabaseAsync(DB_NAME, {
    enableChangeListener: false,
  });
  await native.execAsync("PRAGMA journal_mode = WAL;");
  await createSchema(native);
  await seedIfEmpty(native);

  const db = drizzle(native, { schema });
  _db = db;
  _native = native;
  return { db, native };
}

export async function getDb() {
  const { db } = await openDb();
  return db;
}

export async function getNative() {
  const { native } = await openDb();
  return native;
}

async function ensureBundledDbCopied() {
  const dir = `${FileSystem.documentDirectory}SQLite`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists)
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const target = `${dir}/${DB_NAME}`;
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) return;
  try {
    // Try to copy the bundled dict.db if present. Skipped gracefully if absent (v1 seed only).
    const asset = Asset.fromModule(require("../../assets/dict.db"));
    await asset.downloadAsync();
    if (asset.localUri) {
      const srcInfo = await FileSystem.getInfoAsync(asset.localUri);
      // Skip the placeholder (0-byte) dict.db shipped when build-dict hasn't been run.
      if (srcInfo.exists && "size" in srcInfo && (srcInfo.size ?? 0) > 1024) {
        await FileSystem.copyAsync({ from: asset.localUri, to: target });
        log.info("Bundled dict.db copied to docs dir");
      } else {
        log.info(
          "Placeholder dict.db detected — using seed words. Run `npm run build:dict` for full content.",
        );
      }
    }
  } catch (_e) {
    log.warn("No bundled dict.db; starting with empty DB + seed words.");
  }
}

async function createSchema(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY,
      kanji TEXT,
      kana TEXT NOT NULL,
      romaji TEXT NOT NULL,
      pos TEXT NOT NULL,
      gloss TEXT NOT NULL,
      jlpt INTEGER,
      pitch_accents TEXT,
      freq_rank INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_words_kana ON words(kana);
    CREATE INDEX IF NOT EXISTS idx_words_kanji ON words(kanji);
    CREATE INDEX IF NOT EXISTS idx_words_jlpt ON words(jlpt);

    CREATE TABLE IF NOT EXISTS kanji (
      literal TEXT PRIMARY KEY,
      onyomi TEXT,
      kunyomi TEXT,
      meanings TEXT,
      jlpt INTEGER,
      grade INTEGER,
      stroke_count INTEGER,
      svg_id TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER REFERENCES words(id),
      kind TEXT NOT NULL,
      fsrs_state TEXT NOT NULL,
      due INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_reviewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      register_target TEXT NOT NULL,
      jlpt_target INTEGER NOT NULL,
      turn_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE,
      session_id TEXT REFERENCES sessions(id),
      role TEXT NOT NULL,
      text_ja TEXT NOT NULL,
      text_en TEXT,
      furigana_json TEXT,
      audio_uri TEXT,
      reference_audio_uri TEXT,
      pitch_data_json TEXT,
      alignment_data_json TEXT,
      feedback_json TEXT,
      retry_of_turn_id TEXT,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS furigana_cache (
      hash TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS examples_cache (
      word_id INTEGER PRIMARY KEY,
      examples_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  await migrateTurnsForPronunciation(db);
}

async function migrateTurnsForPronunciation(db: SQLite.SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(turns)",
  );
  const existing = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["client_id", "TEXT"],
    ["reference_audio_uri", "TEXT"],
    ["alignment_data_json", "TEXT"],
    ["retry_of_turn_id", "TEXT"],
    ["attempt_number", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [name, declaration] of additions) {
    if (!existing.has(name)) {
      await db.execAsync(
        `ALTER TABLE turns ADD COLUMN ${name} ${declaration};`,
      );
    }
  }
  await db.execAsync(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_client_id ON turns(client_id);",
  );
}

export async function persistSession(input: {
  id: string;
  scenarioId?: string;
  registerTarget?: string;
  jlptTarget?: number;
  startedAt?: number;
}) {
  const db = await getNative();
  await db.runAsync(
    `INSERT INTO sessions
      (id, scenario_id, started_at, register_target, jlpt_target, turn_count)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO NOTHING`,
    [
      input.id,
      input.scenarioId ?? "open",
      input.startedAt ?? Date.now(),
      input.registerTarget ?? "neutral",
      input.jlptTarget ?? 3,
    ],
  );
}

export type PersistableTurn = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  textJa: string;
  textEn?: string;
  audioUri?: string;
  referenceAudioUri?: string;
  pitchData?: unknown;
  alignmentData?: unknown;
  feedback?: unknown;
  retryOfTurnId?: string;
  attemptNumber?: number;
  createdAt: number;
};

export async function persistTurn(turn: PersistableTurn) {
  const db = await getNative();
  await db.runAsync(
    `INSERT INTO turns
      (client_id, session_id, role, text_ja, text_en, audio_uri,
       reference_audio_uri, pitch_data_json, alignment_data_json,
       feedback_json, retry_of_turn_id, attempt_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       text_ja = excluded.text_ja,
       text_en = excluded.text_en,
       audio_uri = excluded.audio_uri,
       reference_audio_uri = excluded.reference_audio_uri,
       pitch_data_json = excluded.pitch_data_json,
       alignment_data_json = excluded.alignment_data_json,
       feedback_json = excluded.feedback_json,
       retry_of_turn_id = excluded.retry_of_turn_id,
       attempt_number = excluded.attempt_number`,
    [
      turn.id,
      turn.sessionId,
      turn.role,
      turn.textJa,
      turn.textEn ?? null,
      turn.audioUri ?? null,
      turn.referenceAudioUri ?? null,
      turn.pitchData === undefined ? null : JSON.stringify(turn.pitchData),
      turn.alignmentData === undefined
        ? null
        : JSON.stringify(turn.alignmentData),
      turn.feedback === undefined ? null : JSON.stringify(turn.feedback),
      turn.retryOfTurnId ?? null,
      turn.attemptNumber ?? 1,
      turn.createdAt,
    ],
  );
  await db.runAsync(
    `UPDATE sessions SET turn_count =
      (SELECT COUNT(*) FROM turns WHERE session_id = ?) WHERE id = ?`,
    [turn.sessionId, turn.sessionId],
  );
}

async function seedIfEmpty(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM words",
  );
  if ((row?.c ?? 0) > 0) return;
  log.info("Seeding dev vocab words...");
  for (const w of SEED_WORDS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO words (id, kanji, kana, romaji, pos, gloss, jlpt, pitch_accents, freq_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        w.id,
        w.kanji,
        w.kana,
        w.romaji,
        w.pos,
        w.gloss,
        w.jlpt,
        JSON.stringify(w.pitchAccents),
        w.freqRank,
      ],
    );
  }
}
