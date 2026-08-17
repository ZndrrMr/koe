import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { koeIllustrations } from "@/art/koeIllustrations";
import { WholeAffordancePressable } from "@/components/WholeAffordancePressable";
import { CONTROL_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/interaction";

type ThemeName = "light" | "dark";
type ScreenName =
  | "microphoneEducation"
  | "home"
  | "conversation"
  | "recovery"
  | "ending"
  | "coda";

type ProofPalette = {
  canvas: string;
  raised: string;
  ink: string;
  muted: string;
  blue: string;
  hairline: string;
  control: string;
  controlText: string;
  ochre: string;
  error: string;
};

const SCREEN_WIDTH = 390;
const SCREEN_HEIGHT = 844;

const palettes: Record<ThemeName, ProofPalette> = {
  light: {
    canvas: "#F4EFE4",
    raised: "#FBF8F0",
    ink: "#191D20",
    muted: "#5C5B55",
    blue: "#2F5F8F",
    hairline: "#B7AB96",
    control: "#1D4A6D",
    controlText: "#FBF8F0",
    ochre: "#D7AD4B",
    error: "#8E3F34",
  },
  dark: {
    canvas: "#111B25",
    raised: "#182733",
    ink: "#F1EBDD",
    muted: "#AEB7BA",
    blue: "#A9C6D5",
    hairline: "#51606B",
    control: "#A9C6D5",
    controlText: "#111B25",
    ochre: "#D8B75C",
    error: "#E1A49D",
  },
};

const screens: ScreenName[] = [
  "microphoneEducation",
  "home",
  "conversation",
  "recovery",
  "ending",
  "coda",
];

export default function ArtFamilyProofScreen() {
  const pages = (["light", "dark"] as const).flatMap((theme) =>
    screens.map((screen) => ({ screen, theme })),
  );

  return (
    <View style={styles.reviewStage}>
      <StatusBar hidden />
      <ScrollView
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        testID="art-family-pager"
      >
        {pages.map(({ screen, theme }) => (
          <ProofPage key={`${theme}-${screen}`} screen={screen} theme={theme} />
        ))}
      </ScrollView>
    </View>
  );
}

function ProofPage({
  screen,
  theme,
}: {
  screen: ScreenName;
  theme: ThemeName;
}) {
  const palette = palettes[theme];

  return (
    <View style={[styles.page, { backgroundColor: palette.canvas }]}>
      <ProofHeader palette={palette} />
      {screen === "microphoneEducation" ? (
        <MicrophoneEducation palette={palette} theme={theme} />
      ) : null}
      {screen === "home" ? <Home palette={palette} theme={theme} /> : null}
      {screen === "conversation" ? <Conversation palette={palette} /> : null}
      {screen === "recovery" ? (
        <Recovery palette={palette} theme={theme} />
      ) : null}
      {screen === "ending" ? <Ending palette={palette} theme={theme} /> : null}
      {screen === "coda" ? <Coda palette={palette} theme={theme} /> : null}
    </View>
  );
}

function ProofHeader({ palette }: { palette: ProofPalette }) {
  return (
    <View style={styles.header}>
      <View style={styles.lockup}>
        <Text style={[styles.kanji, { color: palette.ink }]}>声</Text>
        <Text style={[styles.wordmark, { color: palette.muted }]}>KOE</Text>
      </View>
    </View>
  );
}

function MicrophoneEducation({
  palette,
  theme,
}: {
  palette: ProofPalette;
  theme: ThemeName;
}) {
  return (
    <View style={styles.standardBody}>
      <Image
        source={koeIllustrations.microphoneEducation[theme]}
        style={styles.microphoneArt}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="Two engraved voice contours turn toward one another."
        accessibilityIgnoresInvertColors
      />
      <Text style={[styles.eyebrow, { color: palette.blue }]}>FIRST VOICE</Text>
      <Text style={[styles.displayLarge, { color: palette.ink }]}>
        Let Koe hear your voice.
      </Text>
      <Text style={[styles.jpBody, { color: palette.ink }]}>
        声を聞かせてください。
      </Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        Microphone access keeps one open conversation moving. Your words remain
        live text—not part of the artwork.
      </Text>
      <PrimaryAction palette={palette} label="Continue" />
    </View>
  );
}

function Home({ palette, theme }: { palette: ProofPalette; theme: ThemeName }) {
  return (
    <View style={styles.standardBody}>
      <Image
        source={koeIllustrations.homeStart[theme]}
        style={styles.homeArt}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="Two engraved voice contours exchange a single thread."
        accessibilityIgnoresInvertColors
      />
      <Text style={[styles.displayLarge, { color: palette.ink }]}>
        Speak, and let the conversation follow.
      </Text>
      <View style={[styles.ochreRule, { backgroundColor: palette.ochre }]} />
      <Text style={[styles.jpBody, { color: palette.ink }]}>
        声を出す。会話になる。
      </Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        Japanese or English. Koe listens, answers aloud, and keeps the exchange
        open.
      </Text>
      <PrimaryAction palette={palette} label="Start speaking" />
    </View>
  );
}

function Conversation({ palette }: { palette: ProofPalette }) {
  return (
    <View style={styles.conversationBody}>
      <View style={styles.stateStage}>
        <ListeningPlate color={palette.blue} />
      </View>
      <Text style={[styles.eyebrow, { color: palette.blue }]}>
        LISTENING / 聞いています
      </Text>
      <Text style={[styles.jpDisplay, { color: palette.ink }]}>
        どうぞ、続けて。
      </Text>
      <Text style={[styles.bodyCentered, { color: palette.muted }]}>
        Koe is listening. Pause naturally when you are finished.
      </Text>
      <View style={[styles.utterance, { borderColor: palette.hairline }]}>
        <Text style={[styles.utteranceText, { color: palette.ink }]}>
          「週末は友達と京都へ行きます。」
        </Text>
      </View>
      <PrimaryAction palette={palette} label="Listening · tap to pause" />
    </View>
  );
}

function ListeningPlate({ color }: { color: string }) {
  return (
    <Svg
      width={204}
      height={204}
      viewBox="0 0 204 204"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Listening"
    >
      <Circle
        cx="102"
        cy="102"
        r="82"
        fill="none"
        stroke={color}
        opacity={0.24}
      />
      <Circle
        cx="102"
        cy="102"
        r="58"
        fill="none"
        stroke={color}
        opacity={0.48}
      />
      <Path
        d="M74 128c14-48 42-48 56 0M80 105c12-34 32-34 44 0M91 82c7-17 15-17 22 0"
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
      <Line x1="102" y1="20" x2="102" y2="44" stroke={color} opacity={0.55} />
      <Line x1="102" y1="160" x2="102" y2="184" stroke={color} opacity={0.55} />
      <Line x1="20" y1="102" x2="44" y2="102" stroke={color} opacity={0.55} />
      <Line x1="160" y1="102" x2="184" y2="102" stroke={color} opacity={0.55} />
    </Svg>
  );
}

function Recovery({
  palette,
  theme,
}: {
  palette: ProofPalette;
  theme: ThemeName;
}) {
  return (
    <View style={styles.recoveryBody}>
      <Image
        source={koeIllustrations.recovery[theme]}
        style={styles.recoveryArt}
        resizeMode="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        accessibilityIgnoresInvertColors
      />
      <Text style={[styles.eyebrow, { color: palette.error }]}>
        CONNECTION PAUSED
      </Text>
      <Text style={[styles.displayMedium, { color: palette.ink }]}>
        Koe lost that part of the exchange.
      </Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        Your last spoken turn did not reach Koe. Nothing was added to the
        conversation.
      </Text>
      <PrimaryAction palette={palette} label="Try again" />
      <SecondaryAction palette={palette} label="End conversation" />
    </View>
  );
}

function Ending({
  palette,
  theme,
}: {
  palette: ProofPalette;
  theme: ThemeName;
}) {
  return (
    <View style={styles.endingBody}>
      <Image
        source={koeIllustrations.homeStart[theme]}
        style={styles.endingArt}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="Two engraved voice contours exchange a single thread."
        accessibilityIgnoresInvertColors
      />
      <Text style={[styles.eyebrow, { color: palette.blue }]}>
        ENDING / 終わりますか
      </Text>
      <Text style={[styles.displayLarge, { color: palette.ink }]}>
        Leave the conversation here?
      </Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        Koe will keep the moments you saved. You can continue speaking instead.
      </Text>
      <PrimaryAction palette={palette} label="Keep talking" />
      <SecondaryAction palette={palette} label="Finish session" />
    </View>
  );
}

function Coda({ palette, theme }: { palette: ProofPalette; theme: ThemeName }) {
  return (
    <View style={styles.codaBody}>
      <Image
        source={koeIllustrations.coda[theme]}
        style={styles.codaArt}
        resizeMode="cover"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        accessibilityIgnoresInvertColors
      />
      <Text style={[styles.eyebrow, { color: palette.blue }]}>
        TODAY’S THREAD
      </Text>
      <Text style={[styles.displayMedium, { color: palette.ink }]}>
        Three moments worth keeping.
      </Text>
      <View style={[styles.savedMoments, { borderColor: palette.hairline }]}>
        <Text style={[styles.savedMoment, { color: palette.ink }]}>
          週末は友達と京都へ行きます。
        </Text>
        <Text style={[styles.savedMoment, { color: palette.ink }]}>
          「に」と「で」の使い分け
        </Text>
        <Text style={[styles.savedMoment, { color: palette.ink }]}>
          もう少しゆっくり話す
        </Text>
      </View>
      <PrimaryAction palette={palette} label="Return home" />
    </View>
  );
}

function PrimaryAction({
  label,
  palette,
}: {
  label: string;
  palette: ProofPalette;
}) {
  return (
    <WholeAffordancePressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Shows this proof action in the art-family preview"
      onPress={() => undefined}
      style={[styles.primaryAction, { borderColor: palette.control }]}
    >
      <Text
        maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.actionText, { color: palette.ink }]}
      >
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.actionArrow, { color: palette.blue }]}
      >
        →
      </Text>
    </WholeAffordancePressable>
  );
}

