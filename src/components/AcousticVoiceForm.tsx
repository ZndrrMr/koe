import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Line, Path } from "react-native-svg";

import { colors } from "@/theme/colors";
import { useConversationPalette } from "@/theme/conversation";
import type { VoicePhase } from "@/voice/lifecycle";
import {
  ACOUSTIC_PRESENTATION,
  advanceEnergyTrace,
  type AcousticDirection,
  INITIAL_ENERGY_TRACE,
  voiceSeamPaths,
} from "@/voice/acousticVisual";

type Props = {
  phase: VoicePhase;
  energy: number;
  direction?: AcousticDirection;
  compact?: boolean;
  showLabels?: boolean;
  testID?: string;
};

const FORM_WIDTH = 250;
const FORM_HEIGHT = 320;

export function AcousticVoiceForm({
  phase,
  energy,
  direction = "voiceSeam",
  compact = false,
  showLabels = true,
  testID = "acoustic-voice-form",
}: Props) {
  const palette = useConversationPalette();
  const presentation = ACOUSTIC_PRESENTATION[phase];
  const reducedMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const [trace, setTrace] = useState(INITIAL_ENERGY_TRACE);
  const progress = useSharedValue(0);
  const formScale = useSharedValue(1);
  const isWide = !compact && windowWidth >= 700;
  const height = compact ? 190 : isWide ? 400 : FORM_HEIGHT;
  const width = compact ? 160 : isWide ? 310 : FORM_WIDTH;

  useEffect(() => {
    setTrace((current) => advanceEnergyTrace(current, phase, energy));
  }, [energy, phase]);

  useEffect(() => {
    formScale.value = reducedMotion ? 1 : 0.975;
    formScale.value = withTiming(1, { duration: reducedMotion ? 0 : 260 });
  }, [formScale, phase, reducedMotion]);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (presentation.processing && !reducedMotion) {
      progress.value = withRepeat(
        withTiming(1, { duration: 1_450 }),
        -1,
        false,
      );
    }
    return () => cancelAnimation(progress);
  }, [presentation.processing, progress, reducedMotion]);

  const formStyle = useAnimatedStyle(() => ({
    transform: [{ scale: formScale.value }],
  }));
  const progressStyle = useAnimatedStyle(() => ({
    opacity: presentation.processing ? 1 : 0,
    transform: [
      { translateY: (progress.value - 0.5) * Math.max(40, height - 56) },
    ],
  }));

  const amplitude =
    presentation.shape === "compressed"
      ? compact
        ? 20
        : isWide
          ? 40
          : 31
      : compact
        ? 34
        : isWide
          ? 72
          : 57;
  const paths = useMemo(
    () => voiceSeamPaths(trace, { width, height, amplitude }),
    [amplitude, height, trace, width],
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityValue={{ text: presentation.titleEn }}
      style={[styles.container, compact && styles.compactContainer]}
    >
      {showLabels ? (
        <View
          style={[styles.labelBlock, isWide && styles.wideLabelBlock]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.eyebrow, { color: palette.muted }]}>
            {presentation.eyebrow}
          </Text>
          <Text
            style={[
              styles.japaneseTitle,
              isWide && styles.wideJapaneseTitle,
              { color: palette.ink },
            ]}
          >
            {presentation.titleJa}
          </Text>
          <Text style={[styles.englishTitle, { color: palette.muted }]}>
            {presentation.titleEn}
          </Text>
        </View>
      ) : null}

      <Animated.View style={[{ width, height }, formStyle]}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {direction === "voiceSeam" ? (
            <VoiceSeam
              phase={phase}
              width={width}
              height={height}
              trace={trace}
              envelope={paths.envelope}
              center={paths.center}
              palette={palette}
              amplitude={amplitude}
            />
          ) : direction === "moraField" ? (
            <MoraField
              trace={trace}
              width={width}
              height={height}
              phase={phase}
              palette={palette}
            />
          ) : (
            <ResonanceGate
              trace={trace}
              width={width}
              height={height}
              phase={phase}
              palette={palette}
            />
          )}
        </Svg>

        {presentation.processing ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.progressMarker,
              {
                backgroundColor: palette.brass,
                left: width / 2 - 3,
                top: height / 2 - 3,
              },
              progressStyle,
            ]}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

type Palette = {
  [Key in keyof (typeof colors.conversation)["light"]]: string;
};

