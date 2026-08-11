import { useColorScheme } from "react-native";

import { colors } from "@/theme/colors";

export type ConversationPalette = {
  [Key in keyof (typeof colors.conversation)["light"]]: string;
};

export function useConversationPalette(): ConversationPalette {
  const systemScheme = useColorScheme();
  const reviewScheme = __DEV__
    ? process.env.EXPO_PUBLIC_KOE_REVIEW_SCHEME
    : undefined;
  const isDark =
    reviewScheme === "dark" ||
    (reviewScheme !== "light" && systemScheme === "dark");
  return isDark ? colors.conversation.dark : colors.conversation.light;
}
