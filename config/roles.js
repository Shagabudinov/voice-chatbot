export const ROLES = {
  // Базовый ассистент
  default: {
    name: "Голосовой ChatGPT Бот",
    systemPrompt: "Ты — голосовой ассистент. Отвечай вежливо и развёрнуто, добавляй подробности.",
    models: {
      chat: "gpt-3.5-turbo",
      voice: "tts-1",
      transcription: "whisper-1"
    },
    voiceType: "alloy" // нейтральный голос
  },
  
  // Технический специалист
  tech: {
    name: "Технический Консультант",
    systemPrompt: "Ты — технический специалист. Отвечай на вопросы, используя технические термины. Давай подробные технические объяснения. При необходимости приводи примеры кода.",
    models: {
      chat: "gpt-4",
      voice: "tts-1",
      transcription: "whisper-1"
    },
    voiceType: "echo" // более формальный, технический голос
  },
  
  // Дружелюбный помощник
  friendly: {
    name: "Дружелюбный Помощник",
    systemPrompt: "Ты — дружелюбный помощник. Общайся неформально, используй простые слова. Будь позитивным и поддерживающим.",
    models: {
      chat: "gpt-3.5-turbo",
      voice: "tts-1-hd",
      transcription: "whisper-1"
    },
    voiceType: "nova" // более мягкий, дружелюбный голос
  },
  
  // Бизнес-консультант
  business: {
    name: "Бизнес-консультант",
    systemPrompt: "Ты — бизнес-консультант. Давай профессиональные советы по бизнесу, маркетингу и управлению. Используй деловой стиль общения.",
    models: {
      chat: "gpt-4",
      voice: "tts-1",
      transcription: "whisper-1"
    },
    voiceType: "onyx" // более серьезный, профессиональный голос
  }
};

// Настройки по умолчанию
export const DEFAULT_ROLE = 'default';

// Валидация ролей
export function isValidRole(role) {
  return role in ROLES;
}

// Получение конфигурации роли
export function getRoleConfig(role) {
  return ROLES[isValidRole(role) ? role : DEFAULT_ROLE];
} 