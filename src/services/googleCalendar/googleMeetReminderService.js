const GoogleCalendarService = require('./googleCalendarService');
const PipedriveClient = require('../pipedrive');
const SendPulseClient = require('../sendpulse');
const { calculateReminderTimes, convertToClientTimezone } = require('../../utils/timezone');
const logger = require('../../utils/logger');
const { randomUUID } = require('crypto');

/**
 * Service for managing Google Meet reminder notifications via SendPulse
 * Scans Google Calendar daily, creates reminder tasks, and sends notifications
 */
class GoogleMeetReminderService {
  constructor(options = {}) {
    this.calendarService = options.calendarService || new GoogleCalendarService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.logger = options.logger || logger;
    
    // In-memory storage for reminder tasks
    // Format: Map<taskId, {meetingTime, meetLink, sendpulseId, clientEmail, reminderType, scheduledTime, sent}>
    this.reminderTasks = new Map();
    
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
        
        // Get person data with SendPulse ID field using getPerson
        // This is necessary because searchPersons doesn't return custom fields
        const personResult = await this.pipedriveClient.getPerson(personId, {
          fields: this.SENDPULSE_ID_FIELD_KEY
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
   * Get phone number from person
   * @param {Object} person - Pipedrive person object
   * @returns {string|null} - Phone number in international format or null
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
        // Нормализуем номер: убираем пробелы, дефисы, скобки
        const normalized = phoneValue.replace(/[\s\-\(\)]/g, '');
        // Проверяем, что номер начинается с + (международный формат)
        if (normalized.startsWith('+') && normalized.length >= 10) {
          return normalized;
        }
        // Если номер без +, но начинается с цифры, добавляем +
        if (/^\d/.test(normalized) && normalized.length >= 10) {
          return '+' + normalized;
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
   * Create reminder tasks for a Google Meet event
   * @param {Object} eventData - Event data from filterGoogleMeetEvents
   * @param {string} clientEmail - Client email address
   * @param {string} contactId - SendPulse ID (для Telegram) или номер телефона (для SMS)
   * @param {string} clientTimezone - Client timezone (IANA)
   * @param {string} contactType - 'telegram' или 'sms'
   * @param {string} phoneNumber - Номер телефона (если используется SMS)
   * @returns {Array<Object>} - Array of created reminder tasks
   */
  createReminderTasks(eventData, clientEmail, contactId, clientTimezone, contactType = 'telegram', phoneNumber = null) {
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
        
        this.reminderTasks.set(taskId30, task30);
        tasks.push(task30);
        
        this.logger.info('Created 30-minute reminder task', {
          taskId: taskId30,
          eventId: event.id,
          clientEmail,
          scheduledTime: reminder30Min.toISOString()
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
        
        this.reminderTasks.set(taskId5, task5);
        tasks.push(task5);
        
        this.logger.info('Created 5-minute reminder task', {
          taskId: taskId5,
          eventId: event.id,
          clientEmail,
          scheduledTime: reminder5Min.toISOString()
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
            
            const tasks = this.createReminderTasks(eventData, clientEmail, contactId, clientTimezone, contactType, phoneNumber);
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
        totalReminderTasks: this.reminderTasks.size
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
   * @param {Object} options - Options with trigger, runId
   * @returns {Promise<Object>} - Summary of processing results
   */
  async processScheduledReminders(options = {}) {
    const { trigger = 'manual', runId = randomUUID() } = options;
    
    this.logger.info('Processing scheduled Google Meet reminders', { trigger, runId });
    
    try {
      const now = new Date();
      const tasksToProcess = [];
      
      // Find tasks that are due (within last 5 minutes to account for cron timing)
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      for (const [taskId, task] of this.reminderTasks.entries()) {
        if (!task.sent && task.scheduledTime <= now && task.scheduledTime >= fiveMinutesAgo) {
          tasksToProcess.push(task);
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
            this.markReminderSent(task.eventId, task.clientEmail, task.reminderType);
            sent++;
            
            this.logger.info('Reminder sent successfully', {
              taskId: task.taskId,
              eventId: task.eventId,
              clientEmail: task.clientEmail,
              reminderType: task.reminderType,
              channel: result.channel || 'unknown',
              runId
            });
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
        if (task.reminderType === '30min') {
          // Короткая версия для SMS (до 160 символов для латиницы, ~70 для кириллицы)
          message = `Встреча через 30 мин. ${meetingDate} в ${meetingTime}. Ссылка: ${task.meetLink}`;
        } else {
          // 5-minute reminder - максимально короткая версия
          message = `Встреча через 5 мин! ${task.meetLink}`;
        }
      } else {
        // Telegram версии - полные с эмодзи
        const meetingDateFull = task.meetingTime.toLocaleDateString('ru-RU', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        if (task.reminderType === '30min') {
          message = `📅 Напоминание о встрече

Здравствуйте!

Напоминаем, что у вас запланирована встреча с нами через Google Meet.

📅 Дата: ${meetingDateFull}
⏰ Время: ${meetingTime}
🔗 Ссылка на встречу: ${task.meetLink}

До встречи осталось 30 минут. Будем рады видеть вас!`;
        } else {
          // 5-minute reminder - shorter and more urgent
          message = `⏰ Встреча через 5 минут!

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
    return Array.from(this.reminderTasks.values());
  }
  
  /**
   * Get reminder tasks scheduled for a specific time range
   * @param {Date} startTime - Start of time range
   * @param {Date} endTime - End of time range
   * @returns {Array<Object>} - Array of reminder tasks in range
   */
  getReminderTasksInRange(startTime, endTime) {
    const tasks = [];
    for (const task of this.reminderTasks.values()) {
      if (task.scheduledTime >= startTime && task.scheduledTime <= endTime) {
        tasks.push(task);
      }
    }
    return tasks.sort((a, b) => a.scheduledTime - b.scheduledTime);
  }
}

module.exports = GoogleMeetReminderService;

