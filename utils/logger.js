import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Создаем директорию для логов, если её нет
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Функция для получения имени файла лога
function getLogFileName() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.log`;
}

// Основная функция логирования
export function logEvent(type, data) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type,
    ...data
  };

  // Форматируем лог для записи
  const logString = JSON.stringify(logEntry);
  
  // Путь к файлу лога
  const logFile = path.join(logsDir, getLogFileName());
  
  // Записываем в файл
  fs.appendFile(logFile, logString + '\n', (err) => {
    if (err) {
      console.error('Ошибка записи лога:', err);
    }
  });

  // Дублируем в консоль для отладки
  console.log(logString);
}

// Функция для ротации логов (удаление старых)
export function cleanOldLogs(daysToKeep = 30) {
  const files = fs.readdirSync(logsDir);
  const now = new Date();
  
  files.forEach(file => {
    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);
    const daysOld = (now - stats.mtime) / (1000 * 60 * 60 * 24);
    
    if (daysOld > daysToKeep) {
      fs.unlinkSync(filePath);
      console.log(`Удален старый лог: ${file}`);
    }
  });
}

// Запускаем очистку старых логов раз в день
setInterval(() => cleanOldLogs(), 24 * 60 * 60 * 1000); 