function VoiceSeam({
  phase,
  width,
  height,
  trace,
  envelope,
  center,
  palette,
  amplitude,
}: {
  phase: VoicePhase;
  width: number;
  height: number;
  trace: readonly number[];
  envelope: string;
  center: string;
  palette: Palette;
  amplitude: number;
}) {
  const presentation = ACOUSTIC_PRESENTATION[phase];
  const comparisonLeft = voiceSeamPaths(trace, {
    width,
    height,
    amplitude: amplitude * 0.72,
    offsetX: -12,
  });
  const comparisonRight = voiceSeamPaths(trace, {
    width,
    height,
    amplitude: amplitude * 0.92,
    offsetX: 12,
  });
  const isInput = phase === "listening" || phase === "interimTranscript";
  const isOutput = phase === "speaking";

  if (presentation.shape === "split" || presentation.shape === "comparing") {
    return (
      <G>
        <Path
          d={comparisonLeft.envelope}
          fill={palette.seamSoft}
          stroke={palette.seam}
          strokeWidth={1.2}
          opacity={presentation.shape === "comparing" ? 0.45 : 0.72}
        />
        <Path
          d={comparisonRight.envelope}
          fill={presentation.shape === "split" ? palette.proof : palette.seam}
          fillOpacity={presentation.shape === "split" ? 0.12 : 0.14}
          stroke={presentation.shape === "split" ? palette.proof : palette.seam}
          strokeWidth={presentation.shape === "split" ? 2.2 : 1.8}
        />
        <Line
          x1={width / 2}
          y1={22}
          x2={width / 2}
          y2={height - 22}
          stroke={palette.hairline}
          strokeWidth={1}
        />
      </G>
    );
  }

  const broken = presentation.shape === "broken";
  const resolved = presentation.shape === "resolved";
  return (
    <G>
      <Line
        x1={width / 2}
        y1={4}
        x2={width / 2}
        y2={height - 4}
        stroke={palette.hairline}
        strokeWidth={1}
      />
      <Path
        d={envelope}
        fill={palette.seam}
        fillOpacity={resolved ? 0.1 : isInput || isOutput ? 0.17 : 0.1}
        stroke={broken ? palette.proof : palette.seam}
        strokeWidth={broken ? 1.6 : isOutput ? 2.1 : 1.5}
        strokeDasharray={broken ? "24 16" : undefined}
      />
      <Path
        d={center}
        fill="none"
        stroke={broken ? palette.proof : palette.ink}
        strokeOpacity={0.82}
        strokeWidth={isOutput ? 2.4 : 1.5}
        strokeDasharray={broken ? "19 14" : undefined}
        strokeLinecap="round"
      />
      {isInput ? (
        <G opacity={0.75}>
          <Line
            x1={25}
            y1={height - 43}
            x2={43}
            y2={height - 43}
            stroke={palette.seam}
          />
          <Line
            x1={31}
            y1={height - 34}
            x2={43}
            y2={height - 34}
            stroke={palette.seam}
          />
          <Line
            x1={37}
            y1={height - 25}
            x2={43}
            y2={height - 25}
            stroke={palette.seam}
          />
        </G>
      ) : null}
      {isOutput ? (
        <G opacity={0.75}>
          <Line
            x1={width - 43}
            y1={25}
            x2={width - 25}
            y2={25}
            stroke={palette.seam}
          />
          <Line
            x1={width - 43}
            y1={34}
            x2={width - 31}
            y2={34}
            stroke={palette.seam}
          />
          <Line
            x1={width - 43}
            y1={43}
            x2={width - 37}
            y2={43}
            stroke={palette.seam}
          />
        </G>
      ) : null}
      {resolved ? (
        <Circle
          cx={width / 2}
          cy={height / 2}
          r={25}
          fill="none"
          stroke={palette.success}
          strokeWidth={2}
        />
      ) : null}
    </G>
  );
}

function MoraField({
  trace,
  width,
  height,
  phase,
  palette,
}: {
  trace: readonly number[];
  width: number;
  height: number;
  phase: VoicePhase;
  palette: Palette;
}) {
  return (
    <G>
      {trace.map((sample, index) => {
        const y = 18 + (index / (trace.length - 1)) * (height - 36);
        const direction = index % 2 ? -1 : 1;
        return (
          <Circle
            key={index}
            cx={width / 2 + direction * sample * width * 0.18}
            cy={y}
            r={3 + sample * 12}
            fill={phase === "correction" ? palette.proof : palette.seam}
            fillOpacity={0.24 + sample * 0.5}
          />
        );
      })}
    </G>
  );
}

function ResonanceGate({
  trace,
  width,
  height,
  phase,
  palette,
}: {
  trace: readonly number[];
  width: number;
  height: number;
  phase: VoicePhase;
  palette: Palette;
}) {
  const energy = trace.slice(-5).reduce((sum, item) => sum + item, 0) / 5;
  return (
    <G>
      {[0, 1, 2, 3].map((ring) => (
        <Ellipse
          key={ring}
          cx={width / 2}
          cy={height / 2}
          rx={25 + ring * 19 + energy * 28}
          ry={38 + ring * 28 + energy * 42}
          fill="none"
          stroke={phase === "correction" ? palette.proof : palette.seam}
          strokeWidth={ring === 0 ? 2 : 1}
          opacity={0.82 - ring * 0.16}
        />
      ))}
      <Line
        x1={width / 2}
        y1={12}
        x2={width / 2}
        y2={height - 12}
        stroke={palette.ink}
        strokeWidth={1.4}
      />
    </G>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  compactContainer: {
    flex: 1,
  },
  labelBlock: {
    alignItems: "center",
    minHeight: 94,
    paddingHorizontal: 16,
  },
  wideLabelBlock: { minHeight: 110 },
  eyebrow: {
    fontFamily: "SFMono-Medium",
    fontSize: 10,
    letterSpacing: 1.6,
    lineHeight: 14,
  },
  japaneseTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 26,
    fontWeight: "600",
    letterSpacing: 0.4,
    lineHeight: 38,
    marginTop: 6,
  },
  wideJapaneseTitle: { fontSize: 30, lineHeight: 42 },
  englishTitle: {
    fontSize: 13,
    letterSpacing: 0.2,
    lineHeight: 18,
  },
  progressMarker: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
