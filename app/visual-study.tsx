import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowRight, RotateCcw, VolumeX, X } from "lucide-react-native";

import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import {
  MOTION_STUDY_STAGES,
  nextMotionStage,
  STUDY_LEARNER_LINE,
  STUDY_MODES,
  studyMode,
  type MotionStudyStage,
  type StudyMode,
} from "@/voice/motionStudy";

const PROTOTYPE_ENERGY = [
  0.08, 0.18, 0.5, 0.72, 0.34, 0.62, 0.84, 0.28, 0.14, 0.56, 0.38,
];

export default function VisualStudyScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const reviewMode = process.env.EXPO_PUBLIC_KOE_REVIEW_MODE as
    | StudyMode
    | undefined;
  const reviewStage = process.env.EXPO_PUBLIC_KOE_REVIEW_STAGE;
  const [modeId, setModeId] = useState<StudyMode>(
    reviewMode && STUDY_MODES.some((mode) => mode.id === reviewMode)
      ? reviewMode
      : "neutral",
  );
  const [stageIndex, setStageIndex] = useState(() => {
    const index = MOTION_STUDY_STAGES.findIndex(
      (stage) => stage.id === reviewStage,
    );
    return index >= 0 ? index : 0;
  });
  const [energyIndex, setEnergyIndex] = useState(0);
  const stage = MOTION_STUDY_STAGES[stageIndex];
  const mode = studyMode(modeId);
  const reviewSequence =
    __DEV__ && process.env.EXPO_PUBLIC_KOE_REVIEW_SEQUENCE === "1";

  useEffect(() => {
    if (!reviewSequence) return;
    const timer = setInterval(
      () => setStageIndex((index) => nextMotionStage(index)),
      1_350,
    );
    return () => clearInterval(timer);
  }, [reviewSequence]);

  useEffect(() => {
    if (!stage || !["listen", "speak", "retry"].includes(stage.id)) return;
    const timer = setInterval(
      () => setEnergyIndex((index) => (index + 1) % PROTOTYPE_ENERGY.length),
      120,
    );
    return () => clearInterval(timer);
  }, [stage]);

  if (!__DEV__) return <Redirect href="/" />;
  if (!stage) return null;

  const advance = () => setStageIndex((index) => nextMotionStage(index));

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.kicker, { color: palette.muted }]}>
            VOICE LOOP STUDY / ZAN-854
          </Text>
          <Text style={[styles.title, { color: palette.ink }]}>
            Flow, not a test
          </Text>
        </View>
        <Pressable
          testID="close-voice-loop-study"
          accessibilityRole="button"
          accessibilityLabel="Close voice loop study"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.closeButton,
            {
              borderColor: palette.hairline,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <X color={palette.ink} size={20} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.canvas}>
          <View style={styles.modeHeader}>
            <View>
              <Text style={[styles.sectionLabel, { color: palette.muted }]}>
                SAME LINE · THREE POSTURES
              </Text>
              <Text style={[styles.modeContext, { color: palette.ink }]}>
                {mode.context}
              </Text>
            </View>
            <View
              accessible
              accessibilityRole="summary"
              accessibilityLabel="Silent prototype. Judge the state without sound."
              style={[styles.silentBadge, { borderColor: palette.hairline }]}
            >
              <VolumeX color={palette.muted} size={14} />
              <Text style={[styles.silentText, { color: palette.muted }]}>
                SOUND MUTED
              </Text>
            </View>
          </View>

          <View style={styles.modeRow}>
            {STUDY_MODES.map((candidate) => {
              const selected = candidate.id === modeId;
              return (
                <Pressable
                  key={candidate.id}
                  testID={`study-mode-${candidate.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${candidate.label}. ${candidate.note}`}
                  accessibilityState={{ selected }}
                  onPress={() => setModeId(candidate.id)}
                  style={[
                    styles.modeButton,
                    {
                      borderColor: selected ? palette.seam : palette.hairline,
                      backgroundColor: selected
                        ? palette.seamSoft
                        : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.modeName, { color: palette.ink }]}>
                    {candidate.label}
                  </Text>
                  {isWide ? (
                    <Text
                      numberOfLines={2}
                      style={[styles.modeNote, { color: palette.muted }]}
                    >
                      {candidate.note}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {!isWide ? (
            <Text style={[styles.selectedModeNote, { color: palette.muted }]}>
              {mode.note}
            </Text>
          ) : null}

          <View
            style={[
              styles.prototype,
              isWide && styles.prototypeWide,
              { borderColor: palette.hairline },
            ]}
          >
            <View style={[styles.formColumn, isWide && styles.formColumnWide]}>
              <AcousticVoiceForm
                phase={stage.phase}
                energy={PROTOTYPE_ENERGY[energyIndex]}
                compact={!isWide}
              />
            </View>

            <View
              style={[
                styles.stageCopy,
                isWide && styles.stageCopyWide,
                isWide && { borderColor: palette.hairline },
              ]}
            >
              <View style={styles.stageMeta}>
                <Text style={[styles.stageNumber, { color: palette.proof }]}>
                  {String(stageIndex + 1).padStart(2, "0")} /{" "}
                  {String(MOTION_STUDY_STAGES.length).padStart(2, "0")}
                </Text>
                <Text style={[styles.stageLabel, { color: palette.muted }]}>
                  {stage.label}
                </Text>
              </View>
              <Text style={[styles.stageTitle, { color: palette.ink }]}>
                {stage.title}
              </Text>
              <Text style={[styles.stageDetail, { color: palette.muted }]}>
                {stage.detail}
              </Text>

              <StageEvidence stage={stage} mode={mode} palette={palette} />

              {stage.motionMs ? (
                <Text style={[styles.motionTime, { color: palette.muted }]}>
                  PROTOTYPE MOTION {stage.motionMs} MS · SERVICE LATENCY
                  MEASURED SEPARATELY
                </Text>
              ) : null}
            </View>
          </View>

          <Pressable
            testID="study-stage-advance"
            accessibilityRole="button"
            accessibilityLabel={`${stage.nextAction}. Current stage ${stageIndex + 1} of ${MOTION_STUDY_STAGES.length}.`}
            onPress={advance}
            style={[styles.advanceButton, { backgroundColor: palette.control }]}
          >
            <View style={styles.advanceCopy}>
              <Text
                style={[styles.advanceKicker, { color: palette.controlText }]}
              >
                {stage.id === "continue" ? "COMPLETE LOOP" : "NEXT STATE"}
              </Text>
              <Text
                style={[styles.advanceLabel, { color: palette.controlText }]}
              >
                {stage.nextAction}
              </Text>
            </View>
            {stage.id === "continue" ? (
              <RotateCcw color={palette.controlText} size={21} />
            ) : (
              <ArrowRight color={palette.controlText} size={21} />
            )}
          </Pressable>

          <Text style={[styles.studyPrompt, { color: palette.muted }]}>
            Observe: name the state before advancing. After the loop, ask what
            Koe did, whether the note interrupted the exchange, and what would
            make you keep talking.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StageEvidence({
  stage,
  mode,
  palette,
}: {
  stage: MotionStudyStage;
  mode: ReturnType<typeof studyMode>;
  palette: ConversationPalette;
}) {
  if (stage.utterance === "correction") {
    return (
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={mode.correction}
        style={[styles.evidenceCard, { borderColor: palette.proof }]}
      >
        <Text style={[styles.evidenceLabel, { color: palette.proof }]}>
          FIRST CORRECTION · AFTER THE REPLY
        </Text>
        <Text style={[styles.evidenceText, { color: palette.ink }]}>
          {mode.correction}
        </Text>
      </View>
    );
  }

  if (stage.utterance === "comparison") {
    return (
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel="Original attempt shortened eiga. Retry held both beats in eiga."
        style={[styles.comparison, { borderColor: palette.hairline }]}
      >
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
      </View>
    );
  }

  if (!stage.utterance) return null;
  const isKoe = stage.utterance === "koe";
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${isKoe ? "Koe" : "Learner"}: ${isKoe ? mode.reply : STUDY_LEARNER_LINE}`}
      style={[styles.utterance, { borderColor: palette.hairline }]}
    >
      <Text style={[styles.evidenceLabel, { color: palette.muted }]}>
        {isKoe ? "KOE / 応答" : "LEARNER / 発話"}
      </Text>
      <Text style={[styles.utteranceText, { color: palette.ink }]}>
        {isKoe ? mode.reply : STUDY_LEARNER_LINE}
      </Text>
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
  safeArea: { flex: 1 },
  header: {
    flexShrink: 0,
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scroll: { flex: 1 },
  content: { width: "100%", paddingBottom: 30 },
  canvas: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingHorizontal: 20,
  },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.35,
    lineHeight: 13,
  },
  title: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 31,
    marginTop: 2,
  },
  closeButton: {
    width: CONVERSATION_TARGET.roundIcon,
    height: CONVERSATION_TARGET.roundIcon,
    borderRadius: CONVERSATION_TARGET.roundIcon / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  modeHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  sectionLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.15,
    lineHeight: 12,
  },
  modeContext: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 2,
  },
  silentBadge: {
    minHeight: CONVERSATION_TARGET.minimum,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  silentText: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 0.75,
  },
  modeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  modeButton: {
    flex: 1,
    minWidth: 0,
    minHeight: CONVERSATION_TARGET.studyMode,
    borderWidth: 1,
    borderRadius: 5,
    overflow: "hidden",
    paddingHorizontal: 11,
    paddingVertical: 10,
    justifyContent: "center",
  },
  modeName: { fontSize: 12, fontWeight: "700", lineHeight: 17 },
  modeNote: { fontSize: 9, lineHeight: 13, marginTop: 3 },
  selectedModeNote: {
    minHeight: 30,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 7,
  },
  prototype: {
    minHeight: 470,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingVertical: 18,
  },
  prototypeWide: {
    minHeight: 520,
    flexDirection: "row",
    alignItems: "stretch",
  },
  formColumn: {
    minHeight: 270,
    alignItems: "center",
    justifyContent: "center",
  },
  formColumnWide: { width: "46%", minHeight: 480 },
  stageCopy: { flex: 1, justifyContent: "center", paddingHorizontal: 6 },
  stageCopyWide: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 34,
  },
  stageMeta: { flexDirection: "row", alignItems: "center", gap: 10 },
  stageNumber: {
    fontFamily: "SFMono-Semibold",
    fontSize: 9,
    letterSpacing: 1,
  },
  stageLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.2,
  },
  stageTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 27,
    fontWeight: "600",
    lineHeight: 38,
    marginTop: 8,
  },
  stageDetail: { fontSize: 12, lineHeight: 18, marginTop: 4, maxWidth: 430 },
  evidenceCard: {
    borderLeftWidth: 3,
    marginTop: 18,
    paddingLeft: 14,
    paddingVertical: 6,
  },
  evidenceLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1,
    lineHeight: 12,
  },
  evidenceText: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    marginTop: 5,
  },
  utterance: {
    minHeight: 76,
    borderLeftWidth: 1,
    marginTop: 18,
    paddingLeft: 14,
    justifyContent: "center",
  },
  utteranceText: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 4,
  },
  comparison: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingVertical: 8,
    gap: 3,
  },
  comparisonRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  comparisonLabel: {
    width: 46,
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 0.8,
  },
  comparisonRule: { flex: 1, height: 2 },
  comparisonValue: {
    width: 64,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 18,
    textAlign: "right",
  },
  motionTime: {
    fontFamily: "SFMono-Regular",
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.55,
    marginTop: 16,
  },
  advanceButton: {
    width: "100%",
    minHeight: CONVERSATION_TARGET.studyAdvance,
    borderRadius: 5,
    marginTop: 16,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  advanceCopy: { flex: 1 },
  advanceKicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1,
    lineHeight: 12,
  },
  advanceLabel: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: 1,
  },
  studyPrompt: {
    maxWidth: 660,
    alignSelf: "center",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 14,
    paddingHorizontal: 10,
  },
});
