const GoogleCalendarService = require('./googleCalendarService');
const PipedriveClient = require('../pipedrive');
const SendPulseClient = require('../sendpulse');
const { calculateReminderTimes, convertToClientTimezone } = require('../../utils/timezone');
const { normalizePhoneNumberWithCountry, isValidE164 } = require('../../utils/phoneNumber');
const logger = require('../../utils/logger');
const { randomUUID } = require('crypto');
const supabase = require('../supabaseClient');

/**
 * Service for managing Google Meet reminder notifications via SendPulse
 * Scans Google Calendar daily, creates reminder tasks, and sends notifications
 */
class GoogleMeetReminderService {
  constructor(options = {}) {
    this.calendarService = options.calendarService || new GoogleCalendarService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.logger = options.logger || logger;
    this.supabase = options.supabase || supabase;
    
    // In-memory cache for quick access (опционально, для производительности)
    // Основное хранилище - Supabase
    this.reminderTasksCache = new Map();
    
    // Cache for sent reminders to prevent duplicates
    this.sentCache = new Set();
    
    // SendPulse ID field key in Pipedrive
    this.SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
    
    // Initialize SendPulse client
    try {
      this.sendpulseClient = options.sendpulseClient || new SendPulseClient();
    } catch (error) {
      this.logger.warn('SendPulse not available, reminders will be skipped', { error: error.message });
      this.sendpulseClient = null;
    }
    
    // Load pending tasks from database on startup
    this.loadPendingTasksFromDatabase().catch((error) => {
      this.logger.error('Failed to load pending tasks from database on startup', { error: error.message });
    });
  }
  
  /**
   * Generate unique task ID
   * @param {string} eventId - Google Calendar event ID
   * @param {string} clientEmail - Client email
   * @param {string} reminderType - '30min' or '5min'
   * @returns {string} - Unique task ID
   */
  generateTaskId(eventId, clientEmail, reminderType) {
    return `${eventId}:${clientEmail}:${reminderType}`;
  }
  
  /**
   * Generate cache key for sent reminders
   * @param {string} eventId - Google Calendar event ID
   * @param {string} clientEmail - Client email
   * @param {string} reminderType - '30min' or '5min'
   * @returns {string} - Cache key
   */
  getReminderCacheKey(eventId, clientEmail, reminderType) {
    return `${eventId}:${clientEmail}:${reminderType}`;
  }
  
  /**
   * Check if reminder was already sent
   * @param {string} eventId - Google Calendar event ID
   * @param {string} clientEmail - Client email
   * @param {string} reminderType - '30min' or '5min'
   * @returns {boolean}
   */
  wasReminderSent(eventId, clientEmail, reminderType) {
    const cacheKey = this.getReminderCacheKey(eventId, clientEmail, reminderType);
    return this.sentCache.has(cacheKey);
  }
  
  /**
   * Mark reminder as sent
   * @param {string} eventId - Google Calendar event ID
   * @param {string} clientEmail - Client email
   * @param {string} reminderType - '30min' or '5min'
   */
  markReminderSent(eventId, clientEmail, reminderType) {
    const cacheKey = this.getReminderCacheKey(eventId, clientEmail, reminderType);
    this.sentCache.add(cacheKey);
  }
  
