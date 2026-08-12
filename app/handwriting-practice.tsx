import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Eraser,
  Hand,
  Pencil,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import {
  KoePencilKitView,
  type DrawingChangePayload,
  type RecognitionPayload,
} from "../modules/koe-pencil-kit";
import { listSavedMoments } from "@/db";
import {
  HANDWRITING_TARGET_SIZE,
  PRACTICE_CHARACTERS,
  STARTER_EXPRESSION,
  assessHandwritingAttempt,
  practiceTargetsForText,
  type FeedbackState,
  type HandwritingAssessment,
  type PracticeCharacter,
} from "@/handwriting/practice";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";

type PracticeSource = {
  textJa: string;
  textEn?: string;
  label: "KEPT FROM CONVERSATION" | "STARTER SET";
};

export default function HandwritingPracticeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ momentId?: string }>();
  const palette = useConversationPalette();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [source, setSource] = useState<PracticeSource>({
    textJa: STARTER_EXPRESSION,
    textEn: "starter characters for recognition calibration",
    label: "STARTER SET",
  });
  const [loadingSource, setLoadingSource] = useState(Boolean(params.momentId));
  const [targetIndex, setTargetIndex] = useState(0);
  const [mode, setMode] = useState<"recall" | "trace">("recall");
  const [allowsFingerDrawing, setAllowsFingerDrawing] = useState(true);
  const [clearRevision, setClearRevision] = useState(0);
  const [undoRevision, setUndoRevision] = useState(0);
  const [recognitionRevision, setRecognitionRevision] = useState(0);
  const [hasInk, setHasInk] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [observation, setObservation] = useState<RecognitionPayload>();
  const [confirmedText, setConfirmedText] = useState<string>();

  useEffect(() => {
    let current = true;
    if (!params.momentId) {
      setLoadingSource(false);
      return () => {
        current = false;
      };
    }
    void listSavedMoments()
      .then((moments) => {
        if (!current) return;
        const moment = moments.find(
          (candidate) => candidate.id === params.momentId,
        );
        if (moment && practiceTargetsForText(moment.textJa).length) {
          setSource({
            textJa: moment.textJa,
            textEn: moment.textEn,
            label: "KEPT FROM CONVERSATION",
          });
        }
      })
      .finally(() => {
        if (current) setLoadingSource(false);
      });
    return () => {
      current = false;
    };
  }, [params.momentId]);

  const targets = useMemo(() => {
    const savedTargets = practiceTargetsForText(source.textJa);
    return savedTargets.length ? savedTargets : PRACTICE_CHARACTERS;
  }, [source.textJa]);
  const character = targets[targetIndex % targets.length];
  const assessment = useMemo(
    () =>
      observation
        ? assessHandwritingAttempt(character, observation, confirmedText)
        : undefined,
    [character, confirmedText, observation],
  );
  const showCorrection = mode === "trace" || Boolean(assessment);

  const resetAttempt = () => {
    setClearRevision((revision) => revision + 1);
    setHasInk(false);
    setStrokeCount(0);
    setObservation(undefined);
    setConfirmedText(undefined);
  };

  const nextCharacter = () => {
    setTargetIndex((index) => (index + 1) % targets.length);
    resetAttempt();
  };

  const onDrawingChange = (drawing: DrawingChangePayload) => {
    setHasInk(drawing.hasInk);
    setStrokeCount(drawing.strokeCount);
    setObservation(undefined);
    setConfirmedText(undefined);
  };

  const onRecognition = (recognition: RecognitionPayload) => {
    setHasInk(recognition.hasInk);
    setStrokeCount(recognition.strokeCount);
    setObservation(recognition);
    setConfirmedText(undefined);
  };

  if (loadingSource) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: palette.canvas }]}
      >
        <ActivityIndicator color={palette.proof} />
      </SafeAreaView>
    );
  }

  const feedback = (
    <FeedbackPanel
      assessment={assessment}
      character={character}
      palette={palette}
      onConfirm={setConfirmedText}
      onRetry={resetAttempt}
      onNext={nextCharacter}
    />
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close handwriting practice"
          hitSlop={4}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.roundControl,
            {
              borderColor: palette.hairline,
              opacity: pressed ? 0.58 : 1,
            },
          ]}
        >
          <X color={palette.ink} size={20} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.kicker, { color: palette.seam }]}>
            WRITE / 書く
          </Text>
          <Text style={[styles.title, { color: palette.ink }]}>
            Write what you kept
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Draw with finger"
          accessibilityState={{ checked: allowsFingerDrawing }}
          onPress={() => setAllowsFingerDrawing((value) => !value)}
          style={({ pressed }) => [
            styles.inputToggle,
            {
              borderColor: allowsFingerDrawing
                ? palette.seam
                : palette.hairline,
              backgroundColor: allowsFingerDrawing
                ? palette.seamSoft
                : "transparent",
              opacity: pressed ? 0.58 : 1,
            },
          ]}
        >
          <Hand color={palette.seam} size={18} />
          <Text style={[styles.inputToggleText, { color: palette.ink }]}>
            Finger {allowsFingerDrawing ? "on" : "off"}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={[styles.sidePanel, wide && styles.sidePanelWide]}>
          <SourcePrompt
            source={source}
            character={character}
            palette={palette}
          />
          <ModeControl mode={mode} onChange={setMode} palette={palette} />
          {wide ? feedback : null}
        </View>

        <View style={styles.canvasColumn}>
          <View style={styles.canvasToolbar}>
            <Text style={[styles.canvasStatus, { color: palette.muted }]}>
              {strokeCount
                ? `${strokeCount} ${strokeCount === 1 ? "stroke" : "strokes"}`
                : allowsFingerDrawing
                  ? "Pencil or one finger"
                  : "Apple Pencil"}
            </Text>
            <View style={styles.toolbarActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Check ${character.literal}`}
                accessibilityHint="Recognizes the character and compares its strokes"
                disabled={!hasInk}
                onPress={() =>
                  setRecognitionRevision((revision) => revision + 1)
                }
                style={[
                  styles.checkControl,
                  {
                    backgroundColor: hasInk
                      ? palette.control
                      : palette.hairline,
                  },
                ]}
              >
                <Pencil
                  color={hasInk ? palette.controlText : palette.muted}
                  size={17}
                />
                <Text
                  style={[
                    styles.checkText,
                    { color: hasInk ? palette.controlText : palette.muted },
                  ]}
                >
                  Check
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Undo last stroke"
                disabled={!hasInk}
                onPress={() => setUndoRevision((revision) => revision + 1)}
                style={({ pressed }) => [
                  styles.squareControl,
                  {
                    borderColor: palette.hairline,
                    opacity: !hasInk ? 0.3 : pressed ? 0.58 : 1,
                  },
                ]}
              >
                <Undo2 color={palette.ink} size={19} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear handwriting field"
                disabled={!hasInk}
                onPress={resetAttempt}
                style={({ pressed }) => [
                  styles.squareControl,
                  {
                    borderColor: palette.hairline,
                    opacity: !hasInk ? 0.3 : pressed ? 0.58 : 1,
                  },
                ]}
              >
                <Eraser color={palette.ink} size={19} />
              </Pressable>
            </View>
          </View>

          <View
            style={[
              styles.canvasFrame,
              wide ? styles.canvasFrameWide : styles.canvasFrameNarrow,
              { borderColor: palette.hairline, backgroundColor: "#F8F8F2" },
            ]}
          >
            <WritingGrid color={palette.seam} />
            {showCorrection ? (
              <ReferenceOverlay
                character={character}
                color={assessment ? palette.proof : palette.seam}
              />
            ) : null}
            <KoePencilKitView
              accessibilityLabel={`Write ${character.literal}`}
              allowsFingerDrawing={allowsFingerDrawing}
              inkColor={palette.ink}
              clearRevision={clearRevision}
              undoRevision={undoRevision}
              recognitionRevision={recognitionRevision}
              onDrawingChange={(event) => onDrawingChange(event.nativeEvent)}
              onRecognition={(event) => onRecognition(event.nativeEvent)}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>

        {!wide ? <View style={styles.feedbackNarrow}>{feedback}</View> : null}
      </View>
    </SafeAreaView>
  );
}

function SourcePrompt({
  source,
  character,
  palette,
}: {
  source: PracticeSource;
  character: PracticeCharacter;
  palette: ConversationPalette;
}) {
  return (
    <View style={[styles.sourceCard, { borderColor: palette.hairline }]}>
      <Text style={[styles.sourceLabel, { color: palette.seam }]}>
        {source.label}
      </Text>
      <Text
        accessibilityLabel={`Source expression: ${source.textJa}`}
        style={[styles.expression, { color: palette.ink }]}
        numberOfLines={2}
      >
        {source.textJa}
      </Text>
      {source.textEn ? (
        <Text
          style={[styles.translation, { color: palette.muted }]}
          numberOfLines={2}
        >
          {source.textEn}
        </Text>
      ) : null}
      <View style={styles.targetRow}>
        <Text style={[styles.targetInstruction, { color: palette.muted }]}>
          Write
        </Text>
        <Text style={[styles.targetLiteral, { color: palette.ink }]}>
          {character.literal}
        </Text>
        <Text style={[styles.targetMeta, { color: palette.muted }]}>
          {character.reading} · {character.meaning} · {character.strokes.length}{" "}
          strokes
        </Text>
      </View>
    </View>
  );
}

function ModeControl({
  mode,
  onChange,
  palette,
}: {
  mode: "recall" | "trace";
  onChange: (mode: "recall" | "trace") => void;
  palette: ConversationPalette;
}) {
  return (
    <View style={[styles.modeControl, { borderColor: palette.hairline }]}>
      {(["recall", "trace"] as const).map((option) => {
        const selected = mode === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={
              option === "recall" ? "Free recall" : "Trace guide"
            }
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.modeOption,
              {
                backgroundColor: selected ? palette.seamSoft : "transparent",
                opacity: pressed ? 0.58 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.modeText,
                { color: selected ? palette.seam : palette.muted },
              ]}
            >
              {option === "recall" ? "Free recall" : "Trace guide"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FeedbackPanel({
  assessment,
  character,
  palette,
  onConfirm,
  onRetry,
  onNext,
}: {
  assessment?: HandwritingAssessment;
  character: PracticeCharacter;
  palette: ConversationPalette;
  onConfirm: (text: string) => void;
  onRetry: () => void;
  onNext: () => void;
}) {
  if (!assessment) {
    return (
      <View style={[styles.feedbackPanel, { borderColor: palette.hairline }]}>
        <Text style={[styles.feedbackEyebrow, { color: palette.seam }]}>
          STROKE CONTRACT
        </Text>
        <Text style={[styles.feedbackTitle, { color: palette.ink }]}>
          Write, check, correct, repeat
        </Text>
        {character.strokes.map((stroke, index) => (
          <View key={stroke.instruction} style={styles.instructionRow}>
            <Text style={[styles.instructionNumber, { color: palette.proof }]}>
              {index + 1}
            </Text>
            <Text style={[styles.instructionText, { color: palette.muted }]}>
              {stroke.instruction}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  const needsConfirmation =
    assessment.recognition.state === "uncertain" ||
    assessment.recognition.state === "unavailable";
  const choices = assessment.recognition.candidates.some(
    (candidate) => candidate.text === character.literal,
  )
    ? assessment.recognition.candidates
    : [
        ...assessment.recognition.candidates,
        { text: character.literal, confidence: 0 },
      ];

  return (
    <View style={[styles.feedbackPanel, { borderColor: palette.hairline }]}>
      <View style={styles.feedbackHeader}>
        <View>
          <Text style={[styles.feedbackEyebrow, { color: palette.seam }]}>
            ATTEMPT FEEDBACK
          </Text>
          <Text style={[styles.feedbackTitle, { color: palette.ink }]}>
            {assessment.verdict === "ready"
              ? "Ready to move on"
              : assessment.verdict === "retry"
                ? "One clear retry"
                : "Close — inspect the overlay"}
          </Text>
        </View>
        <VerdictMark verdict={assessment.verdict} palette={palette} />
      </View>
      <FeedbackRow
        state={recognitionFeedbackState(assessment)}
        message={assessment.recognition.message}
        palette={palette}
      />
      <FeedbackRow
        state={assessment.strokeCount.state}
        message={assessment.strokeCount.message}
        palette={palette}
      />
      <FeedbackRow
        state={assessment.direction.state}
        message={assessment.direction.message}
        palette={palette}
      />
      <FeedbackRow
        state={assessment.proportions.state}
        message={assessment.proportions.message}
        palette={palette}
      />

      {needsConfirmation ? (
        <View style={styles.candidateSection}>
          <Text style={[styles.candidateLabel, { color: palette.muted }]}>
            What did you write?
          </Text>
          <View style={styles.candidates}>
            {choices.slice(0, 4).map((candidate) => (
              <Pressable
                key={candidate.text}
                accessibilityRole="button"
                accessibilityLabel={`Confirm ${candidate.text}`}
                onPress={() => onConfirm(candidate.text)}
                style={({ pressed }) => [
                  styles.candidateButton,
                  {
                    borderColor: palette.hairline,
                    backgroundColor:
                      candidate.text === character.literal
                        ? palette.seamSoft
                        : "transparent",
                    opacity: pressed ? 0.58 : 1,
                  },
                ]}
              >
                <Text style={[styles.candidateText, { color: palette.ink }]}>
                  {candidate.text}
                </Text>
                {candidate.confidence ? (
                  <Text
                    style={[
                      styles.candidateConfidence,
                      { color: palette.muted },
                    ]}
                  >
                    {Math.round(candidate.confidence * 100)}%
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.feedbackActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Try ${character.literal} again`}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: palette.hairline, opacity: pressed ? 0.58 : 1 },
          ]}
        >
          <RotateCcw color={palette.ink} size={17} />
          <Text style={[styles.secondaryText, { color: palette.ink }]}>
            Try again
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next practice character"
          onPress={onNext}
          style={({ pressed }) => [
            styles.nextButton,
            { backgroundColor: palette.seamSoft, opacity: pressed ? 0.58 : 1 },
          ]}
        >
          <Text style={[styles.nextText, { color: palette.seam }]}>Next</Text>
          <ChevronRight color={palette.seam} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

