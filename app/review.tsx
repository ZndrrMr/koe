import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getDueCards, reviewCard, type CardWithWord, type ReviewGrade } from '@/services/srs';
import { JapaneseText } from '@/components/JapaneseText';
import { annotate, type FuriganaRun } from '@/services/furigana';
import { synthesize, play } from '@/services/tts';
import { success as successHaptic, fail as failHaptic, tap as tapHaptic } from '@/utils/haptics';
import { Volume2, X } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useProgress } from '@/stores/useProgress';

const GRADES: Array<{ g: ReviewGrade; label: string; color: string }> = [
  { g: 'again', label: 'Again', color: colors.danger },
  { g: 'hard', label: 'Hard', color: colors.warning },
  { g: 'good', label: 'Good', color: colors.success },
  { g: 'easy', label: 'Easy', color: colors.accent },
];

export default function ReviewScreen() {
  const router = useRouter();
  const [queue, setQueue] = useState<CardWithWord[]>([]);
  const [showBack, setShowBack] = useState(false);
  const [runs, setRuns] = useState<FuriganaRun[]>([]);
  const bumpXp = useProgress((s) => s.bumpXp);

  const loadQueue = useCallback(async () => {
    const cards = await getDueCards(30);
    setQueue(cards);
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    (async () => {
      const r = await annotate(current.word.kanji ?? current.word.kana);
      setRuns(r);
    })();
    setShowBack(false);
  }, [current?.id]);

  if (!current) {
    return (
      <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark items-center justify-center">
        <Text className="text-fg dark:text-fg-dark text-xl font-semibold">All caught up</Text>
        <Text className="text-muted mt-2">Come back later for more reviews.</Text>
        <Pressable onPress={() => router.back()} className="mt-6 bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-semibold">Done</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const onGrade = async (g: ReviewGrade) => {
    if (g === 'again') failHaptic(); else successHaptic();
    await reviewCard(current.id, g);
    bumpXp(g === 'again' ? 2 : 5);
    setQueue((q) => q.slice(1));
  };

  const playAudio = async () => {
    tapHaptic();
    try {
      const res = await synthesize(current.word.kana);
      await play(res.audioUri);
    } catch {}
  };

  const isProduction = current.kind === 'production';

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()}><X color={colors.muted} size={24} /></Pressable>
        <Text className="text-muted">{queue.length} due</Text>
        <View style={{ width: 24 }} />
      </View>

      <View className="flex-1 items-center justify-center px-6">
        {isProduction ? (
          <>
            <Text className="text-muted text-sm uppercase tracking-wider mb-4">Produce</Text>
            <Text className="text-fg dark:text-fg-dark text-2xl text-center">
              {current.word.gloss.split('|')[0]}
            </Text>
            {showBack && (
              <View className="mt-6 items-center">
                <JapaneseText runs={runs} fontSize={32} />
                <Pressable onPress={playAudio} className="mt-4 flex-row items-center gap-2 bg-accent px-4 py-2 rounded-full">
                  <Volume2 color="white" size={16} />
                  <Text className="text-white font-semibold">Play</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            <JapaneseText runs={runs} fontSize={40} />
            {showBack && (
              <Text className="text-fg dark:text-fg-dark mt-6 text-lg text-center">
                {current.word.gloss.split('|')[0]}
              </Text>
            )}
            <Pressable onPress={playAudio} className="mt-4 flex-row items-center gap-2 bg-accent px-4 py-2 rounded-full">
              <Volume2 color="white" size={16} />
              <Text className="text-white font-semibold">Play</Text>
            </Pressable>
          </>
        )}
      </View>

      {!showBack ? (
        <Pressable
          onPress={() => { tapHaptic(); setShowBack(true); }}
          className="mx-6 mb-6 bg-surface dark:bg-surface-dark py-4 rounded-full items-center"
        >
          <Text className="text-fg dark:text-fg-dark font-semibold">Show answer</Text>
        </Pressable>
      ) : (
        <View className="flex-row gap-2 px-4 pb-6">
          {GRADES.map((grade) => (
            <Pressable
              key={grade.g}
              onPress={() => onGrade(grade.g)}
              className="flex-1 py-4 rounded-2xl items-center"
              style={{ backgroundColor: grade.color }}
            >
              <Text className="text-white font-semibold">{grade.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}
