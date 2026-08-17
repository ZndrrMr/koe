import React, { useCallback, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";

import ArtFamilyProofScreen from "@/art/ArtFamilyProofScreen";
import { SafeAreaScreen } from "@/components/SafeAreaScreen";
import { WholeAffordancePressable } from "@/components/WholeAffordancePressable";
import { useKoeIllustration } from "@/art/koeIllustrations";
import { getLatestActiveSession, type SessionSummary } from "@/db";
import { useFirstUse } from "@/stores/useFirstUse";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import {
  CONTROL_MAX_FONT_SIZE_MULTIPLIER,
  CONVERSATION_TARGET,
} from "@/theme/interaction";
import { tap } from "@/utils/haptics";

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
  const illustration = useKoeIllustration("homeStart");
  const { height } = useWindowDimensions();
  const compact = height < 740;
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
        <KoeLockup palette={palette} />

        <Image
          source={illustration}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Two engraved voice contours exchange a single thread."
          accessibilityIgnoresInvertColors
          style={[styles.art, compact && styles.compactArt]}
        />

        <View style={styles.proposition}>
          <Text style={[styles.heroTitle, { color: palette.ink }]}>
            {recoverable
              ? "Return to the conversation."
              : "Speak, and let the conversation follow."}
          </Text>
          <View
            style={[styles.ochreMark, { backgroundColor: palette.ochre }]}
          />
          <Text style={[styles.japaneseLine, { color: palette.ink }]}>
            {recoverable ? "声の続きへ。" : "声を出す。会話になる。"}
          </Text>
          <Text style={[styles.detail, { color: palette.muted }]}>
            {recoverable
              ? `${recoverable.turnCount} saved ${recoverable.turnCount === 1 ? "turn" : "turns"}. Koe will listen from where you stopped.`
              : "Japanese or English. Koe listens, answers aloud, and keeps the exchange open."}
          </Text>
        </View>

        <View style={styles.actions}>
          <RuledAction
            testID={
              recoverable ? "continue-conversation" : "start-conversation"
            }
            label={recoverable ? "Continue conversation" : "Start speaking"}
            hint={
              recoverable
                ? "Restores the conversation at its last saved turn"
                : "Opens a Japanese conversation with no setup"
            }
            palette={palette}
            onPress={recoverable ? continueConversation : startConversation}
          />
          {recoverable ? (
            <RuledAction
              testID="start-new-conversation"
              label="Start a new conversation"
              hint="Starts separately instead of restoring the saved conversation"
              palette={palette}
              onPress={startConversation}
              secondary
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaScreen>
  );
}

function KoeLockup({ palette }: { palette: ConversationPalette }) {
  return (
    <View style={styles.lockup} accessibilityRole="header">
      <Text style={[styles.wordmark, { color: palette.ink }]}>声</Text>
      <Text style={[styles.kicker, { color: palette.muted }]}>KOE</Text>
    </View>
  );
}

function RuledAction({
  testID,
  label,
  hint,
  palette,
  onPress,
  secondary = false,
}: {
  testID?: string;
  label: string;
  hint?: string;
  palette: ConversationPalette;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <WholeAffordancePressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        secondary && styles.secondaryAction,
        {
          borderColor: secondary ? palette.hairline : palette.ruleStrong,
          backgroundColor: pressed ? palette.seamSoft : "transparent",
        },
      ]}
    >
      <View
        style={[
          styles.actionContent,
          secondary && styles.secondaryActionContent,
        ]}
      >
        <Text
          maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.actionText, { color: palette.ink }]}
        >
          {label}
        </Text>
        {!secondary ? (
          <Text
            maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.actionArrow, { color: palette.seam }]}
          >
            →
          </Text>
        ) : null}
      </View>
    </WholeAffordancePressable>
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
  wordmark: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 29,
    lineHeight: 34,
  },
  kicker: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1.8,
  },
  art: {
    width: 310,
    height: 248,
    alignSelf: "center",
    marginTop: 4,
  },
  compactArt: { width: 270, height: 216, marginTop: 0 },
  proposition: { maxWidth: 500 },
  heroTitle: {
    fontFamily: "Iowan Old Style",
    fontSize: 36,
    lineHeight: 40,
  },
  ochreMark: { width: 92, height: 7, marginTop: 8 },
  japaneseLine: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 8,
  },
  detail: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 7,
    maxWidth: 430,
  },
  actions: { marginTop: "auto", paddingTop: 24 },
  action: {
    minHeight: 64,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 2,
    paddingVertical: 12,
    alignItems: "stretch",
    justifyContent: "center",
  },
  secondaryAction: {
    minHeight: CONVERSATION_TARGET.action,
    marginTop: 8,
  },
  actionContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  secondaryActionContent: { justifyContent: "center" },
  actionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 17,
    lineHeight: 22,
  },
  actionArrow: { fontFamily: "Avenir Next", fontSize: 24, lineHeight: 28 },
});
