import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const words = sqliteTable('words', {
  id: integer('id').primaryKey(),
  kanji: text('kanji'),
  kana: text('kana').notNull(),
  romaji: text('romaji').notNull(),
  pos: text('pos').notNull(),
  gloss: text('gloss').notNull(),
  jlpt: integer('jlpt'),
  pitchAccents: text('pitch_accents'),
  freqRank: integer('freq_rank'),
});

export const kanji = sqliteTable('kanji', {
  literal: text('literal').primaryKey(),
  onyomi: text('onyomi'),
  kunyomi: text('kunyomi'),
  meanings: text('meanings'),
  jlpt: integer('jlpt'),
  grade: integer('grade'),
  strokeCount: integer('stroke_count'),
  svgId: text('svg_id'),
});

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wordId: integer('word_id').references(() => words.id),
  kind: text('kind').notNull(),
  fsrsState: text('fsrs_state').notNull(),
  due: integer('due').notNull(),
  createdAt: integer('created_at').notNull(),
  lastReviewedAt: integer('last_reviewed_at'),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  scenarioId: text('scenario_id').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  registerTarget: text('register_target').notNull(),
  jlptTarget: integer('jlpt_target').notNull(),
  turnCount: integer('turn_count').notNull().default(0),
});

export const turns = sqliteTable('turns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id),
  role: text('role').notNull(),
  textJa: text('text_ja').notNull(),
  textEn: text('text_en'),
  furiganaJson: text('furigana_json'),
  audioUri: text('audio_uri'),
  pitchDataJson: text('pitch_data_json'),
  feedbackJson: text('feedback_json'),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const furiganaCache = sqliteTable('furigana_cache', {
  hash: text('hash').primaryKey(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const examplesCache = sqliteTable('examples_cache', {
  wordId: integer('word_id').primaryKey(),
  examplesJson: text('examples_json').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type Word = typeof words.$inferSelect;
export type Kanji = typeof kanji.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Turn = typeof turns.$inferSelect;
