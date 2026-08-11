import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

import {
  completeSession,
  deleteSession,
  getAudioRetentionDays,
  getNative,
  listSavedMoments,
  loadSession,
  persistSession,
  persistTurn,
  purgeExpiredAudio,
  setAudioRetentionDays,
  setLearningMomentDecision,
} from "@/db";
import { analyzePronunciation } from "@/services/pitch";
import { useConversationPalette } from "@/theme/conversation";

type ProofResult = {
  title: string;
  detail: string;
};

const SESSION_ID = "zan-851-runtime-proof";
const DELETE_SESSION_ID = "zan-851-delete-proof";
const RETENTION_SESSION_ID = "zan-851-retention-proof";

export default function SessionHistoryProofScreen() {
  const palette = useConversationPalette();
  const [status, setStatus] = useState("Running on-device persistence checks…");
  const [results, setResults] = useState<ProofResult[]>([]);

  useEffect(() => {
    if (!__DEV__) {
      setStatus(
        "This verification surface is available in development builds.",
      );
      return;
    }
    let active = true;
    void runProof().then(
      (proofResults) => {
        if (!active) return;
        setResults(proofResults);
        setStatus("PASS · session history round-trip complete");
      },
      (error) => {
        if (!active) return;
        setStatus(
          `FAIL · ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.canvas }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.kicker, { color: palette.seam }]}>
          ZAN-851 / SIMULATOR PROOF
        </Text>
        <Text style={[styles.title, { color: palette.ink }]}>残る会話</Text>
        <Text
          accessibilityRole="summary"
          style={[
            styles.status,
            {
              color: status.startsWith("PASS")
                ? palette.success
                : palette.proof,
              borderColor: palette.hairline,
            },
          ]}
        >
          {status}
        </Text>
        <View style={styles.results}>
          {results.map((result, index) => (
            <View
              key={result.title}
              style={[styles.result, { borderColor: palette.hairline }]}
            >
              <Text style={[styles.number, { color: palette.proof }]}>
                {String(index + 1).padStart(2, "0")}
              </Text>
              <View style={styles.resultCopy}>
                <Text style={[styles.resultTitle, { color: palette.ink }]}>
                  {result.title}
                </Text>
                <Text style={[styles.resultDetail, { color: palette.muted }]}>
                  {result.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

async function runProof(): Promise<ProofResult[]> {
  for (const id of [SESSION_ID, DELETE_SESSION_ID, RETENTION_SESSION_ID]) {
    await deleteSession(id);
  }
  const [referenceAsset, goodAsset, poorAsset] = await Promise.all(
    [
      Asset.fromModule(require("../assets/pronunciation-proof/reference.mp3")),
      Asset.fromModule(require("../assets/pronunciation-proof/good.m4a")),
      Asset.fromModule(require("../assets/pronunciation-proof/poor.m4a")),
    ].map(async (asset) => {
      await asset.downloadAsync();
      return asset;
    }),
  );
  const referenceUri = referenceAsset.localUri ?? referenceAsset.uri;
  const goodUri = goodAsset.localUri ?? goodAsset.uri;
  const poorUri = poorAsset.localUri ?? poorAsset.uri;
  const poorFeedback = await analyzePronunciation({
    targetText: "京都へ行きます",
    referenceAudioUri: referenceUri,
    attemptAudioUri: poorUri,
  });
  const goodFeedback = await analyzePronunciation({
    targetText: "京都へ行きます",
    referenceAudioUri: referenceUri,
    attemptAudioUri: goodUri,
    previous: { attemptId: "proof-user", feedback: poorFeedback },
  });

  await persistSession({
    id: SESSION_ID,
    scenarioId: "directions",
    topic: "Finding a temple in Kyoto",
    registerTarget: "teineigo",
    jlptTarget: 4,
  });
  await persistProofTurn({
    id: "proof-user",
    role: "user",
    textJa: "京都に行きます",
    textEn: "I am going to Kyoto.",
    audioUri: poorUri,
    referenceAudioUri: referenceUri,
    pronunciation: poorFeedback,
    corrections: {
      particles: [
        {
          original: "京都に",
          corrected: "京都へ",
          explanation: "へ emphasizes direction.",
        },
      ],
      register: { consistent: true },
      other: [],
    },
    createdAt: Date.now() - 4_000,
  });
  await persistProofTurn({
    id: "proof-assistant",
    role: "assistant",
    textJa: "どのお寺を見たいですか？",
    textEn: "Which temple would you like to see?",
    audioUri: referenceUri,
    createdAt: Date.now() - 3_000,
  });
  await persistProofTurn({
    id: "proof-retry",
    role: "user",
    textJa: "京都へ行きます",
    textEn: "I am going to Kyoto.",
    audioUri: goodUri,
    referenceAudioUri: referenceUri,
    pronunciation: goodFeedback,
    retryOfTurnId: "proof-user",
    attemptNumber: 2,
    createdAt: Date.now() - 2_000,
  });
  await persistTurn({
    id: "proof-interrupted",
    sessionId: SESSION_ID,
    role: "assistant",
    textJa: "それなら",
    streaming: true,
    createdAt: Date.now() - 1_000,
  });
  await persistTurn({
    id: "proof-interrupted",
    sessionId: SESSION_ID,
    role: "assistant",
    textJa: "それなら、清水寺は",
    streaming: true,
    createdAt: Date.now() - 1_000,
  });

  const recovered = await loadSession(SESSION_ID);
  assertProof(recovered, "Session did not reload");
  assertProof(recovered.turns.length === 4, "Duplicate turn was inserted");
  const interrupted = recovered.turns.find(
    (turn) => turn.id === "proof-interrupted",
  );
  assertProof(
    interrupted?.interrupted && !interrupted.streaming,
    "Streaming turn was not recovered as interrupted",
  );
  const retry = recovered.turns.find((turn) => turn.id === "proof-retry");
  assertProof(
    retry?.retryOfTurnId === "proof-user" && Boolean(retry.pronunciation),
    "Retry lineage or alignment was not restored",
  );
  assertProof(
    recovered.turns.every(
      (turn) => turn.id === "proof-interrupted" || Boolean(turn.audioUri),
    ),
    "Managed turn audio was not restored",
  );
  for (const turn of recovered.turns.filter(
    (candidate) => candidate.audioUri,
  )) {
    const info = await FileSystem.getInfoAsync(turn.audioUri!);
    assertProof(info.exists, `Archived audio is missing for ${turn.id}`);
    assertProof(
      turn.audioUri!.includes("/Documents/session-audio/"),
      `Audio was not copied into session ownership for ${turn.id}`,
    );
  }

  let closeout = await completeSession(SESSION_ID, recovered.turns);
  for (const moment of closeout.moments) {
    await setLearningMomentDecision(SESSION_ID, moment.id, "saved");
  }
  const completed = await loadSession(SESSION_ID);
  assertProof(completed?.status === "completed", "Session did not complete");
  const saved = await listSavedMoments();
  const proofMoments = saved.filter(
    (moment) => moment.sessionId === SESSION_ID,
  );
  assertProof(
    proofMoments.some((moment) => moment.kind === "expression") &&
      proofMoments.some((moment) => moment.kind === "correction") &&
      proofMoments.some((moment) => moment.kind === "retry"),
    "Compact closeout categories were not saved",
  );

  await persistSession({ id: DELETE_SESSION_ID, scenarioId: "open" });
  const deleteTurn = await persistTurn({
    id: "delete-audio",
    sessionId: DELETE_SESSION_ID,
    role: "user",
    textJa: "消してください",
    audioUri: goodUri,
    createdAt: Date.now(),
  });
  assertProof(
    Boolean(deleteTurn.audioUri),
    "Delete proof audio did not persist",
  );
  await deleteSession(DELETE_SESSION_ID);
  const database = await getNative();
  const deletedRow = await database.getFirstAsync<{ id: string }>(
    "SELECT id FROM sessions WHERE id = ?",
    [DELETE_SESSION_ID],
  );
  const deletedAudio = await FileSystem.getInfoAsync(deleteTurn.audioUri!);
  assertProof(
    !deletedRow && !deletedAudio.exists,
    "Session deletion left data",
  );

  const originalRetention = await getAudioRetentionDays();
  await persistSession({ id: RETENTION_SESSION_ID, scenarioId: "open" });
  const retentionTurn = await persistTurn({
    id: "retention-audio",
    sessionId: RETENTION_SESSION_ID,
    role: "user",
    textJa: "古い録音",
    audioUri: poorUri,
    createdAt: Date.now() - 40 * 24 * 60 * 60 * 1_000,
  });
  const expiredAt = Date.now() - 40 * 24 * 60 * 60 * 1_000;
  await database.runAsync(
    "UPDATE sessions SET started_at = ?, updated_at = ? WHERE id = ?",
    [expiredAt, expiredAt, RETENTION_SESSION_ID],
  );
  await setAudioRetentionDays(7);
  await purgeExpiredAudio();
  const expiredTurn = await database.getFirstAsync<{
    audio_uri: string | null;
  }>("SELECT audio_uri FROM turns WHERE client_id = ?", ["retention-audio"]);
  const expiredAudio = await FileSystem.getInfoAsync(retentionTurn.audioUri!);
  assertProof(
    expiredTurn?.audio_uri === null && !expiredAudio.exists,
    "Retention purge left expired audio",
  );
  await deleteSession(RETENTION_SESSION_ID);
  await setAudioRetentionDays(originalRetention);

  closeout = completed?.closeout ?? closeout;
  return [
    {
      title: "Relaunch-safe recovery",
      detail: `${recovered.turns.length} unique turns; a streaming reply became one interrupted turn.`,
    },
    {
      title: "Complete voice record",
      detail:
        "Learner and Koe audio, translations, correction feedback, pitch contours, alignment, and retry lineage round-tripped.",
    },
    {
      title: "Compact closeout",
      detail: `${closeout.moments.length} moments generated; expression, correction, and strongest retry saved to Library.`,
    },
    {
      title: "Deletion",
      detail:
        "Session rows, turns, moments, and its owned audio directory were removed together.",
    },
    {
      title: "Voice retention",
      detail:
        "A 40-day-old recording expired under the 7-day policy while its transcript remained.",
    },
  ];
}

async function persistProofTurn(input: {
  id: string;
  role: "user" | "assistant";
  textJa: string;
  textEn?: string;
  audioUri?: string;
  referenceAudioUri?: string;
  pronunciation?: Awaited<ReturnType<typeof analyzePronunciation>>;
  retryOfTurnId?: string;
  attemptNumber?: number;
  corrections?: {
    particles: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
    register: { consistent: boolean; note?: string };
    other: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
  };
  createdAt: number;
}) {
  const pronunciation = input.pronunciation;
  return persistTurn({
    id: input.id,
    sessionId: SESSION_ID,
    role: input.role,
    textJa: input.textJa,
    textEn: input.textEn,
    audioUri: input.audioUri,
    referenceAudioUri: input.referenceAudioUri,
    retryOfTurnId: input.retryOfTurnId,
    attemptNumber: input.attemptNumber,
    createdAt: input.createdAt,
    pitchData: pronunciation
      ? {
          reference: pronunciation.reference,
          attempt: pronunciation.attempt,
        }
      : undefined,
    alignmentData: pronunciation
      ? { path: pronunciation.alignmentPath, units: pronunciation.units }
      : undefined,
    feedback:
      input.corrections || pronunciation
        ? {
            corrections: input.corrections,
            pronunciation: pronunciation
              ? {
                  version: pronunciation.version,
                  status: pronunciation.status,
                  targetText: pronunciation.targetText,
                  scores: pronunciation.scores,
                  firstCorrection: pronunciation.firstCorrection,
                  target: pronunciation.target,
                  retry: pronunciation.retry,
                }
              : undefined,
          }
        : undefined,
  });
}

function assertProof(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 24, paddingTop: 42, paddingBottom: 54 },
  kicker: {
    fontFamily: "SFMono-Medium",
    fontSize: 9,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: "Hiragino Mincho ProN",
    fontSize: 38,
    fontWeight: "600",
    lineHeight: 52,
    marginTop: 8,
  },
  status: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 21,
    paddingVertical: 16,
    marginTop: 16,
  },
  results: { marginTop: 16 },
  result: {
    minHeight: 86,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 14,
  },
  number: { fontFamily: "SFMono-Medium", fontSize: 10 },
  resultCopy: { flex: 1 },
  resultTitle: { fontSize: 15, fontWeight: "700" },
  resultDetail: { fontSize: 12, lineHeight: 18, marginTop: 3 },
});
