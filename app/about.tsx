import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { colors } from "@/theme/colors";

export default function AboutScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close About"
          onPress={() => router.back()}
          className="h-11 w-11 items-center justify-center"
        >
          <X color={colors.muted} size={24} />
        </Pressable>
        <Text className="font-semibold text-fg dark:text-fg-dark">About</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerClassName="p-5">
        <Text className="font-jpBold text-5xl text-primary">声 Koe</Text>
        <Text className="text-muted mt-1">
          Voice-first Japanese conversation app
        </Text>

        <Text className="text-fg dark:text-fg-dark font-semibold mt-6 mb-2">
          Credits
        </Text>
        <Text className="text-fg/80 dark:text-fg-dark/80 leading-relaxed">
          TTS via Inworld. STT via Soniox. Conversation feedback and furigana
          annotation via Google Gemini 3.1 Flash-Lite.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
