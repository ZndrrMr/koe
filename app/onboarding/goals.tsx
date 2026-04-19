import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSettings } from '@/stores/useSettings';
import { addWordToSRS } from '@/services/srs';
import { SEED_WORDS } from '@/data/seed';
import { tap, success } from '@/utils/haptics';
import { colors } from '@/theme/colors';

type Goal = 'travel' | 'anime' | 'work' | 'jlpt' | 'just-because';
type Level = 'beginner' | 'n5' | 'n4' | 'n3' | 'n2plus';

const GOALS: Array<{ id: Goal; label: string; emoji: string }> = [
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'anime', label: 'Anime & manga', emoji: '📺' },
  { id: 'work', label: 'Work in Japan', emoji: '💼' },
  { id: 'jlpt', label: 'JLPT', emoji: '🎓' },
  { id: 'just-because', label: 'Just because', emoji: '💡' },
];

const LEVELS: Array<{ id: Level; label: string; sub: string }> = [
  { id: 'beginner', label: 'Beginner', sub: "I don't know much" },
  { id: 'n5', label: 'N5', sub: 'Basic' },
  { id: 'n4', label: 'N4', sub: 'Elementary' },
  { id: 'n3', label: 'N3', sub: 'Intermediate' },
  { id: 'n2plus', label: 'N2+', sub: 'Advanced' },
];

export default function GoalsScreen() {
  const router = useRouter();
  const complete = useSettings((s) => s.complete);
  const [goal, setGoal] = useState<Goal>('just-because');
  const [level, setLevel] = useState<Level>('beginner');

  const finish = async () => {
    tap();
    const jlptTarget = level === 'beginner' ? 5 : (Number(level.replace('n', '').replace('plus', '')) as 5 | 4 | 3 | 2 | 1);
    complete({ goal, selfLevel: level, jlptTarget });
    // seed SRS with first 20 N5 words
    const starter = SEED_WORDS.slice(0, 20);
    for (const w of starter) {
      await addWordToSRS(w.id, ['recognition', 'production']);
    }
    success();
    router.replace('/(tabs)/learn');
  };

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="p-6">
        <Text className="text-fg dark:text-fg-dark text-2xl font-bold">Your goal</Text>
        <View className="mt-4 gap-2">
          {GOALS.map((g) => (
            <Pressable
              key={g.id}
              onPress={() => { tap(); setGoal(g.id); }}
              className="flex-row items-center px-4 py-4 rounded-2xl"
              style={{
                backgroundColor: goal === g.id ? colors.primary : colors.surface,
              }}
            >
              <Text className="text-2xl mr-3">{g.emoji}</Text>
              <Text className="font-semibold" style={{ color: goal === g.id ? 'white' : colors.text }}>
                {g.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text className="text-fg dark:text-fg-dark text-2xl font-bold mt-8">Your level</Text>
        <View className="mt-4 gap-2">
          {LEVELS.map((lv) => (
            <Pressable
              key={lv.id}
              onPress={() => { tap(); setLevel(lv.id); }}
              className="px-4 py-4 rounded-2xl"
              style={{ backgroundColor: level === lv.id ? colors.accent : colors.surface }}
            >
              <Text className="font-semibold" style={{ color: level === lv.id ? 'white' : colors.text }}>
                {lv.label}
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: level === lv.id ? '#ffffffaa' : colors.muted }}>
                {lv.sub}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={finish} className="bg-primary py-4 rounded-full items-center mt-10">
          <Text className="text-white font-semibold text-lg">Let's go</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
