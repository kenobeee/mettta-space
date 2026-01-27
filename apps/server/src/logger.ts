import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Для локальной разработки — папка logs в корне проекта; в проде можно задать LOG_DIR=/var/log/mira
const DEFAULT_LOG_DIR = join(process.cwd(), 'logs');
const envLogDir = process.env.LOG_DIR;
let resolvedLogDir = envLogDir ? (envLogDir.startsWith('/') ? envLogDir : join(process.cwd(), envLogDir)) : DEFAULT_LOG_DIR;

// Ensure log directory exists; if env path is not writable, fallback to local logs
try {
  if (!existsSync(resolvedLogDir)) {
    mkdirSync(resolvedLogDir, { recursive: true });
  }
} catch (error) {
  console.warn('Не удалось создать каталог логов, переключаюсь на локальные логи:', error);
  resolvedLogDir = DEFAULT_LOG_DIR;
  try {
    if (!existsSync(resolvedLogDir)) {
      mkdirSync(resolvedLogDir, { recursive: true });
    }
  } catch (fallbackError) {
    console.warn('Резервный каталог логов тоже недоступен; запись в файл отключена.', fallbackError);
  }
}

const LOG_FILE = join(resolvedLogDir, 'server.log');
const CLIENT_LOG_FILE = join(resolvedLogDir, 'client.log');

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatLog(level: LogLevel, category: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${dataStr}\n`;
}

function writeLog(level: LogLevel, category: string, message: string, data?: unknown) {
  const logLine = formatLog(level, category, message, data);
  
  // Always log to console
  if (level === 'error') {
    console.error(logLine.trim());
  } else if (level === 'warn') {
    console.warn(logLine.trim());
  } else {
    console.log(logLine.trim());
  }
  
  // Try to write to file
  try {
    if (existsSync(resolvedLogDir)) {
      appendFileSync(LOG_FILE, logLine, 'utf-8');
    }
  } catch {
    // If file write fails, just continue
  }
}

type LoggerType = {
  debug: (category: string, message: string, data?: unknown) => void;
  info: (category: string, message: string, data?: unknown) => void;
  warn: (category: string, message: string, data?: unknown) => void;
  error: (category: string, message: string, data?: unknown) => void;
};

export const logger: LoggerType = {
  debug: (category: string, message: string, data?: unknown) => writeLog('debug', category, message, data),
  info: (category: string, message: string, data?: unknown) => writeLog('info', category, message, data),
  warn: (category: string, message: string, data?: unknown) => writeLog('warn', category, message, data),
  error: (category: string, message: string, data?: unknown) => writeLog('error', category, message, data),
};

export function writeClientLog(clientId: string, level: LogLevel, category: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  const logLine = `[${timestamp}] [CLIENT:${clientId}] [${level.toUpperCase()}] [${category}] ${message}${dataStr}\n`;
  
  // Try to write to file
  try {
    if (existsSync(resolvedLogDir)) {
      appendFileSync(CLIENT_LOG_FILE, logLine, 'utf-8');
    }
  } catch {
    // If file write fails, just continue
  }
}

