import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { SCENARIOS } from '@/data/scenarios';
import { ScenarioCard } from '@/components/ScenarioCard';

export default function SpeakScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="px-5 pt-2 pb-3">
        <Text className="font-jpBold text-2xl text-fg dark:text-fg-dark">会話</Text>
        <Text className="text-muted">Pick a scenario to practice.</Text>
      </View>
      <ScrollView contentContainerClassName="flex-row flex-wrap px-3 pb-10">
        {SCENARIOS.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            onPress={(s) => {
              const id = randomUUID();
              router.push({ pathname: '/session/[id]', params: { id, scenario: s.id } });
            }}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
