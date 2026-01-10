import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = '/var/log/mira';
const LOG_FILE = join(LOG_DIR, 'server.log');
const CLIENT_LOG_FILE = join(LOG_DIR, 'client.log');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch (error) {
    // If we can't create log dir, just log to console
    console.warn('Could not create log directory:', error);
  }
}

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
    if (existsSync(LOG_DIR)) {
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
    if (existsSync(LOG_DIR)) {
      appendFileSync(CLIENT_LOG_FILE, logLine, 'utf-8');
    }
  } catch {
    // If file write fails, just continue
  }
}

