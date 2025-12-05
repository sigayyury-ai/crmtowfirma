const { google } = require('googleapis');
const logger = require('../../utils/logger');

class GoogleCalendarService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    this.refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    this.calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();
    this.timezone = process.env.GOOGLE_TIMEZONE?.trim() || 'Europe/Warsaw';
    
    if (!this.clientId || !this.clientSecret || !this.refreshToken || !this.calendarId) {
      logger.warn('Google Calendar credentials not fully configured', {
        hasClientId: !!this.clientId,
        hasClientSecret: !!this.clientSecret,
        hasRefreshToken: !!this.refreshToken,
        hasCalendarId: !!this.calendarId
      });
    }
    
    this.oauth2Client = null;
    this.calendar = null;
    this.accessToken = null;
    this.tokenExpiry = null;
    
    this._initializeOAuthClient();
  }
  
  /**
   * Initialize OAuth2 client
   */
  _initializeOAuthClient() {
    try {
      this.oauth2Client = new google.auth.OAuth2(
        this.clientId,
        this.clientSecret,
        'urn:ietf:wg:oauth:2.0:oob' // Redirect URI for installed apps
      );
      
      // Set refresh token if available
      if (this.refreshToken) {
        this.oauth2Client.setCredentials({
          refresh_token: this.refreshToken
        });
      }
      
      logger.info('Google Calendar OAuth2 client initialized', {
        hasClientId: !!this.clientId,
        hasRefreshToken: !!this.refreshToken,
        calendarId: this.calendarId,
        timezone: this.timezone
      });
    } catch (error) {
      logger.error('Error initializing Google Calendar OAuth2 client:', error);
    }
  }
  
  /**
   * Check if service is properly configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(
      this.clientId &&
      this.clientSecret &&
      this.refreshToken &&
      this.calendarId &&
      this.oauth2Client
    );
  }
  
  /**
   * Refresh access token if needed
   * @returns {Promise<boolean>}
   */
  async refreshAccessTokenIfNeeded() {
    try {
      if (!this.isConfigured()) {
        logger.warn('Google Calendar not configured, cannot refresh token');
        return false;
      }
      
      // Check if token is expired or will expire in next 5 minutes
      const now = Date.now();
      if (this.tokenExpiry && now < this.tokenExpiry - 5 * 60 * 1000) {
        logger.debug('Google Calendar access token still valid');
        return true;
      }
      
      logger.info('Refreshing Google Calendar access token');
      
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      
      this.oauth2Client.setCredentials(credentials);
      this.accessToken = credentials.access_token;
      
      // Token expires in 1 hour (3600 seconds)
      const expiresIn = credentials.expiry_date 
        ? credentials.expiry_date 
        : Date.now() + (credentials.expires_in || 3600) * 1000;
      this.tokenExpiry = expiresIn;
      
      // Initialize calendar client
      this.calendar = google.calendar({
        version: 'v3',
        auth: this.oauth2Client
      });
      
      logger.info('Google Calendar access token refreshed successfully', {
        expiresAt: new Date(this.tokenExpiry).toISOString()
      });
      
      return true;
    } catch (error) {
      logger.error('Error refreshing Google Calendar access token:', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }
  
  /**
   * Get calendar client (refresh token if needed)
   * @returns {Promise<Object>} - Google Calendar API client
   */
  async getCalendarClient() {
    const refreshed = await this.refreshAccessTokenIfNeeded();
    if (!refreshed) {
      throw new Error('Failed to refresh Google Calendar access token');
    }
    return this.calendar;
  }
  
  /**
   * List calendar events within time range
   * @param {string} timeMin - ISO 8601 datetime (e.g., '2025-01-27T00:00:00+01:00')
   * @param {string} timeMax - ISO 8601 datetime (e.g., '2025-02-27T23:59:59+01:00')
   * @returns {Promise<Array>} - Array of calendar events
   */
  async listCalendarEvents(timeMin, timeMax) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Google Calendar not configured');
      }
      
      const calendar = await this.getCalendarClient();
      
      logger.info('Fetching calendar events', {
        calendarId: this.calendarId,
        timeMin,
        timeMax,
        timezone: this.timezone
      });
      
      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: this.timezone,
        maxResults: 250
      });
      
      const events = response.data.items || [];
      
      logger.info('Calendar events fetched successfully', {
        eventCount: events.length,
        calendarId: this.calendarId
      });
      
      return events;
    } catch (error) {
      logger.error('Error listing calendar events:', {
        error: error.message,
        calendarId: this.calendarId,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Extract Google Meet link from event
   * Checks both conferenceData.entryPoints[0].uri (modern) and hangoutLink (legacy)
   * @param {Object} event - Google Calendar event object
   * @returns {string|null} - Google Meet link or null
   */
  extractGoogleMeetLink(event) {
    try {
      // Modern way: conferenceData.entryPoints
      if (event.conferenceData?.entryPoints?.length > 0) {
        const videoEntry = event.conferenceData.entryPoints.find(
          ep => ep.entryPointType === 'video'
        );
        if (videoEntry?.uri) {
          return videoEntry.uri;
        }
      }
      
      // Legacy way: hangoutLink
      if (event.hangoutLink) {
        return event.hangoutLink;
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting Google Meet link:', {
        error: error.message,
        eventId: event.id
      });
      return null;
    }
  }
  
  /**
   * Extract client email addresses from event attendees
   * Filters out organizer and internal emails (e.g., @comoon.io)
   * @param {Object} event - Google Calendar event object
   * @returns {Array<string>} - Array of client email addresses
   */
  extractClientEmails(event) {
    try {
      if (!event.attendees || event.attendees.length === 0) {
        return [];
      }
      
      const clientEmails = [];
      const internalEmailPatterns = [
        /@comoon\.io$/i,
        /@comoon\.pl$/i
      ];
      
      for (const attendee of event.attendees) {
        // Skip if no email
        if (!attendee.email) {
          continue;
        }
        
        // Skip organizer
        if (attendee.organizer === true) {
          continue;
        }
        
        // Skip internal emails
        const isInternal = internalEmailPatterns.some(pattern => 
          pattern.test(attendee.email)
        );
        if (isInternal) {
          continue;
        }
        
        clientEmails.push(attendee.email);
      }
      
      return clientEmails;
    } catch (error) {
      logger.error('Error extracting client emails:', {
        error: error.message,
        eventId: event.id
      });
      return [];
    }
  }
  
  /**
   * Filter events to only include valid Google Meet events
   * @param {Array<Object>} events - Array of calendar events
   * @returns {Array<Object>} - Filtered events with Google Meet links and client emails
   */
  filterGoogleMeetEvents(events) {
    try {
      const now = new Date();
      const validEvents = [];
      
      for (const event of events) {
        // Skip all-day events (no dateTime)
        if (!event.start?.dateTime) {
          logger.debug('Skipping all-day event', { eventId: event.id });
          continue;
        }
        
        // Skip cancelled events
        if (event.status === 'cancelled') {
          logger.debug('Skipping cancelled event', { eventId: event.id });
          continue;
        }
        
        // Check for Google Meet link
        const meetLink = this.extractGoogleMeetLink(event);
        if (!meetLink) {
          logger.debug('Skipping event without Google Meet link', { eventId: event.id });
          continue;
        }
        
        // Extract client emails
        const clientEmails = this.extractClientEmails(event);
        if (clientEmails.length === 0) {
          logger.debug('Skipping event without client attendees', { eventId: event.id });
          continue;
        }
        
        // Check if event is in the past
        const eventStart = new Date(event.start.dateTime);
        if (eventStart < now) {
          logger.debug('Skipping past event', { 
            eventId: event.id,
            eventStart: eventStart.toISOString()
          });
          continue;
        }
        
        // Check if event is too soon (less than 30 minutes away)
        const minutesUntilEvent = (eventStart - now) / (1000 * 60);
        if (minutesUntilEvent < 30) {
          logger.debug('Skipping event too soon (less than 30 minutes)', {
            eventId: event.id,
            minutesUntilEvent: Math.round(minutesUntilEvent)
          });
          continue;
        }
        
        validEvents.push({
          event,
          meetLink,
          clientEmails,
          eventStart,
          eventEnd: event.end?.dateTime ? new Date(event.end.dateTime) : null,
          eventTimezone: event.start.timeZone || this.timezone
        });
      }
      
      logger.info('Filtered Google Meet events', {
        totalEvents: events.length,
        validEvents: validEvents.length
      });
      
      return validEvents;
    } catch (error) {
      logger.error('Error filtering Google Meet events:', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }
}

module.exports = GoogleCalendarService;

