import React, { useRef } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";

import { SafeAreaScreen } from "@/components/SafeAreaScreen";
import { WholeAffordancePressable } from "@/components/WholeAffordancePressable";
import { useKoeIllustration } from "@/art/koeIllustrations";
import { useFirstUse } from "@/stores/useFirstUse";
import { useConversationPalette } from "@/theme/conversation";
import { CONTROL_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/interaction";

/** The only onboarding state: explain why the microphone is needed. */
export default function WelcomeScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const illustration = useKoeIllustration("microphoneEducation");
  const complete = useFirstUse((state) => state.complete);
  const sessionId = useRef(randomUUID()).current;
  const { height } = useWindowDimensions();
  const compact = height < 740;

  const continueToConversation = () => {
    complete();
    router.replace({
      pathname: "/session/[id]",
      params: { id: sessionId, intro: "1", autostart: "1" },
    });
  };

  return (
    <SafeAreaScreen
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          compact && styles.compactContent,
        ]}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.lockup} accessibilityRole="header">
          <Text style={[styles.kanji, { color: palette.ink }]}>声</Text>
          <Text style={[styles.wordmark, { color: palette.muted }]}>KOE</Text>
        </View>
        <Image
          source={illustration}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Two engraved voice contours turn toward one another."
          accessibilityIgnoresInvertColors
          style={[styles.art, compact && styles.compactArt]}
        />
        <Text style={[styles.eyebrow, { color: palette.seam }]}>
          FIRST VOICE
        </Text>
        <Text style={[styles.title, { color: palette.ink }]}>
          Let Koe hear your voice.
        </Text>
        <Text style={[styles.japanese, { color: palette.ink }]}>
          声を聞かせてください。
        </Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          Microphone access keeps one open conversation moving. Speak Japanese
          or English; Koe answers aloud and listens again automatically.
        </Text>
        <WholeAffordancePressable
          testID="continue-microphone-education"
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityHint="Requests microphone access and begins the conversation"
          onPress={continueToConversation}
          style={({ pressed }) => [
            styles.action,
            {
              borderColor: palette.ruleStrong,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <View style={styles.actionContent}>
            <Text
              maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.actionText, { color: palette.ink }]}
            >
              Continue
            </Text>
            <Text
              maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.actionArrow, { color: palette.seam }]}
            >
              →
            </Text>
          </View>
        </WholeAffordancePressable>
      </ScrollView>
    </SafeAreaScreen>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
  },
  compactContent: { paddingHorizontal: 20, paddingTop: 8 },
  lockup: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  kanji: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 29,
    lineHeight: 34,
  },
  wordmark: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1.8,
  },
  art: {
    width: 310,
    height: 240,
    alignSelf: "center",
    marginTop: 8,
  },
  compactArt: { width: 270, height: 202, marginTop: 0 },
  eyebrow: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.4,
  },
  title: {
    fontFamily: "Iowan Old Style",
    fontSize: 36,
    lineHeight: 40,
    marginTop: 10,
  },
  japanese: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 8,
  },
  body: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 440,
  },
  action: {
    width: "100%",
    minHeight: 64,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginTop: "auto",
    paddingHorizontal: 2,
    paddingVertical: 12,
    alignItems: "stretch",
    justifyContent: "center",
  },
  actionContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 17,
    lineHeight: 22,
  },
  actionArrow: { fontFamily: "Avenir Next", fontSize: 24, lineHeight: 28 },
});
