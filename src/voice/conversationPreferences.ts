import type { Goal, Level } from "@/stores/useSettings";
import type { JlptLevel } from "@/data/scenarios";

export function levelToJlpt(level: Level): JlptLevel {
  if (level === "n2plus") return 2;
  if (level === "n3") return 3;
  if (level === "n4") return 4;
  return 5;
}

export function conversationTopicForGoal(goal: Goal): string | undefined {
  switch (goal) {
    case "travel":
      return "Japanese for travel and everyday situations";
    case "anime":
      return "Japanese media, stories, and everyday interests";
    case "work":
      return "Japanese for work and professional life";
    case "jlpt":
      return "Japanese the learner may meet while preparing for the JLPT";
    default:
      return undefined;
  }
}
