import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { listAllWords } from '@/services/dict';
import type { Word } from '@/db/schema';
import type { PitchAccent } from '@/data/seed';
import { synthesize, play } from '@/services/tts';
import { success, fail, tap } from '@/utils/haptics';
import { colors } from '@/theme/colors';
import { JapaneseText } from '@/components/JapaneseText';
import { annotate, type FuriganaRun } from '@/services/furigana';

const PATTERNS = ['atamadaka', 'heiban', 'nakadaka', 'odaka'] as const;

export default function MinimalPairsScreen() {
  const router = useRouter();
  const [words, setWords] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const [runs, setRuns] = useState<FuriganaRun[]>([]);

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
    if (!current) return;
    (async () => {
      const r = await annotate(current.kanji ?? current.kana);
      setRuns(r);
      try {
        const res = await synthesize(current.kana);
        await play(res.audioUri);
      } catch {}
    })();
    setShowAnswer(false);
  }, [current?.id]);

  if (!current) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <Text className="text-muted">Loading words…</Text>
      </SafeAreaView>
    );
  }

  if (idx >= words.length) {
    return (
      <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center">
        <Text className="text-fg dark:text-fg-dark text-2xl font-bold">Done</Text>
        <Text className="text-muted mt-2">{score.right} / {score.right + score.wrong} correct</Text>
        <Pressable onPress={() => router.back()} className="mt-6 bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-semibold">Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const onChoose = (p: typeof PATTERNS[number]) => {
    if (showAnswer) return;
    if (p === correct) { success(); setScore((s) => ({ ...s, right: s.right + 1 })); }
    else { fail(); setScore((s) => ({ ...s, wrong: s.wrong + 1 })); }
    setShowAnswer(true);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()}><X color={colors.muted} size={24} /></Pressable>
        <Text className="text-muted">{idx + 1} / {words.length}</Text>
        <Text className="text-fg dark:text-fg-dark font-semibold">{score.right}✓</Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-muted text-sm mb-4">What pattern did you hear?</Text>
        <JapaneseText runs={runs} fontSize={48} />
        <Pressable
          onPress={async () => {
            tap();
            const res = await synthesize(current.kana);
            await play(res.audioUri);
          }}
          className="mt-6 bg-accent px-6 py-3 rounded-full"
        >
          <Text className="text-white font-semibold">Play again</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2 px-4 pb-6">
        {PATTERNS.map((p) => {
          const isCorrect = showAnswer && p === correct;
          const isWrong = showAnswer && p !== correct;
          return (
            <Pressable
              key={p}
              onPress={() => onChoose(p)}
              disabled={showAnswer}
              className="flex-1 py-4 rounded-2xl items-center min-w-[45%]"
              style={{
                backgroundColor: isCorrect ? colors.success : isWrong ? '#00000010' : colors.surface,
                borderWidth: isWrong && p === correct ? 2 : 0,
                borderColor: colors.success,
              }}
            >
              <Text className="font-semibold" style={{ color: isCorrect ? 'white' : colors.text }}>{p}</Text>
            </Pressable>
          );
        })}
      </View>

      {showAnswer && (
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

function getPattern(w: Word | undefined): typeof PATTERNS[number] {
  if (!w?.pitchAccents) return 'heiban';
  try {
    const arr = JSON.parse(w.pitchAccents) as PitchAccent[];
    return arr[0]?.pattern ?? 'heiban';
  } catch { return 'heiban'; }
}
