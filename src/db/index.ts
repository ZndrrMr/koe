import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { log } from "@/utils/log";
import {
  buildSessionCloseout,
  type ConversationCorrections,
  type LearningMoment,
  type LearningMomentDecision,
  type LearningMomentKind,
  type SessionCloseout,
  type SessionTurnSnapshot,
} from "./sessionHistory";
import type { PronunciationFeedback } from "@/services/pitch";

const DB_NAME = "koe-voice.db";
const AUDIO_DIRECTORY = `${FileSystem.documentDirectory}session-audio`;
const AUDIO_RETENTION_SETTING = "audio_retention_days";
export const DEFAULT_AUDIO_RETENTION_DAYS = 30;
export const AUDIO_RETENTION_OPTIONS = [7, 30, 0] as const;
export type AudioRetentionDays = (typeof AUDIO_RETENTION_OPTIONS)[number];

let _native: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;

export async function openDb() {
  if (_native) return _native;
  if (!_opening) {
    _opening = openDbOnce().finally(() => {
      _opening = null;
    });
  }
  return _opening!;
}

async function openDbOnce() {
  const native = await SQLite.openDatabaseAsync(DB_NAME, {
    enableChangeListener: false,
  });
  await native.execAsync("PRAGMA journal_mode = WAL;");
  await native.execAsync("PRAGMA foreign_keys = ON;");
  await createSchema(native);
  await enforceAudioRetention(native);
  _native = native;
  return native;
}

export async function getNative() {
  return openDb();
}

