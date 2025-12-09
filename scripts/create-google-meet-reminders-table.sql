-- Создание таблицы для хранения задач напоминаний Google Meet
-- Задачи создаются при ежедневном сканировании календаря и обрабатываются каждые 5 минут

CREATE TABLE IF NOT EXISTS google_meet_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT UNIQUE NOT NULL, -- Уникальный ID задачи: eventId:clientEmail:reminderType
  event_id TEXT NOT NULL, -- ID события в Google Calendar
  event_summary TEXT, -- Название события
  client_email TEXT NOT NULL, -- Email клиента
  sendpulse_id TEXT, -- SendPulse ID для Telegram (если есть)
  phone_number TEXT, -- Номер телефона для SMS (если нет SendPulse ID)
  contact_type TEXT NOT NULL CHECK (contact_type IN ('telegram', 'sms')), -- Тип контакта
  meet_link TEXT NOT NULL, -- Ссылка на Google Meet
  meeting_time TIMESTAMPTZ NOT NULL, -- Время встречи (в таймзоне клиента)
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('30min', '5min')), -- Тип напоминания
  scheduled_time TIMESTAMPTZ NOT NULL, -- Время отправки напоминания
  sent BOOLEAN DEFAULT FALSE, -- Отправлено ли напоминание
  sent_at TIMESTAMPTZ, -- Время отправки
  created_at TIMESTAMPTZ DEFAULT NOW(), -- Время создания задачи
  updated_at TIMESTAMPTZ DEFAULT NOW() -- Время последнего обновления
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_google_meet_reminders_scheduled_time ON google_meet_reminders(scheduled_time) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_google_meet_reminders_event_id ON google_meet_reminders(event_id);
CREATE INDEX IF NOT EXISTS idx_google_meet_reminders_client_email ON google_meet_reminders(client_email);
CREATE INDEX IF NOT EXISTS idx_google_meet_reminders_sent ON google_meet_reminders(sent);

-- Комментарии к таблице
COMMENT ON TABLE google_meet_reminders IS 'Задачи напоминаний о Google Meet звонках. Создаются при ежедневном сканировании календаря в 8:00, обрабатываются каждые 5 минут.';
COMMENT ON COLUMN google_meet_reminders.task_id IS 'Уникальный ID: eventId:clientEmail:reminderType';
COMMENT ON COLUMN google_meet_reminders.scheduled_time IS 'Время отправки напоминания (рассчитывается с учетом таймзоны клиента)';
COMMENT ON COLUMN google_meet_reminders.meeting_time IS 'Время встречи в таймзоне клиента';

