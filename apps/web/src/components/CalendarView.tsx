import { useCallback, useMemo, useState } from 'react';
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
  now: Date;
  onDeleteMeeting: (id: string) => void;
  onEditMeeting: (meeting: Meeting) => void;
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function CalendarView({ meetings, now, onDeleteMeeting, onEditMeeting }: Props) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
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

  const selectedMeetings = useMemo(() => {
    const items = eventsByDate.get(selectedDate) ?? [];
    return items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [eventsByDate, selectedDate]);

  const isMeetingActive = useCallback(
    (meeting: Meeting) => {
      const start = new Date(meeting.startsAt).getTime();
      const end = meeting.durationMin === 0 ? Number.POSITIVE_INFINITY : start + meeting.durationMin * 60_000;
      const current = now.getTime();
      return current >= start && current <= end;
    },
    [now]
  );

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
                  const isActive = isMeetingActive(meeting);
                  return (
                    <div
                      key={meeting.id}
                      className="calendar-timeline-event"
                      style={{ top: `${top}%`, height: `${height}%` }}
                    >
                      <div className="calendar-timeline-event-row">
                        <div className="calendar-timeline-event-title">{meeting.title}</div>
                        <div className="calendar-timeline-event-actions">
                          <button
                            className="icon-btn"
                            onClick={() => onEditMeeting(meeting)}
                            aria-label="Редактировать"
                            title={isActive ? 'Идущую встречу нельзя редактировать' : 'Редактировать'}
                            disabled={isActive}
                          >
                            ✎
                          </button>
                          <button
                            className="icon-btn danger"
                            onClick={() => onDeleteMeeting(meeting.id)}
                            aria-label="Удалить"
                          >
                            🗑️
                          </button>
                        </div>
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
