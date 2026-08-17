import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Mic } from "lucide-react-native";
import { press as pressHaptic } from "@/utils/haptics";
import { colors } from "@/theme/colors";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import type { ConversationPhase } from "@/voice/conversationEngine";
import type { VoiceLifecycle } from "@/voice/lifecycle";

type Props = {
  active: boolean;
  phase: ConversationPhase;
  recovery?: VoiceLifecycle["recovery"];
  disabled?: boolean;
  onPress: () => void;
  palette?: {
    control: string;
    controlText: string;
    proof: string;
    canvas: string;
  };
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
  const background = active
    ? (palette?.proof ?? colors.primary)
    : (palette?.control ?? colors.accent);
  const foreground = palette?.controlText ?? "#FFFFFF";
  const title = needsSettings
    ? "Open settings"
    : isRecovering
      ? "Resume conversation"
      : isResponding
        ? "Speak now"
        : active
          ? "Listening hands-free"
          : "Start conversation";
  const detail = needsSettings
    ? "Allow microphone and speech recognition access"
    : isRecovering
      ? "Koe will continue from the interruption"
      : isResponding
        ? "Tap to stop Koe and take the turn"
        : active
          ? "Speak naturally · pauses send automatically"
          : "One tap starts continuous turn-taking";

  return (
    <View style={styles.wrapper}>
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
        style={[
          styles.button,
          {
            backgroundColor: background,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.iconWell,
            { borderColor: foreground, backgroundColor: `${foreground}14` },
          ]}
        >
          <Mic color={foreground} size={22} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: foreground }]}>{title}</Text>
          <Text style={[styles.detail, { color: foreground }]}>{detail}</Text>
        </View>
        <Text style={[styles.glyph, { color: foreground }]}>自</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: "100%", alignItems: "center", justifyContent: "center" },
  button: {
    width: "100%",
    height: CONVERSATION_TARGET.microphone,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  iconWell: {
    width: CONVERSATION_TARGET.roundIcon,
    height: CONVERSATION_TARGET.roundIcon,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, justifyContent: "center", paddingHorizontal: 12 },
  title: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
  detail: { fontSize: 10, lineHeight: 14, opacity: 0.65, marginTop: 2 },
  glyph: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 15,
    opacity: 0.72,
    paddingHorizontal: 8,
  },
});
