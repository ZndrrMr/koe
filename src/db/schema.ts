import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const words = sqliteTable("words", {
  id: integer("id").primaryKey(),
  kanji: text("kanji"),
  kana: text("kana").notNull(),
  romaji: text("romaji").notNull(),
  pos: text("pos").notNull(),
  gloss: text("gloss").notNull(),
  jlpt: integer("jlpt"),
  pitchAccents: text("pitch_accents"),
  freqRank: integer("freq_rank"),
});

export const kanji = sqliteTable("kanji", {
  literal: text("literal").primaryKey(),
  onyomi: text("onyomi"),
  kunyomi: text("kunyomi"),
  meanings: text("meanings"),
  jlpt: integer("jlpt"),
  grade: integer("grade"),
  strokeCount: integer("stroke_count"),
  svgId: text("svg_id"),
});

export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wordId: integer("word_id").references(() => words.id),
  kind: text("kind").notNull(),
  fsrsState: text("fsrs_state").notNull(),
  due: integer("due").notNull(),
  createdAt: integer("created_at").notNull(),
  lastReviewedAt: integer("last_reviewed_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  topic: text("topic"),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  updatedAt: integer("updated_at").notNull(),
  status: text("status").notNull().default("active"),
  registerTarget: text("register_target").notNull(),
  jlptTarget: integer("jlpt_target").notNull(),
  turnCount: integer("turn_count").notNull().default(0),
  closeoutJson: text("closeout_json"),
});

export const turns = sqliteTable("turns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id").unique(),
  sessionId: text("session_id").references(() => sessions.id),
  role: text("role").notNull(),
  textJa: text("text_ja").notNull(),
  textEn: text("text_en"),
  furiganaJson: text("furigana_json"),
  audioUri: text("audio_uri"),
  referenceAudioUri: text("reference_audio_uri"),
  pitchDataJson: text("pitch_data_json"),
  alignmentDataJson: text("alignment_data_json"),
  feedbackJson: text("feedback_json"),
  retryOfTurnId: text("retry_of_turn_id"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  streaming: integer("streaming", { mode: "boolean" }).notNull().default(false),
  interrupted: integer("interrupted", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull(),
});

export const learningMoments = sqliteTable("learning_moments", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  sourceTurnId: text("source_turn_id").notNull(),
  kind: text("kind").notNull(),
  textJa: text("text_ja").notNull(),
  textEn: text("text_en"),
  note: text("note"),
  audioUri: text("audio_uri"),
  score: integer("score"),
  decision: text("decision").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const furiganaCache = sqliteTable("furigana_cache", {
  hash: text("hash").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const examplesCache = sqliteTable("examples_cache", {
  wordId: integer("word_id").primaryKey(),
  examplesJson: text("examples_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Word = typeof words.$inferSelect;
export type Kanji = typeof kanji.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Turn = typeof turns.$inferSelect;
export type LearningMomentRow = typeof learningMoments.$inferSelect;
