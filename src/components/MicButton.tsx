import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Mic } from "lucide-react-native";

import { press as pressHaptic } from "@/utils/haptics";
import type { ConversationPalette } from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import type { ConversationPhase } from "@/voice/conversationEngine";
import type { VoiceLifecycle } from "@/voice/lifecycle";

type Props = {
  active: boolean;
  phase: ConversationPhase;
  recovery?: VoiceLifecycle["recovery"];
  disabled?: boolean;
  onPress: () => void;
  palette: ConversationPalette;
};

export function MicButton({
  active,
  phase,
  recovery,
  disabled,
  onPress,
  palette,
}: Props) {
  const isResponding = phase === "understanding" || phase === "speaking";
  const isRecovering = phase === "recovery" || Boolean(recovery);
  const needsSettings = isRecovering && recovery === "openSettings";
  const title = needsSettings
    ? "Open settings"
    : isRecovering
      ? "Resume conversation"
      : isResponding
        ? "Speak now"
        : active
          ? "Listening · tap to pause"
          : "Start conversation";
  const detail = needsSettings
    ? "Allow microphone and speech recognition access"
    : isRecovering
      ? "Koe will continue from the interruption"
      : isResponding
        ? "Stop Koe and take the turn"
        : active
          ? "Speak naturally · pauses send automatically"
          : "One tap starts continuous turn-taking";

  return (
    <Pressable
      testID="hands-free-control"
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={() => {
        pressHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: palette.ruleStrong,
          backgroundColor: pressed ? palette.seamSoft : "transparent",
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.copy}>
          <Mic color={palette.seam} size={20} strokeWidth={1.5} />
          <View style={styles.labels}>
            <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
            <Text style={[styles.detail, { color: palette.muted }]}>
              {detail}
            </Text>
          </View>
        </View>
        <Text style={[styles.glyph, { color: palette.seam }]}>声</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: "100%",
    minHeight: CONVERSATION_TARGET.microphone,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 2,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  copy: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  labels: { flex: 1 },
  title: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 17,
    lineHeight: 22,
  },
  detail: {
    fontFamily: "Avenir Next",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  glyph: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 20,
    lineHeight: 28,
    paddingHorizontal: 8,
  },
});
