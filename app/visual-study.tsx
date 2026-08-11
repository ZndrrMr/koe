import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";

import { AcousticVoiceForm } from "@/components/AcousticVoiceForm";
import { useConversationPalette } from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import type { VoicePhase } from "@/voice/lifecycle";
import type { AcousticDirection } from "@/voice/acousticVisual";

const DIRECTIONS: Array<{
  id: AcousticDirection;
  name: string;
  note: string;
}> = [
  {
    id: "voiceSeam",
    name: "Voice seam",
    note: "Selected · one continuous acoustic memory",
  },
  {
    id: "moraField",
    name: "Mora field",
    note: "Rejected · too many separate objects",
  },
  {
    id: "resonanceGate",
    name: "Resonance gate",
    note: "Rejected · reads too close to an AI orb",
  },
];

const PHASES: VoicePhase[] = [
  "idle",
  "listening",
  "understanding",
  "speaking",
  "interrupted",
  "correction",
  "retry",
  "success",
];

const PROTOTYPE_ENERGY = [
  0.08, 0.18, 0.5, 0.72, 0.34, 0.62, 0.84, 0.28, 0.14, 0.56, 0.38,
];

export default function VisualStudyScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const reviewDirection = process.env.EXPO_PUBLIC_KOE_REVIEW_DIRECTION as
    | AcousticDirection
    | undefined;
  const [direction, setDirection] = useState<AcousticDirection>(
    reviewDirection &&
      DIRECTIONS.some((direction) => direction.id === reviewDirection)
      ? reviewDirection
      : "voiceSeam",
  );
  const reviewPhase = process.env.EXPO_PUBLIC_KOE_REVIEW_PHASE as
    | VoicePhase
    | undefined;
  const [phase, setPhase] = useState<VoicePhase>(
    reviewPhase && PHASES.includes(reviewPhase) ? reviewPhase : "idle",
  );
  const [energyIndex, setEnergyIndex] = useState(0);
  const reviewSequence =
    __DEV__ && process.env.EXPO_PUBLIC_KOE_REVIEW_SEQUENCE === "1";

  useEffect(() => {
    if (!reviewSequence) return;
    let index = 0;
    setPhase(PHASES[index]);
    const timer = setInterval(() => {
      index = (index + 1) % PHASES.length;
      setPhase(PHASES[index]);
    }, 1_100);
    return () => clearInterval(timer);
  }, [reviewSequence]);

  useEffect(() => {
    if (phase !== "listening" && phase !== "speaking") return;
    const timer = setInterval(
      () => setEnergyIndex((index) => (index + 1) % PROTOTYPE_ENERGY.length),
      120,
    );
    return () => clearInterval(timer);
  }, [phase]);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.kicker, { color: palette.muted }]}>
            MOTION STUDY / ZAN-849
          </Text>
          <Text style={[styles.title, { color: palette.ink }]}>
            Acoustic form
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close motion study"
          onPress={() => router.back()}
          hitSlop={0}
          style={[styles.closeButton, { borderColor: palette.hairline }]}
        >
          <X color={palette.ink} size={20} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.directionRow}>
          {DIRECTIONS.map((item) => {
            const selected = item.id === direction;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.name}. ${item.note}`}
                onPress={() => setDirection(item.id)}
                style={[
                  styles.directionButton,
                  {
                    backgroundColor: selected
                      ? palette.seamSoft
                      : "transparent",
                    borderColor: selected ? palette.seam : palette.hairline,
                  },
                ]}
              >
                <Text style={[styles.directionName, { color: palette.ink }]}>
                  {item.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.directionNote, { color: palette.muted }]}>
          {DIRECTIONS.find((item) => item.id === direction)?.note}
        </Text>

        <View style={styles.prototype}>
          <AcousticVoiceForm
            direction={direction}
            phase={phase}
            energy={PROTOTYPE_ENERGY[energyIndex]}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: palette.muted }]}>
          STATE / MUTED LEGIBILITY
        </Text>
        <View style={styles.phaseGrid}>
          {PHASES.map((item) => {
            const selected = item === phase;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item} voice state`}
                onPress={() => setPhase(item)}
                style={[
                  styles.phaseButton,
                  {
                    backgroundColor: selected
                      ? palette.seamSoft
                      : "transparent",
                    borderColor: selected ? palette.seam : palette.hairline,
                  },
                ]}
              >
                <Text style={[styles.phaseText, { color: palette.ink }]}>
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
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
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 10,
    letterSpacing: 1.4,
  },
  title: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 24,
    fontWeight: "600",
    marginTop: 3,
  },
  closeButton: {
    width: CONVERSATION_TARGET.roundIcon,
    height: CONVERSATION_TARGET.roundIcon,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { width: "100%", paddingBottom: 30 },
  directionRow: {
    width: "100%",
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 8,
  },
  directionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: CONVERSATION_TARGET.direction,
    borderWidth: 1,
    borderRadius: 4,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  directionName: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  directionNote: {
    minHeight: 28,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 7,
    paddingHorizontal: 20,
  },
  prototype: { minHeight: 430, alignItems: "center", justifyContent: "center" },
  sectionLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 10,
    letterSpacing: 1.4,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  phaseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
  },
  phaseButton: {
    minHeight: CONVERSATION_TARGET.minimum,
    minWidth: 90,
    borderWidth: 1,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  phaseText: { fontFamily: "SFMono-Medium", fontSize: 11 },
});
