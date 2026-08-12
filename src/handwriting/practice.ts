export type PracticePoint = {
  x: number;
  y: number;
};

export type PracticeStroke = {
  path: string;
  points: PracticePoint[];
  instruction: string;
};

export type PracticeCharacter = {
  literal: string;
  kind: "kana" | "kanji";
  reading: string;
  meaning: string;
  strokes: PracticeStroke[];
};

export type RecognitionCandidate = {
  text: string;
  confidence: number;
};

export type CanvasStroke = {
  start: PracticePoint;
  end: PracticePoint;
};

export type CanvasBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HandwritingObservation = {
  hasInk: boolean;
  strokeCount: number;
  candidates: RecognitionCandidate[];
  strokes: CanvasStroke[];
  contentBounds: CanvasBounds;
  error?: string;
};

export type FeedbackState = "pass" | "review" | "unavailable";

export type HandwritingAssessment = {
  verdict: "ready" | "close" | "retry" | "empty";
  recognition: {
    state: "certain" | "uncertain" | "mismatch" | "confirmed" | "unavailable";
    message: string;
    candidates: RecognitionCandidate[];
  };
  strokeCount: {
    state: FeedbackState;
    message: string;
  };
  direction: {
    state: FeedbackState;
    message: string;
    strokeIndex?: number;
  };
  proportions: {
    state: FeedbackState;
    message: string;
  };
};

const CHARACTERS: PracticeCharacter[] = [
  {
    literal: "い",
    kind: "kana",
    reading: "i",
    meaning: "hiragana i",
    strokes: [
      {
        path: "M 31 22 C 28 40 29 64 43 77",
        points: [
          { x: 0.31, y: 0.22 },
          { x: 0.43, y: 0.77 },
        ],
        instruction: "Begin high on the left and sweep down and inward.",
      },
      {
        path: "M 61 34 C 72 43 77 58 72 70",
        points: [
          { x: 0.61, y: 0.34 },
          { x: 0.72, y: 0.7 },
        ],
        instruction:
          "Begin on the right and curve down without closing the gap.",
      },
    ],
  },
  {
    literal: "こ",
    kind: "kana",
    reading: "ko",
    meaning: "hiragana ko",
    strokes: [
      {
        path: "M 25 31 C 43 25 63 25 76 31",
        points: [
          { x: 0.25, y: 0.31 },
          { x: 0.76, y: 0.31 },
        ],
        instruction: "Draw the upper stroke from left to right.",
      },
      {
        path: "M 24 64 C 35 76 62 78 78 69",
        points: [
          { x: 0.24, y: 0.64 },
          { x: 0.78, y: 0.69 },
        ],
        instruction:
          "Start the lower stroke at the left and finish to the right.",
      },
    ],
  },
  {
    literal: "一",
    kind: "kanji",
    reading: "いち",
    meaning: "one",
    strokes: [
      {
        path: "M 19 52 C 39 49 63 49 82 51",
        points: [
          { x: 0.19, y: 0.52 },
          { x: 0.82, y: 0.51 },
        ],
        instruction: "Draw one level stroke from left to right.",
      },
    ],
  },
  {
    literal: "十",
    kind: "kanji",
    reading: "じゅう",
    meaning: "ten",
    strokes: [
      {
        path: "M 20 47 C 39 45 62 45 81 46",
        points: [
          { x: 0.2, y: 0.47 },
          { x: 0.81, y: 0.46 },
        ],
        instruction: "Draw the horizontal stroke first, from left to right.",
      },
      {
        path: "M 51 18 C 50 39 50 65 51 83",
        points: [
          { x: 0.51, y: 0.18 },
          { x: 0.51, y: 0.83 },
        ],
        instruction: "Cross from the top and move straight down.",
      },
    ],
  },
  {
    literal: "人",
    kind: "kanji",
    reading: "ひと",
    meaning: "person",
    strokes: [
      {
        path: "M 53 19 C 50 42 41 64 24 81",
        points: [
          { x: 0.53, y: 0.19 },
          { x: 0.24, y: 0.81 },
        ],
        instruction: "Begin at the top and sweep down to the left.",
      },
      {
        path: "M 54 39 C 59 57 68 70 80 81",
        points: [
          { x: 0.54, y: 0.39 },
          { x: 0.8, y: 0.81 },
        ],
        instruction: "Start near the first stroke and sweep down to the right.",
      },
    ],
  },
];