async function createSchema(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      topic TEXT,
      response_level TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
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
      streaming INTEGER NOT NULL DEFAULT 0,
      interrupted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);

    CREATE TABLE IF NOT EXISTS learning_moments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      source_turn_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text_ja TEXT NOT NULL,
      text_en TEXT,
      note TEXT,
      audio_uri TEXT,
      score INTEGER,
      decision TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_moments_session
      ON learning_moments(session_id);
    CREATE INDEX IF NOT EXISTS idx_learning_moments_decision
      ON learning_moments(decision, created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS furigana_cache (
      hash TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

  `);
}

export async function persistSession(input: {
  id: string;
  topic?: string;
  responseLevel?: string;
  startedAt?: number;
}) {
  const db = await getNative();
  const now = input.startedAt ?? Date.now();
  await db.runAsync(
    `INSERT INTO sessions
      (id, topic, response_level, started_at, updated_at, status, turn_count)
     VALUES (?, ?, ?, ?, ?, 'active', 0)
     ON CONFLICT(id) DO NOTHING`,
    [input.id, input.topic ?? null, input.responseLevel ?? null, now, now],
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
  streaming?: boolean;
  interrupted?: boolean;
};

export async function persistTurn(
  turn: PersistableTurn,
): Promise<PersistableTurn> {
  const db = await getNative();
  const [audioUri, referenceAudioUri] = await Promise.all([
    persistManagedAudio(turn.sessionId, turn.id, "voice", turn.audioUri),
    persistManagedAudio(
      turn.sessionId,
      turn.id,
      "reference",
      turn.referenceAudioUri,
    ),
  ]);
  await db.runAsync(
    `INSERT INTO turns
      (client_id, session_id, role, text_ja, text_en, audio_uri,
       reference_audio_uri, pitch_data_json, alignment_data_json,
       feedback_json, retry_of_turn_id, attempt_number, streaming, interrupted,
       created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       text_ja = excluded.text_ja,
       text_en = excluded.text_en,
       audio_uri = excluded.audio_uri,
       reference_audio_uri = excluded.reference_audio_uri,
       pitch_data_json = excluded.pitch_data_json,
       alignment_data_json = excluded.alignment_data_json,
       feedback_json = excluded.feedback_json,
       retry_of_turn_id = excluded.retry_of_turn_id,
       attempt_number = excluded.attempt_number,
       streaming = excluded.streaming,
       interrupted = excluded.interrupted`,
    [
      turn.id,
      turn.sessionId,
      turn.role,
      turn.textJa,
      turn.textEn ?? null,
      audioUri ?? null,
      referenceAudioUri ?? null,
      turn.pitchData === undefined ? null : JSON.stringify(turn.pitchData),
      turn.alignmentData === undefined
        ? null
        : JSON.stringify(turn.alignmentData),
      turn.feedback === undefined ? null : JSON.stringify(turn.feedback),
      turn.retryOfTurnId ?? null,
      turn.attemptNumber ?? 1,
      turn.streaming ? 1 : 0,
      turn.interrupted ? 1 : 0,
      turn.createdAt,
    ],
  );
  await db.runAsync(
    `UPDATE sessions SET turn_count =
      (SELECT COUNT(*) FROM turns WHERE session_id = ?), updated_at = ?
     WHERE id = ?`,
    [turn.sessionId, Date.now(), turn.sessionId],
  );
  return { ...turn, audioUri, referenceAudioUri };
}

type SessionRow = {
  id: string;
  topic: string | null;
  response_level: string | null;
  started_at: number;
  ended_at: number | null;
  updated_at: number;
  status: "active" | "completed";
  turn_count: number;
};

type TurnRow = {
  id: number;
  client_id: string | null;
  role: "user" | "assistant";
  text_ja: string;
  text_en: string | null;
  audio_uri: string | null;
  reference_audio_uri: string | null;
  pitch_data_json: string | null;
  alignment_data_json: string | null;
  feedback_json: string | null;
  retry_of_turn_id: string | null;
  attempt_number: number;
  streaming: number;
  interrupted: number;
  created_at: number;
};

export type PersistedSession = {
  id: string;
  context: {
    topic?: string;
    responseLevel?: string;
  };
  startedAt: number;
  endedAt?: number;
  status: "active" | "completed";
  turns: SessionTurnSnapshot[];
  closeout?: SessionCloseout;
};

export type SessionSummary = {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "completed";
  turnCount: number;
};

export type SavedLearningMoment = LearningMoment & {
  sessionStartedAt: number;
};

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function hydrateTurn(row: TurnRow): SessionTurnSnapshot {
  const pitch = parseJson<{
    reference: PronunciationFeedback["reference"];
    attempt: PronunciationFeedback["attempt"];
  }>(row.pitch_data_json);
  const alignment = parseJson<{
    path: PronunciationFeedback["alignmentPath"];
    units: PronunciationFeedback["units"];
  }>(row.alignment_data_json);
  const feedback = parseJson<{
    corrections?: ConversationCorrections;
    pronunciation?: Partial<PronunciationFeedback>;
    version?: PronunciationFeedback["version"];
    status?: PronunciationFeedback["status"];
    targetText?: string;
    scores?: PronunciationFeedback["scores"];
    firstCorrection?: string;
    target?: PronunciationFeedback["target"];
    retry?: PronunciationFeedback["retry"];
  }>(row.feedback_json);
  const pronunciationMetadata = feedback?.pronunciation ?? feedback;
  const pronunciation =
    pitch && alignment && pronunciationMetadata?.scores
      ? ({
          version: pronunciationMetadata.version ?? 1,
          status: pronunciationMetadata.status ?? "aligned",
          targetText: pronunciationMetadata.targetText ?? row.text_ja,
          reference: pitch.reference,
          attempt: pitch.attempt,
          alignmentPath: alignment.path,
          units: alignment.units,
          scores: pronunciationMetadata.scores,
          firstCorrection: pronunciationMetadata.firstCorrection ?? "",
          target: pronunciationMetadata.target,
          retry: pronunciationMetadata.retry,
        } satisfies PronunciationFeedback)
      : undefined;
  return {
    id: row.client_id ?? `legacy-${row.id}`,
    role: row.role,
    textJa: row.text_ja,
    textEn: row.text_en ?? undefined,
    audioUri: row.audio_uri ?? undefined,
    referenceAudioUri: row.reference_audio_uri ?? undefined,
    pronunciation,
    retryOfTurnId: row.retry_of_turn_id ?? undefined,
    attemptNumber: row.attempt_number,
    corrections: feedback?.corrections,
    createdAt: row.created_at,
    streaming: Boolean(row.streaming),
    interrupted: Boolean(row.interrupted),
  };
}

export async function loadSession(
  id: string,
): Promise<PersistedSession | null> {
  const db = await getNative();
  const session = await db.getFirstAsync<SessionRow>(
    "SELECT * FROM sessions WHERE id = ?",
    [id],
  );
  if (!session) return null;
  const rows = await db.getAllAsync<TurnRow>(
    `SELECT id, client_id, role, text_ja, text_en, audio_uri,
       reference_audio_uri, pitch_data_json, alignment_data_json,
       feedback_json, retry_of_turn_id, attempt_number, streaming, interrupted,
       created_at
     FROM turns WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
    [id],
  );
  const hadInterruptedStream = rows.some((row) => Boolean(row.streaming));
  if (hadInterruptedStream) {
    await db.runAsync(
      "UPDATE turns SET streaming = 0, interrupted = 1 WHERE session_id = ? AND streaming = 1",
      [id],
    );
  }
  const turns = rows.map((row) =>
    hydrateTurn(
      hadInterruptedStream && row.streaming
        ? { ...row, streaming: 0, interrupted: 1 }
        : row,
    ),
  );
  const momentRows = await db.getAllAsync<LearningMomentRow>(
    "SELECT * FROM learning_moments WHERE session_id = ? ORDER BY created_at ASC",
    [id],
  );
  const moments = momentRows.map(rowToMoment);
  const closeout = moments.length
    ? {
        sessionId: id,
        generatedAt: Math.max(...moments.map((moment) => moment.createdAt)),
        moments,
      }
    : undefined;
  return {
    id: session.id,
    context: {
      topic: session.topic ?? undefined,
      responseLevel: session.response_level ?? undefined,
    },
    startedAt: session.started_at,
    endedAt: session.ended_at ?? undefined,
    status: session.status,
    turns,
    closeout,
  };
}

export async function getLatestActiveSession(): Promise<SessionSummary | null> {
  const db = await getNative();
  const row = await db.getFirstAsync<{
    id: string;
    started_at: number;
    ended_at: number | null;
    status: "active" | "completed";
    turn_count: number;
  }>(
    `SELECT id, started_at, ended_at, status, turn_count
     FROM sessions
     WHERE status = 'active' AND turn_count > 0
     ORDER BY updated_at DESC LIMIT 1`,
  );
  return row
    ? {
        id: row.id,
        startedAt: row.started_at,
        endedAt: row.ended_at ?? undefined,
        status: row.status,
        turnCount: row.turn_count,
      }
    : null;
}

type LearningMomentRow = {
  id: string;
  session_id: string;
  source_turn_id: string;
  kind: LearningMomentKind;
  text_ja: string;
  text_en: string | null;
  note: string | null;
  audio_uri: string | null;
  score: number | null;
  decision: LearningMomentDecision;
  created_at: number;
};

function rowToMoment(row: LearningMomentRow): LearningMoment {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceTurnId: row.source_turn_id,
    kind: row.kind,
    textJa: row.text_ja,
    textEn: row.text_en ?? undefined,
    note: row.note ?? undefined,
    audioUri: row.audio_uri ?? undefined,
    score: row.score ?? undefined,
    decision: row.decision,
    createdAt: row.created_at,
  };
}

