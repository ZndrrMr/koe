import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { MarketingStoryDemo } from "@/components/MarketingStoryDemo";
import {
  MARKETING_FRAMES,
  marketingFrame,
  nextMarketingFrame,
  type MarketingFrameId,
} from "@/marketing/launchSystem";
import { useConversationPalette } from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";

export default function MarketingCaptureScreen() {
  const palette = useConversationPalette();
  const params = useLocalSearchParams<{ frame?: string; autoplay?: string }>();
  const requested = marketingFrame(
    params.frame ?? process.env.EXPO_PUBLIC_KOE_MARKETING_FRAME,
  );
  const [frameId, setFrameId] = useState<MarketingFrameId>(requested.id);
  const [sequenceStarted, setSequenceStarted] = useState(false);
  const autoplay =
    params.autoplay === "1" ||
    process.env.EXPO_PUBLIC_KOE_MARKETING_SEQUENCE === "1";
  const enabled =
    __DEV__ || process.env.EXPO_PUBLIC_KOE_MARKETING_CAPTURE === "1";
  const frame = useMemo(() => marketingFrame(frameId), [frameId]);
  const next = nextMarketingFrame(frame.id);

  useEffect(() => setFrameId(requested.id), [requested.id]);

  useEffect(() => {
    if (!autoplay) {
      setSequenceStarted(false);
      return;
    }
    const timer = setTimeout(() => setSequenceStarted(true), 1_200);
    return () => clearTimeout(timer);
  }, [autoplay]);

  useEffect(() => {
    if (!sequenceStarted) return;
    const timer = setTimeout(() => setFrameId(next.id), frame.durationMs);
    return () => clearTimeout(timer);
  }, [frame.durationMs, next.id, sequenceStarted]);

  if (!enabled) return <Redirect href="/" />;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <View pointerEvents="none" style={styles.atmosphere}>
        <View style={[styles.rule, { backgroundColor: palette.hairline }]} />
        <View style={[styles.disc, { borderColor: palette.seamSoft }]} />
      </View>

      <View style={styles.header}>
        <View style={styles.brand}>
          <Text style={[styles.wordmark, { color: palette.ink }]}>声</Text>
          <View>
            <Text style={[styles.brandName, { color: palette.ink }]}>KOE</Text>
            <Text style={[styles.brandDetail, { color: palette.muted }]}>
              JAPANESE, SPOKEN
            </Text>
          </View>
        </View>
        <Text style={[styles.counter, { color: palette.muted }]}>
          0{frame.order} / 05
        </Text>
      </View>

      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: palette.proof }]}>
          {frame.eyebrow}
        </Text>
        <Text style={[styles.headline, { color: palette.ink }]}>
          {frame.headline}
        </Text>
        <Text style={[styles.detail, { color: palette.muted }]}>
          {frame.detail}
        </Text>
      </View>

      <View style={styles.demo}>
        <MarketingStoryDemo
          frame={frame}
          palette={palette}
          compact
          animated={sequenceStarted}
        />
      </View>

      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Story beat ${frame.order} of ${MARKETING_FRAMES.length}: ${frame.eyebrow}`}
        style={[styles.storyRail, { borderColor: palette.hairline }]}
      >
        {MARKETING_FRAMES.map((item) => {
          const selected = item.id === frame.id;
          return (
            <View key={item.id} style={styles.storyBeat}>
              <View
                style={[
                  styles.storyDot,
                  {
                    backgroundColor: selected
                      ? palette.proof
                      : palette.hairline,
                  },
                ]}
              />
              <Text
                style={[
                  styles.storyLabel,
                  { color: selected ? palette.ink : palette.muted },
                ]}
              >
                {item.eyebrow.split(" / ")[0]}
              </Text>
            </View>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, paddingHorizontal: 18, paddingBottom: 8 },
  atmosphere: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  rule: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "22%",
    width: StyleSheet.hairlineWidth,
  },
  disc: {
    position: "absolute",
    width: 430,
    height: 430,
    borderRadius: 215,
    borderWidth: 1,
    right: -280,
    top: 138,
    opacity: 0.55,
  },
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  wordmark: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 27,
    lineHeight: 34,
  },
  brandName: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  brandDetail: {
    fontFamily: "SFMono-Medium",
    fontSize: 7,
    letterSpacing: 0.8,
    marginTop: 1,
  },
  counter: { fontFamily: "SFMono-Medium", fontSize: 9, letterSpacing: 1.1 },
  copy: {
    minHeight: 150,
    paddingTop: 20,
    paddingRight: 18,
    justifyContent: "center",
  },
  eyebrow: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.3,
    lineHeight: 13,
  },
  headline: {
    maxWidth: 430,
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.65,
    marginTop: 7,
  },
  detail: { maxWidth: 380, fontSize: 12, lineHeight: 18, marginTop: 7 },
  demo: { flex: 1, minHeight: 390, justifyContent: "center" },
  storyRail: {
    width: "100%",
    minHeight: CONVERSATION_TARGET.minimum,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  storyBeat: { alignItems: "center", gap: 4 },
  storyDot: { width: 5, height: 5, borderRadius: 3 },
  storyLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 6,
    letterSpacing: 0.75,
  },
});
