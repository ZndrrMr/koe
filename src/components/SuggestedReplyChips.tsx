import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { tap as hapticTap } from '@/utils/haptics';

type Reply = { ja: string; en: string; hint: string };

export function SuggestedReplyChips({
  replies,
  onPick,
}: {
  replies: Reply[];
  onPick: (r: Reply) => void;
}) {
  if (!replies.length) return null;
  return (
    <View className="flex-row gap-2 px-3 py-2">
      {replies.slice(0, 3).map((r, i) => (
        <Pressable
          key={i}
          onPress={() => {
            hapticTap();
            onPick(r);
          }}
          className="flex-1 bg-surface dark:bg-surface-dark border border-black/5 dark:border-white/10 rounded-full px-3 py-2 items-center"
        >
          <Text className="text-fg dark:text-fg-dark text-sm" numberOfLines={1}>
            {r.ja}
          </Text>
          <Text className="text-muted text-[10px]" numberOfLines={1}>
            {r.en}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
