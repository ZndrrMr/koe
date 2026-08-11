import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Volume2, X } from "lucide-react-native";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { randomUUID } from "expo-crypto";
import { Asset } from "expo-asset";

import { PronunciationFeedbackCard } from "@/components/PronunciationFeedbackCard";
import { JapaneseText } from "@/components/JapaneseText";
import { MicButton } from "@/components/MicButton";
import { getNative, persistSession, persistTurn } from "@/db";
import type { Word } from "@/db/schema";
import { listAllWords } from "@/services/dict";
import { annotate, type FuriganaRun } from "@/services/furigana";
import {
  analyzePronunciation,
  type PronunciationFeedback,
} from "@/services/pitch";
import { startStreaming } from "@/services/stt";
import { play, synthesize } from "@/services/tts";
import { useConversationPalette } from "@/theme/conversation";
import { fail, success, tap as tapHaptic } from "@/utils/haptics";

type Attempt = {
  id: string;
  audioUri: string;
  feedback: PronunciationFeedback;
};

export default function ShadowScreen() {
  const router = useRouter();
  const { proof } = useLocalSearchParams<{ proof?: string }>();
  const proofMode =
    __DEV__ &&
    (proof === "1" || process.env.EXPO_PUBLIC_KOE_PRONUNCIATION_PROOF === "1");
  const palette = useConversationPalette();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [words, setWords] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [runs, setRuns] = useState<FuriganaRun[]>([]);
  const [referenceAudioUri, setReferenceAudioUri] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [proofStatus, setProofStatus] = useState("");
  const [recording, setRecording] = useState(false);
  const sttRef = useRef<Awaited<ReturnType<typeof startStreaming>> | null>(
    null,
  );
  const pressStart = useRef(0);

  useEffect(() => {
    if (proofMode) {
      setWords([
        {
          id: -850,
          kanji: null,
          kana: "おはようございます",
          romaji: "ohayou gozaimasu",
          pos: "phrase",
          gloss: "Good morning",
          jlpt: 5,
          pitchAccents: null,
          freqRank: null,
        },
      ]);
      return;
    }
    void listAllWords(200).then((all) => {
      setWords([...all].sort(() => Math.random() - 0.5).slice(0, 15));
    });
  }, [proofMode]);

  const current = words[index];
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    void (async () => {
      if (proofMode) {
        const [referenceAsset, goodAsset, poorAsset] = await Promise.all(
          [
            Asset.fromModule(
              require("../../assets/pronunciation-proof/reference.mp3"),
            ),
            Asset.fromModule(
              require("../../assets/pronunciation-proof/good.m4a"),
            ),
            Asset.fromModule(
              require("../../assets/pronunciation-proof/poor.m4a"),
            ),
          ].map(async (asset) => {
            await asset.downloadAsync();
            return asset;
          }),
        );
        const referenceUri = referenceAsset.localUri ?? referenceAsset.uri;
        const goodUri = goodAsset.localUri ?? goodAsset.uri;
        const poorUri = poorAsset.localUri ?? poorAsset.uri;
        const goodFeedback = await analyzePronunciation({
          targetText: current.kana,
          referenceAudioUri: referenceUri,
          attemptAudioUri: goodUri,
        });
        const poorFeedback = await analyzePronunciation({
          targetText: current.kana,
          referenceAudioUri: referenceUri,
          attemptAudioUri: poorUri,
          previous: { attemptId: "known-good", feedback: goodFeedback },
        });
        if (cancelled) return;
        setRuns([{ base: current.kana }]);
        setReferenceAudioUri(referenceUri);
        setAttempts([
          { id: "known-good", audioUri: goodUri, feedback: goodFeedback },
          {
            id: "deliberately-poor",
            audioUri: poorUri,
            feedback: poorFeedback,
          },
        ]);
        await persistSession({ id: "zan-850-proof", scenarioId: "shadow" });
        await persistTurn({
          id: "zan-850-proof-attempt",
          sessionId: "zan-850-proof",
          role: "user",
          textJa: current.kana,
          audioUri: poorUri,
          referenceAudioUri: referenceUri,
          pitchData: {
            reference: poorFeedback.reference,
            attempt: poorFeedback.attempt,
          },
          alignmentData: {
            path: poorFeedback.alignmentPath,
            units: poorFeedback.units,
          },
          feedback: {
            firstCorrection: poorFeedback.firstCorrection,
            scores: poorFeedback.scores,
            retry: poorFeedback.retry,
          },
          retryOfTurnId: "known-good",
          attemptNumber: 2,
          createdAt: Date.now(),
        });
        const database = await getNative();
        const persisted = await database.getFirstAsync<{
          pitch_data_json: string | null;
          alignment_data_json: string | null;
          feedback_json: string | null;
          retry_of_turn_id: string | null;
          attempt_number: number;
        }>(
          `SELECT pitch_data_json, alignment_data_json, feedback_json,
            retry_of_turn_id, attempt_number
           FROM turns WHERE client_id = ?`,
          ["zan-850-proof-attempt"],
        );
        if (
          !persisted?.pitch_data_json ||
          !persisted.alignment_data_json ||
          !persisted.feedback_json ||
          persisted.retry_of_turn_id !== "known-good" ||
          persisted.attempt_number !== 2
        ) {
          throw new Error("Pronunciation persistence proof did not round-trip");
        }
        const evidence = `MP3 reference ${goodFeedback.reference.f0.length} frames · M4A attempts ${goodFeedback.attempt.f0.length}/${poorFeedback.attempt.f0.length} frames · known-good ${goodFeedback.scores.overall} · deliberately poor ${poorFeedback.scores.overall} · persistence passed`;
        setProofStatus(`${evidence} · checking replay`);
        await playToEnd(referenceUri);
        await playToEnd(poorUri);
        if (!cancelled) setProofStatus(`${evidence} · replay passed`);
        return;
      }
      const [annotated, reference] = await Promise.all([
        annotate(current.kanji ?? current.kana),
        synthesize(current.kana, { withTimestamps: true }),
      ]);
      if (cancelled) return;
      setRuns(annotated);
      setReferenceAudioUri(reference.audioUri);
      setAttempts([]);
      await play(reference.audioUri);
    })().catch(() => {
      if (!cancelled) {
        setReferenceAudioUri("");
        if (proofMode) setProofStatus("Native pronunciation proof failed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [current?.id, proofMode]);

  const beginRecording = async () => {
    pressStart.current = Date.now();
    setRecording(true);
    try {
      sttRef.current = await startStreaming({
        onChunk: () => {},
        recorder,
      });
    } catch {
      fail();
      setRecording(false);
    }
  };

  const finishRecording = async () => {
    const duration = Date.now() - pressStart.current;
    setRecording(false);
    const handle = sttRef.current;
    sttRef.current = null;
    if (!handle) return;
    if (duration < 400) {
      await handle.cancel();
      return;
    }
    const { audioUri } = await handle.stop();
    if (!audioUri || !referenceAudioUri) {
      Alert.alert(
        "No audio to compare",
        "Hold the button and say the whole word.",
      );
      return;
    }
    try {
      const previous = attempts.at(-1);
      const feedback = await analyzePronunciation({
        targetText: current.kana,
        referenceAudioUri,
        attemptAudioUri: audioUri,
        previous: previous
          ? { attemptId: previous.id, feedback: previous.feedback }
          : undefined,
      });
      setAttempts((existing) => [
        ...existing,
        { id: randomUUID(), audioUri, feedback },
      ]);
      feedback.scores.overall >= 70 ? success() : fail();
    } catch {
      fail();
      Alert.alert(
        "Could not compare that recording",
        "Try once more and keep the microphone close.",
      );
    }
  };

  if (!current) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg">
        <Text className="text-muted">Loading…</Text>
      </SafeAreaView>
    );
  }

  const latest = attempts.at(-1);
  const previous = attempts.at(-2);

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: palette.canvas }}
    >
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close shadowing drill"
          onPress={() => router.back()}
          className="h-11 w-11 items-center justify-center rounded-full"
        >
          <X color={palette.muted} size={24} />
        </Pressable>
        <View className="items-center">
          <Text className="font-mono text-[9px] tracking-widest text-muted">
            SHADOW / まねる
          </Text>
          <Text style={{ color: palette.muted }}>
            {index + 1} / {words.length}
          </Text>
        </View>
        <View className="h-11 w-11" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 18 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center px-6 pb-5 pt-8">
          <JapaneseText runs={runs} fontSize={40} />
          <Text className="mt-3 text-muted">{current.gloss.split("|")[0]}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Play the reference pronunciation"
            onPress={() => {
              tapHaptic();
              void play(referenceAudioUri);
            }}
            className="mt-5 min-h-11 flex-row items-center gap-2 rounded-full bg-accent px-5"
          >
            <Volume2 color="white" size={16} />
            <Text className="font-semibold text-white">Hear reference</Text>
          </Pressable>
          {proofStatus ? (
            <Text
              testID="pronunciation-proof-status"
              accessibilityLabel={proofStatus}
              className="mt-4 text-center font-mono text-[10px] leading-4 text-muted"
            >
              {proofStatus}
            </Text>
          ) : null}
        </View>

        {latest ? (
          <PronunciationFeedbackCard
            feedback={latest.feedback}
            palette={palette}
            attemptAudioUri={latest.audioUri}
            referenceAudioUri={referenceAudioUri}
            previous={
              previous
                ? { feedback: previous.feedback, audioUri: previous.audioUri }
                : undefined
            }
            onPlay={(uri) => void play(uri)}
            initialExpanded={proofMode}
          />
        ) : (
          <View className="mx-6 my-8 border-l-2 border-accent pl-4">
            <Text className="text-sm leading-5" style={{ color: palette.ink }}>
              Listen once, then copy the shape and spacing—not the speaker’s
              vocal range.
            </Text>
          </View>
        )}
      </ScrollView>

      <View
        className="border-t px-4 pt-3"
        style={{ borderColor: palette.hairline }}
      >
        {!proofMode ? (
          <MicButton
            recording={recording}
            onPressIn={beginRecording}
            onPressOut={finishRecording}
            prompt={
              latest ? "Hold to retry this word" : "Hold and shadow the word"
            }
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to the next word"
          onPress={() =>
            setIndex((value) => Math.min(value + 1, words.length - 1))
          }
          className="mb-2 min-h-11 items-center justify-center rounded-full bg-surface dark:bg-surface-dark"
        >
          <Text className="font-semibold text-fg dark:text-fg-dark">Next</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function playToEnd(audioUri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void play(audioUri, {
      onFinished: resolve,
      onError: reject,
    });
  });
}
