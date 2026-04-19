import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { tap as hapticTap } from '@/utils/haptics';
import type { Scenario } from '@/data/scenarios';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  scenario: Scenario;
  onPress: (s: Scenario) => void;
};

export function ScenarioCard({ scenario, onPress }: Props) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      style={style}
      onPressIn={() => (scale.value = withTiming(0.97, { duration: 120 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 180 }))}
      onPress={() => {
        hapticTap();
        onPress(scenario);
      }}
      className="rounded-2xl overflow-hidden bg-surface dark:bg-surface-dark m-2 flex-1 min-w-[45%]"
      android_ripple={{ color: '#0002' }}
    >
      <View className="px-4 pt-6 pb-4">
        <Text style={{ fontSize: 48 }}>{scenario.illustrationEmoji}</Text>
        <Text className="text-fg dark:text-fg-dark font-semibold text-base mt-3">
          {scenario.title}
        </Text>
        <Text className="text-muted text-xs mt-1">{scenario.titleJa}</Text>
        <View className="flex-row items-center gap-2 mt-3">
          <Text className="bg-bg dark:bg-bg-dark text-fg dark:text-fg-dark text-[10px] font-bold px-2 py-0.5 rounded-full">
            N{scenario.difficulty}
          </Text>
          <Text className="bg-bg dark:bg-bg-dark text-accent text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
            {scenario.registerTarget}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}
