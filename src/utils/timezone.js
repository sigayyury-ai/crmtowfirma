const logger = require('./logger');

/**
 * Convert datetime to client timezone
 * @param {Date|string} dateTime - Date object or ISO string
 * @param {string} fromTimezone - Source timezone (IANA, e.g., 'Europe/Warsaw')
 * @param {string} toTimezone - Target timezone (IANA, e.g., 'America/New_York')
 * @returns {Date} - Date object in target timezone
 */
function convertToClientTimezone(dateTime, fromTimezone, toTimezone) {
  try {
    const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
    
    if (!toTimezone || toTimezone === fromTimezone) {
      return date;
    }
    
    // Simplified timezone conversion
    // The date object represents a moment in time (UTC)
    // We need to interpret it in the target timezone for display/scheduling
    // For accurate conversion, we calculate the offset difference
    
    // Get UTC time
    const utcTime = date.getTime();
    
    // Get offset for source timezone (in minutes)
    const sourceOffset = getTimezoneOffset(date, fromTimezone);
    
    // Get offset for target timezone (in minutes)
    const targetOffset = getTimezoneOffset(date, toTimezone);
    
    // Calculate difference
    const offsetDiff = targetOffset - sourceOffset;
    
    // Adjust time by offset difference
    const adjustedDate = new Date(utcTime + offsetDiff * 60 * 1000);
    
    logger.debug('Timezone conversion', {
      from: fromTimezone,
      to: toTimezone,
      original: date.toISOString(),
      converted: adjustedDate.toISOString(),
      offsetDiffMinutes: offsetDiff
    });
    
    return adjustedDate;
  } catch (error) {
    logger.error('Error converting timezone:', {
      error: error.message,
      fromTimezone,
      toTimezone
    });
    // Return original date on error
    return typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
  }
}

/**
 * Get timezone offset in minutes for a given date and timezone
 * @param {Date} date - Date object
 * @param {string} timezone - IANA timezone
 * @returns {number} - Offset in minutes
 */
function getTimezoneOffset(date, timezone) {
  try {
    // Create formatter for the timezone
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    });
    
    const parts = formatter.formatToParts(date);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    
    if (offsetPart) {
      // Extract offset from string like "GMT+01:00" or "GMT-05:00"
      const match = offsetPart.value.match(/GMT([+-])(\d{2}):(\d{2})/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3], 10);
        return sign * (hours * 60 + minutes);
      }
    }
    
    // Fallback: use UTC offset
    return -date.getTimezoneOffset();
  } catch (error) {
    logger.warn('Could not determine timezone offset, using UTC', {
      timezone,
      error: error.message
    });
    return -date.getTimezoneOffset();
  }
}

/**
 * Get timezone offset string (simplified - for production use proper library)
 * @param {string} timezone - IANA timezone
 * @returns {string} - Offset string (e.g., '+01:00')
 */
function getTimezoneOffsetString(timezone) {
  // This is a simplified implementation
  // For production, use a library like date-fns-tz or moment-timezone
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    });
    
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    
    if (offsetPart) {
      // Extract offset from string like "GMT+01:00"
      const match = offsetPart.value.match(/([+-]\d{2}):(\d{2})/);
      if (match) {
        return match[0];
      }
    }
    
    return '+00:00'; // Default to UTC
  } catch (error) {
    logger.warn('Could not determine timezone offset, using UTC', {
      timezone,
      error: error.message
    });
    return '+00:00';
  }
}

/**
 * Calculate reminder times (30 minutes and 5 minutes before meeting)
 * @param {Date} meetingTime - Meeting start time
 * @param {string} timezone - Timezone for calculations
 * @returns {Object} - Object with reminder30Min and reminder5Min dates
 */
function calculateReminderTimes(meetingTime, timezone) {
  try {
    const meeting = typeof meetingTime === 'string' ? new Date(meetingTime) : meetingTime;
    
    const reminder30Min = new Date(meeting.getTime() - 30 * 60 * 1000);
    const reminder5Min = new Date(meeting.getTime() - 5 * 60 * 1000);
    
    return {
      reminder30Min,
      reminder5Min,
      meetingTime: meeting
    };
  } catch (error) {
    logger.error('Error calculating reminder times:', {
      error: error.message,
      meetingTime,
      timezone
    });
    throw error;
  }
}

/**
 * Format date for display in specific timezone
 * @param {Date} date - Date object
 * @param {string} timezone - IANA timezone
 * @returns {string} - Formatted date string
 */
function formatDateInTimezone(date, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  } catch (error) {
    logger.error('Error formatting date in timezone:', {
      error: error.message,
      timezone
    });
    return date.toISOString();
  }
}

module.exports = {
  convertToClientTimezone,
  calculateReminderTimes,
  formatDateInTimezone,
  getTimezoneOffsetString
};

