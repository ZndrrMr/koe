import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { searchWord, listAllWords } from '@/services/dict';
import type { Word } from '@/db/schema';
import { colors } from '@/theme/colors';
import { WordDetailSheet, type WordDetailSheetHandle } from '@/components/WordDetailSheet';

export default function LibraryScreen() {
  const [query, setQuery] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const sheet = useRef<WordDetailSheetHandle>(null);

  useEffect(() => {
    (async () => {
      const all = await listAllWords(200);
      setWords(all);
    })();
  }, []);

  useEffect(() => {
    const id = setTimeout(async () => {
      if (!query.trim()) {
        const all = await listAllWords(200);
        setWords(all);
        return;
      }
      const res = await searchWord(query.trim());
      setWords(res);
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <SafeAreaView className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="px-5 pt-2 pb-3">
        <Text className="font-jpBold text-2xl text-fg dark:text-fg-dark mb-3">辞書</Text>
        <View className="flex-row items-center bg-surface dark:bg-surface-dark rounded-2xl px-4 py-3">
          <Search color={colors.muted} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search words, meanings, readings…"
            placeholderTextColor={colors.muted}
            className="flex-1 ml-3 text-fg dark:text-fg-dark"
          />
        </View>
      </View>
      <FlatList
        data={words}
        keyExtractor={(w) => String(w.id)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => sheet.current?.open(item)}
            className="px-5 py-3 border-b border-black/5 dark:border-white/5"
          >
            <Text className="font-jp text-fg dark:text-fg-dark text-lg">{item.kanji ?? item.kana}</Text>
            <Text className="text-muted text-xs">{item.kana} · {item.gloss.split('|')[0]}</Text>
          </Pressable>
        )}
      />
      <WordDetailSheet ref={sheet} />
    </SafeAreaView>
  );
}