export const HANDWRITING_TARGET_SIZE = 48;
export const STARTER_EXPRESSION = "こい・一人";
export const PRACTICE_CHARACTERS = CHARACTERS;

const BY_LITERAL = new Map(
  CHARACTERS.map((character) => [character.literal, character]),
);

export function getPracticeCharacter(
  literal: string,
): PracticeCharacter | undefined {
  return BY_LITERAL.get(literal.normalize("NFC"));
}

/**
 * The first validation queue stays deliberately small. Saved conversation
 * expressions are filtered into this queue without inventing curriculum state.
 */
export function practiceTargetsForText(text: string): PracticeCharacter[] {
  const seen = new Set<string>();
  return Array.from(text.normalize("NFC"))
    .map((literal) => getPracticeCharacter(literal))
    .filter((character): character is PracticeCharacter => {
      if (!character || seen.has(character.literal)) return false;
      seen.add(character.literal);
      return true;
    });
}

export function assessHandwritingAttempt(
  character: PracticeCharacter,
  observation: HandwritingObservation,
  confirmedText?: string,
): HandwritingAssessment {
  if (!observation.hasInk || observation.strokeCount === 0) {
    return {
      verdict: "empty",
      recognition: {
        state: "unavailable",
        message: "Add at least one stroke before checking.",
        candidates: [],
      },
      strokeCount: { state: "unavailable", message: "No strokes yet." },
      direction: {
        state: "unavailable",
        message: "Direction appears after a complete stroke.",
      },
      proportions: {
        state: "unavailable",
        message: "Proportions appear after a complete character.",
      },
    };
  }

  const candidates = normalizeCandidates(observation.candidates);
  const recognition = assessRecognition(
    character.literal,
    candidates,
    confirmedText,
    observation.error,
  );
  const strokeCount = assessStrokeCount(
    observation.strokeCount,
    character.strokes.length,
  );
  const direction = assessDirection(character, observation.strokes);
  const proportions = assessProportions(character, observation.contentBounds);

  const structuralPass =
    strokeCount.state === "pass" &&
    direction.state === "pass" &&
    proportions.state === "pass";
  const recognitionPass =
    recognition.state === "certain" || recognition.state === "confirmed";
  const verdict =
    recognitionPass && structuralPass
      ? "ready"
      : recognition.state === "mismatch" || strokeCount.state === "review"
        ? "retry"
        : "close";

  return { verdict, recognition, strokeCount, direction, proportions };
}

function normalizeCandidates(
  candidates: RecognitionCandidate[],
): RecognitionCandidate[] {
  const best = new Map<string, number>();
  for (const candidate of candidates) {
    const text = candidate.text.replace(/\s/g, "").normalize("NFC");
    if (!text) continue;
    const confidence = Math.min(1, Math.max(0, candidate.confidence));
    best.set(text, Math.max(best.get(text) ?? 0, confidence));
  }
  return [...best.entries()]
    .map(([text, confidence]) => ({ text, confidence }))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 4);
}

function assessRecognition(
  target: string,
  candidates: RecognitionCandidate[],
  confirmedText?: string,
  error?: string,
): HandwritingAssessment["recognition"] {
  if (confirmedText) {
    const matches = confirmedText.normalize("NFC") === target;
    return {
      state: matches ? "confirmed" : "mismatch",
      message: matches
        ? `You confirmed ${target}; structural feedback stays independent.`
        : `You confirmed ${confirmedText}, not ${target}.`,
      candidates,
    };
  }
  if (!candidates.length) {
    return {
      state: "unavailable",
      message: error
        ? "Recognition was unavailable; the stroke checks still apply."
        : "Koe could not read this yet. Compare the overlay and try again.",
      candidates,
    };
  }
  const top = candidates[0];
  const targetCandidate = candidates.find(
    (candidate) => candidate.text === target,
  );
  const runnerUp = candidates[1]?.confidence ?? 0;
  const margin = top.confidence - runnerUp;

  if (top.text === target && top.confidence >= 0.72 && margin >= 0.12) {
    return {
      state: "certain",
      message: `Koe read ${target} with ${percent(top.confidence)} confidence.`,
      candidates,
    };
  }
  if (targetCandidate || top.confidence < 0.82) {
    return {
      state: "uncertain",
      message: `Koe is not sure. Best guess: ${top.text} at ${percent(top.confidence)}.`,
      candidates,
    };
  }
  return {
    state: "mismatch",
    message: `Koe read ${top.text}, not ${target}. Use the overlay before retrying.`,
    candidates,
  };
}

