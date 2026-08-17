import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ArrowRight, Clock3, Mic } from "lucide-react-native";

import { getLatestActiveSession, type SessionSummary } from "@/db";
import { tap } from "@/utils/haptics";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import { useFirstUse } from "@/stores/useFirstUse";
import ArtFamilyProofScreen from "@/art/ArtFamilyProofScreen";

export default function IndexScreen() {
  const onboardingDone = useFirstUse((state) => state.onboardingDone);
  if (__DEV__ && process.env.EXPO_PUBLIC_KOE_REVIEW_ROUTE === "art-family") {
    return <ArtFamilyProofScreen />;
  }
  return onboardingDone ? (
    <ConversationHome />
  ) : (
    <Redirect href="/onboarding/welcome" />
  );
}

function ConversationHome() {
  const router = useRouter();
  const palette = useConversationPalette();
  const [recoverable, setRecoverable] = useState<SessionSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getLatestActiveSession().then((session) => {
        if (active) setRecoverable(session?.turnCount ? session : null);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const startConversation = () => {
    tap();
    router.push({
      pathname: "/session/[id]",
      params: { id: randomUUID(), autostart: "1" },
    });
  };

  const continueConversation = () => {
    if (!recoverable) return;
    tap();
    router.push({
      pathname: "/session/[id]",
      params: { id: recoverable.id, autostart: "1" },
    });
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <View style={styles.ambient} pointerEvents="none">
        <View
          style={[styles.ambientRule, { backgroundColor: palette.hairline }]}
        />
        <View
          style={[styles.ambientDisc, { backgroundColor: palette.seamSoft }]}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.wordmark, { color: palette.ink }]}>声</Text>
            <Text style={[styles.kicker, { color: palette.muted }]}>KOE</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={[styles.heroLabel, { color: palette.proof }]}>
            CONVERSATION / 会話
          </Text>
          <Text style={[styles.heroTitle, { color: palette.ink }]}>
            Speak. Hear Koe. Keep going.
          </Text>
          <Text style={[styles.heroDetail, { color: palette.muted }]}>
            One open Japanese conversation, with a compact note only when it
            helps.
          </Text>
        </View>

        {recoverable ? (
          <Pressable
            testID="continue-conversation"
            accessibilityRole="button"
            accessibilityLabel="Continue interrupted conversation"
            accessibilityHint="Restores the conversation at its last saved turn"
            onPress={continueConversation}
            style={[styles.primaryAction, { backgroundColor: palette.control }]}
          >
            <View
              style={[
                styles.actionIcon,
                { borderColor: `${palette.controlText}55` },
              ]}
            >
              <Clock3 color={palette.controlText} size={22} />
            </View>
            <View style={styles.actionCopy}>
              <Text
                style={[styles.actionKicker, { color: palette.controlText }]}
              >
                PICK UP YOUR LAST THREAD
              </Text>
              <Text
                style={[styles.actionTitle, { color: palette.controlText }]}
              >
                Continue conversation
              </Text>
              <Text
                style={[styles.actionDetail, { color: palette.controlText }]}
              >
                {recoverable.turnCount} saved{" "}
                {recoverable.turnCount === 1 ? "turn" : "turns"}
              </Text>
            </View>
            <ArrowRight color={palette.controlText} size={22} />
          </Pressable>
        ) : (
          <PrimarySpeakAction palette={palette} onPress={startConversation} />
        )}

        {recoverable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
            onPress={startConversation}
            style={({ pressed }) => [
              styles.secondaryAction,
              {
                borderColor: palette.hairline,
                backgroundColor: pressed ? palette.seamSoft : "transparent",
              },
            ]}
          >
            <Mic color={palette.seam} size={19} />
            <Text style={[styles.secondaryText, { color: palette.ink }]}>
              Start a new conversation
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PrimarySpeakAction({
  palette,
  onPress,
}: {
  palette: ConversationPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="start-conversation"
      accessibilityRole="button"
      accessibilityLabel="Start speaking"
      accessibilityHint="Opens a neutral Japanese conversation with no setup"
      onPress={onPress}
      style={[styles.primaryAction, { backgroundColor: palette.control }]}
    >
      <View
        style={[styles.actionIcon, { borderColor: `${palette.controlText}55` }]}
      >
        <Mic color={palette.controlText} size={23} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionKicker, { color: palette.controlText }]}>
          NO SETUP
        </Text>
        <Text style={[styles.actionTitle, { color: palette.controlText }]}>
          Start speaking
        </Text>
        <Text style={[styles.actionDetail, { color: palette.controlText }]}>
          Japanese or English
        </Text>
      </View>
      <ArrowRight color={palette.controlText} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  ambient: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  ambientRule: {
    position: "absolute",
    left: "22%",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    opacity: 0.65,
  },
  ambientDisc: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    right: -220,
    top: 96,
    opacity: 0.45,
  },
  header: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 29,
    lineHeight: 34,
  },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.8,
    marginTop: 1,
  },
  hero: { paddingTop: 54, paddingBottom: 34, maxWidth: 540 },
  heroLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.35,
    lineHeight: 13,
  },
  heroTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 38,
    lineHeight: 48,
    marginTop: 10,
  },
  heroDetail: { fontSize: 14, lineHeight: 21, marginTop: 10, maxWidth: 430 },
  primaryAction: {
    minHeight: 132,
    borderRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  actionIcon: {
    width: 50,
    height: 50,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  actionCopy: { flex: 1, paddingHorizontal: 16 },
  actionKicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.3,
    lineHeight: 12,
    opacity: 0.68,
  },
  actionTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "700",
    marginTop: 3,
  },
  actionDetail: { fontSize: 11, lineHeight: 16, opacity: 0.68, marginTop: 2 },
  secondaryAction: {
    minHeight: CONVERSATION_TARGET.action,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    marginTop: 10,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
});
