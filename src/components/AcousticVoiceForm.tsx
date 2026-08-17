import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path } from "react-native-svg";

import { useConversationPalette } from "@/theme/conversation";
import type { VoicePhase } from "@/voice/lifecycle";
import {
  ACOUSTIC_PRESENTATION,
  type AcousticPlateKind,
} from "@/voice/acousticVisual";

type Props = {
  phase: VoicePhase;
  compact?: boolean;
  showLabels?: boolean;
  testID?: string;
};

/**
 * The production voice plate is intentionally static. State, copy, and the
 * current action carry meaning without relying on animation or audio energy.
 */
export const AcousticVoiceForm = React.memo(function AcousticVoiceForm({
  phase,
  compact = false,
  showLabels = true,
  testID = "acoustic-voice-form",
}: Props) {
  const palette = useConversationPalette();
  const presentation = ACOUSTIC_PRESENTATION[phase];
  const plateSize = compact ? 144 : 204;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityValue={{ text: presentation.titleEn }}
      style={styles.container}
    >
      <View
        style={[
          styles.stage,
          compact && styles.compactStage,
          { width: compact ? 208 : 300, height: compact ? 176 : 268 },
        ]}
      >
        <VoiceStatePlate
          kind={presentation.plate}
          color={phase === "recoverableError" ? palette.error : palette.seam}
          size={plateSize}
        />
      </View>

      {showLabels ? (
        <View accessibilityLiveRegion="polite" style={styles.copy}>
          <Text style={[styles.eyebrow, { color: palette.seam }]}>
            {presentation.eyebrow}
          </Text>
          <Text style={[styles.japaneseTitle, { color: palette.ink }]}>
            {presentation.titleJa}
          </Text>
          <Text style={[styles.englishTitle, { color: palette.muted }]}>
            {presentation.titleEn}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

function VoiceStatePlate({
  kind,
  color,
  size,
}: {
  kind: AcousticPlateKind;
  color: string;
  size: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 204 204">
      {kind === "ready" ? <ReadyPlate color={color} /> : null}
      {kind === "listening" ? <ListeningPlate color={color} /> : null}
      {kind === "understanding" ? <UnderstandingPlate color={color} /> : null}
      {kind === "speaking" ? <SpeakingPlate color={color} /> : null}
      {kind === "note" ? <NotePlate color={color} /> : null}
      {kind === "recovery" ? <RecoveryPlate color={color} /> : null}
    </Svg>
  );
}

function ReadyPlate({ color }: { color: string }) {
  return (
    <G fill="none" stroke={color}>
      <Circle cx="102" cy="102" r="66" opacity={0.32} />
      <Circle cx="102" cy="102" r="42" opacity={0.16} />
      <Path d="M102 62v80M92 76v52M112 76v52" strokeWidth={2} />
    </G>
  );
}

function ListeningPlate({ color }: { color: string }) {
  return (
    <G fill="none" stroke={color}>
      <Circle cx="102" cy="102" r="82" opacity={0.24} />
      <Circle cx="102" cy="102" r="58" opacity={0.48} />
      <Path
        d="M74 128c14-48 42-48 56 0M80 105c12-34 32-34 44 0M91 82c7-17 15-17 22 0"
        strokeWidth={2}
      />
      <Line x1="102" y1="20" x2="102" y2="44" opacity={0.55} />
      <Line x1="102" y1="160" x2="102" y2="184" opacity={0.55} />
      <Line x1="20" y1="102" x2="44" y2="102" opacity={0.55} />
      <Line x1="160" y1="102" x2="184" y2="102" opacity={0.55} />
    </G>
  );
}

function UnderstandingPlate({ color }: { color: string }) {
  return (
    <G fill="none" stroke={color}>
      <Path d="M37 102c22-53 108-53 130 0-22 53-108 53-130 0Z" opacity={0.34} />
      <Path d="M55 102c16-35 78-35 94 0-16 35-78 35-94 0Z" opacity={0.62} />
      <Path d="M78 102c8-17 40-17 48 0-8 17-40 17-48 0Z" strokeWidth={2} />
    </G>
  );
}

function SpeakingPlate({ color }: { color: string }) {
  return (
    <G fill="none" stroke={color}>
      <Circle cx="102" cy="102" r="34" opacity={0.2} />
      <Path d="M102 64v76M90 78v48M114 78v48" strokeWidth={2} />
      <Path d="M25 102h32M147 102h32M47 47l23 23M134 134l23 23M47 157l23-23M134 70l23-23" />
      <Path d="M102 20v27M102 157v27" opacity={0.55} />
    </G>
  );
}

function NotePlate({ color }: { color: string }) {
  return (
    <G fill="none" stroke={color}>
      <Path d="M43 66h118M43 102h84M43 138h118" opacity={0.7} />
      <Path d="M94 153h67" strokeWidth={7} opacity={0.88} />
    </G>
  );
}

function RecoveryPlate({ color }: { color: string }) {
  return (
    <G fill="none" stroke={color}>
      <Path
        d="M102 35a67 67 0 0 1 54 28M169 102a67 67 0 0 1-28 54M102 169a67 67 0 0 1-54-28M35 102a67 67 0 0 1 28-54"
        strokeWidth={2}
      />
      <Path d="M75 102h54M102 75v54" opacity={0.75} />
    </G>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center" },
  stage: { alignItems: "center", justifyContent: "center" },
  compactStage: { marginTop: 0 },
  copy: { alignItems: "center", maxWidth: 340 },
  eyebrow: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.4,
    textAlign: "center",
  },
  japaneseTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 30,
    lineHeight: 40,
    marginTop: 8,
    textAlign: "center",
  },
  englishTitle: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 3,
    textAlign: "center",
  },
});
