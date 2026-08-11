import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Check, ChevronDown, ChevronUp, Info, X } from "lucide-react-native";

import {
  useSettings,
  type CorrectionStyle,
  type Goal,
  type Level,
} from "@/stores/useSettings";
import { levelToJlpt } from "@/voice/conversationPreferences";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import { CONVERSATION_TARGET } from "@/theme/interaction";
import { tap } from "@/utils/haptics";

type Choice<T extends string> = { value: T; label: string; detail: string };

const LEVELS: Array<Choice<Level>> = [
  {
    value: "beginner",
    label: "New to Japanese",
    detail: "Short, simple replies",
  },
  { value: "n5", label: "Around N5", detail: "Foundational Japanese" },
  { value: "n4", label: "Around N4", detail: "Everyday conversation" },
  { value: "n3", label: "Around N3", detail: "More natural range" },
  { value: "n2plus", label: "N2 or beyond", detail: "Full-speed vocabulary" },
];

const CORRECTIONS: Array<Choice<CorrectionStyle>> = [
  {
    value: "essential",
    label: "Only when it matters",
    detail: "Keep conversation moving; flag meaning-changing issues",
  },
  {
    value: "balanced",
    label: "One useful note",
    detail: "Surface a compact improvement when it helps",
  },
  {
    value: "detailed",
    label: "Detailed coaching",
    detail: "Show more grammar and naturalness feedback",
  },
];

const VOICES: Array<Choice<"ja-female-1" | "ja-female-2" | "ja-male-1">> = [
  { value: "ja-female-1", label: "Asuka", detail: "Clear and direct" },
  { value: "ja-female-2", label: "Ashley", detail: "Warm and measured" },
  { value: "ja-male-1", label: "Satoshi", detail: "Grounded and calm" },
];

const GOALS: Array<Choice<Goal>> = [
  {
    value: "just-because",
    label: "No fixed goal",
    detail: "Follow the conversation",
  },
  { value: "travel", label: "Travel", detail: "Everyday situations in Japan" },
  {
    value: "anime",
    label: "Media & stories",
    detail: "Talk about what you watch and read",
  },
  {
    value: "work",
    label: "Work",
    detail: "Professional life and communication",
  },
  { value: "jlpt", label: "JLPT", detail: "Keep exam vocabulary within reach" },
];

