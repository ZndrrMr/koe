export type Register = 'casual' | 'teineigo' | 'keigo';
export type JlptLevel = 1 | 2 | 3 | 4 | 5;

export type Scenario = {
  id: string;
  title: string;
  titleJa: string;
  description: string;
  illustrationEmoji: string;
  registerTarget: Register;
  difficulty: JlptLevel;
};

// These are optional topic and vocabulary cues. Selecting one does not start a
// lesson, assign a persona, or authorize roleplay.

export const SCENARIOS: Scenario[] = [
  {
    id: 'konbini',
    title: 'Konbini checkout',
    titleJa: 'コンビニ',
    description: 'Cashier asks about bags, points cards, and warming up food.',
    illustrationEmoji: '🏪',
    registerTarget: 'teineigo',
    difficulty: 5,
  },
  {
    id: 'ramen',
    title: 'Ordering ramen',
    titleJa: 'ラーメン屋',
    description: 'Ticket machine + counter ordering at a ramen shop.',
    illustrationEmoji: '🍜',
    registerTarget: 'teineigo',
    difficulty: 5,
  },
  {
    id: 'jikoshoukai',
    title: 'Self-introduction',
    titleJa: '自己紹介',
    description: 'First day at work or school — meet a colleague.',
    illustrationEmoji: '🙇',
    registerTarget: 'teineigo',
    difficulty: 5,
  },
  {
    id: 'directions',
    title: 'Asking directions',
    titleJa: '道を聞く',
    description: 'Find your way to the station from a passerby.',
    illustrationEmoji: '🧭',
    registerTarget: 'teineigo',
    difficulty: 5,
  },
  {
    id: 'train-counter',
    title: 'Train ticket counter',
    titleJa: 'みどりの窓口',
    description: 'Reserved seats, fare adjustment, express tickets.',
    illustrationEmoji: '🎫',
    registerTarget: 'keigo',
    difficulty: 4,
  },
  {
    id: 'doctor',
    title: "Doctor's office",
    titleJa: '病院',
    description: 'Describe your symptoms to a doctor.',
    illustrationEmoji: '🏥',
    registerTarget: 'teineigo',
    difficulty: 4,
  },
  {
    id: 'izakaya',
    title: 'Izakaya with a friend',
    titleJa: '居酒屋',
    description: 'Casual drinks after work.',
    illustrationEmoji: '🍻',
    registerTarget: 'casual',
    difficulty: 4,
  },
  {
    id: 'hotel-checkin',
    title: 'Hotel check-in',
    titleJa: 'ホテルチェックイン',
    description: 'Check in to a hotel (keigo register).',
    illustrationEmoji: '🏨',
    registerTarget: 'keigo',
    difficulty: 4,
  },
  {
    id: 'senpai-smalltalk',
    title: 'Senpai small talk',
    titleJa: '先輩と世間話',
    description: 'Mixed register chat with a senior colleague.',
    illustrationEmoji: '☕',
    registerTarget: 'teineigo',
    difficulty: 3,
  },
  {
    id: 'phone-reservation',
    title: 'Phone reservation',
    titleJa: '電話で予約',
    description: 'Make a restaurant reservation over the phone.',
    illustrationEmoji: '📞',
    registerTarget: 'keigo',
    difficulty: 3,
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
