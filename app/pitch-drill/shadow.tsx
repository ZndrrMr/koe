import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, Volume2 } from 'lucide-react-native';
import { useAudioRecorder, RecordingPresets } from 'expo-audio';
import { listAllWords } from '@/services/dict';
import type { Word } from '@/db/schema';
import { synthesize, play } from '@/services/tts';
import { extractContour, compareContours } from '@/services/pitch';
import { startStreaming } from '@/services/stt';
import { PitchContour } from '@/components/PitchContour';
import { JapaneseText } from '@/components/JapaneseText';
import { annotate, type FuriganaRun } from '@/services/furigana';
import { MicButton } from '@/components/MicButton';
import { colors } from '@/theme/colors';
import { success, fail, tap as tapHaptic } from '@/utils/haptics';

export default function ShadowScreen() {
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [words, setWords] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [runs, setRuns] = useState<FuriganaRun[]>([]);
  const [nativePitch, setNativePitch] = useState<{ f0: number[]; timestamps: number[] }>({ f0: [], timestamps: [] });
  const [userPitch, setUserPitch] = useState<{ f0: number[]; timestamps: number[] } | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const sttRef = useRef<Awaited<ReturnType<typeof startStreaming>> | null>(null);
  const pressStart = useRef(0);

  useEffect(() => {
    (async () => {
      const all = await listAllWords(200);
      setWords(all.sort(() => Math.random() - 0.5).slice(0, 15));
    })();
  }, []);

  const current = words[idx];

  useEffect(() => {
    if (!current) return;
    (async () => {
      const r = await annotate(current.kanji ?? current.kana);
      setRuns(r);
      setUserPitch(null);
      setScore(null);
      try {
        const res = await synthesize(current.kana);
        await play(res.audioUri);
        const contour = await extractContour(res.audioUri);
        setNativePitch({ f0: contour.f0, timestamps: contour.timestamps });
      } catch {}
    })();
  }, [current?.id]);

  const onPressIn = async () => {
    pressStart.current = Date.now();
    setRecording(true);
    try {
      sttRef.current = await startStreaming({
        onChunk: () => {},
        recorder,
      });
    } catch (e) {
      fail();
      setRecording(false);
    }
  };

  const onPressOut = async () => {
    const dur = Date.now() - pressStart.current;
    setRecording(false);
    const handle = sttRef.current;
    sttRef.current = null;
    if (!handle) return;
    if (dur < 400) { await handle.cancel(); return; }
    const { audioUri } = await handle.stop();
    try {
      const contour = await extractContour(audioUri);
      if (!contour.f0.length) {
        Alert.alert('Try again', 'We could not hear you clearly.');
        return;
      }
      const user = { f0: contour.f0, timestamps: contour.timestamps };
      setUserPitch(user);
      const { normalizedScore } = compareContours(nativePitch, user);
      setScore(normalizedScore);
      normalizedScore >= 65 ? success() : fail();
    } catch (e) {
      fail();
    }
  };

  if (!current) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <Text className="text-muted">Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()}><X color={colors.muted} size={24} /></Pressable>
        <Text className="text-muted">{idx + 1} / {words.length}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <JapaneseText runs={runs} fontSize={40} />
        <Text className="text-muted mt-3">{current.gloss.split('|')[0]}</Text>
        <Pressable
          onPress={async () => { tapHaptic(); const r = await synthesize(current.kana); await play(r.audioUri); }}
          className="mt-4 flex-row items-center gap-2 bg-accent px-4 py-2 rounded-full"
        >
          <Volume2 color="white" size={16} />
          <Text className="text-white font-semibold">Hear native</Text>
        </Pressable>

        <View className="mt-8">
          <PitchContour
            native={nativePitch}
            user={userPitch ?? undefined}
            width={320}
            height={120}
            showScore={score != null}
            score={score ?? undefined}
          />
        </View>
        {score != null && (
          <Text className="mt-4 text-xl font-bold" style={{ color: score >= 65 ? colors.success : colors.warning }}>
            {score} / 100
          </Text>
        )}
      </View>

      <MicButton recording={recording} onPressIn={onPressIn} onPressOut={onPressOut} />

      <Pressable
        onPress={() => setIdx((i) => Math.min(i + 1, words.length - 1))}
        className="mx-4 mb-6 bg-surface dark:bg-surface-dark py-3 rounded-full items-center"
      >
        <Text className="text-fg dark:text-fg-dark font-semibold">Next</Text>
      </Pressable>
    </SafeAreaView>
  );
}
