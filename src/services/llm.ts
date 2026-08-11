import { postJson } from '@/services/api';
import { tutorSystemPrompt } from '@/prompts/tutor';
import type { Register, JlptLevel } from '@/data/scenarios';
import type { ConversationContext } from '@/stores/useSession';
import { hasWorker } from '@/utils/config';
import { log } from '@/utils/log';
import { saveAudioFromBase64 } from '@/services/tts';
import { sha256 } from '@/utils/hash';

export type ConvoTurn = { role: 'user' | 'assistant'; content: string };

export type ConversationResult = {
  fullText: string;
  audioUri?: string;
  corrections: {
    particles: Array<{
      original: string;
      corrected: string;
      explanation: string;
    }>;
    register: { consistent: boolean; note?: string };
    other: Array<{ original: string; corrected: string; explanation: string }>;
  };
};

const EMPTY_CORRECTIONS = {
  particles: [] as Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>,
  register: { consistent: true } as { consistent: boolean; note?: string },
  other: [] as Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>,
};

export async function* streamConversation(opts: {
  context?: ConversationContext;
  history: ConvoTurn[];
  userTurn: string;
}): AsyncGenerator<string, ConversationResult, void> {
  const system = tutorSystemPrompt({
    topic: opts.context?.topic,
    registerTarget: opts.context?.registerTarget,
    jlptTarget: opts.context?.jlptTarget,
  });

  if (!hasWorker()) {
    log.warn('LLM: worker unset, yielding stub reply.');
    const reply = 'そうなんですね。もう少し聞かせてください。';
    yield reply;
    return {
      fullText: reply,
      corrections: EMPTY_CORRECTIONS,
    };
  }

  const chatBody = {
    system,
    messages: [...opts.history, { role: 'user', content: opts.userTurn }],
    maxTokens: 300,
  };

  const chatPromise = postJson<{
    text: string;
    audioBase64?: string;
    audioFormat?: string;
  }>('/llm/chat', chatBody);

  const chat = await chatPromise;
  const fullText = (chat.text ?? '').trim();
  if (fullText) yield fullText;

  let audioUri: string | undefined;
  if (chat.audioBase64) {
    try {
      const key = await sha256(`${fullText}|Asuka`);
      audioUri = await saveAudioFromBase64(chat.audioBase64, key, chat.audioFormat ?? 'flac');
    } catch (e) {
      log.warn('Failed to persist reply audio', e);
    }
  }

  const feedbackPromise = postJson<{ corrections?: typeof EMPTY_CORRECTIONS }>('/llm/flash', {
    task: 'feedback',
    registerTarget: opts.context?.registerTarget,
    jlptTarget: opts.context?.jlptTarget,
    history: opts.history,
    userTurn: opts.userTurn,
    tutorReply: fullText,
  }).catch((e) => {
    log.warn('feedback fetch failed', e);
    return { corrections: EMPTY_CORRECTIONS };
  });

  const feedback = await feedbackPromise;
  const corrections = feedback.corrections ?? EMPTY_CORRECTIONS;

  return {
    fullText,
    audioUri,
    corrections: {
      particles: corrections.particles ?? [],
      register: corrections.register ?? { consistent: true },
      other: corrections.other ?? [],
    },
  };
}

export async function generateSuggestedReplies(opts: {
  history: ConvoTurn[];
  registerTarget?: Register;
  jlptTarget?: JlptLevel;
}): Promise<Array<{ ja: string; en: string; hint: string }>> {
  if (!hasWorker()) {
    return [
      {
        ja: '今日はいい天気ですね。',
        en: 'Nice weather today.',
        hint: 'Start with the day.',
      },
      {
        ja: '最近、どうですか？',
        en: 'How have you been?',
        hint: 'Ask an open question.',
      },
      {
        ja: 'もう一度お願いします。',
        en: 'One more time, please.',
        hint: 'Ask for repetition.',
      },
    ];
  }

  try {
    const res = await postJson<{
      replies: Array<{ ja: string; en: string; hint: string }>;
    }>('/llm/flash', {
      task: 'suggest-replies',
      history: opts.history,
      registerTarget: opts.registerTarget,
      jlptTarget: opts.jlptTarget,
    });
    return res.replies ?? [];
  } catch (e) {
    log.warn('generateSuggestedReplies failed', e);
    return [];
  }
}

export async function gradePronunciation(opts: {
  targetText: string;
  userTranscript: string;
  nativePitchContour: number[];
  userPitchContour: number[];
}): Promise<{
  phonemeScore: number;
  pitchScore: number;
  overallScore: number;
  notes: string[];
}> {
  if (!hasWorker()) {
    return {
      phonemeScore: 80,
      pitchScore: 70,
      overallScore: 75,
      notes: ['(stub — configure worker)'],
    };
  }
  try {
    return await postJson('/llm/flash', {
      task: 'grade-pronunciation',
      targetText: opts.targetText,
      userTranscript: opts.userTranscript,
      nativePitchContour: opts.nativePitchContour,
      userPitchContour: opts.userPitchContour,
    });
  } catch (e) {
    log.warn('gradePronunciation failed', e);
    return {
      phonemeScore: 0,
      pitchScore: 0,
      overallScore: 0,
      notes: ['Grading failed'],
    };
  }
}
