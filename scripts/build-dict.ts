#!/usr/bin/env tsx
/**
 * Dict build script.
 *
 * Downloads JMdict, KANJIDIC2, Kanjium pitch accents, and KanjiVG,
 * then produces:
 *   assets/dict.db          — SQLite bundle used at app launch
 *   assets/strokes/*.svg    — KanjiVG stroke files bundled by Metro
 *
 * Run once locally before building the app:
 *   npm run build:dict
 *
 * Dependencies (installed on demand at script startup):
 *   better-sqlite3, node-gyp-build helpers
 *   xml2js for EDRDG XML parsing
 *   tar, gunzip, adm-zip for archives
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const CACHE = resolve(ROOT, 'scripts/.cache');
const ASSETS = resolve(ROOT, 'assets');
const STROKES_DIR = join(ASSETS, 'strokes');

const URLS = {
  jmdict: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
  kanjidic: 'http://www.edrdg.org/kanjidic/kanjidic2.xml.gz',
  kanjium: 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt',
  kanjivg: 'https://github.com/KanjiVG/kanjivg/releases/download/r20220427/kanjivg-20220427-main.zip',
};

async function ensureDirs() {
  for (const p of [CACHE, ASSETS, STROKES_DIR]) {
    await mkdir(p, { recursive: true });
  }
}

async function download(url: string, dest: string) {
  if (existsSync(dest)) {
    console.log(`[build-dict] cache hit: ${dest}`);
    return;
  }
  console.log(`[build-dict] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  writeFileSync(dest, Buffer.from(arrayBuffer));
}

async function gunzipTo(src: string, dest: string) {
  if (existsSync(dest)) return;
  console.log(`[build-dict] gunzip ${src} → ${dest}`);
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
}

function ensurePackage(pkg: string) {
  try { require.resolve(pkg); return; } catch {}
  console.log(`[build-dict] installing ${pkg}…`);
  const res = spawnSync('npm', ['i', '--no-save', pkg], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`failed to install ${pkg}`);
}

async function main() {
  await ensureDirs();

  const jmdictGz = join(CACHE, 'JMdict_e.gz');
  const jmdictXml = join(CACHE, 'JMdict_e.xml');
  const kanjidicGz = join(CACHE, 'kanjidic2.xml.gz');
  const kanjidicXml = join(CACHE, 'kanjidic2.xml');
  const kanjiumTxt = join(CACHE, 'kanjium-accents.txt');
  const kvZip = join(CACHE, 'kanjivg.zip');

  await Promise.all([
    download(URLS.jmdict, jmdictGz),
    download(URLS.kanjidic, kanjidicGz),
    download(URLS.kanjium, kanjiumTxt),
    download(URLS.kanjivg, kvZip),
  ]);

  await gunzipTo(jmdictGz, jmdictXml);
  await gunzipTo(kanjidicGz, kanjidicXml);

  ensurePackage('better-sqlite3');
  ensurePackage('xml2js');
  ensurePackage('adm-zip');

  const Database = require('better-sqlite3');
  const { parseStringPromise } = require('xml2js');
  const AdmZip = require('adm-zip');

  const dbPath = join(ASSETS, 'dict.db');
  if (existsSync(dbPath)) {
    console.log(`[build-dict] removing existing ${dbPath}`);
    spawnSync('rm', ['-f', dbPath]);
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY, kanji TEXT, kana TEXT NOT NULL, romaji TEXT NOT NULL,
      pos TEXT NOT NULL, gloss TEXT NOT NULL, jlpt INTEGER,
      pitch_accents TEXT, freq_rank INTEGER
    );
    CREATE TABLE IF NOT EXISTS kanji (
      literal TEXT PRIMARY KEY, onyomi TEXT, kunyomi TEXT, meanings TEXT,
      jlpt INTEGER, grade INTEGER, stroke_count INTEGER, svg_id TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS furigana_cache (hash TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS examples_cache (word_id INTEGER PRIMARY KEY, examples_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_words_kana ON words(kana);
    CREATE INDEX IF NOT EXISTS idx_words_kanji ON words(kanji);
    CREATE INDEX IF NOT EXISTS idx_words_jlpt ON words(jlpt);
  `);

  // ---- Kanjium pitch map (reading → [accent positions]) ----
  const pitchMap = new Map<string, number[]>();
  for (const raw of readFileSync(kanjiumTxt, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [, reading, accents] = parts;
    const nums = accents.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
    if (!reading || !nums.length) continue;
    pitchMap.set(reading, nums);
  }
  console.log(`[build-dict] loaded ${pitchMap.size} pitch entries`);

  // ---- JMdict ingest ----
  console.log('[build-dict] parsing JMdict (this takes ~30s)');
  const xml = readFileSync(jmdictXml, 'utf8');
  const parsed = await parseStringPromise(xml, { trim: true });
  const entries = parsed?.JMdict?.entry ?? [];
  console.log(`[build-dict] JMdict entries: ${entries.length}`);

  const insertWord = db.prepare(
    `INSERT OR REPLACE INTO words (id, kanji, kana, romaji, pos, gloss, jlpt, pitch_accents, freq_rank)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: any[]) => {
    for (const r of rows) insertWord.run(r);
  });

  const rows: any[] = [];
  for (const e of entries) {
    const id = Number(e.ent_seq?.[0] ?? 0);
    const kanjiElems = (e.k_ele ?? []).map((k: any) => k.keb?.[0]).filter(Boolean);
    const kanaElems = (e.r_ele ?? []).map((r: any) => r.reb?.[0]).filter(Boolean);
    if (!kanaElems.length) continue;
    const kana = kanaElems[0];
    const kanji = kanjiElems[0] ?? null;

    const senses = e.sense ?? [];
    const gloss = senses
      .flatMap((s: any) => (s.gloss ?? []).map((g: any) => (typeof g === 'string' ? g : g._)))
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ');
    const pos = senses
      .flatMap((s: any) => s.pos ?? [])
      .map((p: any) => (typeof p === 'string' ? p : p._))
      .filter(Boolean)
      .slice(0, 4)
      .join(',');
    const gi = ((e.k_ele?.[0]?.ke_pri ?? []) as string[]).concat((e.r_ele?.[0]?.re_pri ?? []) as string[]);
    const freqRank = gi.some((g: string) => /nf\d+/.test(g))
      ? Math.min(...gi.filter((g: string) => g.startsWith('nf')).map((g: string) => Number(g.slice(2)))) * 500
      : null;

    const accents = pitchMap.get(kana) ?? [];
    const pitchAccents = accents.map((pos) => ({
      mora: pos,
      pattern: pos === 0 ? 'heiban' : pos === 1 ? 'atamadaka' : pos >= kana.length ? 'odaka' : 'nakadaka',
      dropMora: pos === 0 ? null : pos,
    }));
    const jlpt = null; // JMdict_e does not carry JLPT; a separate tag list would fill this.

    rows.push([id, kanji, kana, toRomaji(kana), pos, gloss, jlpt, JSON.stringify(pitchAccents), freqRank]);
    if (rows.length >= 5000) { tx(rows); rows.length = 0; }
  }
  if (rows.length) tx(rows);

  // ---- KANJIDIC2 ingest ----
  console.log('[build-dict] parsing KANJIDIC2');
  const kXml = readFileSync(kanjidicXml, 'utf8');
  const kParsed = await parseStringPromise(kXml, { trim: true });
  const characters = kParsed?.kanjidic2?.character ?? [];
  console.log(`[build-dict] KANJIDIC2 characters: ${characters.length}`);

  const insertKanji = db.prepare(
    `INSERT OR REPLACE INTO kanji (literal, onyomi, kunyomi, meanings, jlpt, grade, stroke_count, svg_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ktx = db.transaction((rows: any[]) => { for (const r of rows) insertKanji.run(r); });
  const krows: any[] = [];
  for (const ch of characters) {
    const literal = ch.literal?.[0];
    if (!literal) continue;
    const misc = ch.misc?.[0];
    const rm = ch.reading_meaning?.[0]?.rmgroup?.[0];
    const ons = (rm?.reading ?? [])
      .filter((r: any) => r.$?.r_type === 'ja_on')
      .map((r: any) => r._).join(',');
    const kuns = (rm?.reading ?? [])
      .filter((r: any) => r.$?.r_type === 'ja_kun')
      .map((r: any) => r._).join(',');
    const meanings = (rm?.meaning ?? [])
      .filter((m: any) => typeof m === 'string' || !m.$?.m_lang || m.$?.m_lang === 'en')
      .map((m: any) => (typeof m === 'string' ? m : m._))
      .join('|');
    const grade = Number(misc?.grade?.[0] ?? 0) || null;
    const strokeCount = Number(misc?.stroke_count?.[0] ?? 0) || null;
    const jlpt = Number(misc?.jlpt?.[0] ?? 0) || null;
    const svgId = literal.codePointAt(0)?.toString(16).padStart(5, '0') ?? null;
    krows.push([literal, ons, kuns, meanings, jlpt, grade, strokeCount, svgId]);
  }
  ktx(krows);

  // ---- KanjiVG SVG extraction ----
  console.log('[build-dict] extracting KanjiVG SVGs');
  const zip = new AdmZip(kvZip);
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (!name.endsWith('.svg') || !/kanji\/[0-9a-f]{5}\.svg$/.test(name)) continue;
    const base = name.split('/').pop()!;
    writeFileSync(join(STROKES_DIR, base), entry.getData());
    count++;
  }
  console.log(`[build-dict] wrote ${count} SVGs to ${STROKES_DIR}`);

  db.close();
  console.log(`[build-dict] done → ${dbPath}`);
}

function toRomaji(kana: string): string {
  // Very small hiragana→romaji map. Good enough for the romaji column.
  const map: Record<string, string> = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
    か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
    た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
    は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
    や: 'ya', ゆ: 'yu', よ: 'yo',
    ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
    わ: 'wa', を: 'wo', ん: 'n',
    が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
    ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
    ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
    ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  };
  return [...kana].map((c) => map[c] ?? c).join('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
