import React from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { colors } from '@/theme/colors';

export default function AboutScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()}><X color={colors.muted} size={24} /></Pressable>
        <Text className="font-semibold text-fg dark:text-fg-dark">About</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerClassName="p-5">
        <Text className="font-jpBold text-5xl text-primary">声 Koe</Text>
        <Text className="text-muted mt-1">Japanese pitch-first speaking app</Text>

        <Text className="text-fg dark:text-fg-dark font-semibold mt-6 mb-2">Credits</Text>
        <Text className="text-fg/80 dark:text-fg-dark/80 leading-relaxed">
          Dictionary data: JMdict/EDICT and KANJIDIC2 — © EDRDG, CC-BY-SA 4.0.{'\n\n'}
          Pitch accent data: Kanjium by mifunetoshiro, CC0.{'\n\n'}
          Stroke order: KanjiVG by Ulrich Apel, CC-BY-SA 3.0.{'\n\n'}
          TTS via Inworld. STT via Soniox. Tutor via Anthropic Claude. Furigana and grading via Google Gemini.
        </Text>

        <Pressable onPress={() => Linking.openURL('https://www.edrdg.org/edrdg/licence.html')} className="mt-4">
          <Text className="text-accent">EDRDG license →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
