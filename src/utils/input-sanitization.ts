
/**
 * Basic input sanitization utilities
 */

/**
 * Sanitize text input by removing potentially harmful characters
 */
export const sanitizeText = (input: string): string => {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .slice(0, 1000); // Limit length
};

/**
 * Sanitize email input
 */
export const sanitizeEmail = (email: string): string => {
  if (!email || typeof email !== 'string') return '';
  
  return email
    .toLowerCase()
    .trim()
    .replace(/[^\w@.-]/g, '') // Only allow word chars, @, ., -
    .slice(0, 254); // RFC 5321 limit
};

/**
 * Sanitize phone number input
 */
export const sanitizePhone = (phone: string): string => {
  if (!phone || typeof phone !== 'string') return '';
  
  return phone
    .trim()
    .replace(/[^\d\s\-\+\(\)]/g, '') // Only allow digits, spaces, dashes, plus, parentheses
    .slice(0, 20);
};

/**
 * Check if honeypot field was filled (indicates spam)
 */
export const isSpamSubmission = (honeypotValue: string): boolean => {
  return honeypotValue.trim().length > 0;
};
