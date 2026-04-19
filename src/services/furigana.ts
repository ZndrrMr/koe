import { sha256 } from '@/utils/hash';
import { getNative } from '@/db';
import { postJson } from '@/services/api';
import { hasWorker } from '@/utils/config';
import { log } from '@/utils/log';

export type FuriganaRun = { base: string; reading?: string };

const HIRAGANA_BLOCK = /^[\u3040-\u309F]+$/;
const KATAKANA_BLOCK = /^[\u30A0-\u30FF\u31F0-\u31FF]+$/;
const KANJI_BLOCK = /[\u4E00-\u9FAF]/;

function splitByScript(text: string): FuriganaRun[] {
  const runs: FuriganaRun[] = [];
  let buf = '';
  let isKanji = false;
  for (const ch of text) {
    const kanji = KANJI_BLOCK.test(ch);
    if (kanji !== isKanji && buf.length) {
      runs.push({ base: buf });
      buf = '';
    }
    isKanji = kanji;
    buf += ch;
  }
  if (buf) runs.push({ base: buf });
  return runs;
}

export async function annotate(text: string): Promise<FuriganaRun[]> {
  if (!text.trim()) return [];

  // Fast path: no kanji at all.
  if (HIRAGANA_BLOCK.test(text) || KATAKANA_BLOCK.test(text)) {
    return [{ base: text }];
  }
  if (!KANJI_BLOCK.test(text)) {
    return [{ base: text }];
  }

  const key = await sha256(text);
  const db = await getNative();
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM furigana_cache WHERE hash = ?',
    [key],
  );
  if (row?.payload) {
    try {
      return JSON.parse(row.payload) as FuriganaRun[];
    } catch (e) {
      log.warn('Cached furigana parse failed', e);
    }
  }

  let runs: FuriganaRun[] = splitByScript(text);
  if (hasWorker()) {
    try {
      const res = await postJson<{ runs: FuriganaRun[] }>('/furigana', { text });
      if (res.runs?.length) runs = res.runs;
    } catch (e) {
      log.warn('Furigana worker call failed; using script-split fallback.', e);
    }
  }

  await db.runAsync(
    'INSERT OR REPLACE INTO furigana_cache (hash, payload, created_at) VALUES (?, ?, ?)',
    [key, JSON.stringify(runs), Date.now()],
  );

  return runs;
}
