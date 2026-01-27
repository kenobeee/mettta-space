import type { ChatClient } from '@chat/shared';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private sessionId: string;
  private clientRef: ChatClient | null = null;

  constructor() {
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.loadLogs();
  }

  setClient(client: ChatClient | null) {
    this.clientRef = client;
  }

  private loadLogs() {
    try {
      const stored = localStorage.getItem('webrtc_logs');
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Не удалось загрузить логи:', e);
    }
  }

  private saveLogs() {
    try {
      // Keep only last maxLogs entries
      const logsToSave = this.logs.slice(-this.maxLogs);
      localStorage.setItem('webrtc_logs', JSON.stringify(logsToSave));
      localStorage.setItem('webrtc_logs_session', this.sessionId);
    } catch (e) {
      console.error('Не удалось сохранить логи:', e);
    }
  }

  private sanitizeData(data: unknown): unknown {
    try {
      return JSON.parse(JSON.stringify(data, (_key, value) => {
        // Remove circular references and functions
        if (typeof value === 'function') return '[Function]';
        if (value instanceof MediaStream) return `MediaStream(${value.id})`;
        if (value instanceof MediaStreamTrack) return `MediaStreamTrack(${value.kind}, enabled: ${value.enabled}, muted: ${value.muted}, readyState: ${value.readyState})`;
        if (value instanceof RTCPeerConnection) return `RTCPeerConnection(${value.connectionState})`;
        return value;
      }));
    } catch {
      return '[Circular or non-serializable]';
    }
  }

  private log(level: LogLevel, category: string, message: string, data?: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data: data ? this.sanitizeData(data) : undefined
    };

    this.logs.push(entry);
    this.saveLogs();

    // Also log to console
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[${category}] ${message}`, data || '');

    // Send to server if client is available
    if (this.clientRef) {
      try {
        this.clientRef.sendLog(level, category, message, data ? this.sanitizeData(data) : undefined);
      } catch (e) {
        // If sending fails, just continue - don't break logging
        console.warn('Не удалось отправить лог на сервер:', e);
      }
    }
  }

  debug(category: string, message: string, data?: unknown) {
    this.log('debug', category, message, data);
  }

  info(category: string, message: string, data?: unknown) {
    this.log('info', category, message, data);
  }

  warn(category: string, message: string, data?: unknown) {
    this.log('warn', category, message, data);
  }

  error(category: string, message: string, data?: unknown) {
    this.log('error', category, message, data);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsAsText(): string {
    return this.logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${log.data ? ' ' + JSON.stringify(log.data, null, 2) : ''}`
    ).join('\n');
  }

  clear() {
    this.logs = [];
    this.saveLogs();
  }

  download() {
    const text = this.getLogsAsText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `webrtc_logs_${this.sessionId}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const logger = new Logger();

