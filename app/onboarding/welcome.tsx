import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme/colors';
import { tap } from '@/utils/haptics';

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark items-center justify-between p-8">
      <View />
      <View className="items-center">
        <Text className="font-jpBold text-[120px] text-primary" style={{ lineHeight: 130 }}>声</Text>
        <Text className="text-fg dark:text-fg-dark text-3xl font-bold mt-4">Speak Japanese.</Text>
        <Text className="text-fg dark:text-fg-dark text-3xl font-bold">Hear yourself.</Text>
        <View className="mt-10">
          <Svg width={260} height={80} viewBox="0 0 260 80">
            <Path
              d="M0 60 Q 30 20, 60 40 T 120 30 T 180 50 T 260 20"
              stroke={colors.accent}
              strokeWidth={3}
              fill="none"
            />
          </Svg>
        </View>
      </View>
      <Pressable
        onPress={() => { tap(); router.push('/onboarding/kana-check'); }}
        className="bg-primary w-full py-4 rounded-full items-center"
      >
        <Text className="text-white font-semibold text-lg">Start</Text>
      </Pressable>
    </SafeAreaView>
  );
}
