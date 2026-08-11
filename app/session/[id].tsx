import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X, MessageCircleMore, Volume2 } from 'lucide-react-native';
import { randomUUID } from 'expo-crypto';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';

import { getScenario } from '@/data/scenarios';
import { useSession, type ChatTurn } from '@/stores/useSession';
import { useSettings } from '@/stores/useSettings';
import { useProgress } from '@/stores/useProgress';
import { startStreaming } from '@/services/stt';
import { streamConversation, generateSuggestedReplies } from '@/services/llm';
import { synthesize, play } from '@/services/tts';
import { annotate } from '@/services/furigana';
import { MicButton } from '@/components/MicButton';
import { SuggestedReplyChips } from '@/components/SuggestedReplyChips';
import { JapaneseText } from '@/components/JapaneseText';
import { tap, fail as failHaptic, success } from '@/utils/haptics';
import { log } from '@/utils/log';
import { colors } from '@/theme/colors';

export default function SessionScreen() {
  const router = useRouter();
  const { id, scenario: scenarioId } = useLocalSearchParams<{
    id: string;
    scenario?: string;
  }>();
  const scenario = getScenario(scenarioId ?? '');
  const settings = useSettings();
  const bumpXp = useProgress((s) => s.bumpXp);
  const tickDay = useProgress((s) => s.tickDay);

  const session = useSession();
  const [suggested, setSuggested] = useState<Array<{ ja: string; en: string; hint: string }>>([]);
  const [showPhraseHelp, setShowPhraseHelp] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const sttHandleRef = useRef<Awaited<ReturnType<typeof startStreaming>> | null>(null);
  const pressStartRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const [furiganaCache, setFuriganaCache] = useState<Record<string, Awaited<ReturnType<typeof annotate>>>>({});

  useEffect(() => {
    (async () => {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone', 'Koe needs the microphone to hear you.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!id) return;
    if (session.id === id) return;
    session.start(
      id,
      scenario
        ? {
            scenarioId: scenario.id,
            topic: scenario.description,
            registerTarget: scenario.registerTarget,
            jlptTarget: scenario.difficulty,
          }
        : {},
    );
  }, [id, scenario?.id]);

  const annotateTurn = useCallback(async (turn: ChatTurn) => {
    const runs = await annotate(turn.textJa);
    setFuriganaCache((prev) => ({ ...prev, [turn.id]: runs }));
  }, []);

  const playAssistant = useCallback(
    async (turn: ChatTurn) => {
      try {
        if (turn.audioUri) {
          await play(turn.audioUri);
          return;
        }
        if (!turn.textJa || !turn.textJa.trim()) return;
        const res = await synthesize(turn.textJa, { voice: settings.voice });
        await play(res.audioUri);
      } catch (e) {
        log.warn('TTS play failed', e);
      }
    },
    [settings.voice],
  );

  const refreshSuggestions = useCallback(
    async (history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
      const out = await generateSuggestedReplies({
        history,
        registerTarget: scenario?.registerTarget,
        jlptTarget: scenario?.difficulty,
      });
      setSuggested(out);
    },
    [scenario],
  );

  const onPressIn = useCallback(async () => {
    if (session.isStreaming || session.isRecording) return;
    pressStartRef.current = Date.now();
    session.setRecording(true);
    try {
      sttHandleRef.current = await startStreaming({
        onChunk: (_chunk) => {
          // could stream into the user's bubble in real time
        },
        languageHint: 'ja,en',
        recorder,
      });
    } catch (e) {
      log.error('start STT failed', e);
      failHaptic();
      session.setRecording(false);
    }
  }, [session, recorder]);

  const onPressOut = useCallback(async () => {
    if (!session.isRecording) return;
    const duration = Date.now() - pressStartRef.current;
    session.setRecording(false);
    const handle = sttHandleRef.current;
    sttHandleRef.current = null;
    if (!handle) return;

    if (duration < 400) {
      await handle.cancel();
      return;
    }
    const { fullText, audioUri } = await handle.stop();
    if (!fullText.trim()) {
      Alert.alert('I did not catch that', 'Hold the mic and speak whenever you are ready.');
      return;
    }
    await sendUser(fullText, audioUri);
  }, [session]);

  const sendUser = useCallback(
    async (text: string, audioUri?: string) => {
      const userTurn: ChatTurn = {
        id: randomUUID(),
        role: 'user',
        textJa: text,
        audioUri,
        createdAt: Date.now(),
      };
      session.addTurn(userTurn);
      annotateTurn(userTurn);
      success();

      const assistantTurn: ChatTurn = {
        id: randomUUID(),
        role: 'assistant',
        textJa: '',
        streaming: true,
        createdAt: Date.now(),
      };
      session.addTurn(assistantTurn);
      session.setStreaming(true);

      const history = useSession
        .getState()
        .turns.filter((t) => t.id !== assistantTurn.id && t.textJa)
        .map((t) => ({ role: t.role, content: t.textJa }));

      try {
        const gen = streamConversation({
          context: useSession.getState().context,
          history: history.slice(0, -1) as any,
          userTurn: text,
        });
        let reply = '';
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            const result = value;
            const finalText = result.fullText || reply;
            session.patchTurn(assistantTurn.id, {
              textJa: finalText,
              corrections: result.corrections,
              audioUri: result.audioUri,
              streaming: false,
            });
            bumpXp(10);
            tickDay();
            annotateTurn({ ...assistantTurn, textJa: finalText });
            if (result.audioUri) {
              play(result.audioUri).catch(() => {});
            } else if (finalText) {
              synthesize(finalText, { voice: settings.voice })
                .then((res) => play(res.audioUri))
                .catch(() => {});
            }
            if (showPhraseHelp) {
              refreshSuggestions([...history, { role: 'assistant', content: finalText }] as any);
            }
            break;
          }
          reply = value;
          session.patchTurn(assistantTurn.id, { textJa: reply });
        }
      } catch (e) {
        log.error('stream failed', e);
        session.patchTurn(assistantTurn.id, {
          textJa: '(connection error — check your worker URL)',
          streaming: false,
        });
      } finally {
        session.setStreaming(false);
      }
    },
    [annotateTurn, bumpXp, tickDay, refreshSuggestions, settings.voice, showPhraseHelp],
  );

  const endSession = () => {
    Alert.alert('End session', 'Finish this conversation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => {
          session.end();
          router.back();
        },
      },
    ]);
  };

  const togglePhraseHelp = () => {
    tap();
    const next = !showPhraseHelp;
    setShowPhraseHelp(next);
    if (next && !suggested.length) {
      const history = useSession
        .getState()
        .turns.filter((turn) => turn.textJa)
        .map((turn) => ({ role: turn.role, content: turn.textJa }));
      refreshSuggestions(history);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
        <Pressable
          accessibilityRole="button"
          onPress={endSession}
          className="min-h-11 min-w-11 flex-row items-center gap-1"
        >
          <X color={colors.muted} size={22} />
          <Text className="text-muted">End</Text>
        </Pressable>
        <View className="items-center">
          <Text className="text-fg dark:text-fg-dark font-semibold">{scenario?.title ?? 'Conversation'}</Text>
          {scenario && <Text className="text-muted text-[10px] mt-0.5">Optional topic</Text>}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1 px-3"
        contentContainerClassName="py-4"
        contentContainerStyle={{ flexGrow: 1 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {!session.turns.length && (
          <View className="flex-1 items-center justify-center px-8 py-20">
            <Text className="font-jpBold text-fg dark:text-fg-dark text-2xl text-center">何でも話してみてください</Text>
            <Text className="text-muted text-center mt-3 leading-5">
              Hold the mic and speak in Japanese. Ask for help, translation, correction, or roleplay whenever you want
              it.
            </Text>
          </View>
        )}
        {session.turns.map((turn) => (
          <TurnBubble
            key={turn.id}
            turn={turn}
            runs={furiganaCache[turn.id] ?? [{ base: turn.textJa }]}
            onReplay={() => playAssistant(turn)}
          />
        ))}
      </ScrollView>

      {showPhraseHelp && (
        <View className="mx-4 mb-2 rounded-2xl bg-accent/10 px-3 py-3">
          <Text className="text-accent text-xs font-semibold mb-2">Try one of these</Text>
          <SuggestedReplyChips replies={suggested} onPick={(reply) => sendUser(reply.ja)} />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showPhraseHelp }}
        onPress={togglePhraseHelp}
        className="min-h-11 flex-row items-center gap-2 px-4 py-2"
      >
        <MessageCircleMore color={colors.accent} size={17} />
        <Text className="text-accent text-xs font-semibold">
          {showPhraseHelp ? 'Hide phrase help' : 'Need a phrase?'}
        </Text>
      </Pressable>

      <View className="border-t border-black/5 dark:border-white/5">
        <MicButton
          recording={session.isRecording}
          disabled={session.isStreaming}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
        />
      </View>
    </SafeAreaView>
  );
}

function TurnBubble({
  turn,
  runs,
  onReplay,
}: {
  turn: ChatTurn;
  runs: Awaited<ReturnType<typeof annotate>>;
  onReplay: () => void;
}) {
  const isUser = turn.role === 'user';
  const correctionNotes = turn.corrections
    ? [
        ...turn.corrections.particles.map((item) => `${item.original} → ${item.corrected} — ${item.explanation}`),
        ...turn.corrections.other.map((item) => `${item.original} → ${item.corrected} — ${item.explanation}`),
        ...(!turn.corrections.register.consistent && turn.corrections.register.note
          ? [turn.corrections.register.note]
          : []),
      ]
    : [];

  return (
    <View className={`my-2 max-w-[85%] ${isUser ? 'self-end items-end' : 'self-start items-start'}`}>
      <View className={`rounded-2xl px-4 py-3 ${isUser ? 'bg-primary' : 'bg-surface dark:bg-surface-dark'}`}>
        <JapaneseText runs={runs} color={isUser ? '#fff' : undefined} fontSize={18} />
        {turn.textEn && (
          <Text className={`text-xs mt-2 ${isUser ? 'text-white/70' : 'text-muted'}`}>{turn.textEn}</Text>
        )}
        {!isUser && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Replay response"
            onPress={onReplay}
            className="min-h-11 flex-row items-center mt-1 -mb-2 gap-1"
          >
            <Volume2 color={colors.accent} size={14} />
            <Text className="text-accent text-xs">Replay</Text>
          </Pressable>
        )}
      </View>
      {!isUser && correctionNotes.length > 0 && (
        <View className="mt-1 max-w-full rounded-xl bg-warning/10 px-3 py-2">
          <Text className="text-warning text-[10px] font-bold uppercase">Quick note</Text>
          {correctionNotes.map((note, index) => (
            <Text key={index} className="text-fg dark:text-fg-dark text-xs mt-1">
              {note}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
