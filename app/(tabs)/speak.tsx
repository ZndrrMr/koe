import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { ArrowRight, Mic } from 'lucide-react-native';

import { SCENARIOS } from '@/data/scenarios';
import { ScenarioCard } from '@/components/ScenarioCard';
import { tap } from '@/utils/haptics';

export default function SpeakScreen() {
  const router = useRouter();

  const startConversation = (scenarioId?: string) => {
    const id = randomUUID();
    router.push({
      pathname: '/session/[id]',
      params: scenarioId ? { id, scenario: scenarioId } : { id },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="px-5 pt-2 pb-10">
        <View className="mb-6">
          <Text className="font-jpBold text-3xl text-fg dark:text-fg-dark">会話</Text>
          <Text className="text-muted mt-1">Speak naturally in Japanese.</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start talking"
          accessibilityHint="Starts a Japanese conversation with no lesson or scenario"
          onPress={() => {
            tap();
            startConversation();
          }}
          className="w-full min-h-[184px] rounded-[28px] bg-primary px-6 py-6 justify-between"
          style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
        >
          <View className="w-12 h-12 rounded-full bg-white/15 items-center justify-center">
            <Mic color="white" size={24} />
          </View>
          <View className="flex-row items-end justify-between mt-8">
            <View className="flex-1 pr-4">
              <Text className="text-white text-2xl font-bold">Start talking</Text>
              <Text className="text-white/75 mt-1">No setup. Say whatever is on your mind.</Text>
            </View>
            <View className="w-11 h-11 rounded-full bg-white items-center justify-center">
              <ArrowRight color="#DC2626" size={22} />
            </View>
          </View>
        </Pressable>

        <View className="mt-9 mb-3">
          <Text className="text-fg dark:text-fg-dark text-lg font-semibold">Optional conversation starters</Text>
          <Text className="text-muted text-sm mt-1">Pick a topic, or ask for roleplay once you are talking.</Text>
        </View>

        <View className="flex-row flex-wrap -mx-2">
          {SCENARIOS.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              onPress={(selected) => startConversation(selected.id)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
