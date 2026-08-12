import type { Goal, ResponseLevel } from "@/stores/useSettings";

export function responseGuidanceForLevel(level: ResponseLevel): string {
  switch (level) {
    case "starting":
      return "very short replies with common words";
    case "basic":
      return "short replies with foundational everyday Japanese";
    case "everyday":
      return "natural everyday conversation at a measured pace";
    case "broad":
      return "natural conversation with a broad vocabulary";
    case "full-speed":
      return "unrestricted natural Japanese";
  }
}

export function conversationTopicForGoal(goal: Goal): string | undefined {
  switch (goal) {
    case "travel":
      return "Japanese for travel and everyday situations";
    case "media":
      return "Japanese media, stories, and everyday interests";
    case "work":
      return "Japanese for work and professional life";
    default:
      return undefined;
  }
}
