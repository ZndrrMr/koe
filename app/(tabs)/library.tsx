import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowRight,
  Bookmark,
  Check,
  Clock3,
  PenLine,
  Play,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react-native";

import {
  AUDIO_RETENTION_OPTIONS,
  deleteSession,
  getAudioRetentionDays,
  listRecentSessions,
  listSavedMoments,
  purgeExpiredAudio,
  setAudioRetentionDays,
  setLearningMomentDecision,
  type AudioRetentionDays,
  type SavedLearningMoment,
  type SessionSummary,
} from "@/db";
import type { Word } from "@/db/schema";
import { getScenario } from "@/data/scenarios";
import { searchWord, listAllWords } from "@/services/dict";
import { play } from "@/services/tts";
import {
  WordDetailSheet,
  type WordDetailSheetHandle,
} from "@/components/WordDetailSheet";
import {
  type ConversationPalette,
  useConversationPalette,
} from "@/theme/conversation";
import { practiceTargetsForText } from "@/handwriting/practice";

export default function LibraryScreen() {
  const router = useRouter();
  const palette = useConversationPalette();
  const [query, setQuery] = useState("");
  const [words, setWords] = useState<Word[]>([]);
  const [moments, setMoments] = useState<SavedLearningMoment[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [retentionDays, setRetentionDaysState] =
    useState<AudioRetentionDays>(30);
  const [showRetention, setShowRetention] = useState(false);
  const sheet = useRef<WordDetailSheetHandle>(null);

  const refreshHistory = useCallback(async () => {
    const [saved, recent, retention] = await Promise.all([
      listSavedMoments(),
      listRecentSessions(),
      getAudioRetentionDays(),
    ]);
    setMoments(saved);
    setSessions(recent);
    setRetentionDaysState(retention);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshHistory();
    }, [refreshHistory]),
  );

  useEffect(() => {
    let current = true;
    const timeout = setTimeout(() => {
      const request = query.trim()
        ? searchWord(query.trim())
        : listAllWords(40);
      void request.then((results) => {
        if (current) setWords(results);
      });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [query]);

  const removeMoment = (moment: SavedLearningMoment) => {
    Alert.alert(
      "Discard this moment?",
      "It will leave your Library. The rest of its session stays intact.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard moment",
          style: "destructive",
          onPress: () => {
            void setLearningMomentDecision(
              moment.sessionId,
              moment.id,
              "discarded",
            ).then(refreshHistory);
          },
        },
      ],
    );
  };

  const removeSession = (session: SessionSummary) => {
    Alert.alert(
      "Delete this session?",
      "This permanently removes its recordings, transcript, translations, feedback, saved moments, and pronunciation retries.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete session",
          style: "destructive",
          onPress: () => void deleteSession(session.id).then(refreshHistory),
        },
      ],
    );
  };

  const chooseRetention = async (days: AudioRetentionDays) => {
    await setAudioRetentionDays(days);
    setRetentionDaysState(days);
    setShowRetention(false);
    await refreshHistory();
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.kicker, { color: palette.seam }]}>
            LIBRARY / 声の余韻
          </Text>
          <Text style={[styles.title, { color: palette.ink }]}>残した声</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>
            Expressions, corrections, and retries you chose to carry forward.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Voice recording retention: ${retentionLabel(retentionDays)}`}
          accessibilityHint="Opens recording retention choices"
          onPress={() => setShowRetention(true)}
          style={[
            styles.retentionButton,
            {
              borderColor: palette.hairline,
              backgroundColor: palette.seamSoft,
            },
          ]}
        >
          <View style={styles.retentionRow}>
            <ShieldCheck color={palette.seam} size={19} />
            <View style={styles.retentionCopy}>
              <Text style={[styles.retentionTitle, { color: palette.ink }]}>
                Recordings: {retentionLabel(retentionDays)}
              </Text>
              <Text style={[styles.retentionDetail, { color: palette.muted }]}>
                Transcripts stay until you delete their session.
              </Text>
            </View>
            <ArrowRight color={palette.seam} size={18} />
          </View>
        </Pressable>

        <SectionHeading
          eyebrow="KEPT FROM CONVERSATIONS"
          title="Learning moments"
          count={moments.length}
          palette={palette}
        />
        {moments.length ? (
          <View style={styles.momentStack}>
            {moments.map((moment) => (
              <SavedMomentCard
                key={moment.id}
                moment={moment}
                palette={palette}
                onWrite={
                  practiceTargetsForText(moment.textJa).length
                    ? () =>
                        router.push({
                          pathname: "/handwriting-practice",
                          params: { momentId: moment.id },
                        })
                    : undefined
                }
                onPlay={
                  moment.audioUri
                    ? () => void play(moment.audioUri!)
                    : undefined
                }
                onRemove={() => removeMoment(moment)}
              />
            ))}
          </View>
        ) : (
          <View style={[styles.emptyMoment, { borderColor: palette.hairline }]}>
            <Bookmark color={palette.proof} size={22} />
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>
              Nothing kept yet
            </Text>
            <Text style={[styles.emptyDetail, { color: palette.muted }]}>
              At the end of a conversation, keep the few expressions,
              corrections, or retries you want to meet again.
            </Text>
          </View>
        )}

        <SectionHeading
          eyebrow="SESSION MEMORY"
          title="Recent practice"
          count={sessions.length}
          palette={palette}
        />
        <View style={styles.sessionStack}>
          {sessions.map((session) => {
            const scenario = getScenario(session.scenarioId);
            return (
              <View
                key={session.id}
                style={[styles.sessionRow, { borderColor: palette.hairline }]}
              >
                <View style={styles.sessionDate}>
                  <Text style={[styles.sessionDay, { color: palette.ink }]}>
                    {new Date(session.startedAt).getDate()}
                  </Text>
                  <Text style={[styles.sessionMonth, { color: palette.muted }]}>
                    {new Date(session.startedAt)
                      .toLocaleDateString(undefined, { month: "short" })
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={styles.sessionCopy}>
                  <Text style={[styles.sessionTitle, { color: palette.ink }]}>
                    {scenario?.title ?? "Open conversation"}
                  </Text>
                  <Text style={[styles.sessionMeta, { color: palette.muted }]}>
                    {session.turnCount} turns · {session.savedMomentCount} kept
                    {session.status === "active" ? " · interrupted" : ""}
                  </Text>
                </View>
                {session.status === "active" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Resume conversation"
                    onPress={() =>
                      router.push({
                        pathname: "/session/[id]",
                        params:
                          session.scenarioId === "open"
                            ? { id: session.id }
                            : {
                                id: session.id,
                                scenario: session.scenarioId,
                              },
                      })
                    }
                    style={[
                      styles.sessionAction,
                      { borderColor: palette.hairline },
                    ]}
                  >
                    <Clock3 color={palette.seam} size={18} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${scenario?.title ?? "open conversation"} session`}
                  onPress={() => removeSession(session)}
                  style={[
                    styles.sessionAction,
                    { borderColor: palette.hairline },
                  ]}
                >
                  <Trash2 color={palette.muted} size={17} />
                </Pressable>
              </View>
            );
          })}
          {!sessions.length ? (
            <Text style={[styles.noSessions, { color: palette.muted }]}>
              Completed and interrupted sessions will appear here.
            </Text>
          ) : null}
        </View>

        <SectionHeading
          eyebrow="REFERENCE"
          title="Dictionary"
          palette={palette}
        />
        <View
          style={[
            styles.searchBox,
            {
              borderColor: palette.hairline,
              backgroundColor: palette.canvas,
            },
          ]}
        >
          <Search color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="Search dictionary"
            value={query}
            onChangeText={setQuery}
            placeholder="Word, meaning, or reading"
            placeholderTextColor={palette.muted}
            selectionColor={palette.proof}
            style={[styles.searchInput, { color: palette.ink }]}
          />
        </View>
        <View style={styles.wordList}>
          {words.map((word) => (
            <Pressable
              key={word.id}
              accessibilityRole="button"
              accessibilityLabel={`${word.kanji ?? word.kana}, ${word.gloss.split("|")[0]}`}
              onPress={() => sheet.current?.open(word)}
              style={({ pressed }) => [
                styles.wordRow,
                {
                  borderColor: palette.hairline,
                  opacity: pressed ? 0.62 : 1,
                },
              ]}
            >
              <Text style={[styles.wordJa, { color: palette.ink }]}>
                {word.kanji ?? word.kana}
              </Text>
              <Text style={[styles.wordMeta, { color: palette.muted }]}>
                {word.kana} · {word.gloss.split("|")[0]}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <RetentionModal
        visible={showRetention}
        selected={retentionDays}
        palette={palette}
        onSelect={(days) => void chooseRetention(days)}
        onPurge={() => {
          void purgeExpiredAudio().then(() => {
            setShowRetention(false);
            return refreshHistory();
          });
        }}
        onClose={() => setShowRetention(false)}
      />
      <WordDetailSheet ref={sheet} />
    </SafeAreaView>
  );
}

function SectionHeading({
  eyebrow,
  title,
  count,
  palette,
}: {
  eyebrow: string;
  title: string;
  count?: number;
  palette: ConversationPalette;
}) {
  return (
    <View style={styles.sectionHeading}>
      <View>
        <Text style={[styles.sectionEyebrow, { color: palette.seam }]}>
          {eyebrow}
        </Text>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>
          {title}
        </Text>
      </View>
      {count !== undefined ? (
        <Text style={[styles.sectionCount, { color: palette.muted }]}>
          {String(count).padStart(2, "0")}
        </Text>
      ) : null}
    </View>
  );
}

function SavedMomentCard({
  moment,
  palette,
  onPlay,
  onWrite,
  onRemove,
}: {
  moment: SavedLearningMoment;
  palette: ConversationPalette;
  onPlay?: () => void;
  onWrite?: () => void;
  onRemove: () => void;
}) {
  const bars = voiceprint(moment.textJa);
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.momentCard,
        { borderColor: palette.hairline, backgroundColor: palette.canvas },
      ]}
    >
      <View style={styles.voiceprint} accessibilityElementsHidden>
        {bars.map((height, index) => (
          <View
            key={`${height}-${index}`}
            style={[
              styles.voiceprintBar,
              {
                height,
                backgroundColor:
                  moment.kind === "retry" ? palette.success : palette.proof,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.savedMomentCopy}>
        <Text style={[styles.momentLabel, { color: palette.seam }]}>
          {libraryKindLabel(moment.kind)} ·{" "}
          {formatShortDate(moment.sessionStartedAt)}
        </Text>
        <Text style={[styles.savedMomentJa, { color: palette.ink }]}>
          {moment.textJa}
        </Text>
        {moment.textEn ? (
          <Text style={[styles.savedMomentEn, { color: palette.muted }]}>
            {moment.textEn}
          </Text>
        ) : null}
        {moment.note ? (
          <Text style={[styles.savedMomentNote, { color: palette.muted }]}>
            {moment.note}
          </Text>
        ) : null}
      </View>
      <View style={styles.savedMomentActions}>
        {onWrite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Write ${moment.textJa}`}
            accessibilityHint="Starts character recall from this saved expression"
            onPress={onWrite}
            style={[styles.roundAction, { borderColor: palette.hairline }]}
          >
            <PenLine color={palette.proof} size={17} />
          </Pressable>
        ) : null}
        {onPlay ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Play ${moment.textJa}`}
            onPress={onPlay}
            style={[styles.roundAction, { borderColor: palette.hairline }]}
          >
            <Play color={palette.ink} size={17} fill={palette.ink} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${moment.textJa} from Library`}
          onPress={onRemove}
          style={[styles.roundAction, { borderColor: palette.hairline }]}
        >
          <X color={palette.muted} size={17} />
        </Pressable>
      </View>
    </View>
  );
}

function RetentionModal({
  visible,
  selected,
  palette,
  onSelect,
  onPurge,
  onClose,
}: {
  visible: boolean;
  selected: AudioRetentionDays;
  palette: ConversationPalette;
  onSelect: (days: AudioRetentionDays) => void;
  onPurge: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: palette.canvas }]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleCopy}>
              <Text style={[styles.modalKicker, { color: palette.seam }]}>
                VOICE PRIVACY
              </Text>
              <Text style={[styles.modalTitle, { color: palette.ink }]}>
                Keep recordings for
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close voice retention"
              onPress={onClose}
              style={[styles.roundAction, { borderColor: palette.hairline }]}
            >
              <X color={palette.ink} size={18} />
            </Pressable>
          </View>
          <Text style={[styles.modalDetail, { color: palette.muted }]}>
            Audio expires automatically. Transcripts, feedback, and saved
            moments remain until you delete their session.
          </Text>
          <View style={styles.retentionOptions}>
            {AUDIO_RETENTION_OPTIONS.map((days) => (
              <Pressable
                key={days}
                accessibilityRole="button"
                accessibilityLabel={`Keep recordings ${retentionLabel(days)}`}
                accessibilityState={{ selected: selected === days }}
                onPress={() => onSelect(days)}
                style={[
                  styles.retentionOption,
                  {
                    borderColor:
                      selected === days ? palette.seam : palette.hairline,
                    backgroundColor:
                      selected === days ? palette.seamSoft : "transparent",
                  },
                ]}
              >
                <Text style={[styles.optionText, { color: palette.ink }]}>
                  {retentionLabel(days)}
                </Text>
                {selected === days ? (
                  <Check color={palette.seam} size={18} />
                ) : null}
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete expired recordings now"
            onPress={onPurge}
            style={[styles.purgeButton, { borderColor: palette.hairline }]}
          >
            <Trash2 color={palette.muted} size={17} />
            <Text style={[styles.purgeText, { color: palette.muted }]}>
              Delete expired recordings now
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function retentionLabel(days: AudioRetentionDays) {
  return days === 0 ? "until I delete them" : `${days} days`;
}

function formatShortDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function libraryKindLabel(kind: SavedLearningMoment["kind"]) {
  if (kind === "correction") return "CORRECTION";
  if (kind === "retry") return "STRONGEST RETRY";
  return "EXPRESSION";
}

function voiceprint(text: string): number[] {
  const source = text || "声";
  return Array.from({ length: 9 }, (_, index) => {
    const code = source.charCodeAt(index % source.length);
    return 10 + (code % 24);
  });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 52 },
  header: { paddingTop: 18, paddingBottom: 22 },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.45,
    lineHeight: 13,
  },
  title: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 36,
    fontWeight: "600",
    lineHeight: 48,
    marginTop: 7,
  },
  subtitle: { fontSize: 13, lineHeight: 19, maxWidth: 360, marginTop: 3 },
  retentionButton: {
    width: "100%",
    alignSelf: "stretch",
    minHeight: 74,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
  },
  retentionRow: {
    width: "100%",
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12,
  },
  retentionCopy: { flex: 1 },
  retentionTitle: { fontSize: 13, fontWeight: "700" },
  retentionDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  sectionHeading: {
    minHeight: 88,
    paddingTop: 30,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sectionEyebrow: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.2,
    lineHeight: 12,
  },
  sectionTitle: { fontSize: 20, fontWeight: "700", marginTop: 3 },
  sectionCount: { fontFamily: "SFMono-Medium", fontSize: 11 },
  momentStack: { gap: 12 },
  momentCard: {
    minHeight: 146,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  voiceprint: {
    width: 24,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    overflow: "hidden",
  },
  voiceprintBar: { width: 1.5, borderRadius: 1 },
  savedMomentCopy: { flex: 1 },
  momentLabel: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1,
    lineHeight: 12,
  },
  savedMomentJa: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 20,
    lineHeight: 29,
    marginTop: 5,
  },
  savedMomentEn: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  savedMomentNote: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  savedMomentActions: { gap: 8 },
  roundAction: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyMoment: {
    minHeight: 172,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 10 },
  emptyDetail: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 300,
    marginTop: 5,
  },
  sessionStack: { borderTopWidth: StyleSheet.hairlineWidth },
  sessionRow: {
    minHeight: 78,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sessionDate: { width: 38, alignItems: "center" },
  sessionDay: { fontFamily: "SFMono-Medium", fontSize: 18, lineHeight: 22 },
  sessionMonth: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1,
    lineHeight: 11,
  },
  sessionCopy: { flex: 1 },
  sessionTitle: { fontSize: 14, fontWeight: "700" },
  sessionMeta: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  sessionAction: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  noSessions: { fontSize: 12, lineHeight: 18, paddingVertical: 18 },
  searchBox: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, minHeight: 48, fontSize: 14 },
  wordList: { marginTop: 8 },
  wordRow: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  wordJa: { fontFamily: "Hiragino Sans", fontSize: 17, lineHeight: 24 },
  wordMeta: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "flex-end",
    padding: 12,
  },
  modalCard: { borderRadius: 18, padding: 20, paddingBottom: 26 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  modalTitleCopy: { flex: 1, paddingRight: 16 },
  modalKicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 8,
    letterSpacing: 1.25,
    lineHeight: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: "700", marginTop: 4 },
  modalDetail: { fontSize: 12, lineHeight: 18, marginTop: 12 },
  retentionOptions: { marginTop: 18, gap: 8 },
  retentionOption: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  optionText: { fontSize: 14, fontWeight: "700" },
  purgeButton: {
    minHeight: 50,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  purgeText: { fontSize: 12, fontWeight: "700" },
});
