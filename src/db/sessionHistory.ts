import type { PronunciationFeedback } from "@/services/pitch";

export type ConversationCorrections = {
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

export type SessionTurnSnapshot = {
  id: string;
  role: "user" | "assistant";
  textJa: string;
  textEn?: string;
  audioUri?: string;
  referenceAudioUri?: string;
  pronunciation?: PronunciationFeedback;
  retryOfTurnId?: string;
  attemptNumber?: number;
  corrections?: ConversationCorrections;
  createdAt: number;
  streaming?: boolean;
  interrupted?: boolean;
};

export type LearningMomentKind = "expression" | "correction" | "retry";
export type LearningMomentDecision = "pending" | "saved" | "discarded";

export type LearningMoment = {
  id: string;
  sessionId: string;
  sourceTurnId: string;
  kind: LearningMomentKind;
  textJa: string;
  textEn?: string;
  note?: string;
  audioUri?: string;
  score?: number;
  decision: LearningMomentDecision;
  createdAt: number;
};

export type SessionCloseout = {
  sessionId: string;
  generatedAt: number;
  moments: LearningMoment[];
};

function momentId(sessionId: string, kind: LearningMomentKind, turnId: string) {
  return `${sessionId}:${kind}:${turnId}`;
}

function correctionMoment(
  sessionId: string,
  turn: SessionTurnSnapshot,
): LearningMoment | undefined {
  const corrections = turn.corrections;
  if (!corrections) return undefined;
  const replacements = [...corrections.particles, ...corrections.other];
  const replacement = replacements[0];
  if (replacement) {
    return {
      id: momentId(sessionId, "correction", turn.id),
      sessionId,
      sourceTurnId: turn.id,
      kind: "correction",
      textJa: replacement.corrected,
      textEn: turn.textEn,
      note: `${replacement.original} → ${replacement.corrected} · ${replacement.explanation}`,
      audioUri: turn.audioUri,
      decision: "pending",
      createdAt: turn.createdAt,
    };
  }
  if (!corrections.register.consistent && corrections.register.note) {
    return {
      id: momentId(sessionId, "correction", turn.id),
      sessionId,
      sourceTurnId: turn.id,
      kind: "correction",
      textJa: turn.textJa,
      textEn: turn.textEn,
      note: corrections.register.note,
      audioUri: turn.audioUri,
      decision: "pending",
      createdAt: turn.createdAt,
    };
  }
  return undefined;
}

function retryMoment(
  sessionId: string,
  turn: SessionTurnSnapshot,
): LearningMoment {
  const overall = turn.pronunciation?.scores.overall;
  const delta = turn.pronunciation?.retry?.scoreDelta;
  const pieces = [
    overall === undefined ? undefined : `${Math.round(overall)}% match`,
    delta === undefined
      ? undefined
      : `${delta >= 0 ? "+" : ""}${Math.round(delta)} from the first try`,
  ].filter(Boolean);
  return {
    id: momentId(sessionId, "retry", turn.id),
    sessionId,
    sourceTurnId: turn.id,
    kind: "retry",
    textJa: turn.pronunciation?.targetText ?? turn.textJa,
    textEn: turn.textEn,
    note: pieces.join(" · ") || "Pronunciation retry",
    audioUri: turn.audioUri,
    score: overall,
    decision: "pending",
    createdAt: turn.createdAt,
  };
}

/**
 * Turns become a tiny set of editorial learning moments for the session coda
 * and the optional handwriting handoff, never a dense chat transcript.
 */
export function buildSessionCloseout(
  sessionId: string,
  turns: SessionTurnSnapshot[],
  generatedAt = Date.now(),
): SessionCloseout {
  const completeTurns = turns.filter((turn) => turn.textJa.trim());
  const expressions = [...completeTurns]
    .reverse()
    .filter(
      (turn) =>
        turn.role === "assistant" &&
        !turn.interrupted &&
        !turn.streaming &&
        turn.textJa.length <= 80,
    )
    .filter(
      (turn, index, candidates) =>
        candidates.findIndex(
          (candidate) => candidate.textJa.trim() === turn.textJa.trim(),
        ) === index,
    )
    .slice(0, 2)
    .reverse()
    .map<LearningMoment>((turn) => ({
      id: momentId(sessionId, "expression", turn.id),
      sessionId,
      sourceTurnId: turn.id,
      kind: "expression",
      textJa: turn.textJa.trim(),
      textEn: turn.textEn,
      note: "Expression from Koe",
      audioUri: turn.audioUri,
      decision: "pending",
      createdAt: turn.createdAt,
    }));

  const correction = completeTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => correctionMoment(sessionId, turn))
    .filter((moment): moment is LearningMoment => Boolean(moment))
    .at(-1);

  const retry = completeTurns
    .filter(
      (turn) =>
        turn.role === "user" &&
        Boolean(turn.retryOfTurnId) &&
        Boolean(turn.pronunciation),
    )
    .sort((left, right) => {
      const leftImproved = left.pronunciation?.retry?.targetImproved ? 1 : 0;
      const rightImproved = right.pronunciation?.retry?.targetImproved ? 1 : 0;
      if (leftImproved !== rightImproved) return rightImproved - leftImproved;
      return (
        (right.pronunciation?.scores.overall ?? 0) -
        (left.pronunciation?.scores.overall ?? 0)
      );
    })[0];

  return {
    sessionId,
    generatedAt,
    moments: [
      ...expressions,
      ...(correction ? [correction] : []),
      ...(retry ? [retryMoment(sessionId, retry)] : []),
    ],
  };
}

export function withMomentDecision(
  closeout: SessionCloseout,
  momentIdToUpdate: string,
  decision: LearningMomentDecision,
): SessionCloseout {
  return {
    ...closeout,
    moments: closeout.moments.map((moment) =>
      moment.id === momentIdToUpdate ? { ...moment, decision } : moment,
    ),
  };
}
