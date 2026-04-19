import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { FuriganaRun } from '@/services/furigana';
import { colors, pitchColor, type PitchPattern } from '@/theme/colors';
import { useSettings } from '@/stores/useSettings';

export type PitchInfo = {
  pattern: PitchPattern;
  dropMora: number | null;
  mora: number;
};

type Props = {
  runs: FuriganaRun[];
  showFurigana?: 'always' | 'never' | 'known-hidden';
  showPitch?: boolean;
  pitchAccents?: Record<string, PitchInfo>;
  onWordPress?: (run: FuriganaRun) => void;
  fontSize?: number;
  color?: string;
  className?: string;
};

/**
 * Renders mixed JP text with optional furigana ruby above kanji runs
 * and pitch-accent overlines/color hints when PitchInfo is supplied.
 */
export function JapaneseText({
  runs,
  showFurigana,
  showPitch,
  pitchAccents,
  onWordPress,
  fontSize = 22,
  color,
  className,
}: Props) {
  const settings = useSettings();
  const resolvedFuri = showFurigana ?? settings.furiganaMode;
  const resolvedPitch = showPitch ?? settings.showPitch;
  const baseColor = color ?? colors.text;

  return (
    <View className={`flex-row flex-wrap items-end ${className ?? ''}`}>
      {runs.map((run, i) => {
        const pitch = pitchAccents?.[run.base];
        const tint = resolvedPitch && pitch ? pitchColor(pitch.pattern) : baseColor;
        const showReading =
          resolvedFuri !== 'never' && Boolean(run.reading) && run.reading !== run.base;
        return (
          <Pressable
            key={`${run.base}-${i}`}
            onPress={() => onWordPress?.(run)}
            className="mr-0.5"
            style={{ paddingTop: showReading ? fontSize * 0.6 : 0 }}
          >
            <View style={{ position: 'relative' }}>
              {showReading && (
                <Text
                  style={{
                    position: 'absolute',
                    top: -fontSize * 0.6,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: fontSize * 0.45,
                    color: colors.muted,
                  }}
                >
                  {run.reading}
                </Text>
              )}
              {resolvedPitch && pitch && (
                <View
                  style={{
                    position: 'absolute',
                    top: -2,
                    left: 0,
                    right: 0,
                    height: 1.5,
                    backgroundColor: tint,
                    opacity: 0.85,
                  }}
                />
              )}
              <Text style={{ fontSize, color: tint, lineHeight: fontSize * 1.4 }}>
                {run.base}
              </Text>
              {resolvedPitch && pitch && settings.showPitchNumbers && (
                <Text
                  style={{
                    position: 'absolute',
                    right: -8,
                    top: -8,
                    fontSize: fontSize * 0.4,
                    color: tint,
                  }}
                >
                  [{pitch.dropMora ?? 0}]
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
