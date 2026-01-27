import { useMemo, useState } from 'react';
import type { Meeting } from '@chat/shared';

const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

const toDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
};

const formatDateLabel = (key: string) => {
  const { year, month, day } = parseDateKey(key);
  const dd = `${day}`.padStart(2, '0');
  const mm = `${month}`.padStart(2, '0');
  return `${dd}.${mm}.${year}`;
};

const parseTimeLabel = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const formatTimeLabel = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  const hh = Number.isFinite(hour) ? String(hour).padStart(2, '0') : '00';
  const mm = Number.isFinite(minute) ? String(minute).padStart(2, '0') : '00';
  return `${hh}:${mm}`;
};

const buildCalendar = (date: Date) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  return Array.from({ length: 42 }, (_, index) => {
    const dayIndex = index - firstWeekday + 1;
    if (dayIndex <= 0) {
      const day = daysInPrevMonth + dayIndex;
      return {
        day,
        monthOffset: -1,
        date: new Date(year, month - 1, day)
      };
    }
    if (dayIndex > daysInMonth) {
      const day = dayIndex - daysInMonth;
      return {
        day,
        monthOffset: 1,
        date: new Date(year, month + 1, day)
      };
    }
    return { day: dayIndex, monthOffset: 0, date: new Date(year, month, dayIndex) };
  });
};

