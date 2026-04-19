import { postJson, postStream } from '@/services/api';
import { tutorSystemPrompt } from '@/prompts/tutor';
import { getScenario, type Register, type JlptLevel } from '@/data/scenarios';
import { hasWorker } from '@/utils/config';
import { log } from '@/utils/log';

export type ConvoTurn = { role: 'user' | 'assistant'; content: string };

export type ConversationResult = {
  fullText: string;
  corrections: {
    particles: Array<{ original: string; corrected: string; explanation: string }>;
    register: { consistent: boolean; note?: string };
    other: Array<{ original: string; corrected: string; explanation: string }>;
  };
  translation: string;
};

const EMPTY_RESULT: ConversationResult = {
  fullText: '',
  corrections: { particles: [], register: { consistent: true }, other: [] },
  translation: '',
};

function parseResult(full: string): ConversationResult {
  const correctionsMark = '---CORRECTIONS---';
  const translationMark = '---TRANSLATION---';
  const parts = full.split(correctionsMark);
  const mainText = (parts[0] ?? '').trim();
  let corrections = EMPTY_RESULT.corrections;
  let translation = '';

  if (parts[1]) {
    const [corrRaw, transRaw = ''] = parts[1].split(translationMark);
    try {
      const parsed = JSON.parse((corrRaw ?? '').trim());
      corrections = {
        particles: parsed.particles ?? [],
        register: parsed.register ?? { consistent: true },
        other: parsed.other ?? [],
      };
    } catch (e) {
      log.warn('Failed to parse CORRECTIONS JSON', e);
    }
    translation = (transRaw ?? '').trim();
  }

  return { fullText: mainText, corrections, translation };
}

export async function* streamConversation(opts: {
  scenarioId: string;
  registerTarget: Register;
  jlptTarget: JlptLevel;
  history: ConvoTurn[];
  userTurn: string;
}): AsyncGenerator<string, ConversationResult, void> {
  const scenario = getScenario(opts.scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${opts.scenarioId}`);

  const system = tutorSystemPrompt({
    scenarioId: scenario.id,
    scenarioDescription: scenario.description,
    registerTarget: opts.registerTarget,
    jlptTarget: opts.jlptTarget,
  });

  if (!hasWorker()) {
    log.warn('LLM: worker unset, yielding stub reply.');
    const stub = `${scenario.openingLine}\n---CORRECTIONS---\n{"particles":[],"register":{"consistent":true},"other":[]}\n---TRANSLATION---\n${scenario.openingTranslation}`;
    yield stub;
    return parseResult(stub);
  }

  const body = {
    system,
    messages: [...opts.history, { role: 'user', content: opts.userTurn }],
    model: 'claude-sonnet-4-5',
    max_tokens: 600,
    stream: true,
  };

  const res = await postStream('/llm/chat', body);
  if (!res.body) throw new Error('No response body from /llm/chat');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        const delta =
          evt?.delta?.text ??
          evt?.content_block_delta?.delta?.text ??
          evt?.choices?.[0]?.delta?.content ??
          '';
        if (delta) {
          full += delta;
          yield delta;
        }
      } catch {
        // swallow malformed SSE frames
      }
    }
  }

  return parseResult(full);
}

export async function generateSuggestedReplies(opts: {
  history: ConvoTurn[];
  registerTarget: Register;
  jlptTarget: JlptLevel;
}): Promise<Array<{ ja: string; en: string; hint: string }>> {
  if (!hasWorker()) {
    return [
      { ja: 'はい、お願いします。', en: 'Yes, please.', hint: 'Polite agreement.' },
      { ja: 'いいえ、結構です。', en: "No, I'm good.", hint: 'Polite refusal.' },
      { ja: 'すみません、もう一度お願いします。', en: 'Sorry, could you say that again?', hint: 'Ask for repetition.' },
    ];
  }

  try {
    const res = await postJson<{ replies: Array<{ ja: string; en: string; hint: string }> }>('/llm/flash', {
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
    return { phonemeScore: 80, pitchScore: 70, overallScore: 75, notes: ['(stub — configure worker)'] };
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
    return { phonemeScore: 0, pitchScore: 0, overallScore: 0, notes: ['Grading failed'] };
  }
}

export { parseResult as _parseResult };
