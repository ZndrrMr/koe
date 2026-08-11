import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Mic } from "lucide-react-native";
import { press as pressHaptic } from "@/utils/haptics";
import { colors } from "@/theme/colors";
import { CONVERSATION_TARGET } from "@/theme/interaction";

type Props = {
  recording: boolean;
  disabled?: boolean;
  prompt?: string;
  onPressIn: () => void;
  onPressOut: () => void;
  palette?: {
    control: string;
    controlText: string;
    proof: string;
    canvas: string;
  };
};

export function MicButton({
  recording,
  disabled,
  prompt,
  onPressIn,
  onPressOut,
  palette,
}: Props) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const background = recording
    ? (palette?.proof ?? colors.primary)
    : (palette?.control ?? colors.accent);
  const foreground = palette?.controlText ?? "#FFFFFF";

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.animatedButton, style]}>
        <Pressable
          testID="hold-to-speak"
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={
            recording
              ? "Release to review transcript"
              : (prompt ?? "Hold to speak")
          }
          accessibilityHint="Records your Japanese while held"
          accessibilityState={{ disabled: Boolean(disabled) }}
          onPressIn={() => {
            pressHaptic();
            scale.value = withSpring(0.985, { damping: 18, stiffness: 260 });
            onPressIn();
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 14, stiffness: 220 });
            onPressOut();
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
            <Text style={[styles.title, { color: foreground }]}>
              {recording
                ? "Listening—release when finished"
                : (prompt ?? "Hold to speak")}
            </Text>
            <Text style={[styles.detail, { color: foreground }]}>
              {recording
                ? "The seam follows your voice"
                : "Japanese or English · interrupt anytime"}
            </Text>
          </View>
          <Text style={[styles.glyph, { color: foreground }]}>押</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: "100%", alignItems: "center", justifyContent: "center" },
  animatedButton: {
    width: "100%",
    height: CONVERSATION_TARGET.microphone,
  },
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
