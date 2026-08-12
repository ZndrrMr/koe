import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowRight, Check, Mic2 } from "lucide-react-native";

import { MarketingStoryDemo } from "@/components/MarketingStoryDemo";
import {
  CREATOR_LOOP,
  MARKETING_FRAMES,
  PRODUCT_PAGE_THESIS,
  marketingFrame,
  nextMarketingFrame,
  type MarketingFrameId,
} from "@/marketing/launchSystem";
import { useConversationPalette } from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";

export default function LandingScreen() {
  const palette = useConversationPalette();
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const [frameId, setFrameId] = useState<MarketingFrameId>("speak");
  const [playing, setPlaying] = useState(false);
  const frame = marketingFrame(frameId);

  useEffect(() => {
    if (!playing) return;
    const next = nextMarketingFrame(frame.id);
    const timer = setTimeout(() => setFrameId(next.id), frame.durationMs);
    return () => clearTimeout(timer);
  }, [frame.durationMs, frame.id, playing]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View pointerEvents="none" style={styles.atmosphere}>
          <View
            style={[styles.verticalRule, { backgroundColor: palette.hairline }]}
          />
          <View
            style={[styles.heroCircle, { borderColor: palette.seamSoft }]}
          />
        </View>

        <View style={styles.nav}>
          <View style={styles.brand}>
            <Text style={[styles.wordmark, { color: palette.ink }]}>声</Text>
            <View>
              <Text style={[styles.brandName, { color: palette.ink }]}>
                KOE
              </Text>
              <Text style={[styles.brandDetail, { color: palette.muted }]}>
                JAPANESE, SPOKEN
              </Text>
            </View>
          </View>
          <Text style={[styles.navNote, { color: palette.muted }]}>
            VOICE-FIRST JAPANESE
          </Text>
        </View>

        <View style={[styles.hero, wide && styles.heroWide]}>
          <View style={[styles.heroCopy, wide && styles.heroCopyWide]}>
            <Text style={[styles.kicker, { color: palette.proof }]}>
              CONVERSATION / 会話
            </Text>
            <Text
              style={[
                styles.heroTitle,
                wide && styles.heroTitleWide,
                { color: palette.ink },
              ]}
            >
              {PRODUCT_PAGE_THESIS}
            </Text>
            <Text style={[styles.heroDetail, { color: palette.muted }]}>
              Koe answers what you meant, shows one pitch or timing detail worth
              fixing, then returns you to the conversation.
            </Text>
            <View style={styles.heroActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  playing
                    ? "Pause the product story"
                    : "Play the thirteen second product story"
                }
                accessibilityState={{ selected: playing }}
                onPress={() => setPlaying((value) => !value)}
                style={[
                  styles.primaryAction,
                  { backgroundColor: palette.control },
                ]}
              >
                <Mic2 color={palette.controlText} size={18} />
                <Text
                  style={[
                    styles.primaryActionText,
                    { color: palette.controlText },
                  ]}
                >
                  {playing ? "Pause the loop" : "See the speaking loop"}
                </Text>
                <ArrowRight color={palette.controlText} size={18} />
              </Pressable>
            </View>
            <Text style={[styles.heroFootnote, { color: palette.muted }]}>
              No scenario picker. No score before the answer. Start with one
              line.
            </Text>
          </View>

          <View style={[styles.heroDemo, wide && styles.heroDemoWide]}>
            <MarketingStoryDemo
              frame={frame}
              palette={palette}
              animated={playing}
            />
          </View>
        </View>

        <View style={[styles.sequence, { borderColor: palette.hairline }]}>
          <Text style={[styles.sectionKicker, { color: palette.proof }]}>
            ONE CONVERSATION · FIVE BEATS
          </Text>
          <View style={[styles.sequenceRow, !wide && styles.sequenceColumn]}>
            {MARKETING_FRAMES.map((item) => {
              const selected = item.id === frame.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${item.headline}`}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setPlaying(false);
                    setFrameId(item.id);
                  }}
                  style={[
                    styles.sequenceItem,
                    !wide && styles.sequenceItemNarrow,
                    {
                      borderColor: selected ? palette.seam : palette.hairline,
                      backgroundColor: selected
                        ? palette.seamSoft
                        : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sequenceNumber,
                      { color: selected ? palette.proof : palette.muted },
                    ]}
                  >
                    0{item.order}
                  </Text>
                  <Text style={[styles.sequenceTitle, { color: palette.ink }]}>
                    {item.eyebrow.split(" / ")[0]}
                  </Text>
                  <Text
                    style={[styles.sequenceDetail, { color: palette.muted }]}
                  >
                    {item.headline}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.creator, wide && styles.creatorWide]}>
          <View style={[styles.creatorIntro, wide && styles.creatorIntroWide]}>
            <Text style={[styles.sectionKicker, { color: palette.proof }]}>
              BUILT WHILE LEARNING
            </Text>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>
              The launch is the work, in public.
            </Text>
            <Text style={[styles.sectionDetail, { color: palette.muted }]}>
              {CREATOR_LOOP.principle}
            </Text>
          </View>
          <View style={styles.creatorFormats}>
            {CREATOR_LOOP.recurringFormats.map((format) => (
              <View
                key={format.id}
                style={[styles.creatorRow, { borderColor: palette.hairline }]}
              >
                <Check color={palette.success} size={16} />
                <View style={styles.creatorRowCopy}>
                  <Text style={[styles.creatorSource, { color: palette.ink }]}>
                    {format.source}
                  </Text>
                  <Text
                    style={[styles.creatorArtifact, { color: palette.muted }]}
                  >
                    {format.artifact}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.consent, { borderColor: palette.proof }]}>
          <Text style={[styles.consentLabel, { color: palette.proof }]}>
            CONSENT IS A PRODUCT RULE
          </Text>
          <Text style={[styles.consentText, { color: palette.ink }]}>
            Public user conversations require{" "}
            {CREATOR_LOOP.consent.publicUserConversationRequires}. Without it:{" "}
            {CREATOR_LOOP.consent.withoutConsent}
          </Text>
        </View>

        <View style={[styles.footer, { borderColor: palette.hairline }]}>
          <Text style={[styles.footerMark, { color: palette.ink }]}>声</Text>
          <Text style={[styles.footerCopy, { color: palette.muted }]}>
            Speak. Hear. Tune. Continue.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: "center", paddingHorizontal: 20 },
  atmosphere: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  verticalRule: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "18%",
    width: StyleSheet.hairlineWidth,
    opacity: 0.7,
  },
  heroCircle: {
    position: "absolute",
    width: 720,
    height: 720,
    borderRadius: 360,
    borderWidth: 1,
    right: -370,
    top: 90,
    opacity: 0.7,
  },
  nav: {
    width: "100%",
    maxWidth: 1180,
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  wordmark: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 31,
    lineHeight: 38,
  },
  brandName: { fontSize: 12, fontWeight: "800", letterSpacing: 1.8 },
  brandDetail: {
    fontFamily: "SFMono-Medium",
    fontSize: 7,
    letterSpacing: 0.9,
    marginTop: 1,
  },
  navNote: { fontFamily: "SFMono-Medium", fontSize: 8, letterSpacing: 1.1 },
  hero: { width: "100%", maxWidth: 1180, paddingTop: 54, paddingBottom: 88 },
  heroWide: {
    minHeight: 720,
    flexDirection: "row",
    alignItems: "center",
    gap: 68,
  },
  heroCopy: { maxWidth: 620, paddingBottom: 42 },
  heroCopyWide: { width: "42%", paddingBottom: 0 },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.35,
    lineHeight: 13,
  },
  heroTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 46,
    lineHeight: 56,
    letterSpacing: -1.1,
    marginTop: 14,
  },
  heroTitleWide: { fontSize: 62, lineHeight: 72, letterSpacing: -1.65 },
  heroDetail: { maxWidth: 530, fontSize: 17, lineHeight: 27, marginTop: 22 },
  heroActions: { marginTop: 28, alignItems: "flex-start" },
  primaryAction: {
    minHeight: CONVERSATION_TARGET.studyAdvance,
    borderRadius: 4,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  primaryActionText: { fontSize: 14, fontWeight: "700" },
  heroFootnote: {
    fontFamily: "SFMono-Regular",
    fontSize: 9,
    lineHeight: 15,
    marginTop: 14,
  },
  heroDemo: { width: "100%", maxWidth: 640 },
  heroDemoWide: { flex: 1 },
  sequence: {
    width: "100%",
    maxWidth: 1180,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 62,
  },
  sectionKicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.3,
    lineHeight: 13,
  },
  sequenceRow: { flexDirection: "row", gap: 10, marginTop: 22 },
  sequenceColumn: { flexDirection: "column" },
  sequenceItem: {
    flex: 1,
    minHeight: 156,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    padding: 16,
  },
  sequenceItemNarrow: { width: "100%", minHeight: 116 },
  sequenceNumber: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 0.9,
  },
  sequenceTitle: { fontSize: 13, fontWeight: "800", marginTop: 20 },
  sequenceDetail: { fontSize: 11, lineHeight: 16, marginTop: 7 },
  creator: { width: "100%", maxWidth: 1180, paddingVertical: 80 },
  creatorWide: { flexDirection: "row", gap: 80 },
  creatorIntro: { maxWidth: 560, paddingBottom: 36 },
  creatorIntroWide: { width: "38%", paddingBottom: 0 },
  sectionTitle: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 38,
    lineHeight: 48,
    letterSpacing: -0.7,
    marginTop: 12,
  },
  sectionDetail: { fontSize: 15, lineHeight: 24, marginTop: 16 },
  creatorFormats: { flex: 1 },
  creatorRow: {
    minHeight: 82,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 13,
  },
  creatorRowCopy: { flex: 1 },
  creatorSource: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  creatorArtifact: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  consent: {
    width: "100%",
    maxWidth: 1180,
    borderLeftWidth: 3,
    paddingLeft: 18,
    paddingVertical: 22,
  },
  consentLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.15,
  },
  consentText: { maxWidth: 860, fontSize: 14, lineHeight: 22, marginTop: 8 },
  footer: {
    width: "100%",
    maxWidth: 1180,
    minHeight: 150,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerMark: { fontFamily: "Hiragino Mincho ProN", fontSize: 32 },
  footerCopy: { fontFamily: "SFMono-Medium", fontSize: 9, letterSpacing: 1.05 },
});
