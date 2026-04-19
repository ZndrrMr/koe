import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Volume2, Plus } from 'lucide-react-native';
import type { Word } from '@/db/schema';
import { annotate, type FuriganaRun } from '@/services/furigana';
import { JapaneseText, type PitchInfo } from '@/components/JapaneseText';
import { KanjiStroke } from '@/components/KanjiStroke';
import { synthesize, play } from '@/services/tts';
import { addWordToSRS } from '@/services/srs';
import { suggestExamples } from '@/services/dict';
import { success, tap } from '@/utils/haptics';
import { colors } from '@/theme/colors';
import type { PitchAccent } from '@/data/seed';

export type WordDetailSheetHandle = {
  open: (word: Word) => void;
  close: () => void;
};

export const WordDetailSheet = forwardRef<WordDetailSheetHandle>((_, ref) => {
  const sheet = useRef<BottomSheet>(null);
  const [word, setWord] = useState<Word | null>(null);
  const [runs, setRuns] = useState<FuriganaRun[]>([]);
  const [examples, setExamples] = useState<string[]>([]);

  useImperativeHandle(ref, () => ({
    open: (w) => {
      setWord(w);
      sheet.current?.snapToIndex(0);
    },
    close: () => sheet.current?.close(),
  }));

  useEffect(() => {
    if (!word) {
      setRuns([]);
      setExamples([]);
      return;
    }
    (async () => {
      const text = word.kanji ?? word.kana;
      const annotated = await annotate(text);
      setRuns(annotated);
      const ex = await suggestExamples(word.id);
      setExamples(ex);
    })();
  }, [word]);

  const pitchMap = useMemo<Record<string, PitchInfo> | undefined>(() => {
    if (!word?.pitchAccents) return undefined;
    try {
      const parsed = JSON.parse(word.pitchAccents) as PitchAccent[];
      const first = parsed[0];
      if (!first) return undefined;
      const key = word.kanji ?? word.kana;
      return { [key]: { pattern: first.pattern, dropMora: first.dropMora, mora: first.mora } };
    } catch { return undefined; }
  }, [word]);

  const playTts = async () => {
    if (!word) return;
    tap();
    const res = await synthesize(word.kana);
    await play(res.audioUri);
  };

  const addToSRS = async () => {
    if (!word) return;
    await addWordToSRS(word.id, ['recognition', 'production']);
    success();
  };

  const kanjiChars = useMemo(() => {
    if (!word?.kanji) return [];
    return Array.from(word.kanji).filter((c) => /[\u4E00-\u9FAF]/.test(c));
  }, [word]);

  return (
    <BottomSheet
      ref={sheet}
      index={-1}
      enablePanDownToClose
      snapPoints={['60%', '90%']}
      backgroundStyle={{ backgroundColor: colors.surface, borderRadius: 28 }}
      handleIndicatorStyle={{ backgroundColor: colors.muted }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {word && (
          <ScrollView className="px-5 pt-2 pb-10">
            <JapaneseText runs={runs} pitchAccents={pitchMap} fontSize={36} />
            <Text className="text-muted mt-2">{word.kana}</Text>
            <View className="flex-row items-center gap-3 mt-4">
              <Pressable onPress={playTts} className="flex-row items-center gap-2 bg-accent rounded-full px-4 py-2">
                <Volume2 color="white" size={18} />
                <Text className="text-white font-semibold">Play</Text>
              </Pressable>
              <Pressable onPress={addToSRS} className="flex-row items-center gap-2 bg-primary rounded-full px-4 py-2">
                <Plus color="white" size={18} />
                <Text className="text-white font-semibold">Add to SRS</Text>
              </Pressable>
            </View>

            <Text className="text-fg font-semibold mt-6 mb-1">Meanings</Text>
            {word.gloss.split('|').map((g, i) => (
              <Text key={i} className="text-fg/80 leading-snug">• {g.trim()}</Text>
            ))}

            <View className="flex-row gap-4 mt-4">
              {word.jlpt && <Text className="text-xs text-accent">JLPT N{word.jlpt}</Text>}
              {word.freqRank && <Text className="text-xs text-muted">rank #{word.freqRank}</Text>}
              <Text className="text-xs text-muted uppercase">{word.pos}</Text>
            </View>

            {kanjiChars.length > 0 && (
              <>
                <Text className="text-fg font-semibold mt-6 mb-2">Kanji</Text>
                <View className="flex-row flex-wrap gap-3">
                  {kanjiChars.map((c) => (
                    <KanjiStroke key={c} literal={c} size={80} />
                  ))}
                </View>
              </>
            )}

            <Text className="text-fg font-semibold mt-6 mb-2">Examples</Text>
            {examples.length === 0 ? (
              <Text className="text-muted text-sm">Tap play and try it out loud.</Text>
            ) : (
              examples.map((ex, i) => (
                <Text key={i} className="text-fg/90 mb-2 text-base">・ {ex}</Text>
              ))
            )}
          </ScrollView>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

WordDetailSheet.displayName = 'WordDetailSheet';