function FeedbackRow({
  state,
  message,
  palette,
}: {
  state: FeedbackState;
  message: string;
  palette: ConversationPalette;
}) {
  const color =
    state === "pass"
      ? palette.success
      : state === "review"
        ? palette.proof
        : palette.muted;
  return (
    <View style={styles.feedbackRow}>
      {state === "pass" ? (
        <Check color={color} size={17} />
      ) : (
        <AlertCircle color={color} size={17} />
      )}
      <Text style={[styles.feedbackMessage, { color: palette.muted }]}>
        {message}
      </Text>
    </View>
  );
}

function VerdictMark({
  verdict,
  palette,
}: {
  verdict: HandwritingAssessment["verdict"];
  palette: ConversationPalette;
}) {
  const pass = verdict === "ready";
  return (
    <View
      accessibilityLabel={pass ? "Attempt ready" : "Attempt needs review"}
      style={[
        styles.verdictMark,
        { backgroundColor: pass ? palette.success : palette.seamSoft },
      ]}
    >
      {pass ? (
        <Check color={palette.canvas} size={18} />
      ) : (
        <AlertCircle color={palette.seam} size={18} />
      )}
    </View>
  );
}

function recognitionFeedbackState(
  assessment: HandwritingAssessment,
): FeedbackState {
  if (
    assessment.recognition.state === "certain" ||
    assessment.recognition.state === "confirmed"
  ) {
    return "pass";
  }
  return assessment.recognition.state === "unavailable"
    ? "unavailable"
    : "review";
}

