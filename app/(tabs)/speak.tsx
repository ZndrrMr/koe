import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ArrowRight, Clock3, Mic } from "lucide-react-native";

import { getScenario, SCENARIOS } from "@/data/scenarios";
import { ScenarioCard } from "@/components/ScenarioCard";
import { tap } from "@/utils/haptics";
import { getLatestActiveSession, type SessionSummary } from "@/db";

export default function SpeakScreen() {
  const router = useRouter();
  const [recoverable, setRecoverable] = useState<SessionSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getLatestActiveSession().then((session) => {
        if (active) setRecoverable(session);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const startConversation = (scenarioId?: string) => {
    const id = randomUUID();
    router.push({
      pathname: "/session/[id]",
      params: scenarioId ? { id, scenario: scenarioId } : { id },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="px-5 pt-2 pb-10">
        <View className="mb-6">
          <Text className="font-jpBold text-3xl text-fg dark:text-fg-dark">
            会話
          </Text>
          <Text className="text-muted mt-1">Speak naturally in Japanese.</Text>
        </View>

        {recoverable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue interrupted conversation"
            accessibilityHint="Restores the conversation at its last saved turn"
            onPress={() => {
              tap();
              router.push({
                pathname: "/session/[id]",
                params:
                  recoverable.scenarioId === "open"
                    ? { id: recoverable.id }
                    : {
                        id: recoverable.id,
                        scenario: recoverable.scenarioId,
                      },
              });
            }}
            className="w-full min-h-[92px] rounded-[22px] border border-black/10 dark:border-white/10 bg-surface dark:bg-surface-dark px-5 py-4 mb-4 flex-row items-center"
            style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1 })}
          >
            <View className="w-11 h-11 rounded-full bg-warning/15 items-center justify-center">
              <Clock3 color="#B06A00" size={21} />
            </View>
            <View className="flex-1 ml-4">
              <Text className="text-[11px] font-semibold tracking-widest text-muted">
                CONTINUE WHERE YOU LEFT OFF
              </Text>
              <Text className="text-fg dark:text-fg-dark text-base font-semibold mt-1">
                {getScenario(recoverable.scenarioId)?.title ??
                  "Open conversation"}
              </Text>
              <Text className="text-muted text-xs mt-0.5">
                {recoverable.turnCount} saved{" "}
                {recoverable.turnCount === 1 ? "turn" : "turns"}
              </Text>
            </View>
            <ArrowRight color="#DC2626" size={20} />
          </Pressable>
        ) : null}

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
              <Text className="text-white text-2xl font-bold">
                Start talking
              </Text>
              <Text className="text-white/75 mt-1">
                No setup. Say whatever is on your mind.
              </Text>
            </View>
            <View className="w-11 h-11 rounded-full bg-white items-center justify-center">
              <ArrowRight color="#DC2626" size={22} />
            </View>
          </View>
        </Pressable>

        <View className="mt-9 mb-3">
          <Text className="text-fg dark:text-fg-dark text-lg font-semibold">
            Optional conversation starters
          </Text>
          <Text className="text-muted text-sm mt-1">
            Pick a topic, or ask for roleplay once you are talking.
          </Text>
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
