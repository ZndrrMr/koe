import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSettings } from '@/stores/useSettings';
import { success, fail, tap } from '@/utils/haptics';
import { colors } from '@/theme/colors';

type Q = { char: string; answer: string; choices: string[] };

const HIRAGANA = [
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['か', 'ka'], ['き', 'ki'],
  ['さ', 'sa'], ['た', 'ta'], ['な', 'na'], ['は', 'ha'], ['ま', 'ma'],
] as const;
const KATAKANA = [
  ['ア', 'a'], ['イ', 'i'], ['ウ', 'u'], ['カ', 'ka'], ['キ', 'ki'],
  ['サ', 'sa'], ['タ', 'ta'], ['ナ', 'na'], ['ハ', 'ha'], ['マ', 'ma'],
] as const;

function shuffle<T>(arr: readonly T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

function buildQuestions(): Q[] {
  const pool = [...HIRAGANA, ...KATAKANA];
  const allRomaji = Array.from(new Set(pool.map(([, a]) => a)));
  return shuffle(pool)
    .slice(0, 10)
    .map(([char, answer]) => {
      const otherAnswers = shuffle(allRomaji.filter((a) => a !== answer)).slice(0, 3);
      return { char, answer, choices: shuffle([answer, ...otherAnswers]) };
    });
}

export default function KanaCheckScreen() {
  const router = useRouter();
  const completeSettings = useSettings((s) => s.complete);
  const setSetting = useSettings((s) => s.set);
  const [questions] = useState(() => buildQuestions());
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const q = questions[idx];
  const done = idx >= questions.length;

  if (done) {
    const known = score >= 8;
    return (
      <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center p-8">
        <Text className="text-fg dark:text-fg-dark text-2xl font-bold">Kana check</Text>
        <Text className="text-fg dark:text-fg-dark text-5xl font-bold mt-4">{score}/10</Text>
        <Text className="text-muted mt-2 text-center">
          {known ? "You're good with kana — we'll skip the primer." : "We'll queue a kana primer to warm you up."}
        </Text>
        <Pressable
          onPress={() => {
            tap();
            setSetting('kanaKnown', known);
            router.push('/onboarding/goals');
          }}
          className="mt-8 bg-primary w-full py-4 rounded-full items-center"
        >
          <Text className="text-white font-semibold">Continue</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark p-6">
      <Text className="text-muted">{idx + 1} / {questions.length}</Text>
      <Text className="text-fg dark:text-fg-dark mt-2 text-lg">What sound is this?</Text>
      <View className="items-center justify-center my-12">
        <Text style={{ fontSize: 120, color: colors.text }}>{q.char}</Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {q.choices.map((c) => {
          const isPicked = picked === c;
          const isCorrect = picked && c === q.answer;
          return (
            <Pressable
              key={c}
              onPress={() => {
                if (picked) return;
                tap();
                setPicked(c);
                if (c === q.answer) { success(); setScore((s) => s + 1); } else { fail(); }
                setTimeout(() => { setPicked(null); setIdx((i) => i + 1); }, 500);
              }}
              disabled={!!picked}
              className="flex-1 min-w-[45%] py-5 rounded-2xl items-center"
              style={{
                backgroundColor: isCorrect ? colors.success : isPicked ? colors.danger : colors.surface,
              }}
            >
              <Text className="text-2xl font-semibold" style={{ color: isPicked ? 'white' : colors.text }}>
                {c}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
