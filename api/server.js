// server.js

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getRoleConfig, DEFAULT_ROLE } from '../config/roles.js';
import { logEvent } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

// ----------- Константы и подготовка окружения -----------
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Не найден ключ OPENAI_API_KEY в переменных окружения!');
  process.exit(1);
}

// Инициализация OpenAI клиента
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Директория, в которой лежит текущий server.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Заменяем конфигурацию multer
const storage = multer.diskStorage({
  destination: 'temp/',
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.webm');
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Принимаем WebM и MP3 файлы
    if (file.mimetype === 'audio/webm' || file.mimetype === 'audio/mp3') {
      cb(null, true);
    } else {
      cb(new Error('Только WebM и MP3 файлы разрешены'));
    }
  },
});

// ----------- Инициализация Express -----------
const app = express();
app.use(cors());
app.use(express.json());

// Раздача статических файлов из public/
app.use(express.static(path.join(__dirname, '../public')));

// Папка temp/ будет хранить временные .mp3-файлы.
// Готовые ссылки на них можно раздавать:
app.use('/audio', express.static(path.join(__dirname, '../temp')));

// ----------- Хранение чата в памяти -----------
// sessions[sessionId] = { role: string, messages: array }
const sessions = {};

// ----------- Маршрут: отправка текстового сообщения -----------
app.post('/api/chat/text', async (req, res) => {
  try {
    const { sessionId, message, role = DEFAULT_ROLE } = req.body;

    logEvent('text_message_received', {
      sessionId,
      role,
      messageLength: message?.length,
      historyLength: sessions[sessionId]?.messages?.length || 0,
    });

    if (!sessionId || !message) {
      logEvent('error', {
        type: 'validation_error',
        sessionId,
        error: 'sessionId и message обязательны.',
      });
      return res
        .status(400)
        .json({ error: 'sessionId и message обязательны.' });
    }

    // Инициализация сессии, если нет
    if (!sessions[sessionId]) {
      const roleConfig = getRoleConfig(role);
      sessions[sessionId] = {
        role,
        messages: [{ role: 'system', content: roleConfig.systemPrompt }],
      };
      logEvent('new_session_created', { sessionId, role });
    }

    // Добавляем реплику пользователя
    sessions[sessionId].messages.push({ role: 'user', content: message });

    const roleConfig = getRoleConfig(sessions[sessionId].role);

    // Запрашиваем ChatGPT
    logEvent('gpt_request_started', {
      sessionId,
      model: roleConfig.models.chat,
    });

    const chatResp = await openai.chat.completions.create({
      model: roleConfig.models.chat,
      messages: sessions[sessionId].messages,
    });
    const responseText = chatResp.choices[0].message.content;
    logEvent('gpt_response_received', {
      sessionId,
      responseLength: responseText.length,
      tokensUsed: chatResp.usage,
    });

    // Сохраняем ответ ассистента в историю
    sessions[sessionId].messages.push({
      role: 'assistant',
      content: responseText,
    });

    // Делаем TTS с моделью из конфигурации роли
    const ttsResp = await openai.audio.speech.create({
      model: roleConfig.models.voice,
      voice: roleConfig.voiceType,
      input: responseText,
    });
    logEvent('tts_response_received', { sessionId });

    // Получаем аудио как ArrayBuffer
    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());

    // Сохраняем во временный файл
    const fileName = `bot_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, 'temp', fileName);
    fs.writeFileSync(filePath, audioBuffer);

    logEvent('response_sent', {
      sessionId,
      responseLength: responseText.length,
      audioGenerated: true,
    });

    return res.json({
      responseText,
      audioUrl: `/audio/${fileName}`,
    });
  } catch (error) {
    logEvent('error', {
      type: 'server_error',
      sessionId: req.body?.sessionId,
      error: error.message,
      stack: error.stack,
    });
    console.error('Ошибка /api/chat/text:', error.message);
    return res.status(500).json({ error: 'Произошла ошибка на сервере.' });
  }
});

// ----------- Маршрут: отправка голосового сообщения -----------
app.post('/api/chat/voice', upload.single('audio'), async (req, res) => {
  try {
    const { sessionId, role = DEFAULT_ROLE } = req.body;

    logEvent('voice_message_received', {
      sessionId,
      role,
      fileSize: req.file?.size,
      mimeType: req.file?.mimetype,
    });

    if (!sessionId) {
      logEvent('error', {
        type: 'validation_error',
        error: 'sessionId обязателен.',
      });
      return res.status(400).json({ error: 'sessionId обязателен.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Файл audio обязателен.' });
    }

    // Инициализация сессии
    if (!sessions[sessionId]) {
      const roleConfig = getRoleConfig(role);
      sessions[sessionId] = {
        role,
        messages: [{ role: 'system', content: roleConfig.systemPrompt }],
      };
      logEvent('new_session_created', { sessionId, role });
    }

    const roleConfig = getRoleConfig(sessions[sessionId].role);

    // Путь к загруженному аудио
    const audioPath = req.file.path;

    // Распознаём через Whisper с моделью из конфигурации
    logEvent('whisper_request_started', { sessionId });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: roleConfig.models.transcription,
      language: 'ru',
      response_format: 'text',
      temperature: 0.2,
      prompt:
        'Это разговорная русская речь. Ожидается корректное распознавание с правильной пунктуацией и числительными. Речь может содержать технические термины и имена собственные. При неуверенности в распознавании лучше пропустить слово, чем распознать неверно.',
    });
    logEvent('whisper_response_received', {
      sessionId,
      transcriptionLength: transcription?.length,
    });

    // Проверяем результат распознавания
    const userMessage = transcription || ''; // Защита от null
    console.log('Распознанный текст:', userMessage);

    if (!userMessage) {
      return res.status(400).json({ error: 'Не удалось распознать речь' });
    }

    // Добавляем в историю пользователя
    sessions[sessionId].messages.push({ role: 'user', content: userMessage });

    // Запрашиваем ChatGPT
    logEvent('gpt_request_started', {
      sessionId,
      model: roleConfig.models.chat,
    });

    const chatResp = await openai.chat.completions.create({
      model: roleConfig.models.chat,
      messages: sessions[sessionId].messages,
    });
    const responseText = chatResp.choices[0].message.content;
    logEvent('gpt_response_received', {
      sessionId,
      responseLength: responseText.length,
      tokensUsed: chatResp.usage,
    });

    // Пишем в историю ассистента
    sessions[sessionId].messages.push({
      role: 'assistant',
      content: responseText,
    });

    // Генерируем озвучку
    const ttsResp = await openai.audio.speech.create({
      model: roleConfig.models.voice,
      voice: roleConfig.voiceType,
      input: responseText,
    });
    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());

    // Сохраняем во временный файл
    const fileName = `bot_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, 'temp', fileName);
    fs.writeFileSync(filePath, audioBuffer);

    logEvent('response_sent', {
      sessionId,
      transcriptionLength: userMessage.length,
      responseLength: responseText.length,
      audioGenerated: true,
    });

    return res.json({
      userMessage,
      responseText,
      audioUrl: `/audio/${fileName}`,
    });
  } catch (error) {
    logEvent('error', {
      type: 'server_error',
      sessionId: req.body?.sessionId,
      error: error.message,
      stack: error.stack,
    });
    console.error('Ошибка /api/chat/voice:', error);
    return res.status(500).json({ error: 'Произошла ошибка на сервере.' });
  }
});

