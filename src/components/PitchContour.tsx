import React, { useMemo } from "react";
import { Text, View } from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import type {
  PitchContour as PitchContourData,
  SpeechUnitMeasurement,
} from "@/services/pitch";
import { colors } from "@/theme/colors";

type Contour = Pick<PitchContourData, "f0" | "timestamps">;

type Props = {
  native: Contour;
  user?: Contour;
  previous?: Contour;
  units?: SpeechUnitMeasurement[];
  targetUnitIndex?: number;
  height?: number;
  width?: number;
  showScore?: boolean;
  score?: number;
};

const CHART_INSET = { top: 18, right: 8, bottom: 24, left: 28 };

function toPoints(
  contour: Contour,
  width: number,
  height: number,
  center: number,
  range: number,
) {
  if (!contour.f0.length) return "";
  const semitones = contour.f0.map((value) =>
    value > 0 ? 12 * Math.log2(value / center) : Number.NaN,
  );
  const minTime = contour.timestamps[0] ?? 0;
  const maxTime = contour.timestamps.at(-1) ?? minTime + 1;
  const duration = Math.max(1, maxTime - minTime);
  const plotWidth = width - CHART_INSET.left - CHART_INSET.right;
  const plotHeight = height - CHART_INSET.top - CHART_INSET.bottom;
  let path = "";
  let connected = false;
  semitones.forEach((semitone, index) => {
    if (!Number.isFinite(semitone)) {
      connected = false;
      return;
    }
    const x =
      CHART_INSET.left +
      (((contour.timestamps[index] ?? minTime) - minTime) / duration) *
        plotWidth;
    const y =
      CHART_INSET.top +
      plotHeight / 2 -
      (semitone / range) * (plotHeight / 2 - 4);
    path += `${connected ? " L" : " M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    connected = true;
  });
  return path.trim();
}

function computeCenter(contour: Contour) {
  const voiced = contour.f0.filter((value) => value > 0);
  if (!voiced.length) return 200;
  const sorted = [...voiced].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

export function PitchContour({
  native,
  user,
  previous,
  units,
  targetUnitIndex,
  height = 132,
  width = 320,
  showScore,
  score,
}: Props) {
  const { nativePath, userPath, previousPath } = useMemo(() => {
    const center = computeCenter(native);
    return {
      nativePath: toPoints(native, width, height, center, 10),
      userPath: user
        ? toPoints(user, width, height, computeCenter(user), 10)
        : "",
      previousPath: previous
        ? toPoints(previous, width, height, computeCenter(previous), 10)
        : "",
    };
  }, [native, previous, user, width, height]);

  if (!native.f0.length) {
    return (
      <View
        accessible
        accessibilityLabel="Pitch comparison unavailable"
        style={{ width, height }}
        className="items-center justify-center rounded-xl bg-surface dark:bg-surface-dark"
      >
        <Text className="text-muted text-xs">
          Record the phrase to see pitch and timing.
        </Text>
      </View>
    );
  }

  const plotWidth = width - CHART_INSET.left - CHART_INSET.right;
  const plotHeight = height - CHART_INSET.top - CHART_INSET.bottom;
  const target =
    targetUnitIndex === undefined ? undefined : units?.[targetUnitIndex];
  const referenceStart = units?.[0]?.referenceStartMs ?? 0;
  const referenceEnd = units?.at(-1)?.referenceEndMs ?? 1;
  const referenceDuration = Math.max(1, referenceEnd - referenceStart);
  const targetX = target
    ? CHART_INSET.left +
      ((target.referenceStartMs - referenceStart) / referenceDuration) *
        plotWidth
    : 0;
  const targetWidth = target
    ? Math.max(
        10,
        ((target.referenceEndMs - target.referenceStartMs) /
          referenceDuration) *
          plotWidth,
      )
    : 0;
  const summary = [
    "Pitch guide.",
    "The solid line is the reference and the dashed line is this attempt.",
    target ? `${target.unit} is the current practice target.` : "",
    typeof score === "number" ? `Score ${score} out of 100.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <View accessible accessibilityLabel={summary} style={{ width }}>
      <Svg width={width} height={height}>
        {target ? (
          <Rect
            x={targetX}
            y={CHART_INSET.top - 4}
            width={targetWidth}
            height={plotHeight + 8}
            rx={4}
            fill={colors.warning}
            opacity={0.12}
          />
        ) : null}
        <Line
          x1={CHART_INSET.left}
          y1={CHART_INSET.top + plotHeight / 2}
          x2={width - CHART_INSET.right}
          y2={CHART_INSET.top + plotHeight / 2}
          stroke={colors.muted}
          strokeWidth={0.5}
          opacity={0.36}
        />
        <SvgText x={2} y={CHART_INSET.top + 5} fill={colors.muted} fontSize={8}>
          HIGH
        </SvgText>
        <SvgText
          x={4}
          y={CHART_INSET.top + plotHeight}
          fill={colors.muted}
          fontSize={8}
        >
          LOW
        </SvgText>
        {previousPath ? (
          <Path
            d={previousPath}
            stroke={colors.muted}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
            opacity={0.42}
          />
        ) : null}
        {nativePath ? (
          <Path
            d={nativePath}
            stroke={colors.accent}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
        ) : null}
        {userPath ? (
          <Path
            d={userPath}
            stroke={colors.primary}
            strokeWidth={2.25}
            fill="none"
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        ) : null}
        {units?.map((unit) => {
          const stride = Math.max(1, Math.ceil(units.length / 9));
          if (
            unit.index !== targetUnitIndex &&
            unit.index !== 0 &&
            unit.index !== units.length - 1 &&
            unit.index % stride !== 0
          ) {
            return null;
          }
          const x =
            CHART_INSET.left +
            (((unit.referenceStartMs + unit.referenceEndMs) / 2 -
              referenceStart) /
              referenceDuration) *
              plotWidth;
          return (
            <SvgText
              key={`${unit.unit}-${unit.index}`}
              x={x}
              y={height - 5}
              fill={
                unit.index === targetUnitIndex ? colors.warning : colors.muted
              }
              fontSize={9}
              fontWeight={unit.index === targetUnitIndex ? "700" : "400"}
              textAnchor="middle"
            >
              {unit.unit}
            </SvgText>
          );
        })}
        {showScore && typeof score === "number" ? (
          <SvgText
            x={width - 8}
            y={13}
            fill={colors.text}
            fontSize={11}
            fontWeight="700"
            textAnchor="end"
          >
            {score}/100
          </SvgText>
        ) : null}
      </Svg>
      <View className="mt-1 flex-row items-center justify-center gap-4">
        <Legend color={colors.accent} label="Reference" />
        <Legend color={colors.primary} label="This try" dashed />
        {previous ? <Legend color={colors.muted} label="Previous" /> : null}
      </View>
    </View>
  );
}

function Legend({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Svg width={15} height={6}>
        <Line
          x1={0}
          y1={3}
          x2={15}
          y2={3}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? "3 2" : undefined}
        />
        {!dashed ? <Circle cx={7.5} cy={3} r={1.5} fill={color} /> : null}
      </Svg>
      <Text className="text-muted text-[10px]">{label}</Text>
    </View>
  );
}
