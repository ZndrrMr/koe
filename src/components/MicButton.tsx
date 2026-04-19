import React from 'react';
import { Pressable, View, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Mic } from 'lucide-react-native';
import { press as pressHaptic } from '@/utils/haptics';
import { colors } from '@/theme/colors';

type Props = {
  recording: boolean;
  disabled?: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
};

export function MicButton({ recording, disabled, onPressIn, onPressOut }: Props) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View className="items-center justify-center py-4">
      <Animated.View style={style}>
        <Pressable
          disabled={disabled}
          onPressIn={() => {
            pressHaptic();
            scale.value = withSpring(1.08, { damping: 14, stiffness: 220 });
            onPressIn();
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 14, stiffness: 220 });
            onPressOut();
          }}
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: recording ? colors.primary : colors.accent,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            opacity: disabled ? 0.4 : 1,
          }}
        >
          <Mic color="white" size={36} />
        </Pressable>
      </Animated.View>
      <Text className="text-muted text-xs mt-2">
        {recording ? 'Release to send' : 'Hold to speak'}
      </Text>
    </View>
  );
}