export default function PreferencesScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const settings = useSettings();
  const [showMore, setShowMore] = useState(false);

  const chooseLevel = (level: Level) => {
    tap();
    settings.set("selfLevel", level);
    settings.set("jlptTarget", levelToJlpt(level));
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <View style={[styles.header, { borderColor: palette.hairline }]}>
        <View style={styles.headerCopy}>
          <Text style={[styles.kicker, { color: palette.proof }]}>
            OPTIONAL / 任意
          </Text>
          <Text style={[styles.headerTitle, { color: palette.ink }]}>
            Shape the conversation
          </Text>
        </View>
        <Pressable
          testID="close-preferences"
          accessibilityRole="button"
          accessibilityLabel="Close conversation settings"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.closeButton,
            {
              borderColor: palette.hairline,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <X color={palette.ink} size={19} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: palette.muted }]}>
          Nothing here is required. Koe begins neutral and uses these choices
          only to make replies and feedback more comfortable.
        </Text>

        <PreferenceSection
          eyebrow="RESPONSE LEVEL"
          title="How much Japanese feels comfortable?"
          choices={LEVELS}
          selected={settings.selfLevel}
          onSelect={chooseLevel}
          palette={palette}
        />

        <PreferenceSection
          eyebrow="COACHING DETAIL"
          title="When should Koe interrupt the flow?"
          choices={CORRECTIONS}
          selected={settings.correctionStyle}
          onSelect={(value) => {
            tap();
            settings.set("correctionStyle", value);
          }}
          palette={palette}
        />

        <PreferenceSection
          eyebrow="TUTOR VOICE"
          title="Choose the voice you hear back."
          choices={VOICES}
          selected={settings.voice}
          onSelect={(value) => {
            tap();
            settings.set("voice", value);
          }}
          palette={palette}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            showMore ? "Hide more preferences" : "Show more preferences"
          }
          accessibilityState={{ expanded: showMore }}
          onPress={() => {
            tap();
            setShowMore((value) => !value);
          }}
          style={({ pressed }) => [
            styles.moreButton,
            {
              borderColor: palette.hairline,
              backgroundColor: pressed ? palette.seamSoft : "transparent",
            },
          ]}
        >
          <View>
            <Text style={[styles.moreTitle, { color: palette.ink }]}>
              More personalization
            </Text>
            <Text style={[styles.moreDetail, { color: palette.muted }]}>
              Goal and conversation context
            </Text>
          </View>
          {showMore ? (
            <ChevronUp color={palette.ink} size={18} />
          ) : (
            <ChevronDown color={palette.ink} size={18} />
          )}
        </Pressable>

        {showMore ? (
          <PreferenceSection
            eyebrow="CURRENT FOCUS"
            title="What should feel close at hand?"
            choices={GOALS}
            selected={settings.goal}
            onSelect={(value) => {
              tap();
              settings.set("goal", value);
            }}
            palette={palette}
          />
        ) : null}

        <View
          accessibilityRole="summary"
          style={[
            styles.conversationNote,
            {
              borderColor: palette.hairline,
              backgroundColor: palette.seamSoft,
            },
          ]}
        >
          <Info color={palette.seam} size={19} />
          <View style={styles.conversationNoteCopy}>
            <Text style={[styles.noteTitle, { color: palette.ink }]}>
              Personas and scenarios stay conversational
            </Text>
            <Text style={[styles.noteDetail, { color: palette.muted }]}>
              Ask Koe to role-play a shop clerk, practice hotel check-in, or
              switch formality while you are talking. There is no catalog to
              configure first.
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save conversation settings"
          onPress={() => {
            tap();
            router.back();
          }}
          style={({ pressed }) => [
            styles.doneButton,
            { backgroundColor: palette.control, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={[styles.doneText, { color: palette.controlText }]}>
            Done
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function PreferenceSection<T extends string>({
  eyebrow,
  title,
  choices,
  selected,
  onSelect,
  palette,
}: {
  eyebrow: string;
  title: string;
  choices: Array<Choice<T>>;
  selected: T;
  onSelect: (value: T) => void;
  palette: ConversationPalette;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionEyebrow, { color: palette.seam }]}>
        {eyebrow}
      </Text>
      <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
      <View style={styles.choiceStack}>
        {choices.map((choice) => {
          const isSelected = selected === choice.value;
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityLabel={`${choice.label}. ${choice.detail}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(choice.value)}
              style={({ pressed }) => [
                styles.choice,
                {
                  borderColor: isSelected ? palette.seam : palette.hairline,
                  backgroundColor: isSelected
                    ? palette.seamSoft
                    : pressed
                      ? palette.seamSoft
                      : "transparent",
                },
              ]}
            >
              <View style={styles.choiceCopy}>
                <Text style={[styles.choiceLabel, { color: palette.ink }]}>
                  {choice.label}
                </Text>
                <Text style={[styles.choiceDetail, { color: palette.muted }]}>
                  {choice.detail}
                </Text>
              </View>
              <View
                style={[
                  styles.selection,
                  {
                    borderColor: isSelected ? palette.seam : palette.hairline,
                    backgroundColor: isSelected ? palette.seam : "transparent",
                  },
                ]}
              >
                {isSelected ? <Check color={palette.canvas} size={14} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 78,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1, paddingRight: 16 },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.3,
    lineHeight: 12,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "700",
    marginTop: 3,
  },
  closeButton: {
    width: CONVERSATION_TARGET.roundIcon,
    height: CONVERSATION_TARGET.roundIcon,
    borderRadius: CONVERSATION_TARGET.roundIcon / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 32,
  },
  intro: { fontSize: 13, lineHeight: 20, maxWidth: 500 },
  section: { marginTop: 30 },
  sectionEyebrow: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.25,
    lineHeight: 12,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    marginTop: 5,
  },
  choiceStack: { gap: 8, marginTop: 12 },
  choice: {
    minHeight: 62,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  choiceCopy: { flex: 1, paddingRight: 12 },
  choiceLabel: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  choiceDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  selection: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  moreButton: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    paddingHorizontal: 14,
    marginTop: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moreTitle: { fontSize: 14, fontWeight: "700", lineHeight: 19 },
  moreDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  conversationNote: {
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    padding: 14,
    marginTop: 30,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  conversationNoteCopy: { flex: 1, marginLeft: 12 },
  noteTitle: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  noteDetail: { fontSize: 11, lineHeight: 17, marginTop: 4 },
  doneButton: {
    minHeight: CONVERSATION_TARGET.codaAction,
    borderRadius: 5,
    marginTop: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { fontSize: 14, fontWeight: "700" },
});