function SecondaryAction({
  label,
  palette,
}: {
  label: string;
  palette: ProofPalette;
}) {
  return (
    <WholeAffordancePressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Shows this secondary action in the art-family preview"
      onPress={() => undefined}
      style={[styles.secondaryAction, { borderColor: palette.hairline }]}
    >
      <Text
        maxFontSizeMultiplier={CONTROL_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.secondaryActionText, { color: palette.ink }]}
      >
        {label}
      </Text>
    </WholeAffordancePressable>
  );
}

const styles = StyleSheet.create({
  reviewStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#080A0C",
  },
  pager: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, flexGrow: 0 },
  page: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, paddingHorizontal: 24 },
  header: { height: 80, justifyContent: "center" },
  lockup: { alignItems: "center", flexDirection: "row", gap: 7 },
  kanji: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 29,
    lineHeight: 34,
  },
  wordmark: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.8,
  },
  standardBody: { flex: 1 },
  microphoneArt: { width: 310, height: 240, alignSelf: "center" },
  homeArt: { width: 310, height: 248, alignSelf: "center", marginTop: 8 },
  eyebrow: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.4,
    textAlign: "center",
  },
  displayLarge: {
    fontFamily: "Iowan Old Style",
    fontSize: 36,
    lineHeight: 40,
    marginTop: 10,
  },
  displayMedium: {
    fontFamily: "Iowan Old Style",
    fontSize: 30,
    lineHeight: 35,
    marginTop: 12,
  },
  jpDisplay: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 34,
    lineHeight: 44,
    marginTop: 12,
    textAlign: "center",
  },
  jpBody: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 8,
  },
  body: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  bodyCentered: {
    fontFamily: "Avenir Next",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: "center",
  },
  ochreRule: { width: 92, height: 7, marginTop: 8 },
  primaryAction: {
    minHeight: 64,
    marginTop: "auto",
    marginBottom: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  actionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 17,
    lineHeight: 22,
  },
  actionArrow: { fontSize: 24, lineHeight: 28 },
  secondaryAction: {
    minHeight: 52,
    marginTop: 10,
    marginBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    fontFamily: "AvenirNext-DemiBold",
    fontSize: 16,
    lineHeight: 22,
  },
  conversationBody: { flex: 1, alignItems: "stretch" },
  stateStage: {
    width: 300,
    height: 300,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  utterance: {
    marginTop: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
  },
  utteranceText: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 20,
    lineHeight: 29,
  },
  recoveryBody: { flex: 1 },
  recoveryArt: {
    width: 144,
    height: 144,
    alignSelf: "center",
    marginTop: 76,
    marginBottom: 20,
  },
  endingBody: { flex: 1 },
  endingArt: {
    width: 120,
    height: 96,
    alignSelf: "center",
    marginTop: 94,
    marginBottom: 28,
  },
  codaBody: { flex: 1 },
  codaArt: {
    width: 280,
    height: 180,
    alignSelf: "center",
    marginTop: 16,
    marginBottom: 18,
  },
  savedMoments: { marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth },
  savedMoment: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
