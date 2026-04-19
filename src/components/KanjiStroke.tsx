import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme/colors';

type Props = { literal: string; size?: number; strokePaths?: string[] };

/**
 * KanjiVG stroke renderer. If strokePaths is provided, animate each path in
 * order. If not, render the literal as centered text as a placeholder —
 * the real SVGs ship via the build-dict script.
 */
export function KanjiStroke({ literal, size = 96, strokePaths }: Props) {
  if (!strokePaths?.length) {
    return (
      <View
        style={{
          width: size,
          height: size,
          backgroundColor: colors.surface,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: size * 0.6, color: colors.text }}>{literal}</Text>
      </View>
    );
  }
  return (
    <Pressable>
      <Svg width={size} height={size} viewBox="0 0 109 109">
        {strokePaths.map((d, i) => (
          <Path key={i} d={d} stroke={colors.text} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </Pressable>
  );
}
