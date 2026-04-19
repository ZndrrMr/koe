import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Flame, Play, Headphones, Activity, MessageCircle } from 'lucide-react-native';
import { useProgress } from '@/stores/useProgress';
import { getStats } from '@/services/srs';
import { tap } from '@/utils/haptics';
import { colors } from '@/theme/colors';

export default function LearnScreen() {
  const router = useRouter();
  const streak = useProgress((s) => s.streak);
  const xpThisWeek = useProgress((s) => s.xpThisWeek);
  const [due, setDue] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const s = await getStats();
        setDue(s.dueToday);
      } catch {}
    })();
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="p-5 pb-24">
        <View className="flex-row items-center justify-between mb-6">
          <Pressable onPress={() => router.push('/about')}>
            <Text className="font-jpBold text-3xl text-fg dark:text-fg-dark">声</Text>
          </Pressable>
          <View className="flex-row items-center gap-1">
            <Flame color={colors.warning} size={20} />
            <Text className="text-fg dark:text-fg-dark font-bold text-lg">{streak}</Text>
          </View>
        </View>

        <Text className="text-muted text-sm">XP this week</Text>
        <View className="h-2 bg-surface dark:bg-surface-dark rounded-full overflow-hidden mt-1">
          <View
            className="h-full bg-primary rounded-full"
            style={{ width: `${Math.min(100, (xpThisWeek / 100) * 100)}%` }}
          />
        </View>
        <Text className="text-fg dark:text-fg-dark font-bold text-lg mt-1 mb-6">
          {xpThisWeek} XP · {due} due
        </Text>

        <Pressable
          onPress={() => {
            tap();
            router.push('/(tabs)/speak');
          }}
          className="bg-primary rounded-3xl p-6 mb-4 active:opacity-90"
        >
          <Text className="text-white/80 text-xs uppercase tracking-widest font-bold">Today</Text>
          <Text className="text-white text-2xl font-bold mt-2">Start today's session</Text>
          <Text className="text-white/80 mt-1">~15 min · SRS + new words + AI chat</Text>
          <View className="flex-row items-center mt-4 gap-2">
            <Play color="white" size={18} />
            <Text className="text-white font-semibold">Begin</Text>
          </View>
        </Pressable>

        <QuickCard
          icon={<Activity color={colors.accent} size={24} />}
          title="Pitch drill"
          subtitle="Minimal pairs · 5 min"
          onPress={() => router.push('/(tabs)/pitch')}
        />
        <QuickCard
          icon={<Headphones color={colors.accent} size={24} />}
          title="Shadowing practice"
          subtitle="Listen, speak, score"
          onPress={() => router.push('/pitch-drill/shadow')}
        />
        <QuickCard
          icon={<MessageCircle color={colors.accent} size={24} />}
          title="Free conversation"
          subtitle="Pick a scenario"
          onPress={() => router.push('/(tabs)/speak')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickCard({
  icon, title, subtitle, onPress,
}: { icon: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }}
      className="bg-surface dark:bg-surface-dark rounded-2xl p-4 flex-row items-center mb-3 active:opacity-80"
    >
      {icon}
      <View className="ml-4 flex-1">
        <Text className="text-fg dark:text-fg-dark font-semibold">{title}</Text>
        <Text className="text-muted text-xs mt-1">{subtitle}</Text>
      </View>
    </Pressable>
  );
}
