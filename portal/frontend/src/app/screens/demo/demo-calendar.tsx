'use client';

import { useEffect, useState } from 'react';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { DEMO_COMPANIES, type DemoPost } from '@/lib/demo-data';
import { PLATFORM_NAMES } from './demo-shared';

export function DemoCalendar({
  company,
  posts,
  showToast,
  onReschedule,
}: {
  company: string;
  posts: DemoPost[];
  showToast: (message: string) => void;
  onReschedule: (id: string, date: string, time: string) => void;
}) {
  const [view, setView] = useState('Month');
  const [month, setMonth] = useState(10);
  const [selected, setSelected] = useState<DemoPost | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [companyFilter, setCompanyFilter] = useState(company);
  const [platform, setPlatform] = useState('All platforms');
  useEffect(() => setCompanyFilter(company), [company]);
  const monthName = new Date(2026, month, 1).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  });
  const monthOffset = new Date(2026, month, 1).getDay();
  const daysInMonth = new Date(2026, month + 1, 0).getDate();
  const monthCellCount = Math.ceil((monthOffset + daysInMonth) / 7) * 7;
  const weekStart = 12 - new Date(2026, month, 12).getDay();
  const days =
    view === 'Month'
      ? Array.from({ length: monthCellCount }, (_, index) => index - monthOffset + 1)
      : view === 'Week'
        ? Array.from({ length: 7 }, (_, index) => index + weekStart)
        : [12];
  const groupView = company === 'All companies';
  const activeCompany = groupView ? companyFilter : company;
  const events = posts.filter(
    (post) =>
      (post.status === 'Scheduled' || post.status === 'Approved') &&
      (activeCompany === 'All companies' || post.company === activeCompany) &&
      (platform === 'All platforms' || post.platforms.includes(platform)),
  );
  return (
    <>
      <PageTitle
        title="Content calendar"
        description="Coordinate planned content across company channels."
        action={
          <button
            className="btn btn-primary"
            onClick={() =>
              showToast('Scheduling controls are a local demo. No post was scheduled.')
            }
          >
            ＋ Plan a post
          </button>
        }
      />
      <SectionPanel title="Publishing calendar" subtitle="Select a sample item to view its status">
        <div className="calendar-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button
              className="btn btn-outline"
              aria-label="Previous month"
              onClick={() => setMonth((value) => value - 1)}
            >
              ‹
            </button>
            <strong style={{ minWidth: 160, textAlign: 'center', fontSize: 14 }}>
              {monthName}
            </strong>
            <button
              className="btn btn-outline"
              aria-label="Next month"
              onClick={() => setMonth((value) => value + 1)}
            >
              ›
            </button>
          </div>
          <div className="heading-actions">
            {['Month', 'Week', 'Day'].map((item) => (
              <button
                key={item}
                className={`btn ${view === item ? 'btn-dark' : 'btn-outline'}`}
                aria-pressed={view === item}
                onClick={() => setView(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <select
            className="select-field"
            aria-label="Calendar company filter"
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
          >
            {(groupView ? DEMO_COMPANIES : [company]).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            className="select-field"
            aria-label="Calendar platform filter"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            <option>All platforms</option>
            {PLATFORM_NAMES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="calendar-scroll">
          <div className={`calendar-grid ${view === 'Day' ? 'calendar-grid-day' : ''}`}>
            {(view === 'Day'
              ? ['Selected day']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            ).map((day) => (
              <div className="calendar-day-label" key={day}>
                {day}
              </div>
            ))}
            {days.map((day, index) => {
              const calendarDate = new Date(2026, month, day);
              const eventsForDay = events.filter(
                (post) =>
                  Number(post.date.slice(-2)) === calendarDate.getDate() &&
                  Number(post.date.slice(5, 7)) === calendarDate.getMonth() + 1,
              );
              return (
                <div className="calendar-cell" key={`${month}-${index}`}>
                  <span
                    className="calendar-date"
                    style={{ opacity: calendarDate.getMonth() === month ? 1 : 0.35 }}
                  >
                    {calendarDate.getDate()}
                  </span>
                  {eventsForDay.map((event, eventIndex) => (
                    <button
                      className={`calendar-event ${eventIndex % 2 ? 'gold-event' : ''}`}
                      key={event.id}
                      title={`${event.time} · ${event.title}`}
                      onClick={() => {
                        setSelected(event);
                        setDate(event.date);
                        setTime(event.time);
                      }}
                    >
                      {event.time} {event.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        {selected && (
          <div className="panel" style={{ marginTop: 16, background: '#f8fbfc' }}>
            <div className="panel-header">
              <div>
                <h2>Reschedule sample post</h2>
                <p>
                  {selected.title} · {selected.company}
                </p>
              </div>
              <button className="btn btn-outline" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="grid grid-2">
              <div className="field-group">
                <label className="label" htmlFor="calendar-date">
                  New date
                </label>
                <input
                  className="field"
                  id="calendar-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="label" htmlFor="calendar-time">
                  New time
                </label>
                <input
                  className="field"
                  id="calendar-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
            </div>
            <button
              className="btn btn-primary"
              disabled={!date || !time}
              onClick={() => {
                onReschedule(selected.id, date, time);
                setSelected(null);
              }}
            >
              Save sample schedule
            </button>
          </div>
        )}
        <small className="hint">
          Calendar events and rescheduling are sample interactions only.
        </small>
      </SectionPanel>
    </>
  );
}
