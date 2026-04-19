export type PitchAccent = {
  mora: number;
  pattern: 'atamadaka' | 'heiban' | 'nakadaka' | 'odaka';
  dropMora: number | null;
};

export type SeedWord = {
  id: number;
  kanji: string | null;
  kana: string;
  romaji: string;
  pos: string;
  gloss: string;
  jlpt: number;
  pitchAccents: PitchAccent[];
  freqRank: number;
};

/**
 * Development seed: ~60 common N5 words with pitch data.
 * In production this is replaced by the JMdict-built assets/dict.db (~40MB).
 */
export const SEED_WORDS: SeedWord[] = [
  { id: 1, kanji: '今日', kana: 'きょう', romaji: 'kyou', pos: 'n,n-adv', gloss: 'today', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 12 },
  { id: 2, kanji: '明日', kana: 'あした', romaji: 'ashita', pos: 'n,n-adv', gloss: 'tomorrow', jlpt: 5, pitchAccents: [{ mora: 3, pattern: 'heiban', dropMora: null }], freqRank: 120 },
  { id: 3, kanji: '昨日', kana: 'きのう', romaji: 'kinou', pos: 'n,n-adv', gloss: 'yesterday', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 180 },
  { id: 4, kanji: '学生', kana: 'がくせい', romaji: 'gakusei', pos: 'n', gloss: 'student', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 240 },
  { id: 5, kanji: '先生', kana: 'せんせい', romaji: 'sensei', pos: 'n', gloss: 'teacher|doctor|honorific for professional', jlpt: 5, pitchAccents: [{ mora: 3, pattern: 'nakadaka', dropMora: 3 }], freqRank: 200 },
  { id: 6, kanji: '食べる', kana: 'たべる', romaji: 'taberu', pos: 'v1,vt', gloss: 'to eat', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 80 },
  { id: 7, kanji: '飲む', kana: 'のむ', romaji: 'nomu', pos: 'v5m,vt', gloss: 'to drink', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 150 },
  { id: 8, kanji: '行く', kana: 'いく', romaji: 'iku', pos: 'v5k-s,vi', gloss: 'to go', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 20 },
  { id: 9, kanji: '来る', kana: 'くる', romaji: 'kuru', pos: 'vk,vi', gloss: 'to come', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 40 },
  { id: 10, kanji: '見る', kana: 'みる', romaji: 'miru', pos: 'v1,vt', gloss: 'to see|to watch', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 60 },
  { id: 11, kanji: '聞く', kana: 'きく', romaji: 'kiku', pos: 'v5k,vt', gloss: 'to listen|to ask', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 95 },
  { id: 12, kanji: '話す', kana: 'はなす', romaji: 'hanasu', pos: 'v5s,vt', gloss: 'to speak|to talk', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 110 },
  { id: 13, kanji: '読む', kana: 'よむ', romaji: 'yomu', pos: 'v5m,vt', gloss: 'to read', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 130 },
  { id: 14, kanji: '書く', kana: 'かく', romaji: 'kaku', pos: 'v5k,vt', gloss: 'to write', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 115 },
  { id: 15, kanji: '水', kana: 'みず', romaji: 'mizu', pos: 'n', gloss: 'water', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 70 },
  { id: 16, kanji: 'お茶', kana: 'おちゃ', romaji: 'ocha', pos: 'n', gloss: 'tea', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 300 },
  { id: 17, kanji: 'ビール', kana: 'ビール', romaji: 'biiru', pos: 'n', gloss: 'beer', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 900 },
  { id: 18, kanji: 'お願い', kana: 'おねがい', romaji: 'onegai', pos: 'n,vs', gloss: 'request|please', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 90 },
  { id: 19, kanji: 'すみません', kana: 'すみません', romaji: 'sumimasen', pos: 'int,exp', gloss: 'excuse me|sorry|thank you', jlpt: 5, pitchAccents: [{ mora: 4, pattern: 'nakadaka', dropMora: 4 }], freqRank: 50 },
  { id: 20, kanji: 'ありがとう', kana: 'ありがとう', romaji: 'arigatou', pos: 'int,exp', gloss: 'thank you', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 55 },
  { id: 21, kanji: 'こんにちは', kana: 'こんにちは', romaji: 'konnichiwa', pos: 'int,exp', gloss: 'hello|good afternoon', jlpt: 5, pitchAccents: [{ mora: 5, pattern: 'nakadaka', dropMora: 5 }], freqRank: 65 },
  { id: 22, kanji: 'おはよう', kana: 'おはよう', romaji: 'ohayou', pos: 'int,exp', gloss: 'good morning', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 160 },
  { id: 23, kanji: 'こんばんは', kana: 'こんばんは', romaji: 'konbanwa', pos: 'int,exp', gloss: 'good evening', jlpt: 5, pitchAccents: [{ mora: 5, pattern: 'nakadaka', dropMora: 5 }], freqRank: 500 },
  { id: 24, kanji: 'さようなら', kana: 'さようなら', romaji: 'sayounara', pos: 'int,exp', gloss: 'goodbye', jlpt: 5, pitchAccents: [{ mora: 5, pattern: 'nakadaka', dropMora: 5 }], freqRank: 450 },
  { id: 25, kanji: 'はい', kana: 'はい', romaji: 'hai', pos: 'int', gloss: 'yes', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 10 },
  { id: 26, kanji: 'いいえ', kana: 'いいえ', romaji: 'iie', pos: 'int', gloss: 'no', jlpt: 5, pitchAccents: [{ mora: 3, pattern: 'odaka', dropMora: 3 }], freqRank: 210 },
  { id: 27, kanji: '私', kana: 'わたし', romaji: 'watashi', pos: 'pn', gloss: 'I|me', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 15 },
  { id: 28, kanji: 'あなた', kana: 'あなた', romaji: 'anata', pos: 'pn', gloss: 'you', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 100 },
  { id: 29, kanji: '箸', kana: 'はし', romaji: 'hashi', pos: 'n', gloss: 'chopsticks', jlpt: 4, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 1200 },
  { id: 30, kanji: '橋', kana: 'はし', romaji: 'hashi', pos: 'n', gloss: 'bridge', jlpt: 4, pitchAccents: [{ mora: 2, pattern: 'odaka', dropMora: 2 }], freqRank: 1300 },
  { id: 31, kanji: '雨', kana: 'あめ', romaji: 'ame', pos: 'n', gloss: 'rain', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 250 },
  { id: 32, kanji: '飴', kana: 'あめ', romaji: 'ame', pos: 'n', gloss: 'candy', jlpt: 4, pitchAccents: [{ mora: 2, pattern: 'heiban', dropMora: null }], freqRank: 1500 },
  { id: 33, kanji: '温める', kana: 'あたためる', romaji: 'atatameru', pos: 'v1,vt', gloss: 'to warm up|to heat', jlpt: 4, pitchAccents: [{ mora: 4, pattern: 'nakadaka', dropMora: 4 }], freqRank: 800 },
  { id: 34, kanji: '袋', kana: 'ふくろ', romaji: 'fukuro', pos: 'n', gloss: 'bag|sack', jlpt: 4, pitchAccents: [{ mora: 3, pattern: 'odaka', dropMora: 3 }], freqRank: 700 },
  { id: 35, kanji: 'カード', kana: 'カード', romaji: 'kaado', pos: 'n', gloss: 'card', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 400 },
  { id: 36, kanji: 'ラーメン', kana: 'ラーメン', romaji: 'raamen', pos: 'n', gloss: 'ramen', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 350 },
  { id: 37, kanji: '注文', kana: 'ちゅうもん', romaji: 'chuumon', pos: 'n,vs', gloss: 'order', jlpt: 4, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 260 },
  { id: 38, kanji: 'お店', kana: 'おみせ', romaji: 'omise', pos: 'n', gloss: 'shop|store', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 170 },
  { id: 39, kanji: '駅', kana: 'えき', romaji: 'eki', pos: 'n', gloss: 'station', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 140 },
  { id: 40, kanji: '電車', kana: 'でんしゃ', romaji: 'densha', pos: 'n', gloss: 'train', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 220 },
  { id: 41, kanji: '切符', kana: 'きっぷ', romaji: 'kippu', pos: 'n', gloss: 'ticket', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 600 },
  { id: 42, kanji: 'お医者さん', kana: 'おいしゃさん', romaji: 'oisha-san', pos: 'n', gloss: 'doctor (polite)', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 750 },
  { id: 43, kanji: '頭', kana: 'あたま', romaji: 'atama', pos: 'n', gloss: 'head', jlpt: 5, pitchAccents: [{ mora: 3, pattern: 'odaka', dropMora: 3 }], freqRank: 280 },
  { id: 44, kanji: '痛い', kana: 'いたい', romaji: 'itai', pos: 'adj-i', gloss: 'painful|sore', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 320 },
  { id: 45, kanji: 'ホテル', kana: 'ホテル', romaji: 'hoteru', pos: 'n', gloss: 'hotel', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 500 },
  { id: 46, kanji: '予約', kana: 'よやく', romaji: 'yoyaku', pos: 'n,vs', gloss: 'reservation', jlpt: 4, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 420 },
  { id: 47, kanji: '名前', kana: 'なまえ', romaji: 'namae', pos: 'n', gloss: 'name', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 85 },
  { id: 48, kanji: '好き', kana: 'すき', romaji: 'suki', pos: 'adj-na', gloss: 'liked|fond of', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'heiban', dropMora: null }], freqRank: 125 },
  { id: 49, kanji: '嫌い', kana: 'きらい', romaji: 'kirai', pos: 'adj-na', gloss: 'disliked', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 380 },
  { id: 50, kanji: '大きい', kana: 'おおきい', romaji: 'ookii', pos: 'adj-i', gloss: 'big|large', jlpt: 5, pitchAccents: [{ mora: 3, pattern: 'nakadaka', dropMora: 3 }], freqRank: 75 },
  { id: 51, kanji: '小さい', kana: 'ちいさい', romaji: 'chiisai', pos: 'adj-i', gloss: 'small', jlpt: 5, pitchAccents: [{ mora: 3, pattern: 'nakadaka', dropMora: 3 }], freqRank: 145 },
  { id: 52, kanji: '新しい', kana: 'あたらしい', romaji: 'atarashii', pos: 'adj-i', gloss: 'new', jlpt: 5, pitchAccents: [{ mora: 4, pattern: 'nakadaka', dropMora: 4 }], freqRank: 105 },
  { id: 53, kanji: '古い', kana: 'ふるい', romaji: 'furui', pos: 'adj-i', gloss: 'old', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 270 },
  { id: 54, kanji: '高い', kana: 'たかい', romaji: 'takai', pos: 'adj-i', gloss: 'tall|expensive', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 165 },
  { id: 55, kanji: '安い', kana: 'やすい', romaji: 'yasui', pos: 'adj-i', gloss: 'cheap|inexpensive', jlpt: 5, pitchAccents: [{ mora: 2, pattern: 'nakadaka', dropMora: 2 }], freqRank: 310 },
  { id: 56, kanji: 'お金', kana: 'おかね', romaji: 'okane', pos: 'n', gloss: 'money', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 55 },
  { id: 57, kanji: '友達', kana: 'ともだち', romaji: 'tomodachi', pos: 'n', gloss: 'friend', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 180 },
  { id: 58, kanji: '家族', kana: 'かぞく', romaji: 'kazoku', pos: 'n', gloss: 'family', jlpt: 5, pitchAccents: [{ mora: 1, pattern: 'atamadaka', dropMora: 1 }], freqRank: 195 },
  { id: 59, kanji: '仕事', kana: 'しごと', romaji: 'shigoto', pos: 'n,vs', gloss: 'work|job', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 98 },
  { id: 60, kanji: '会社', kana: 'かいしゃ', romaji: 'kaisha', pos: 'n', gloss: 'company', jlpt: 5, pitchAccents: [{ mora: 0, pattern: 'heiban', dropMora: null }], freqRank: 135 },
];
