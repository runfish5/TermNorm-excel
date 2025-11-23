/**
 * Async Utilities - Reusable async helper functions
 *
 * Generic utilities for async operations like delays and retry logic.
 * These are domain-agnostic and can be used throughout the application.
 */

/**
 * Sleep for a specified duration
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>} Promise that resolves after the delay
 *
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 *
 * @param {Function} fn - Async function to retry (should return boolean or truthy value for success)
 * @param {Object} options - Retry configuration
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number[]} options.delays - Delay in ms between attempts (default: [1000, 2000, 4000])
 * @param {Function} [options.onRetry] - Optional callback called before each retry: (attempt, delay) => void
 * @param {Function} [options.onFailure] - Optional callback called after all retries fail
 * @returns {Promise<boolean>} True if function succeeded, false if all retries exhausted
 *
 * @example
 * const success = await retryWithBackoff(
 *   async () => await initializeSession(),
 *   {
 *     maxAttempts: 3,
 *     delays: [1000, 2000, 4000],
 *     onRetry: (attempt, delay) => console.log(`Retry ${attempt} in ${delay}ms`)
 *   }
 * );
 */
export async function retryWithBackoff(fn, options = {}) {
  const { maxAttempts = 3, delays = [1000, 2000, 4000], onRetry = null, onFailure = null } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fn();

    // Check for success (truthy value or true)
    if (result) {
      return true;
    }

    // Don't sleep after last attempt
    if (attempt < maxAttempts) {
      const delay = delays[attempt - 1] || delays[delays.length - 1];

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt, delay);
      }

      await sleep(delay);
    }
  }

  // All retries exhausted
  if (onFailure) {
    onFailure(maxAttempts);
  }

  return false;
}
