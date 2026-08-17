import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Mic2, RotateCcw, Volume2 } from "lucide-react-native";

import type { PronunciationFeedback } from "@/services/pitch";
import type { ConversationPalette } from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";

type Props = {
  feedback: PronunciationFeedback;
  palette: ConversationPalette;
  attemptAudioUri?: string;
  referenceAudioUri?: string;
  previous?: {
    feedback: PronunciationFeedback;
    audioUri?: string;
  };
  onPlay: (uri: string) => void;
  onRetry?: () => void;
  initialExpanded?: boolean;
};

/** One actionable pronunciation note, never a score dashboard. */
export function PronunciationFeedbackCard({
  feedback,
  palette,
  attemptAudioUri,
  referenceAudioUri,
  previous,
  onPlay,
  onRetry,
}: Props) {
  const retryCopy = feedback.retry
    ? feedback.retry.targetImproved
      ? "That sound moved closer."
      : "Try that sound once more."
    : undefined;

  return (
    <View
      accessibilityRole="summary"
      style={[styles.note, { borderColor: palette.hairline }]}
    >
      <Text style={[styles.kicker, { color: palette.seam }]}>
        ONE USEFUL NOTE / 気づき
      </Text>
      <Text style={[styles.correction, { color: palette.ink }]}>
        {feedback.firstCorrection}
      </Text>
      {retryCopy ? (
        <View style={styles.retryCopyRow}>
          <View
            style={[styles.ochreMark, { backgroundColor: palette.ochre }]}
          />
          <Text style={[styles.retryCopy, { color: palette.muted }]}>
            {retryCopy}
          </Text>
        </View>
      ) : null}

      {referenceAudioUri || attemptAudioUri || previous?.audioUri ? (
        <View style={styles.audioRow}>
          {referenceAudioUri ? (
            <AudioAction
              label="Reference"
              palette={palette}
              icon={<Volume2 color={palette.seam} size={17} />}
              onPress={() => onPlay(referenceAudioUri)}
            />
          ) : null}
          {attemptAudioUri ? (
            <AudioAction
              label="This try"
              palette={palette}
              icon={<Mic2 color={palette.seam} size={17} />}
              onPress={() => onPlay(attemptAudioUri)}
            />
          ) : null}
          {previous?.audioUri ? (
            <AudioAction
              label="Previous"
              palette={palette}
              icon={<RotateCcw color={palette.muted} size={16} />}
              onPress={() => onPlay(previous.audioUri!)}
            />
          ) : null}
        </View>
      ) : null}

      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry this phrase"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryAction,
            {
              borderColor: palette.ruleStrong,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <Text style={[styles.retryActionText, { color: palette.ink }]}>
            Try this phrase once
          </Text>
          <RotateCcw color={palette.seam} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AudioAction({
  label,
  palette,
  icon,
  onPress,
}: {
  label: string;
  palette: ConversationPalette;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${label.toLowerCase()}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.audioAction,
        {
          borderColor: palette.hairline,
          backgroundColor: pressed ? palette.seamSoft : "transparent",
        },
      ]}
    >
      {icon}
      <Text style={[styles.audioLabel, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    paddingVertical: 14,
  },
  kicker: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.4,
  },
  correction: {
    fontFamily: "Avenir Next",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 6,
  },
  retryCopyRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  ochreMark: { width: 36, height: 6, marginRight: 8 },
  retryCopy: {
    flex: 1,
    fontFamily: "Avenir Next",
    fontSize: 13,
    lineHeight: 18,
  },
  audioRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  audioAction: {
    minWidth: 96,
    minHeight: CONVERSATION_TARGET.minimum,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  audioLabel: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 13,
    lineHeight: 18,
  },
  retryAction: {
    minHeight: CONVERSATION_TARGET.action,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  retryActionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 16,
    lineHeight: 22,
  },
});
