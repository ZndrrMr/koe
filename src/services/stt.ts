import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  type AudioRecorder,
} from 'expo-audio';
import { getJson } from '@/services/api';
import { config, hasWorker } from '@/utils/config';
import { log } from '@/utils/log';
import { v4 as uuidv4 } from 'uuid';

export type STTChunk = {
  text: string;
  isFinal: boolean;
  confidence: number;
};

export type STTHandle = {
  stop: () => Promise<{ fullText: string; durationMs: number; audioUri: string }>;
  cancel: () => Promise<void>;
};

const REC_DIR = `${FileSystem.cacheDirectory}recordings`;

async function ensureRecDir() {
  const info = await FileSystem.getInfoAsync(REC_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(REC_DIR, { intermediates: true });
}

export async function ensurePermission() {
  const status = await AudioModule.requestRecordingPermissionsAsync();
  return status.granted;
}

type SonioxToken = { token: string; url: string; expiresAt: number };

async function fetchSonioxToken(): Promise<SonioxToken | null> {
  if (!hasWorker()) return null;
  try {
    return await getJson<SonioxToken>('/stt/token');
  } catch (e) {
    log.error('Soniox token fetch failed', e);
    return null;
  }
}

export async function startStreaming(opts: {
  onChunk: (chunk: STTChunk) => void;
  languageHint?: 'ja' | 'ja,en';
  recorder: AudioRecorder;
}): Promise<STTHandle> {
  const ok = await ensurePermission();
  if (!ok) throw new Error('Microphone permission denied');

  await ensureRecDir();
  const audioUri = `${REC_DIR}/${uuidv4()}.m4a`;

  await opts.recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
  opts.recorder.record();
  const startedAt = Date.now();

  const token = await fetchSonioxToken();
  let ws: WebSocket | null = null;
  let partialText = '';
  let finalText = '';

  if (token) {
    try {
      ws = new WebSocket(token.url);
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            api_key: token.token,
            language_hints: (opts.languageHint ?? 'ja,en').split(','),
            model: 'stt-rt-preview',
            enable_non_final_tokens: true,
          }),
        );
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          if (data.tokens) {
            const text = (data.tokens as Array<{ text: string; is_final?: boolean }>)
              .map((t) => t.text)
              .join('');
            const anyFinal = (data.tokens as Array<{ is_final?: boolean }>).some((t) => t.is_final);
            if (anyFinal) finalText += text;
            partialText = finalText + text;
            opts.onChunk({ text: partialText, isFinal: anyFinal, confidence: data.confidence ?? 0.8 });
          }
        } catch (e) {
          log.warn('Soniox parse error', e);
        }
      };
      ws.onerror = (e) => log.warn('Soniox WS error', e);
    } catch (e) {
      log.warn('Soniox WS connect failed; falling back to local transcript only.', e);
      ws = null;
    }
  } else {
    log.info('STT: no Soniox token — recording audio without live transcription.');
  }

  return {
    stop: async () => {
      try {
        await opts.recorder.stop();
      } catch (e) {
        log.warn('Recorder stop error', e);
      }
      const srcUri = opts.recorder.uri;
      if (srcUri && srcUri !== audioUri) {
        try {
          await FileSystem.copyAsync({ from: srcUri, to: audioUri });
        } catch (e) {
          log.warn('Recording copy failed; using source uri.', e);
        }
      }
      try { ws?.close(); } catch {}
      return {
        fullText: partialText.trim(),
        durationMs: Date.now() - startedAt,
        audioUri: srcUri ?? audioUri,
      };
    },
    cancel: async () => {
      try { await opts.recorder.stop(); } catch {}
      try { ws?.close(); } catch {}
    },
  };
}

export { useAudioRecorder };

export function workerConfigured() {
  return Boolean(config.workerUrl);
}
