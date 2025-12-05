/**
 * Retry async function with exponential backoff
 * @param {Function} fn - Async function returning truthy on success
 * @param {Object} opts - {maxAttempts, delays[], onFailure(attempts)}
 */
export async function retryWithBackoff(fn, { maxAttempts = 3, delays = [1000, 2000, 4000], onFailure } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await fn()) return true;
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, delays[i] || delays[delays.length - 1]));
    }
  }
  onFailure?.(maxAttempts);
  return false;
}