export async function listSavedMoments(
  limit = 50,
): Promise<SavedLearningMoment[]> {
  const db = await getNative();
  const rows = await db.getAllAsync<{
    id: string;
    session_id: string;
    source_turn_id: string;
    kind: LearningMomentKind;
    text_ja: string;
    text_en: string | null;
    note: string | null;
    audio_uri: string | null;
    score: number | null;
    decision: LearningMomentDecision;
    created_at: number;
    session_started_at: number;
  }>(
    `SELECT m.*, s.started_at AS session_started_at
     FROM learning_moments m
     JOIN sessions s ON s.id = m.session_id
     WHERE m.decision = 'saved'
     ORDER BY m.created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    ...rowToMoment(row),
    sessionStartedAt: row.session_started_at,
  }));
}

async function writeCloseoutMoments(
  db: SQLite.SQLiteDatabase,
  closeout: SessionCloseout,
) {
  for (const moment of closeout.moments) {
    await db.runAsync(
      `INSERT INTO learning_moments
        (id, session_id, source_turn_id, kind, text_ja, text_en, note,
         audio_uri, score, decision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text_ja = excluded.text_ja,
         text_en = excluded.text_en,
         note = excluded.note,
         audio_uri = excluded.audio_uri,
         score = excluded.score`,
      [
        moment.id,
        moment.sessionId,
        moment.sourceTurnId,
        moment.kind,
        moment.textJa,
        moment.textEn ?? null,
        moment.note ?? null,
        moment.audioUri ?? null,
        moment.score ?? null,
        moment.decision,
        moment.createdAt,
      ],
    );
  }
}

async function closeoutWithStoredDecisions(
  db: SQLite.SQLiteDatabase,
  closeout: SessionCloseout,
): Promise<SessionCloseout> {
  const rows = await db.getAllAsync<{
    id: string;
    decision: LearningMomentDecision;
  }>("SELECT id, decision FROM learning_moments WHERE session_id = ?", [
    closeout.sessionId,
  ]);
  const decisions = new Map(rows.map((row) => [row.id, row.decision]));
  return {
    ...closeout,
    moments: closeout.moments.map((moment) => ({
      ...moment,
      decision: decisions.get(moment.id) ?? moment.decision,
    })),
  };
}

export async function prepareSessionCloseout(
  sessionId: string,
  turns: SessionTurnSnapshot[],
): Promise<SessionCloseout> {
  const db = await getNative();
  const audioRows = await db.getAllAsync<{
    client_id: string | null;
    audio_uri: string | null;
  }>("SELECT client_id, audio_uri FROM turns WHERE session_id = ?", [
    sessionId,
  ]);
  const audioByTurn = new Map(
    audioRows
      .filter((row) => Boolean(row.client_id))
      .map((row) => [row.client_id!, row.audio_uri ?? undefined]),
  );
  const generated = buildSessionCloseout(sessionId, turns);
  const closeout = {
    ...generated,
    moments: generated.moments.map((moment) => ({
      ...moment,
      audioUri: audioByTurn.get(moment.sourceTurnId) ?? moment.audioUri,
    })),
  };
  await writeCloseoutMoments(db, closeout);
  const resolved = await closeoutWithStoredDecisions(db, closeout);
  await db.runAsync("UPDATE sessions SET updated_at = ? WHERE id = ?", [
    Date.now(),
    sessionId,
  ]);
  return resolved;
}

export async function completeSession(
  sessionId: string,
  turns: SessionTurnSnapshot[],
): Promise<SessionCloseout> {
  const closeout = await prepareSessionCloseout(sessionId, turns);
  const db = await getNative();
  const endedAt = Date.now();
  await db.runAsync(
    `UPDATE sessions SET ended_at = ?, updated_at = ?, status = 'completed'
     WHERE id = ?`,
    [endedAt, endedAt, sessionId],
  );
  return closeout;
}

export async function setLearningMomentDecision(
  sessionId: string,
  momentId: string,
  decision: LearningMomentDecision,
): Promise<void> {
  const db = await getNative();
  await db.runAsync(
    "UPDATE learning_moments SET decision = ? WHERE id = ? AND session_id = ?",
    [decision, momentId, sessionId],
  );
}

export async function getAudioRetentionDays(): Promise<AudioRetentionDays> {
  const db = await getNative();
  return readAudioRetentionDays(db);
}

export async function setAudioRetentionDays(
  days: AudioRetentionDays,
): Promise<number> {
  const db = await getNative();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [AUDIO_RETENTION_SETTING, String(days)],
  );
  return enforceAudioRetention(db);
}

export async function purgeExpiredAudio(): Promise<number> {
  const db = await getNative();
  return enforceAudioRetention(db);
}

async function readAudioRetentionDays(
  db: SQLite.SQLiteDatabase,
): Promise<AudioRetentionDays> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [AUDIO_RETENTION_SETTING],
  );
  const parsed = Number(row?.value ?? DEFAULT_AUDIO_RETENTION_DAYS);
  return AUDIO_RETENTION_OPTIONS.includes(parsed as AudioRetentionDays)
    ? (parsed as AudioRetentionDays)
    : DEFAULT_AUDIO_RETENTION_DAYS;
}

async function enforceAudioRetention(
  db: SQLite.SQLiteDatabase,
): Promise<number> {
  const days = await readAudioRetentionDays(db);
  if (days === 0) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
  const sessions = await db.getAllAsync<{ id: string }>(
    `SELECT DISTINCT s.id FROM sessions s
     JOIN turns t ON t.session_id = s.id
     WHERE COALESCE(s.ended_at, s.updated_at, s.started_at) < ?
       AND (t.audio_uri IS NOT NULL OR t.reference_audio_uri IS NOT NULL)`,
    [cutoff],
  );
  for (const session of sessions) {
    await FileSystem.deleteAsync(sessionAudioDirectory(session.id), {
      idempotent: true,
    }).catch((error) => log.warn("Could not expire session audio", error));
    await db.runAsync(
      "UPDATE turns SET audio_uri = NULL, reference_audio_uri = NULL WHERE session_id = ?",
      [session.id],
    );
    await db.runAsync(
      "UPDATE learning_moments SET audio_uri = NULL WHERE session_id = ?",
      [session.id],
    );
  }
  return sessions.length;
}

function safePathComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function sessionAudioDirectory(sessionId: string): string {
  return `${AUDIO_DIRECTORY}/${safePathComponent(sessionId)}`;
}

async function persistManagedAudio(
  sessionId: string,
  turnId: string,
  kind: "voice" | "reference",
  source?: string,
): Promise<string | undefined> {
  if (!source) return undefined;
  const directory = sessionAudioDirectory(sessionId);
  if (source.startsWith(`${directory}/`)) return source;
  try {
    const sourceInfo = await FileSystem.getInfoAsync(source);
    if (!sourceInfo.exists) return source;
    const extensionMatch = source.split("?")[0].match(/\.([a-zA-Z0-9]{2,5})$/);
    const extension = extensionMatch?.[1]?.toLowerCase() ?? "m4a";
    const destination = `${directory}/${safePathComponent(turnId)}-${kind}.${extension}`;
    const directoryInfo = await FileSystem.getInfoAsync(directory);
    if (!directoryInfo.exists) {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    }
    const destinationInfo = await FileSystem.getInfoAsync(destination);
    if (!destinationInfo.exists) {
      await FileSystem.copyAsync({ from: source, to: destination });
    }
    return destination;
  } catch (error) {
    log.warn("Could not archive session audio", error);
    return source;
  }
}