type Props = {
  meetings: Meeting[];
  onCreateMeeting: (meeting: { title: string; startsAt: string; durationMin: number }) => void;
  onUpdateMeeting: (meeting: { id: string; title: string; startsAt: string; durationMin: number }) => void;
  onDeleteMeeting: (id: string) => void;
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function CalendarView({ meetings, onCreateMeeting, onUpdateMeeting, onDeleteMeeting }: Props) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('10:00');
  const [durationMin, setDurationMin] = useState(30);
  const [editingId, setEditingId] = useState<string | null>(null);
  const cells = buildCalendar(currentMonth);
  const monthLabel = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    meetings.forEach((meeting) => {
      const dateKey = toDateKey(new Date(meeting.startsAt));
      const list = map.get(dateKey) ?? [];
      list.push(meeting);
      map.set(dateKey, list);
    });
    return map;
  }, [meetings]);

  const { year, month, day } = useMemo(() => parseDateKey(selectedDate), [selectedDate]);

  const handleCreate = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const parsed = parseTimeLabel(time) ?? { hour: 10, minute: 0 };
    const startsAt = new Date(year, month - 1, day, parsed.hour, parsed.minute);
    const payload = {
      title: trimmedTitle,
      startsAt: startsAt.toISOString(),
      durationMin
    };
    if (editingId) {
      onUpdateMeeting({ id: editingId, ...payload });
    } else {
      onCreateMeeting(payload);
    }
    setTitle('');
    setEditingId(null);
  };

  const selectedMeetings = useMemo(() => {
    const items = eventsByDate.get(selectedDate) ?? [];
    return items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [eventsByDate, selectedDate]);

  const startEdit = (meeting: Meeting) => {
    setEditingId(meeting.id);
    setTitle(meeting.title);
    const start = new Date(meeting.startsAt);
    setSelectedDate(toDateKey(start));
    setTime(formatTimeLabel(`${start.getHours()}:${start.getMinutes()}`));
    setDurationMin(meeting.durationMin);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setTitle('');
  };

  return (
    <div className="calendar">
      <div className="calendar-header">
        <div className="calendar-title">{monthLabel}</div>
        <div className="calendar-controls">
          <button
            className="calendar-btn"
            onClick={() =>
              setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
            }
          >
            ‹
          </button>
          <button className="calendar-btn" onClick={() => setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
            Сегодня
          </button>
          <button
            className="calendar-btn"
            onClick={() =>
              setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
            }
          >
            ›
          </button>
        </div>
      </div>
      <div className="calendar-form">
        <div className="calendar-form-title">{editingId ? 'Редактировать встречу' : 'Новая встреча'}</div>
        <div className="calendar-form-row">
          <input
            type="text"
            placeholder="Название"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
          <input
            type="time"
            value={time}
            step={900}
            onChange={(event) => setTime(event.target.value)}
          />
          <select value={durationMin} onChange={(event) => setDurationMin(Number(event.target.value))}>
            {[15, 30, 45, 60, 90, 120].map((value) => (
              <option key={value} value={value}>
                {value} мин
              </option>
            ))}
            <option value={0}>Без лимита</option>
          </select>
          <button onClick={handleCreate} disabled={!title.trim()}>
            {editingId ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId && (
            <button className="ghost" onClick={cancelEdit}>
              Отмена
            </button>
          )}
        </div>
      </div>
      <div className="calendar-content">
        <div className="calendar-main">
          <div className="calendar-weekdays">
            {WEEK_DAYS.map((day) => (
              <div key={day} className="calendar-weekday">
                {day}
              </div>
            ))}
          </div>
          <div className="calendar-grid">
            {cells.slice(0, 35).map((cell, idx) => {
              const isToday = toDateKey(cell.date) === toDateKey(today);
              const dateKey = toDateKey(cell.date);
              const events = (eventsByDate.get(dateKey) ?? []).sort(
                (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
              );
              const visibleEvents = events.slice(0, 2);
              const overflow = events.length - visibleEvents.length;
              return (
                <div
                  key={`${cell.day}-${idx}`}
                  className={`calendar-cell ${cell.monthOffset !== 0 ? 'muted' : ''} ${isToday ? 'today' : ''} ${
                    dateKey === selectedDate ? 'selected' : ''
                  }`}
                  onClick={() => setSelectedDate(dateKey)}
                >
                  <div className="calendar-cell-day">{cell.day}</div>
                  {visibleEvents.map((event) => (
                    <div key={event.id} className="calendar-event">
                      <span className="calendar-event-time">{formatTime(new Date(event.startsAt))}</span>
                      <span className="calendar-event-title">{event.title}</span>
                    </div>
                  ))}
                  {overflow > 0 && <div className="calendar-event more">+{overflow}</div>}
                </div>
              );
            })}
          </div>
        </div>
        <aside className="calendar-sidebar">
          <div className="calendar-list">
            <div className="calendar-list-title">Встречи на {formatDateLabel(selectedDate)}</div>
            <div className="calendar-timeline">
              <div className="calendar-timeline-labels">
                {Array.from({ length: 13 }, (_, idx) => idx * 2).map((hour) => (
                  <div key={hour} className="calendar-timeline-label">
                    {String(hour).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              <div className="calendar-timeline-grid">
                {Array.from({ length: 13 }, (_, idx) => idx * 2).map((hour) => (
                  <div
                    key={hour}
                    className="calendar-timeline-line"
                    style={{ top: `${(hour / 24) * 100}%` }}
                  />
                ))}
                {selectedMeetings.map((meeting) => {
                  const start = new Date(meeting.startsAt);
                  const minutesFromStart = start.getHours() * 60 + start.getMinutes();
                  const duration = meeting.durationMin === 0 ? 1440 - minutesFromStart : meeting.durationMin;
                  const top = (minutesFromStart / 1440) * 100;
                  const height = Math.max((duration / 1440) * 100, 4);
                  return (
                    <div
                      key={meeting.id}
                      className="calendar-timeline-event"
                      style={{ top: `${top}%`, height: `${height}%` }}
                    >
                      <div className="calendar-timeline-event-time">{formatTime(start)}</div>
                      <div className="calendar-timeline-event-title">{meeting.title}</div>
                      <div className="calendar-timeline-event-actions">
                        <button className="ghost" onClick={() => startEdit(meeting)}>
                          Изменить
                        </button>
                        <button className="danger" onClick={() => onDeleteMeeting(meeting.id)}>
                          Удалить
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
