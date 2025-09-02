// utils/errorUtils.js

/**
 * Format error message consistently
 * @param {Error|string} error - Error object or message
 * @param {string} context - Optional context for the error
 * @returns {string} Formatted error message
 */
export function formatErrorMessage(error, context = "") {
  const message = error instanceof Error ? error.message : String(error);
  return context ? `${context}: ${message}` : `Error: ${message}`;
}

/**
 * Format API error with provider context
 * @param {number} status - HTTP status code
 * @param {string} statusText - HTTP status text
 * @param {string} provider - LLM provider info
 * @param {string} endpoint - API endpoint
 * @returns {Object} Formatted error information
 */
export function formatApiError(status, statusText, provider = "Unknown Provider", endpoint = "") {
  const isAuthError = status === 401;
  const message = isAuthError 
    ? "❌ API key invalid - check your key"
    : `❌ API Error: ${status} ${statusText} (${provider})`;
    
  const logMessage = `[${provider}] ${isAuthError ? 'API Key Error: 401 Unauthorized' : `API Error: ${status} ${statusText}`}${endpoint ? ` - Endpoint: ${endpoint}` : ''}`;
  
  return { message, logMessage, isAuthError };
}

/**
 * Format connection error consistently
 * @param {Error} error - Network/connection error
 * @returns {string} User-friendly error message
 */
export function formatConnectionError(error) {
  if (error.name === "AbortError") {
    return "Backend server timeout - ensure server is running on port 8000";
  }
  
  if (error.message.includes("fetch") || error.message.includes("Failed to fetch")) {
    return "Backend server not accessible - ensure server is running on port 8000";
  }
  
  return `❌ Connection failed: ${error.message}`;
}