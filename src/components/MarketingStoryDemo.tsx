import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Bookmark, Check, Mic2, Volume2 } from "lucide-react-native";

import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import { PitchContour } from "@/components/PitchContour";
import {
  DEMO_PRONUNCIATION,
  type MarketingFrame,
} from "@/marketing/launchSystem";
import type { ConversationPalette } from "@/theme/conversation";

const ENERGY = [0.18, 0.42, 0.76, 0.58, 0.84, 0.31, 0.66];

export function MarketingStoryDemo({
  frame,
  palette,
  compact = false,
  animated = false,
}: {
  frame: MarketingFrame;
  palette: ConversationPalette;
  compact?: boolean;
  animated?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [energyIndex, setEnergyIndex] = useState(3);
  const chartWidth = useMemo(
    () =>
      Math.max(
        244,
        Math.min(compact ? 300 : 430, width - (compact ? 86 : 112)),
      ),
    [compact, width],
  );

  useEffect(() => {
    if (!animated || !["listening", "speaking"].includes(frame.phase)) return;
    const timer = setInterval(
      () => setEnergyIndex((index) => (index + 1) % ENERGY.length),
      130,
    );
    return () => clearInterval(timer);
  }, [animated, frame.phase]);

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${frame.eyebrow}. ${frame.headline} ${frame.utteranceJa}. ${frame.utteranceEn}`}
      style={[
        styles.shell,
        compact && styles.shellCompact,
        { borderColor: palette.hairline, backgroundColor: palette.canvas },
      ]}
    >
      <View style={styles.demoHeader}>
        <View>
          <Text style={[styles.demoKicker, { color: palette.muted }]}>
            KOE / OPEN CONVERSATION
          </Text>
          <Text style={[styles.demoTitle, { color: palette.ink }]}>
            One voice loop
          </Text>
        </View>
        <View style={[styles.soundBadge, { borderColor: palette.hairline }]}>
          {frame.id === "speak" ? (
            <Mic2 color={palette.seam} size={13} />
          ) : (
            <Volume2 color={palette.seam} size={13} />
          )}
          <Text style={[styles.soundText, { color: palette.muted }]}>
            SOUND ON
          </Text>
        </View>
      </View>

      <View style={[styles.body, compact && styles.bodyCompact]}>
        <View style={[styles.formColumn, compact && styles.formColumnCompact]}>
          <AcousticVoiceForm
            phase={frame.phase}
            energy={ENERGY[energyIndex]}
            compact
            showLabels={false}
            testID={`marketing-form-${frame.id}`}
          />
        </View>
        <View
          style={[
            styles.evidence,
            compact && styles.evidenceCompact,
            { borderColor: palette.hairline },
          ]}
        >
          <Text style={[styles.frameNumber, { color: palette.proof }]}>
            {String(frame.order).padStart(2, "0")} / 05 · {frame.eyebrow}
          </Text>
          <Text style={[styles.utteranceJa, { color: palette.ink }]}>
            {frame.utteranceJa}
          </Text>
          <Text style={[styles.utteranceEn, { color: palette.muted }]}>
            {frame.utteranceEn}
          </Text>
          <FrameEvidence
            frame={frame}
            palette={palette}
            chartWidth={chartWidth}
          />
        </View>
      </View>
    </View>
  );
}

function FrameEvidence({
  frame,
  palette,
  chartWidth,
}: {
  frame: MarketingFrame;
  palette: ConversationPalette;
  chartWidth: number;
}) {
  if (frame.id === "speak") {
    return (
      <View style={[styles.proofLine, { borderColor: palette.seam }]}>
        <View style={[styles.liveDot, { backgroundColor: palette.proof }]} />
        <Text style={[styles.proofText, { color: palette.ink }]}>
          Words arriving as you speak
        </Text>
      </View>
    );
  }
  if (frame.id === "reply") {
    return (
      <View style={[styles.proofLine, { borderColor: palette.seam }]}>
        <Volume2 color={palette.seam} size={16} />
        <Text style={[styles.proofText, { color: palette.ink }]}>
          Reply playing · barge in anytime
        </Text>
      </View>
    );
  }
  if (frame.id === "tune") {
    return (
      <View style={styles.chart}>
        <PitchContour
          native={DEMO_PRONUNCIATION.reference}
          user={DEMO_PRONUNCIATION.attempt}
          units={DEMO_PRONUNCIATION.units}
          targetUnitIndex={DEMO_PRONUNCIATION.target?.unitIndex}
          width={chartWidth}
          height={118}
        />
      </View>
    );
  }
  if (frame.id === "compare") {
    return (
      <View style={[styles.comparison, { borderColor: palette.hairline }]}>
        <ComparisonRow
          label="BEFORE"
          value="えが"
          color={palette.muted}
          palette={palette}
        />
        <ComparisonRow
          label="RETRY"
          value="えいが"
          color={palette.success}
          palette={palette}
        />
        <View style={[styles.delta, { backgroundColor: palette.success }]}>
          <Check color={palette.canvas} size={13} />
          <Text style={[styles.deltaText, { color: palette.canvas }]}>
            TARGET +24
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.saved, { borderColor: palette.success }]}>
      <Bookmark color={palette.success} size={17} />
      <View style={styles.savedCopy}>
        <Text style={[styles.savedLabel, { color: palette.success }]}>
          KEPT FROM THIS CONVERSATION
        </Text>
        <Text style={[styles.savedText, { color: palette.ink }]}>
          映画 · keep both beats in えい
        </Text>
      </View>
    </View>
  );
}

function ComparisonRow({
  label,
  value,
  color,
  palette,
}: {
  label: string;
  value: string;
  color: string;
  palette: ConversationPalette;
}) {
  return (
    <View style={styles.comparisonRow}>
      <Text style={[styles.comparisonLabel, { color: palette.muted }]}>
        {label}
      </Text>
      <View style={[styles.comparisonRule, { backgroundColor: color }]} />
      <Text style={[styles.comparisonValue, { color: palette.ink }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    overflow: "hidden",
  },
  shellCompact: { borderRadius: 4 },
  demoHeader: {
    minHeight: 68,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  demoKicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.15,
    lineHeight: 12,
  },
  demoTitle: { fontSize: 15, fontWeight: "700", marginTop: 3 },
  soundBadge: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  soundText: { fontFamily: "SFMono-Medium", fontSize: 8, letterSpacing: 0.9 },
  body: {
    minHeight: 360,
    flexDirection: "row",
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  bodyCompact: {
    minHeight: 350,
    flexDirection: "column",
    alignItems: "stretch",
  },
  formColumn: { minWidth: 180, alignItems: "center", justifyContent: "center" },
  formColumnCompact: { height: 190, minWidth: 0 },
  evidence: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 20,
    justifyContent: "center",
  },
  evidenceCompact: {
    borderLeftWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  frameNumber: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.05,
    lineHeight: 12,
  },
  utteranceJa: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 25,
    lineHeight: 36,
    marginTop: 8,
  },
  utteranceEn: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  proofLine: {
    minHeight: 48,
    marginTop: 20,
    borderTopWidth: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  proofText: { fontSize: 12, fontWeight: "600" },
  chart: { marginTop: 12, alignItems: "center" },
  comparison: {
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    gap: 8,
  },
  comparisonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  comparisonLabel: {
    width: 46,
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 0.8,
  },
  comparisonRule: { flex: 1, height: 2 },
  comparisonValue: {
    width: 52,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 16,
  },
  delta: {
    minHeight: 28,
    alignSelf: "flex-end",
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  deltaText: { fontFamily: "SFMono-Medium", fontSize: 8, letterSpacing: 0.8 },
  saved: {
    minHeight: 66,
    marginTop: 20,
    borderLeftWidth: 2,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  savedCopy: { flex: 1 },
  savedLabel: { fontFamily: "SFMono-Medium", fontSize: 8, letterSpacing: 0.75 },
  savedText: { fontSize: 13, fontWeight: "600", lineHeight: 18, marginTop: 5 },
});