  /**
   * Find person in Pipedrive by email
   * @param {string} email - Email address
   * @returns {Promise<Object|null>} - Person object or null
   */
  async findPersonByEmail(email) {
    try {
      this.logger.debug('Searching for person in Pipedrive', { email });
      
      // Optimized: Try to get person with SendPulse ID in one request
      // First, search for person by email (exact match, limit 1)
      const searchResult = await this.pipedriveClient.searchPersons(email, {
        exactMatch: true,
        limit: 1,
        fields: 'name,email'
      });
      
      if (searchResult.success && searchResult.persons?.length > 0) {
        const personId = searchResult.persons[0].id;
        
        // Get person data with SendPulse ID field, phone, country and address (for country) using getPerson
        // This is necessary because searchPersons doesn't return custom fields
        const personResult = await this.pipedriveClient.getPerson(personId, {
          fields: `${this.SENDPULSE_ID_FIELD_KEY},phone,country,address`
        });
        
        if (personResult.success && personResult.person) {
          const person = personResult.person;
          this.logger.info('Person found in Pipedrive', {
            personId: person.id,
            email,
            hasSendpulseId: !!person[this.SENDPULSE_ID_FIELD_KEY]
          });
          return person;
        }
      }
      
      this.logger.warn('Person not found in Pipedrive', { email });
      return null;
    } catch (error) {
      this.logger.error('Error finding person in Pipedrive', {
        email,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Get SendPulse ID from person
   * @param {Object} person - Pipedrive person object
   * @returns {string|null} - SendPulse ID or null
   */
  getSendpulseIdFromPerson(person) {
    if (!person) {
      return null;
    }
    
    const sendpulseId = person[this.SENDPULSE_ID_FIELD_KEY];
    if (!sendpulseId || String(sendpulseId).trim() === '') {
      return null;
    }
    
    return String(sendpulseId).trim();
  }
  
  /**
   * Get phone number from person with proper normalization
   * @param {Object} person - Pipedrive person object
   * @returns {string|null} - Phone number in E.164 format or null
   */
  getPhoneNumberFromPerson(person) {
    if (!person) {
      return null;
    }
    
    // Pipedrive может хранить телефоны в разных форматах
    // Проверяем поле phone (может быть массивом или объектом)
    let phones = [];
    
    if (person.phone) {
      if (Array.isArray(person.phone)) {
        phones = person.phone;
      } else if (typeof person.phone === 'object') {
        phones = [person.phone];
      } else {
        phones = [{ value: person.phone }];
      }
    }
    
    // Ищем первый валидный номер телефона
    for (const phone of phones) {
      const phoneValue = phone?.value || phone;
      if (phoneValue && typeof phoneValue === 'string') {
        // Используем нормализацию с учетом страны из person
        const normalized = normalizePhoneNumberWithCountry(phoneValue, person);
        
        if (normalized && isValidE164(normalized)) {
          this.logger.debug('Phone number normalized successfully', {
            original: phoneValue,
            normalized: normalized,
            personId: person.id
          });
          return normalized;
        } else {
          this.logger.warn('Phone number normalization failed', {
            original: phoneValue,
            personId: person.id,
            reason: normalized ? 'Invalid E.164 format' : 'Normalization failed'
          });
        }
      }
    }
    
    return null;
  }
  
  /**
   * Get client timezone from Pipedrive person
   * @param {Object} person - Pipedrive person object
   * @returns {string|null} - IANA timezone or null
   */
  getClientTimezone(person) {
    // TODO: Implement timezone extraction from Pipedrive person
    // For now, return null to use calendar timezone as fallback
    // This can be extended to check person location or custom fields
    return null;
  }
  
  /**
   * Load pending tasks from database on startup
   * @returns {Promise<void>}
   */
  async loadPendingTasksFromDatabase() {
    if (!this.supabase) {
      this.logger.warn('Supabase not available, skipping task loading from database');
      return;
    }

    try {
      const { data, error } = await this.supabase
        .from('google_meet_reminders')
        .select('*')
        .eq('sent', false)
        .gte('scheduled_time', new Date().toISOString())
        .order('scheduled_time', { ascending: true });

      if (error) {
        this.logger.error('Error loading pending tasks from database', { error: error.message });
        return;
      }

      if (data && data.length > 0) {
        // Загружаем задачи в кэш для быстрого доступа
        for (const task of data) {
          // Конвертируем даты из строк в Date объекты
          const taskObj = {
            ...task,
            meetingTime: new Date(task.meeting_time),
            scheduledTime: new Date(task.scheduled_time),
            createdAt: new Date(task.created_at)
          };
          this.reminderTasksCache.set(task.task_id, taskObj);
        }

        this.logger.info('Loaded pending tasks from database', {
          count: data.length,
          cacheSize: this.reminderTasksCache.size
        });
      } else {
        this.logger.info('No pending tasks found in database');
      }
    } catch (error) {
      this.logger.error('Error loading pending tasks from database', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Save reminder task to database
   * @param {Object} task - Task object
   * @returns {Promise<boolean>} - Success status
   */
  async saveTaskToDatabase(task) {
    if (!this.supabase) {
      this.logger.warn('Supabase not available, task will not be persisted', { taskId: task.taskId });
      return false;
    }

    try {
      const payload = {
        task_id: task.taskId,
        event_id: task.eventId,
        event_summary: task.eventSummary,
        client_email: task.clientEmail,
        sendpulse_id: task.sendpulseId || null,
        phone_number: task.phoneNumber || null,
        contact_type: task.contactType,
        meet_link: task.meetLink,
        meeting_time: task.meetingTime.toISOString(),
        reminder_type: task.reminderType,
        scheduled_time: task.scheduledTime.toISOString(),
        sent: task.sent || false,
        sent_at: task.sentAt ? task.sentAt.toISOString() : null,
        created_at: task.createdAt.toISOString()
      };

      const { error } = await this.supabase
        .from('google_meet_reminders')
        .upsert(payload, { onConflict: 'task_id' });

      if (error) {
        // Игнорируем ошибку дубликата (задача уже существует)
        if (error.code === '23505') {
          this.logger.debug('Task already exists in database', { taskId: task.taskId });
          return true;
        }
        this.logger.error('Error saving task to database', {
          error: error.message,
          taskId: task.taskId
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Error saving task to database', {
        error: error.message,
        taskId: task.taskId
      });
      return false;
    }
  }

  /**
   * Create reminder tasks for a Google Meet event
   * @param {Object} eventData - Event data from filterGoogleMeetEvents
   * @param {string} clientEmail - Client email address
   * @param {string} contactId - SendPulse ID (для Telegram) или номер телефона (для SMS)
   * @param {string} clientTimezone - Client timezone (IANA)
   * @param {string} contactType - 'telegram' или 'sms'
   * @param {string} phoneNumber - Номер телефона (если используется SMS)
   * @returns {Promise<Array<Object>>} - Array of created reminder tasks
   */
  async createReminderTasks(eventData, clientEmail, contactId, clientTimezone, contactType = 'telegram', phoneNumber = null) {
    try {
      const { event, meetLink, eventStart, eventTimezone } = eventData;
      
      // Convert meeting time to client timezone if available
      const clientMeetingTime = clientTimezone
        ? convertToClientTimezone(eventStart, eventTimezone, clientTimezone)
        : eventStart;
      
      // Calculate reminder times
      const { reminder30Min, reminder5Min } = calculateReminderTimes(clientMeetingTime, clientTimezone || eventTimezone);
      
      const now = new Date();
      const tasks = [];
      
      // Create 30-minute reminder task
      if (reminder30Min > now) {
        const taskId30 = this.generateTaskId(event.id, clientEmail, '30min');
        const task30 = {
          taskId: taskId30,
          eventId: event.id,
          eventSummary: event.summary || 'Meeting',
          clientEmail,
          sendpulseId: contactType === 'telegram' ? contactId : null,
          phoneNumber: contactType === 'sms' ? contactId : phoneNumber,
          contactType, // 'telegram' или 'sms'
          meetLink,
          meetingTime: clientMeetingTime,
          reminderType: '30min',
          scheduledTime: reminder30Min,
          sent: false,
          createdAt: now
        };
        
        // Сохраняем в кэш и БД
        this.reminderTasksCache.set(taskId30, task30);
        const saved = await this.saveTaskToDatabase(task30);
        tasks.push(task30);
        
        this.logger.info('Created 30-minute reminder task', {
          taskId: taskId30,
          eventId: event.id,
          eventSummary: event.summary || 'Meeting',
          clientEmail,
          contactType,
          scheduledTime: reminder30Min.toISOString(),
          meetingTime: clientMeetingTime.toISOString(),
          savedToDatabase: saved,
          cacheSize: this.reminderTasksCache.size,
          hasMeetLink: !!meetLink
        });
      } else {
        this.logger.debug('Skipping 30-minute reminder (time has passed)', {
          eventId: event.id,
          clientEmail,
          reminderTime: reminder30Min.toISOString()
        });
      }
      
      // Create 5-minute reminder task
      if (reminder5Min > now) {
        const taskId5 = this.generateTaskId(event.id, clientEmail, '5min');
        const task5 = {
          taskId: taskId5,
          eventId: event.id,
          eventSummary: event.summary || 'Meeting',
          clientEmail,
          sendpulseId: contactType === 'telegram' ? contactId : null,
          phoneNumber: contactType === 'sms' ? contactId : phoneNumber,
          contactType, // 'telegram' или 'sms'
          meetLink,
          meetingTime: clientMeetingTime,
          reminderType: '5min',
          scheduledTime: reminder5Min,
          sent: false,
          createdAt: now
        };
        
        // Сохраняем в кэш и БД
        this.reminderTasksCache.set(taskId5, task5);
        const saved = await this.saveTaskToDatabase(task5);
        tasks.push(task5);
        
        this.logger.info('Created 5-minute reminder task', {
          taskId: taskId5,
          eventId: event.id,
          eventSummary: event.summary || 'Meeting',
          clientEmail,
          contactType,
          scheduledTime: reminder5Min.toISOString(),
          meetingTime: clientMeetingTime.toISOString(),
          savedToDatabase: saved,
          cacheSize: this.reminderTasksCache.size,
          hasMeetLink: !!meetLink
        });
      } else {
        this.logger.debug('Skipping 5-minute reminder (time has passed)', {
          eventId: event.id,
          clientEmail,
          reminderTime: reminder5Min.toISOString()
        });
      }
      
      return tasks;
    } catch (error) {
      this.logger.error('Error creating reminder tasks', {
        error: error.message,
        stack: error.stack,
        eventId: eventData.event.id,
        clientEmail
      });
      return [];
    }
  }
  
  /**
   * Daily calendar scan - main entry point
   * Scans calendar, finds Google Meet events, matches clients, creates reminder tasks
   * @param {Object} options - Options with trigger, runId
   * @returns {Promise<Object>} - Summary of scan results
   */
  async dailyCalendarScan(options = {}) {
    const { trigger = 'manual', runId = randomUUID() } = options;
    
    this.logger.info('Google Meet reminder calendar scan started', { trigger, runId });
    
    try {
      // Calculate time range: today to 30 days from now
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setHours(0, 0, 0, 0);
      
      const timeMax = new Date(now);
      timeMax.setDate(timeMax.getDate() + 30);
      timeMax.setHours(23, 59, 59, 999);
      
      // Format for Google Calendar API (ISO 8601)
      const timeMinStr = timeMin.toISOString();
      const timeMaxStr = timeMax.toISOString();
      
      this.logger.info('Fetching calendar events', {
        timeMin: timeMinStr,
        timeMax: timeMaxStr,
        runId
      });
      
      // Fetch events from calendar
      const events = await this.calendarService.listCalendarEvents(timeMinStr, timeMaxStr);
      
      // Filter for Google Meet events
      const meetEvents = this.calendarService.filterGoogleMeetEvents(events);
      
      this.logger.info('Processing Google Meet events', {
        totalEvents: events.length,
        meetEvents: meetEvents.length,
        runId
      });
      
      let tasksCreated = 0;
      let clientsMatched = 0;
      let clientsSkipped = 0;
      
      // Process each event
      for (const eventData of meetEvents) {
        const { event, clientEmails } = eventData;
        
        // Process each client email
        for (const clientEmail of clientEmails) {
          try {
            // Find person in Pipedrive
            const person = await this.findPersonByEmail(clientEmail);
            
            if (!person) {
              this.logger.warn('Person not found in Pipedrive, skipping reminder', {
                eventId: event.id,
                clientEmail,
                runId
              });
              clientsSkipped++;
              continue;
            }
            
            // Get SendPulse ID (для Telegram)
            const sendpulseId = this.getSendpulseIdFromPerson(person);
            
            // Get phone number (для SMS как резервный канал)
            const phoneNumber = this.getPhoneNumberFromPerson(person);
            
            // Если нет ни SendPulse ID, ни телефона - пропускаем
            if (!sendpulseId && !phoneNumber) {
              this.logger.warn('Neither SendPulse ID nor phone number found for person, skipping reminder', {
                eventId: event.id,
                clientEmail,
                personId: person.id,
                runId
              });
              clientsSkipped++;
              continue;
            }
            
            // Get client timezone
            const clientTimezone = this.getClientTimezone(person);
            
            // Create reminder tasks (используем SendPulse ID если есть, иначе phoneNumber)
            // В задаче сохраняем оба значения для возможности выбора канала
            const contactId = sendpulseId || phoneNumber;
            const contactType = sendpulseId ? 'telegram' : 'sms';
            
            const tasks = await this.createReminderTasks(eventData, clientEmail, contactId, clientTimezone, contactType, phoneNumber);
            tasksCreated += tasks.length;
            clientsMatched++;
            
            this.logger.info('Created reminder tasks for client', {
              eventId: event.id,
              clientEmail,
              contactType: sendpulseId ? 'telegram' : 'sms',
              contactId: sendpulseId || phoneNumber ? '***masked***' : null,
              tasksCount: tasks.length,
              runId
            });
          } catch (error) {
            this.logger.error('Error processing client email', {
              eventId: event.id,
              clientEmail,
              error: error.message,
              runId
            });
            clientsSkipped++;
          }
        }
      }
      
      const summary = {
        success: true,
        runId,
        trigger,
        eventsScanned: events.length,
        meetEventsFound: meetEvents.length,
        tasksCreated,
        clientsMatched,
        clientsSkipped,
        totalReminderTasks: this.reminderTasksCache.size,
        queueStatus: {
          totalTasks: this.reminderTasksCache.size,
          pendingTasks: Array.from(this.reminderTasksCache.values()).filter(t => !t.sent).length,
          sentTasks: Array.from(this.reminderTasksCache.values()).filter(t => t.sent).length
        }
      };
      
      this.logger.info('Google Meet reminder calendar scan completed', summary);
      
      return summary;
    } catch (error) {
      this.logger.error('Error in daily calendar scan', {
        error: error.message,
        stack: error.stack,
        trigger,
        runId
      });
      
      return {
        success: false,
        error: error.message,
        runId,
        trigger
      };
    }
  }
  
  /**
   * Process scheduled reminders - send notifications for tasks whose time has arrived
   * Оптимизировано: загружает только задачи, которые должны быть отправлены сейчас
   * @param {Object} options - Options with trigger, runId
   * @returns {Promise<Object>} - Summary of processing results
   */
  async processScheduledReminders(options = {}) {
    const { trigger = 'manual', runId = randomUUID() } = options;
    
    this.logger.debug('Processing scheduled Google Meet reminders', { trigger, runId });
    
    try {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      // Оптимизация: загружаем только задачи, которые должны быть отправлены сейчас
      let tasksToProcess = [];
      
      if (this.supabase) {
        // Загружаем задачи из БД, которые должны быть отправлены
        const { data, error } = await this.supabase
          .from('google_meet_reminders')
          .select('*')
          .eq('sent', false)
          .lte('scheduled_time', now.toISOString())
          .gte('scheduled_time', fiveMinutesAgo.toISOString())
          .order('scheduled_time', { ascending: true });

        if (error) {
          this.logger.error('Error loading tasks from database', { error: error.message });
        } else if (data && data.length > 0) {
          // Конвертируем данные из БД в объекты задач
          tasksToProcess = data.map(task => ({
            taskId: task.task_id,
            eventId: task.event_id,
            eventSummary: task.event_summary,
            clientEmail: task.client_email,
            sendpulseId: task.sendpulse_id,
            phoneNumber: task.phone_number,
            contactType: task.contact_type,
            meetLink: task.meet_link,
            meetingTime: new Date(task.meeting_time),
            reminderType: task.reminder_type,
            scheduledTime: new Date(task.scheduled_time),
            sent: task.sent,
            createdAt: new Date(task.created_at)
          }));
        }
      } else {
        // Fallback: используем кэш, если БД недоступна
        for (const [taskId, task] of this.reminderTasksCache.entries()) {
          if (!task.sent && task.scheduledTime <= now && task.scheduledTime >= fiveMinutesAgo) {
            tasksToProcess.push(task);
          }
        }
      }
      
      this.logger.info('Found reminders to process', {
        tasksToProcess: tasksToProcess.length,
        runId
      });
      
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      
      for (const task of tasksToProcess) {
        try {
          // Check if already sent (duplicate prevention)
          if (this.wasReminderSent(task.eventId, task.clientEmail, task.reminderType)) {
            this.logger.debug('Reminder already sent, skipping', {
              taskId: task.taskId,
              runId
            });
            skipped++;
            continue;
          }
          
          // Send reminder
          const result = await this.sendReminderNotification(task);
          
          if (result.success) {
            task.sent = true;
            task.sentAt = new Date();
            this.markReminderSent(task.eventId, task.clientEmail, task.reminderType);
            
            // Обновляем в БД
            if (this.supabase) {
              await this.supabase
                .from('google_meet_reminders')
                .update({
                  sent: true,
                  sent_at: task.sentAt.toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('task_id', task.taskId);
            }
            
            // Обновляем кэш
            this.reminderTasksCache.set(task.taskId, task);
            sent++;
            
            // Подробное логирование успешной отправки
            const logData = {
              taskId: task.taskId,
              eventId: task.eventId,
              eventSummary: task.eventSummary,
              clientEmail: task.clientEmail,
              reminderType: task.reminderType,
              channel: result.channel || 'unknown',
              messageId: result.messageId || 'N/A',
              scheduledTime: task.scheduledTime.toISOString(),
              meetingTime: task.meetingTime.toISOString(),
              runId
            };
            
            // Добавляем детали в зависимости от канала
            if (result.channel === 'sms') {
              // Маскируем номер телефона для безопасности
              const phoneNumber = task.phoneNumber || task.sendpulseId || 'N/A';
              const maskedPhone = phoneNumber && phoneNumber.length > 5 
                ? `${phoneNumber.substring(0, 3)}***${phoneNumber.substring(phoneNumber.length - 2)}`
                : 'N/A';
              logData.phoneNumber = maskedPhone;
              logData.messageLength = task.reminderType === '30min' 
                ? 'Привет это COMOON у нас с тобой звонок через час. Ссылка на почте.'.length
                : `Через 5 мин: ${task.meetLink}`.length;
            } else if (result.channel === 'telegram') {
              logData.sendpulseId = task.sendpulseId ? '***masked***' : 'N/A';
            }
            
            this.logger.info('Reminder sent successfully', logData);
          } else {
            failed++;
            this.logger.error('Failed to send reminder', {
              taskId: task.taskId,
              error: result.error,
              channel: result.channel || 'unknown',
              runId
            });
          }
        } catch (error) {
          failed++;
          this.logger.error('Error processing reminder task', {
            taskId: task.taskId,
            error: error.message,
            runId
          });
        }
      }
      
      const summary = {
        success: true,
        runId,
        trigger,
        tasksProcessed: tasksToProcess.length,
        sent,
        failed,
        skipped
      };
      
      this.logger.info('Scheduled reminders processing completed', summary);
      
      return summary;
    } catch (error) {
      this.logger.error('Error processing scheduled reminders', {
        error: error.message,
        stack: error.stack,
        trigger,
        runId
      });
      
      return {
        success: false,
        error: error.message,
        runId,
        trigger
      };
    }
  }
  
  /**
   * Send reminder notification via SendPulse
   * @param {Object} task - Reminder task object
   * @returns {Promise<Object>} - Result of sending
   */
  async sendReminderNotification(task) {
    try {
      if (!this.sendpulseClient) {
        return {
          success: false,
          error: 'SendPulse client not available'
        };
      }
      
      // Определяем канал отправки: Telegram (SendPulse ID) или SMS (номер телефона)
      const contactType = task.contactType || (task.sendpulseId ? 'telegram' : 'sms');
      
      // Format meeting time for message
      const meetingDate = task.meetingTime.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const meetingTime = task.meetingTime.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: task.meetingTime.getTimezoneOffset() ? undefined : 'Europe/Warsaw'
      });
      
      // Create message based on reminder type and channel
      let message;
      
      if (contactType === 'sms') {
        // SMS версии - короткие, без эмодзи (для экономии символов)
        // Лимит: 70 символов для кириллицы, 160 для латиницы
        if (task.reminderType === '30min') {
          // 30-минутное напоминание без ссылки (ссылка будет в 5-минутном)
          message = `Привет это COMOON у нас с тобой звонок через час. Ссылка на почте.`;
        } else {
          // 5-minute reminder - с ссылкой (последнее напоминание перед встречей)
          message = `Через 5 мин: ${task.meetLink}`;
        }
      } else {
        // Telegram версии - полные с эмодзи
        if (task.reminderType === '30min') {
          message = `Привет это COMOON у нас с тобой звонок через час. Ссылка на почте.

🔗 Ссылка на встречу: ${task.meetLink}`;
        } else {
          // 5-minute reminder - shorter and more urgent
          message = `Встреча через 5 минут!

Ссылка: ${task.meetLink}

До встречи осталось 5 минут. Ждем вас!`;
        }
      }
      
      let result;
      
      if (contactType === 'telegram' && task.sendpulseId) {
        // Отправка через Telegram (SendPulse ID)
        result = await this.sendpulseClient.sendTelegramMessage(
          task.sendpulseId,
          message
        );
      } else if (contactType === 'sms' && (task.phoneNumber || task.sendpulseId)) {
        // Отправка через SMS (номер телефона)
        // Используем phoneNumber если есть, иначе sendpulseId (который в этом случае содержит номер)
        const phoneNumber = task.phoneNumber || task.sendpulseId;
        result = await this.sendpulseClient.sendSMS(
          phoneNumber,
          message
        );
      } else {
        return {
          success: false,
          error: 'No valid contact method (SendPulse ID or phone number)'
        };
      }
      
      if (result.success) {
        return {
          success: true,
          messageId: result.messageId,
          channel: contactType
        };
      } else {
        return {
          success: false,
          error: result.error || 'Unknown error',
          channel: contactType
        };
      }
    } catch (error) {
      this.logger.error('Error sending reminder notification', {
        error: error.message,
        taskId: task.taskId
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get all upcoming reminder tasks (for monitoring/debugging)
   * @returns {Array<Object>} - Array of reminder tasks
   */
  getAllReminderTasks() {
    return Array.from(this.reminderTasksCache.values());
  }
  
  /**
   * Get reminder tasks scheduled for a specific time range
   * @param {Date} startTime - Start of time range
   * @param {Date} endTime - End of time range
   * @returns {Array<Object>} - Array of reminder tasks in range
   */
  getReminderTasksInRange(startTime, endTime) {
    const tasks = [];
    for (const task of this.reminderTasksCache.values()) {
      if (task.scheduledTime >= startTime && task.scheduledTime <= endTime) {
        tasks.push(task);
      }
    }
    return tasks.sort((a, b) => a.scheduledTime - b.scheduledTime);
  }
}

module.exports = GoogleMeetReminderService;