// Добавляем новый маршрут для очистки истории
app.post('/api/chat/clear', (req, res) => {
  try {
    const { sessionId } = req.body;

    logEvent('clear_history_requested', {
      sessionId,
      currentHistoryLength: sessions[sessionId]?.messages?.length,
    });

    if (!sessionId) {
      logEvent('error', {
        type: 'validation_error',
        error: 'sessionId обязателен.',
      });
      return res.status(400).json({ error: 'sessionId обязателен.' });
    }

    // Очищаем историю
    sessions[sessionId] = {
      role: DEFAULT_ROLE,
      messages: [
        { role: 'system', content: getRoleConfig(DEFAULT_ROLE).systemPrompt },
      ],
    };

    logEvent('history_cleared', { sessionId });

    return res.json({ success: true });
  } catch (error) {
    logEvent('error', {
      type: 'server_error',
      sessionId: req.body?.sessionId,
      error: error.message,
      stack: error.stack,
    });
    console.error('Ошибка очистки истории:', error);
    return res.status(500).json({ error: 'Произошла ошибка на сервере.' });
  }
});

// Добавляем периодическую статистику активных сессий
setInterval(() => {
  const activeSessions = Object.keys(sessions).length;
  const totalMessages = Object.values(sessions).reduce(
    (sum, session) => sum + session.messages.length,
    0
  );

  logEvent('sessions_stats', {
    activeSessions,
    totalMessages,
    averageMessagesPerSession: totalMessages / activeSessions,
  });
}, 60000); // каждую минуту

// Добавляем маршрут для получения доступных ролей
app.get('/api/roles', (req, res) => {
  const roles = Object.keys(ROLES).map((key) => ({
    id: key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    description: ROLES[key].systemPrompt,
  }));

  res.json(roles);
});

// Добавляем маршрут для получения конфигурации конкретной роли
app.get('/api/roles/:roleId', (req, res) => {
  const { roleId } = req.params;
  const roleConfig = getRoleConfig(roleId);

  if (!roleConfig) {
    return res.status(404).json({ error: 'Роль не найдена' });
  }

  res.json(roleConfig);
});

// ----------- Запуск сервера -----------
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
