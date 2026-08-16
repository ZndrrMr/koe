import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useFirstUse } from "@/stores/useFirstUse";
import { useConversationPalette } from "@/theme/conversation";

/**
 * Onboarding is an entry seam, not a questionnaire. New learners are taken
 * straight to a neutral conversation; the session itself explains the mic at
 * the moment it becomes relevant.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const complete = useFirstUse((state) => state.complete);
  const sessionId = useRef(randomUUID()).current;

  useEffect(() => {
    complete();
    router.replace({
      pathname: "/session/[id]",
      params: { id: sessionId, intro: "1" },
    });
  }, [complete, router, sessionId]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
      accessibilityLabel="Opening your first conversation"
    >
      <View style={styles.mark}>
        <Text style={[styles.kanji, { color: palette.seam }]}>声</Text>
        <Text style={[styles.label, { color: palette.muted }]}>
          OPENING KOE
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  mark: { alignItems: "center", gap: 10 },
  kanji: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 72,
    lineHeight: 84,
  },
  label: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.8,
  },
});
