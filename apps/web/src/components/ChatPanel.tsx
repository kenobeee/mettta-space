import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@chat/shared';

type Props = {
  messages: ChatMessage[];
  selfId?: string;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
};

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

export function ChatPanel({ messages, selfId, input, onInputChange, onSend, disabled }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  return (
    <div className="chat">
      <div className="chat-header">Чат</div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">Пока нет сообщений</div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`chat-message ${message.userId === selfId ? 'mine' : ''}`}>
              <div className="chat-meta">
                <span className="chat-author">{message.displayName}</span>
                <span className="chat-time">{formatTime(message.createdAt)}</span>
              </div>
              <div className="chat-text">{message.text}</div>
            </div>
          ))
        )}
      </div>
      <div className="chat-input">
        <input
          type="text"
          placeholder={disabled ? 'Подключение...' : 'Сообщение'}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!disabled) onSend();
            }
          }}
          disabled={disabled}
        />
        <button onClick={onSend} disabled={disabled || !input.trim()}>
          Отправить
        </button>
      </div>
    </div>
  );
}
