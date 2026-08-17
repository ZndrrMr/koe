import React from "react";
import { Stack } from "expo-router";

import { useConversationPalette } from "@/theme/conversation";

export default function OnboardingLayout() {
  const palette = useConversationPalette();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.canvas },
      }}
    />
  );
}
