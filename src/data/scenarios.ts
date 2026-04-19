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
  openingLine: string;
  openingTranslation: string;
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'konbini',
    title: 'Konbini checkout',
    titleJa: 'コンビニ',
    description: 'Cashier asks about bags, points cards, and warming up food.',
    illustrationEmoji: '🏪',
    registerTarget: 'teineigo',
    difficulty: 5,
    openingLine: 'いらっしゃいませ。袋はご利用ですか？',
    openingTranslation: 'Welcome. Would you like a bag?',
  },
  {
    id: 'ramen',
    title: 'Ordering ramen',
    titleJa: 'ラーメン屋',
    description: 'Ticket machine + counter ordering at a ramen shop.',
    illustrationEmoji: '🍜',
    registerTarget: 'teineigo',
    difficulty: 5,
    openingLine: 'いらっしゃい！ご注文はお決まりですか？',
    openingTranslation: 'Welcome! Have you decided your order?',
  },
  {
    id: 'jikoshoukai',
    title: 'Self-introduction',
    titleJa: '自己紹介',
    description: 'First day at work or school — meet a colleague.',
    illustrationEmoji: '🙇',
    registerTarget: 'teineigo',
    difficulty: 5,
    openingLine: 'はじめまして。新しく入られた方ですか？',
    openingTranslation: 'Nice to meet you. Are you the new arrival?',
  },
  {
    id: 'directions',
    title: 'Asking directions',
    titleJa: '道を聞く',
    description: 'Find your way to the station from a passerby.',
    illustrationEmoji: '🧭',
    registerTarget: 'teineigo',
    difficulty: 5,
    openingLine: 'はい、何かお困りですか？',
    openingTranslation: 'Yes, is something the matter?',
  },
  {
    id: 'train-counter',
    title: 'Train ticket counter',
    titleJa: 'みどりの窓口',
    description: 'Reserved seats, fare adjustment, express tickets.',
    illustrationEmoji: '🎫',
    registerTarget: 'keigo',
    difficulty: 4,
    openingLine: 'お待たせしました。ご用件をお伺いします。',
    openingTranslation: "Thanks for waiting. How may I help you?",
  },
  {
    id: 'doctor',
    title: "Doctor's office",
    titleJa: '病院',
    description: 'Describe your symptoms to a doctor.',
    illustrationEmoji: '🏥',
    registerTarget: 'teineigo',
    difficulty: 4,
    openingLine: '今日はどうされましたか？',
    openingTranslation: 'What brings you in today?',
  },
  {
    id: 'izakaya',
    title: 'Izakaya with a friend',
    titleJa: '居酒屋',
    description: 'Casual drinks after work.',
    illustrationEmoji: '🍻',
    registerTarget: 'casual',
    difficulty: 4,
    openingLine: 'お疲れ！とりあえずビール？',
    openingTranslation: 'Good job today! Beer to start?',
  },
  {
    id: 'hotel-checkin',
    title: 'Hotel check-in',
    titleJa: 'ホテルチェックイン',
    description: 'Check in to a hotel (keigo register).',
    illustrationEmoji: '🏨',
    registerTarget: 'keigo',
    difficulty: 4,
    openingLine: 'いらっしゃいませ。本日はご宿泊でございますか？',
    openingTranslation: 'Welcome. Are you staying with us today?',
  },
  {
    id: 'senpai-smalltalk',
    title: 'Senpai small talk',
    titleJa: '先輩と世間話',
    description: 'Mixed register chat with a senior colleague.',
    illustrationEmoji: '☕',
    registerTarget: 'teineigo',
    difficulty: 3,
    openingLine: 'お、最近どう？忙しい？',
    openingTranslation: 'Hey, how have you been? Busy?',
  },
  {
    id: 'phone-reservation',
    title: 'Phone reservation',
    titleJa: '電話で予約',
    description: 'Make a restaurant reservation over the phone.',
    illustrationEmoji: '📞',
    registerTarget: 'keigo',
    difficulty: 3,
    openingLine: 'お電話ありがとうございます、さくら亭です。',
    openingTranslation: 'Thank you for calling — this is Sakura-tei.',
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
