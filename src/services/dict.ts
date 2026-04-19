import { getNative } from '@/db';
import { postJson } from '@/services/api';
import { hasWorker } from '@/utils/config';
import { log } from '@/utils/log';
import type { Word, Kanji } from '@/db/schema';

function rowToWord(r: {
  id: number; kanji: string | null; kana: string; romaji: string; pos: string; gloss: string;
  jlpt: number | null; pitch_accents: string | null; freq_rank: number | null;
}): Word {
  return {
    id: r.id, kanji: r.kanji, kana: r.kana, romaji: r.romaji, pos: r.pos, gloss: r.gloss,
    jlpt: r.jlpt, pitchAccents: r.pitch_accents, freqRank: r.freq_rank,
  };
}

function rowToKanji(r: {
  literal: string; onyomi: string | null; kunyomi: string | null; meanings: string | null;
  jlpt: number | null; grade: number | null; stroke_count: number | null; svg_id: string | null;
}): Kanji {
  return {
    literal: r.literal, onyomi: r.onyomi, kunyomi: r.kunyomi, meanings: r.meanings,
    jlpt: r.jlpt, grade: r.grade, strokeCount: r.stroke_count, svgId: r.svg_id,
  };
}

export async function searchWord(query: string): Promise<Word[]> {
  const db = await getNative();
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM words
     WHERE kanji LIKE ? OR kana LIKE ? OR romaji LIKE ? OR gloss LIKE ?
     ORDER BY COALESCE(freq_rank, 9999) ASC
     LIMIT 50`,
    [like, like, like, like],
  );
  return rows.map(rowToWord);
}

export async function listByJlpt(jlpt: number, limit = 100, offset = 0): Promise<Word[]> {
  const db = await getNative();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM words WHERE jlpt = ? ORDER BY COALESCE(freq_rank, 9999) ASC LIMIT ? OFFSET ?`,
    [jlpt, limit, offset],
  );
  return rows.map(rowToWord);
}

export async function listAllWords(limit = 200, offset = 0): Promise<Word[]> {
  const db = await getNative();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM words ORDER BY COALESCE(freq_rank, 9999) ASC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map(rowToWord);
}

export async function getWord(id: number): Promise<Word | null> {
  const db = await getNative();
  const row = await db.getFirstAsync<any>('SELECT * FROM words WHERE id = ?', [id]);
  return row ? rowToWord(row) : null;
}

export async function getKanji(literal: string): Promise<Kanji | null> {
  const db = await getNative();
  const row = await db.getFirstAsync<any>('SELECT * FROM kanji WHERE literal = ?', [literal]);
  return row ? rowToKanji(row) : null;
}

export async function suggestExamples(wordId: number): Promise<string[]> {
  const db = await getNative();
  const cached = await db.getFirstAsync<{ examples_json: string }>(
    'SELECT examples_json FROM examples_cache WHERE word_id = ?',
    [wordId],
  );
  if (cached?.examples_json) {
    try { return JSON.parse(cached.examples_json) as string[]; } catch {}
  }
  if (!hasWorker()) return [];
  const word = await getWord(wordId);
  if (!word) return [];
  try {
    const res = await postJson<{ examples: string[] }>('/llm/flash', {
      task: 'examples',
      word: word.kanji ?? word.kana,
      kana: word.kana,
      gloss: word.gloss,
    });
    const examples = res.examples ?? [];
    await db.runAsync(
      'INSERT OR REPLACE INTO examples_cache (word_id, examples_json, created_at) VALUES (?, ?, ?)',
      [wordId, JSON.stringify(examples), Date.now()],
    );
    return examples;
  } catch (e) {
    log.warn('examples fetch failed', e);
    return [];
  }
}
