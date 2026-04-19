import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';
import { colors } from '@/theme/colors';

type Contour = { f0: number[]; timestamps: number[] };

type Props = {
  native: Contour;
  user?: Contour;
  height?: number;
  width?: number;
  showScore?: boolean;
  score?: number;
};

function toPoints(c: Contour, w: number, h: number, center: number, range: number) {
  if (!c.f0.length) return '';
  const semis = c.f0.map((v) => (v > 0 ? 12 * Math.log2(v / center) : NaN));
  const minT = c.timestamps[0];
  const maxT = c.timestamps[c.timestamps.length - 1];
  const duration = Math.max(1, maxT - minT);
  let d = '';
  let moved = false;
  semis.forEach((s, i) => {
    if (!Number.isFinite(s)) {
      moved = false;
      return;
    }
    const x = ((c.timestamps[i] - minT) / duration) * w;
    const y = h / 2 - (s / range) * (h / 2 - 8);
    d += (moved ? ' L ' : ' M ') + x.toFixed(1) + ' ' + y.toFixed(1);
    moved = true;
  });
  return d.trim();
}

function computeCenter(c: Contour) {
  const voiced = c.f0.filter((v) => v > 0);
  if (!voiced.length) return 200;
  return voiced.reduce((a, b) => a + b, 0) / voiced.length;
}

export function PitchContour({ native, user, height = 80, width = 320, showScore, score }: Props) {
  const { nativePath, userPath } = useMemo(() => {
    const center = computeCenter(native);
    const nativePath = toPoints(native, width, height, center, 12);
    const userPath = user ? toPoints(user, width, height, center, 12) : '';
    return { nativePath, userPath };
  }, [native, user, width, height]);

  if (!native.f0.length) {
    return (
      <View
        style={{ width, height }}
        className="items-center justify-center rounded-xl bg-surface dark:bg-surface-dark"
      >
        <Text className="text-muted text-xs">no pitch data</Text>
      </View>
    );
  }

  return (
    <View style={{ width, height }} className="relative rounded-xl">
      <Svg width={width} height={height}>
        <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={colors.muted} strokeWidth={0.5} opacity={0.3} />
        {nativePath && (
          <Path d={nativePath} stroke={colors.accent} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        )}
        {userPath && (
          <Path d={userPath} stroke={colors.primary} strokeWidth={2} fill="none" strokeDasharray="4 4" strokeLinecap="round" />
        )}
        {showScore && typeof score === 'number' && (
          <SvgText x={width - 8} y={14} fill={colors.text} fontSize={12} fontWeight="700" textAnchor="end">
            {score}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}
