import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { listAllWords } from '@/services/dict';
import type { Word } from '@/db/schema';
import type { PitchAccent } from '@/data/seed';
import { JapaneseText } from '@/components/JapaneseText';
import { annotate, type FuriganaRun } from '@/services/furigana';
import { colors, pitchColor, type PitchPattern } from '@/theme/colors';
import { success, fail, tap } from '@/utils/haptics';

const PATTERNS: PitchPattern[] = ['atamadaka', 'heiban', 'nakadaka', 'odaka'];

export default function AccentQuizScreen() {
  const router = useRouter();
  const [words, setWords] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [runs, setRuns] = useState<FuriganaRun[]>([]);
  const [chosen, setChosen] = useState<PitchPattern | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    (async () => {
      const all = await listAllWords(300);
      const withPitch = all.filter((w) => !!w.pitchAccents);
      setWords(withPitch.sort(() => Math.random() - 0.5).slice(0, 20));
    })();
  }, []);

  const current = words[idx];
  const correct = getPattern(current);

  useEffect(() => {
    setChosen(null);
    (async () => {
      if (!current) return;
      const r = await annotate(current.kanji ?? current.kana);
      setRuns(r);
    })();
  }, [current?.id]);

  if (!current) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <Text className="text-muted">Loading…</Text>
      </SafeAreaView>
    );
  }

  if (idx >= words.length) {
    return (
      <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center">
        <Text className="text-fg dark:text-fg-dark text-2xl font-bold">Done</Text>
        <Text className="text-muted mt-2">{score} / {words.length} correct</Text>
        <Pressable onPress={() => router.back()} className="mt-6 bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-semibold">Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const onChoose = (p: PitchPattern) => {
    if (chosen) return;
    setChosen(p);
    if (p === correct) { success(); setScore((s) => s + 1); }
    else { fail(); }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()}><X color={colors.muted} size={24} /></Pressable>
        <Text className="text-muted">{idx + 1} / {words.length}</Text>
        <Text className="text-fg dark:text-fg-dark font-semibold">{score}✓</Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-muted text-sm">N{current.jlpt ?? '?'} · rank #{current.freqRank ?? '?'}</Text>
        <View className="mt-6">
          <JapaneseText
            runs={runs}
            fontSize={48}
            pitchAccents={chosen ? {
              [current.kanji ?? current.kana]: {
                pattern: correct,
                dropMora: parsePitch(current)?.dropMora ?? null,
                mora: parsePitch(current)?.mora ?? 0,
              },
            } : undefined}
          />
        </View>
        <Text className="text-fg/80 dark:text-fg-dark/80 mt-3">{current.gloss.split('|')[0]}</Text>
      </View>

      <View className="flex-row flex-wrap gap-2 px-4 pb-6">
        {PATTERNS.map((p) => {
          const picked = chosen === p;
          const isCorrect = chosen && p === correct;
          return (
            <Pressable
              key={p}
              onPress={() => { tap(); onChoose(p); }}
              disabled={!!chosen}
              className="flex-1 py-4 rounded-2xl items-center min-w-[45%]"
              style={{
                backgroundColor: isCorrect ? pitchColor(p) : picked ? `${pitchColor(p)}40` : colors.surface,
              }}
            >
              <Text className="font-semibold" style={{ color: isCorrect ? 'white' : colors.text }}>
                {p}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {chosen && (
        <Pressable
          onPress={() => setIdx((i) => i + 1)}
          className="mx-4 mb-6 bg-primary py-4 rounded-full items-center"
        >
          <Text className="text-white font-semibold">Next</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function parsePitch(w: Word | undefined): PitchAccent | null {
  if (!w?.pitchAccents) return null;
  try { return (JSON.parse(w.pitchAccents) as PitchAccent[])[0] ?? null; } catch { return null; }
}
function getPattern(w: Word | undefined): PitchPattern { return parsePitch(w)?.pattern ?? 'heiban'; }