function assessStrokeCount(
  actual: number,
  expected: number,
): HandwritingAssessment["strokeCount"] {
  if (actual === expected) {
    return {
      state: "pass",
      message: `${actual} ${actual === 1 ? "stroke" : "strokes"} — expected ${expected}.`,
    };
  }
  const relation = actual < expected ? "few" : "many";
  return {
    state: "review",
    message: `${actual} strokes is too ${relation}; ${expected} expected.`,
  };
}

function assessDirection(
  character: PracticeCharacter,
  actualStrokes: CanvasStroke[],
): HandwritingAssessment["direction"] {
  if (actualStrokes.length !== character.strokes.length) {
    return {
      state: "unavailable",
      message: "Match the stroke count before checking order and direction.",
    };
  }

  const expected = character.strokes.map((stroke) => ({
    start: stroke.points[0],
    end: stroke.points.at(-1)!,
  }));

  for (let index = 0; index < actualStrokes.length; index += 1) {
    const actual = actualStrokes[index];
    const direct = strokeDistance(actual, expected[index]);
    const reversed = strokeDistance(actual, {
      start: expected[index].end,
      end: expected[index].start,
    });
    if (reversed + 0.16 < direct) {
      return {
        state: "review",
        strokeIndex: index,
        message: `Stroke ${index + 1} is reversed. ${character.strokes[index].instruction}`,
      };
    }

    const bestIndex = expected
      .map((candidate, candidateIndex) => ({
        candidateIndex,
        distance: strokeDistance(actual, candidate),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (
      bestIndex.candidateIndex !== index &&
      bestIndex.distance + 0.18 < direct
    ) {
      return {
        state: "review",
        strokeIndex: index,
        message: `Stroke ${index + 1} appears out of order. ${character.strokes[index].instruction}`,
      };
    }
  }

  return {
    state: "pass",
    message: "Stroke order and direction match the reference.",
  };
}

function assessProportions(
  character: PracticeCharacter,
  actual: CanvasBounds,
): HandwritingAssessment["proportions"] {
  if (actual.width <= 0 || actual.height <= 0) {
    return {
      state: "unavailable",
      message: "Koe could not measure the character bounds.",
    };
  }

  const reference = boundsForCharacter(character);
  const actualRatio = actual.width / actual.height;
  const referenceRatio = reference.width / reference.height;
  const ratioDifference = Math.abs(Math.log(actualRatio / referenceRatio));
  const actualCenter = {
    x: actual.x + actual.width / 2,
    y: actual.y + actual.height / 2,
  };
  const referenceCenter = {
    x: reference.x + reference.width / 2,
    y: reference.y + reference.height / 2,
  };
  const centerDistance = pointDistance(actualCenter, referenceCenter);

  if (centerDistance > 0.18) {
    return {
      state: "review",
      message: "Move the character closer to the center of the field.",
    };
  }
  if (ratioDifference > 0.38) {
    return {
      state: "review",
      message:
        actualRatio > referenceRatio
          ? "Narrow the character to match the reference proportions."
          : "Give the character more horizontal room.",
    };
  }
  return {
    state: "pass",
    message: "Placement and proportions are close to the reference.",
  };
}

function boundsForCharacter(character: PracticeCharacter): CanvasBounds {
  const points = character.strokes.flatMap((stroke) => stroke.points);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function strokeDistance(left: CanvasStroke, right: CanvasStroke): number {
  return (
    pointDistance(left.start, right.start) + pointDistance(left.end, right.end)
  );
}

function pointDistance(left: PracticePoint, right: PracticePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
