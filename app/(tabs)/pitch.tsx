import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Activity, Mic, Waves } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { tap } from '@/utils/haptics';

type Drill = {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  href: '/pitch-drill/minimal-pairs' | '/pitch-drill/shadow' | '/pitch-drill/accent-quiz';
};

const DRILLS: Drill[] = [
  {
    id: 'minimal-pairs',
    title: 'Minimal pairs',
    subtitle: '箸 vs 橋 — hear the difference',
    icon: <Waves color={colors.accent} size={28} />,
    href: '/pitch-drill/minimal-pairs',
  },
  {
    id: 'shadow',
    title: 'Shadow mode',
    subtitle: 'Repeat the sentence, see your contour',
    icon: <Mic color={colors.primary} size={28} />,
    href: '/pitch-drill/shadow',
  },
  {
    id: 'accent-quiz',
    title: 'Accent pattern quiz',
    subtitle: 'Guess atamadaka / heiban / …',
    icon: <Activity color={colors.warning} size={28} />,
    href: '/pitch-drill/accent-quiz',
  },
];

export default function PitchScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="p-5">
        <Text className="font-jpBold text-2xl text-fg dark:text-fg-dark mb-1">アクセント</Text>
        <Text className="text-muted mb-5">Train your ear and your voice.</Text>
        {DRILLS.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => { tap(); router.push(d.href); }}
            className="bg-surface dark:bg-surface-dark rounded-2xl p-4 mb-3 flex-row items-center"
          >
            <View className="bg-bg dark:bg-bg-dark p-3 rounded-2xl">{d.icon}</View>
            <View className="ml-4 flex-1">
              <Text className="text-fg dark:text-fg-dark font-semibold text-base">{d.title}</Text>
              <Text className="text-muted text-xs mt-1">{d.subtitle}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
