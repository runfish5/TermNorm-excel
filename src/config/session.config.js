/**
 * Session Configuration - Centralized constants for session management
 *
 * This file contains all session-related configuration to avoid magic numbers
 * and scattered string literals across the codebase.
 */

// Session Retry Configuration
export const SESSION_RETRY = {
  MAX_ATTEMPTS: 3,
  DELAYS_MS: [1000, 2000, 4000], // Exponential backoff: 1s, 2s, 4s
};

// API Endpoints
export const SESSION_ENDPOINTS = {
  INIT: '/session/init-terms',
  RESEARCH: '/research-and-match',
};

// Logging Prefixes (for consistent console output)
export const LOG_PREFIX = {
  SESSION: '[SESSION]',
  NORMALIZER: '[NORMALIZER]',
  RECOVERY: '[RECOVERY]',
};

// Error Messages
export const ERROR_MESSAGES = {
  // Session initialization errors
  SESSION_INIT_FAILED: 'Backend session initialization failed - check server logs',
  SESSION_INIT_MAX_RETRIES: (attempts) =>
    `Failed to initialize backend session after ${attempts} attempts`,
  SESSION_REINIT_NO_TERMS: 'Cannot reinitialize - no terms available in mappings',

  // Session recovery errors
  SESSION_RECOVERY_FAILED: 'Failed to initialize backend session - LLM features unavailable',

  // User-facing error messages
  SESSION_WARNING: '⚠️ Backend session initialization failed. LLM features unavailable. Check backend logs.',
};

// HTTP Status Codes and Guidance
export const ERROR_GUIDANCE = {
  403: '💡 Check your IP is in backend-api/config/users.json',
  500: '💡 Server error - check backend-api/logs/app.log',
  SESSION_LOST: '💡 Session lost - reload mappings or wait for auto-recovery',
  OFFLINE: '💡 Run: start-server-py-LLMs.bat',
};
