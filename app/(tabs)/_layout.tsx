import React from "react";
import { Stack } from "expo-router";

/**
 * Koe has one top-level activity: conversation. Legacy course surfaces remain
 * addressable while they are retired, but they no longer compete in a tab bar.
 */
export default function ConversationLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
