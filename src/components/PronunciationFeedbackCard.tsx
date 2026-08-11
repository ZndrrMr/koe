import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ChevronDown,
  ChevronUp,
  Mic2,
  RotateCcw,
  Volume2,
} from "lucide-react-native";

import { PitchContour } from "@/components/PitchContour";
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

export function PronunciationFeedbackCard({
  feedback,
  palette,
  attemptAudioUri,
  referenceAudioUri,
  previous,
  onPlay,
  onRetry,
  initialExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [cardWidth, setCardWidth] = useState(320);
  const retryCopy = feedback.retry
    ? feedback.retry.targetImproved
      ? `Target improved +${feedback.retry.targetScoreDelta}`
      : `Target ${signed(feedback.retry.targetScoreDelta)} — try it once more`
    : undefined;
  const statusCopy = feedback.firstCorrection;
  const targetIndex = feedback.target?.unitIndex;
  const visibleUnits = useMemo(() => {
    if (feedback.units.length <= 7) return feedback.units;
    const center = targetIndex ?? 0;
    const start = Math.max(0, Math.min(center - 3, feedback.units.length - 7));
    return feedback.units.slice(start, start + 7);
  }, [feedback.units, targetIndex]);
  const metricRows = useMemo(
    () =>
      [
        ["Pitch shape", feedback.scores.pitch],
        ["Mora timing", feedback.scores.timing],
        ["Voice continuity", feedback.scores.voicing],
      ] as const,
    [feedback.scores],
  );

  return (
    <View
      onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
      style={[
        styles.card,
        { borderColor: palette.hairline, backgroundColor: palette.canvas },
      ]}
    >
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={[styles.kicker, { color: palette.proof }]}>
            NEXT REP
          </Text>
          <Text style={[styles.correction, { color: palette.ink }]}>
            {statusCopy}
          </Text>
        </View>
        {feedback.status === "aligned" ? (
          <View
            accessible
            accessibilityLabel={`Pronunciation score ${feedback.scores.overall} out of 100`}
            style={[styles.scoreSeal, { borderColor: palette.seam }]}
          >
            <Text style={[styles.scoreValue, { color: palette.seam }]}>
              {feedback.scores.overall}
            </Text>
            <Text style={[styles.scoreUnit, { color: palette.muted }]}>
              /100
            </Text>
          </View>
        ) : null}
      </View>

      {retryCopy ? (
        <View
          style={[
            styles.retryResult,
            {
              borderColor: feedback.retry?.targetImproved
                ? palette.success
                : palette.brass,
            },
          ]}
        >
          <Text
            style={[
              styles.retryText,
              {
                color: feedback.retry?.targetImproved
                  ? palette.success
                  : palette.brass,
              },
            ]}
          >
            {retryCopy}
          </Text>
        </View>
      ) : null}

      <View style={styles.audioRow}>
        {referenceAudioUri ? (
          <AudioButton
            label="Reference"
            icon="reference"
            palette={palette}
            onPress={() => onPlay(referenceAudioUri)}
          />
        ) : null}
        {attemptAudioUri ? (
          <AudioButton
            label="This try"
            icon="attempt"
            palette={palette}
            onPress={() => onPlay(attemptAudioUri)}
          />
        ) : null}
        {previous?.audioUri ? (
          <AudioButton
            label="Previous"
            icon="previous"
            palette={palette}
            onPress={() => onPlay(previous.audioUri!)}
          />
        ) : null}
      </View>

      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry this phrase"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: palette.control, opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <RotateCcw color={palette.controlText} size={16} />
          <Text style={[styles.buttonText, { color: palette.controlText }]}>
            Retry this phrase
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? "Hide full breakdown" : "Show full breakdown"
        }
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.expandButton,
          {
            borderColor: palette.hairline,
            backgroundColor: pressed ? palette.seamSoft : "transparent",
          },
        ]}
      >
        <Text style={[styles.expandText, { color: palette.ink }]}>
          {expanded ? "Hide breakdown" : "Why this correction?"}
        </Text>
        {expanded ? (
          <ChevronUp color={palette.ink} size={16} />
        ) : (
          <ChevronDown color={palette.ink} size={16} />
        )}
      </Pressable>

      {expanded && feedback.status === "aligned" ? (
        <View style={[styles.breakdown, { borderColor: palette.hairline }]}>
          <PitchContour
            native={feedback.reference}
            user={feedback.attempt}
            previous={previous?.feedback.attempt}
            units={feedback.units}
            targetUnitIndex={targetIndex}
            width={Math.max(250, cardWidth - 28)}
            height={142}
          />
          <Text style={[styles.chartExplanation, { color: palette.muted }]}>
            Height is pitch, left-to-right is timing. The highlighted mora is
            the single change to practice next.
          </Text>
          <View style={styles.metrics}>
            {metricRows.map(([label, score]) => (
              <Metric
                key={label}
                label={label}
                score={score}
                palette={palette}
              />
            ))}
          </View>
          <View style={styles.unitList}>
            {visibleUnits.map((unit) => (
              <View
                key={`${unit.unit}-${unit.index}`}
                style={[
                  styles.unitRow,
                  {
                    borderColor:
                      unit.index === targetIndex
                        ? palette.proof
                        : palette.hairline,
                  },
                ]}
              >
                <Text style={[styles.unitName, { color: palette.ink }]}>
                  {unit.unit}
                </Text>
                <Text style={[styles.unitMeasure, { color: palette.muted }]}>
                  pitch {unit.pitchScore} · time {unit.timingScore} · voice{" "}
                  {unit.voicingScore}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function AudioButton({
  label,
  icon,
  palette,
  onPress,
}: {
  label: string;
  icon: "reference" | "attempt" | "previous";
  palette: ConversationPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${label.toLowerCase()}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.audioButton,
        {
          borderColor: palette.hairline,
          backgroundColor: pressed ? palette.seamSoft : "transparent",
        },
      ]}
    >
      {icon === "reference" ? (
        <Volume2 color={palette.seam} size={15} />
      ) : icon === "attempt" ? (
        <Mic2 color={palette.proof} size={15} />
      ) : (
        <RotateCcw color={palette.muted} size={14} />
      )}
      <Text style={[styles.audioLabel, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );
}

function Metric({
  label,
  score,
  palette,
}: {
  label: string;
  score: number;
  palette: ConversationPalette;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>
        {label}
      </Text>
      <View style={[styles.metricTrack, { backgroundColor: palette.seamSoft }]}>
        <View
          style={[
            styles.metricFill,
            { width: `${score}%`, backgroundColor: palette.seam },
          ]}
        />
      </View>
      <Text style={[styles.metricScore, { color: palette.ink }]}>{score}</Text>
    </View>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
  },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headingCopy: { flex: 1 },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.35,
    lineHeight: 13,
  },
  correction: { fontSize: 15, fontWeight: "600", lineHeight: 21, marginTop: 4 },
  scoreSeal: {
    width: 50,
    height: 50,
    borderWidth: 1,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { fontFamily: "SFMono-Semibold", fontSize: 17, lineHeight: 18 },
  scoreUnit: { fontFamily: "SFMono-Regular", fontSize: 8 },
  retryResult: { borderLeftWidth: 2, paddingLeft: 8, marginTop: 10 },
  retryText: { fontSize: 12, fontWeight: "700" },
  audioRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  audioButton: {
    minHeight: CONVERSATION_TARGET.minimum,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  audioLabel: { fontSize: 11, fontWeight: "600" },
  retryButton: {
    minHeight: CONVERSATION_TARGET.minimum,
    borderRadius: 4,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
  },
  buttonText: { fontSize: 13, fontWeight: "700" },
  expandButton: {
    minHeight: CONVERSATION_TARGET.minimum,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  expandText: { fontSize: 12, fontWeight: "600" },
  breakdown: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  chartExplanation: { fontSize: 10, lineHeight: 15, marginTop: 8 },
  metrics: { gap: 7, marginTop: 12 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  metricLabel: { width: 88, fontSize: 10 },
  metricTrack: { flex: 1, height: 4, overflow: "hidden" },
  metricFill: { height: 4 },
  metricScore: {
    width: 24,
    textAlign: "right",
    fontFamily: "SFMono-Medium",
    fontSize: 10,
  },
  unitList: { marginTop: 12 },
  unitRow: {
    minHeight: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  unitName: {
    width: 32,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 15,
  },
  unitMeasure: { flex: 1, fontFamily: "SFMono-Regular", fontSize: 9 },
});
