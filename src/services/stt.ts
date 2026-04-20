import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
} from 'expo-audio';
import { authHeaders, workerUrl } from '@/services/api';
import { config, hasWorker } from '@/utils/config';
import { log } from '@/utils/log';
import { randomUUID } from 'expo-crypto';

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

async function transcribeFile(uri: string, languageHint: string): Promise<string> {
  if (!hasWorker()) {
    log.warn('STT: worker URL unset — cannot transcribe.');
    return '';
  }
  const res = await fetch(uri);
  const bytes = await res.arrayBuffer();
  const up = await fetch(
    `${workerUrl('/stt/transcribe')}?lang=${encodeURIComponent(languageHint)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'audio/m4a', ...authHeaders() },
      body: bytes,
    },
  );
  if (!up.ok) {
    const body = await up.text().catch(() => '');
    throw new Error(`STT ${up.status}: ${body}`);
  }
  const { text } = (await up.json()) as { text: string };
  return text ?? '';
}

export async function startStreaming(opts: {
  onChunk: (chunk: STTChunk) => void;
  languageHint?: 'ja' | 'ja,en';
  recorder: AudioRecorder;
}): Promise<STTHandle> {
  const ok = await ensurePermission();
  if (!ok) throw new Error('Microphone permission denied');

  await ensureRecDir();
  const audioUri = `${REC_DIR}/${randomUUID()}.m4a`;

  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  await opts.recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
  opts.recorder.record();
  const startedAt = Date.now();
  const languageHint = opts.languageHint ?? 'ja,en';

  return {
    stop: async () => {
      try {
        await opts.recorder.stop();
      } catch (e) {
        log.warn('Recorder stop error', e);
      }
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch (e) {
        log.warn('Audio mode reset failed', e);
      }
      const srcUri = opts.recorder.uri;
      if (srcUri && srcUri !== audioUri) {
        try {
          await FileSystem.copyAsync({ from: srcUri, to: audioUri });
        } catch (e) {
          log.warn('Recording copy failed; using source uri.', e);
        }
      }
      const finalUri = srcUri ?? audioUri;

      let fullText = '';
      try {
        fullText = await transcribeFile(finalUri, languageHint);
        if (fullText) {
          opts.onChunk({ text: fullText, isFinal: true, confidence: 0.9 });
        }
      } catch (e) {
        log.error('STT transcribe failed', e);
      }

      return {
        fullText: fullText.trim(),
        durationMs: Date.now() - startedAt,
        audioUri: finalUri,
      };
    },
    cancel: async () => {
      try { await opts.recorder.stop(); } catch {}
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {}
    },
  };
}

export { useAudioRecorder };

export function workerConfigured() {
  return Boolean(config.workerUrl);
}