function WritingGrid({ color }: { color: string }) {
  return (
    <Svg
      accessibilityElementsHidden
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      viewBox="0 0 100 100"
    >
      <Line
        x1="50"
        y1="4"
        x2="50"
        y2="96"
        stroke={color}
        strokeOpacity={0.2}
        strokeDasharray="2 3"
      />
      <Line
        x1="4"
        y1="50"
        x2="96"
        y2="50"
        stroke={color}
        strokeOpacity={0.2}
        strokeDasharray="2 3"
      />
      <Line
        x1="10"
        y1="10"
        x2="90"
        y2="90"
        stroke={color}
        strokeOpacity={0.1}
        strokeDasharray="2 4"
      />
      <Line
        x1="90"
        y1="10"
        x2="10"
        y2="90"
        stroke={color}
        strokeOpacity={0.1}
        strokeDasharray="2 4"
      />
    </Svg>
  );
}

function ReferenceOverlay({
  character,
  color,
}: {
  character: PracticeCharacter;
  color: string;
}) {
  return (
    <Svg
      accessibilityElementsHidden
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      viewBox="0 0 100 100"
    >
      {character.strokes.map((stroke, index) => {
        const start = stroke.points[0];
        const end = stroke.points.at(-1)!;
        return (
          <React.Fragment key={stroke.path}>
            <Path
              d={stroke.path}
              fill="none"
              stroke={color}
              strokeDasharray="2.5 2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.6}
              strokeWidth={2.4}
            />
            <Circle
              cx={start.x * 100}
              cy={start.y * 100}
              r={3.4}
              fill={color}
              opacity={0.82}
            />
            <SvgText
              x={start.x * 100}
              y={start.y * 100 + 1.7}
              fill="#F8F8F2"
              fontSize={5}
              fontWeight="700"
              textAnchor="middle"
            >
              {index + 1}
            </SvgText>
            <Circle
              cx={end.x * 100}
              cy={end.y * 100}
              r={1.7}
              fill={color}
              opacity={0.68}
            />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, alignItems: "stretch", justifyContent: "center" },
  header: {
    minHeight: 66,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  roundControl: {
    width: HANDWRITING_TARGET_SIZE,
    height: HANDWRITING_TARGET_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: HANDWRITING_TARGET_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1 },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.25,
    lineHeight: 12,
  },
  title: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 21,
    fontWeight: "600",
    lineHeight: 28,
  },
  inputToggle: {
    minWidth: 112,
    minHeight: HANDWRITING_TARGET_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  inputToggleText: { fontSize: 12, fontWeight: "700" },
  body: { flex: 1, paddingHorizontal: 18, paddingBottom: 14, gap: 12 },
  bodyWide: {
    flexDirection: "row",
    paddingHorizontal: 24,
    paddingBottom: 22,
    gap: 24,
  },
  sidePanel: { gap: 10 },
  sidePanelWide: { width: 330, flexShrink: 0 },
  sourceCard: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sourceLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.2,
    lineHeight: 12,
  },
  expression: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 25,
    lineHeight: 34,
    marginTop: 3,
  },
  translation: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  targetRow: {
    minHeight: 46,
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  targetInstruction: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 0.8,
  },
  targetLiteral: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 32,
    lineHeight: 41,
  },
  targetMeta: { flex: 1, fontSize: 10, lineHeight: 14 },
  modeControl: {
    minHeight: HANDWRITING_TARGET_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: "row",
    gap: 4,
    padding: 3,
  },
  modeOption: {
    flexBasis: 0,
    flexGrow: 1,
    minHeight: 40,
    borderRadius: 7,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  modeText: { fontSize: 12, fontWeight: "700" },
  canvasColumn: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "flex-start",
    minWidth: 0,
  },
  canvasToolbar: {
    minHeight: HANDWRITING_TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  canvasStatus: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 0.55,
  },
  toolbarActions: { flexDirection: "row", gap: 8 },
  checkControl: {
    minWidth: 96,
    height: HANDWRITING_TARGET_SIZE,
    borderRadius: 9,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  squareControl: {
    width: HANDWRITING_TARGET_SIZE,
    height: HANDWRITING_TARGET_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  canvasFrame: {
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 8,
    alignSelf: "center",
  },
  canvasFrameWide: {
    flex: 1,
    aspectRatio: 1,
    width: "100%",
    maxWidth: 620,
    maxHeight: 620,
  },
  canvasFrameNarrow: {
    flex: 1,
    aspectRatio: 1,
    width: "100%",
    maxWidth: 460,
    maxHeight: 460,
    minHeight: 250,
  },
  checkText: { fontSize: 14, fontWeight: "800" },
  feedbackNarrow: { maxHeight: 220 },
  feedbackPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 4,
  },
  feedbackHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  feedbackEyebrow: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.15,
    lineHeight: 12,
  },
  feedbackTitle: {
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    marginTop: 2,
  },
  verdictMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  instructionRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 5,
  },
  instructionNumber: {
    width: 16,
    fontFamily: "SFMono-Medium",
    fontSize: 11,
    lineHeight: 17,
  },
  instructionText: { flex: 1, fontSize: 11, lineHeight: 17 },
  feedbackRow: {
    minHeight: 29,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 6,
  },
  feedbackMessage: { flex: 1, fontSize: 10.5, lineHeight: 15 },
  candidateSection: { marginTop: 8 },
  candidateLabel: { fontSize: 10, lineHeight: 15 },
  candidates: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 5 },
  candidateButton: {
    minWidth: HANDWRITING_TARGET_SIZE,
    minHeight: HANDWRITING_TARGET_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  candidateText: { fontFamily: "Hiragino Sans", fontSize: 19 },
  candidateConfidence: { fontFamily: "SFMono-Medium", fontSize: 8 },
  feedbackActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  secondaryButton: {
    flex: 1,
    minHeight: HANDWRITING_TARGET_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryText: { fontSize: 12, fontWeight: "700" },
  nextButton: {
    flex: 1,
    minHeight: HANDWRITING_TARGET_SIZE,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  nextText: { fontSize: 12, fontWeight: "800" },
});
