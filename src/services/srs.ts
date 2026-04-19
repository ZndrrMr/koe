import { createEmptyCard, fsrs, Rating, State, type Card as FSRSCard, type Grade } from 'ts-fsrs';
import { getNative } from '@/db';
import type { Word } from '@/db/schema';
import { log } from '@/utils/log';

export type CardKind = 'recognition' | 'production' | 'pitch' | 'listening';
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

const GRADE_TO_RATING: Record<ReviewGrade, Rating> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const scheduler = fsrs();

export type CardRow = {
  id: number;
  wordId: number;
  kind: CardKind;
  fsrsState: string;
  due: number;
  createdAt: number;
  lastReviewedAt: number | null;
};

export type CardWithWord = CardRow & { word: Word };

function rowToFsrs(state: string): FSRSCard {
  try {
    const parsed = JSON.parse(state);
    return {
      ...createEmptyCard(),
      ...parsed,
      due: new Date(parsed.due),
      last_review: parsed.last_review ? new Date(parsed.last_review) : undefined,
    };
  } catch {
    return createEmptyCard();
  }
}

function fsrsToJson(card: FSRSCard): string {
  return JSON.stringify({
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  });
}

export async function addWordToSRS(wordId: number, kinds: CardKind[]): Promise<void> {
  const db = await getNative();
  const now = Date.now();
  for (const kind of kinds) {
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM cards WHERE word_id = ? AND kind = ?',
      [wordId, kind],
    );
    if (existing) continue;
    const card = createEmptyCard();
    await db.runAsync(
      `INSERT INTO cards (word_id, kind, fsrs_state, due, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [wordId, kind, fsrsToJson(card), card.due.getTime(), now],
    );
  }
}

export async function getDueCards(limit = 30): Promise<CardWithWord[]> {
  const db = await getNative();
  const now = Date.now();
  const rows = await db.getAllAsync<{
    id: number; word_id: number; kind: string; fsrs_state: string; due: number;
    created_at: number; last_reviewed_at: number | null;
    w_id: number; kanji: string | null; kana: string; romaji: string; pos: string; gloss: string;
    jlpt: number | null; pitch_accents: string | null; freq_rank: number | null;
  }>(
    `SELECT c.id, c.word_id, c.kind, c.fsrs_state, c.due, c.created_at, c.last_reviewed_at,
            w.id as w_id, w.kanji, w.kana, w.romaji, w.pos, w.gloss, w.jlpt, w.pitch_accents, w.freq_rank
     FROM cards c JOIN words w ON w.id = c.word_id
     WHERE c.due <= ?
     ORDER BY c.due ASC LIMIT ?`,
    [now, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    wordId: r.word_id,
    kind: r.kind as CardKind,
    fsrsState: r.fsrs_state,
    due: r.due,
    createdAt: r.created_at,
    lastReviewedAt: r.last_reviewed_at,
    word: {
      id: r.w_id, kanji: r.kanji, kana: r.kana, romaji: r.romaji, pos: r.pos, gloss: r.gloss,
      jlpt: r.jlpt, pitchAccents: r.pitch_accents, freqRank: r.freq_rank,
    },
  }));
}

export async function reviewCard(cardId: number, grade: ReviewGrade): Promise<void> {
  const db = await getNative();
  const row = await db.getFirstAsync<{ fsrs_state: string }>(
    'SELECT fsrs_state FROM cards WHERE id = ?',
    [cardId],
  );
  if (!row) {
    log.warn(`reviewCard: card ${cardId} not found`);
    return;
  }
  const now = new Date();
  const prev = rowToFsrs(row.fsrs_state);
  const { card } = scheduler.next(prev, now, GRADE_TO_RATING[grade] as Grade);
  await db.runAsync(
    `UPDATE cards SET fsrs_state = ?, due = ?, last_reviewed_at = ? WHERE id = ?`,
    [fsrsToJson(card), card.due.getTime(), now.getTime(), cardId],
  );
}

export async function getStats(): Promise<{
  total: number;
  dueToday: number;
  learnedThisWeek: number;
  masteryByJlpt: Record<1 | 2 | 3 | 4 | 5, number>;
}> {
  const db = await getNative();
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const weekAgo = now - 7 * 86400000;

  const total = (await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM cards'))?.c ?? 0;
  const dueToday = (await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM cards WHERE due <= ?',
    [endOfDay.getTime()],
  ))?.c ?? 0;
  const learnedThisWeek = (await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(DISTINCT word_id) as c FROM cards WHERE created_at >= ?',
    [weekAgo],
  ))?.c ?? 0;

  const masteryByJlpt: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byJlpt = await db.getAllAsync<{ jlpt: number; avg_due: number; c: number }>(
    `SELECT w.jlpt as jlpt, AVG(c.due - c.created_at) as avg_due, COUNT(*) as c
     FROM cards c JOIN words w ON w.id = c.word_id
     WHERE w.jlpt BETWEEN 1 AND 5
     GROUP BY w.jlpt`,
  );
  for (const r of byJlpt) {
    const key = r.jlpt as 1 | 2 | 3 | 4 | 5;
    masteryByJlpt[key] = Math.min(100, Math.round((r.avg_due / (30 * 86400000)) * 100));
  }

  return { total, dueToday, learnedThisWeek, masteryByJlpt };
}

export { State as FSRSState };
