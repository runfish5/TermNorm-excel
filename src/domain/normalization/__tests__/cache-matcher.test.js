/**
 * Cache Matcher Tests
 *
 * Tests for exact matching logic (first tier of three-tier pipeline)
 */

import {
  getCachedMatch,
  hasExactMatch,
  getCachedMatches,
  validateMappings,
} from '../cache-matcher.js';

describe('Cache Matcher', () => {
  // Test fixtures
  const forwardMapping = {
    'ABC Inc': 'ABC Corporation',
    'XYZ Ltd': { target: 'XYZ Company', confidence: 1.0 }, // Object format
    'DEF Group': 'DEF Holdings',
    'Spaces': 'Trimmed Value', // Test trimming (key should be normalized)
  };

  const reverseMapping = {
    'ABC Corporation': true,
    'XYZ Company': true,
    'DEF Holdings': true,
    'Standalone Target': true,
  };

  describe('getCachedMatch()', () => {
    it('should find exact match in forward mapping (string format)', () => {
      const result = getCachedMatch('ABC Inc', forwardMapping, reverseMapping);

      expect(result).toEqual({
        target: 'ABC Corporation',
        method: 'cached',
        confidence: 1.0,
        timestamp: expect.any(String),
        source: 'ABC Inc',
      });
    });

    it('should find exact match in forward mapping (object format)', () => {
      const result = getCachedMatch('XYZ Ltd', forwardMapping, reverseMapping);

      expect(result).toEqual({
        target: 'XYZ Company',
        method: 'cached',
        confidence: 1.0,
        timestamp: expect.any(String),
        source: 'XYZ Ltd',
      });
    });

    it('should find exact match in reverse mapping', () => {
      const result = getCachedMatch('Standalone Target', forwardMapping, reverseMapping);

      expect(result).toEqual({
        target: 'Standalone Target',
        method: 'cached',
        confidence: 1.0,
        timestamp: expect.any(String),
        source: 'Standalone Target',
      });
    });

    it('should return null for no match', () => {
      const result = getCachedMatch('Unknown Company', forwardMapping, reverseMapping);

      expect(result).toBeNull();
    });

    it('should handle empty string', () => {
      const result = getCachedMatch('', forwardMapping, reverseMapping);

      expect(result).toBeNull();
    });

    it('should handle null value', () => {
      const result = getCachedMatch(null, forwardMapping, reverseMapping);

      expect(result).toBeNull();
    });

    it('should handle undefined value', () => {
      const result = getCachedMatch(undefined, forwardMapping, reverseMapping);

      expect(result).toBeNull();
    });

    it('should handle number values (Excel cells)', () => {
      const forward = { '123': 'Company 123' };
      const reverse = {};

      const result = getCachedMatch(123, forward, reverse);

      expect(result).toEqual({
        target: 'Company 123',
        method: 'cached',
        confidence: 1.0,
        timestamp: expect.any(String),
        source: '123',
      });
    });

    it('should trim whitespace from values', () => {
      const result = getCachedMatch('  Spaces  ', forwardMapping, reverseMapping);

      expect(result).toEqual({
        target: 'Trimmed Value',
        method: 'cached',
        confidence: 1.0,
        timestamp: expect.any(String),
        source: 'Spaces', // Trimmed
      });
    });

    it('should prioritize forward mapping over reverse', () => {
      // If value exists in both forward and reverse, forward wins
      const forward = { 'Test': 'Target A' };
      const reverse = { 'Test': true }; // Would map to itself

      const result = getCachedMatch('Test', forward, reverse);

      expect(result.target).toBe('Target A');
    });

    it('should have valid ISO 8601 timestamp', () => {
      const result = getCachedMatch('ABC Inc', forwardMapping, reverseMapping);

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });

  describe('hasExactMatch()', () => {
    it('should return true for forward mapping match', () => {
      expect(hasExactMatch('ABC Inc', forwardMapping, reverseMapping)).toBe(true);
    });

    it('should return true for reverse mapping match', () => {
      expect(hasExactMatch('Standalone Target', forwardMapping, reverseMapping)).toBe(true);
    });

    it('should return false for no match', () => {
      expect(hasExactMatch('Unknown', forwardMapping, reverseMapping)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasExactMatch('', forwardMapping, reverseMapping)).toBe(false);
    });

    it('should return false for null', () => {
      expect(hasExactMatch(null, forwardMapping, reverseMapping)).toBe(false);
    });

    it('should handle numbers', () => {
      const forward = { '123': 'Company' };
      expect(hasExactMatch(123, forward, {})).toBe(true);
    });
  });

  describe('getCachedMatches()', () => {
    it('should return map of matched values only', () => {
      const values = ['ABC Inc', 'Unknown', 'XYZ Ltd', 'Another Unknown'];

      const matches = getCachedMatches(values, forwardMapping, reverseMapping);

      expect(matches.size).toBe(2);
      expect(matches.has('ABC Inc')).toBe(true);
      expect(matches.has('XYZ Ltd')).toBe(true);
      expect(matches.has('Unknown')).toBe(false);
      expect(matches.has('Another Unknown')).toBe(false);
    });

    it('should return empty map for no matches', () => {
      const values = ['Unknown 1', 'Unknown 2'];

      const matches = getCachedMatches(values, forwardMapping, reverseMapping);

      expect(matches.size).toBe(0);
    });

    it('should return empty map for empty array', () => {
      const matches = getCachedMatches([], forwardMapping, reverseMapping);

      expect(matches.size).toBe(0);
    });

    it('should handle mixed forward and reverse matches', () => {
      const values = ['ABC Inc', 'Standalone Target', 'Unknown'];

      const matches = getCachedMatches(values, forwardMapping, reverseMapping);

      expect(matches.size).toBe(2);
      expect(matches.get('ABC Inc').target).toBe('ABC Corporation');
      expect(matches.get('Standalone Target').target).toBe('Standalone Target');
    });

    it('should preserve match result structure', () => {
      const values = ['ABC Inc'];

      const matches = getCachedMatches(values, forwardMapping, reverseMapping);
      const match = matches.get('ABC Inc');

      expect(match).toEqual({
        target: 'ABC Corporation',
        method: 'cached',
        confidence: 1.0,
        timestamp: expect.any(String),
        source: 'ABC Inc',
      });
    });
  });

  describe('validateMappings()', () => {
    it('should return true for valid mappings', () => {
      expect(validateMappings({ a: 'b' }, { c: true })).toBe(true);
    });

    it('should return true for empty objects', () => {
      expect(validateMappings({}, {})).toBe(true);
    });

    it('should return false for null forward', () => {
      expect(validateMappings(null, {})).toBe(false);
    });

    it('should return false for null reverse', () => {
      expect(validateMappings({}, null)).toBe(false);
    });

    it('should return false for undefined forward', () => {
      expect(validateMappings(undefined, {})).toBe(false);
    });

    it('should return false for undefined reverse', () => {
      expect(validateMappings({}, undefined)).toBe(false);
    });

    it('should return false for non-object forward (string)', () => {
      expect(validateMappings('invalid', {})).toBe(false);
    });

    it('should accept arrays as valid (JS typeof array === object)', () => {
      // In JavaScript, arrays pass typeof check for 'object'
      // This is acceptable as validateMappings is a basic type check
      expect(validateMappings({}, [])).toBe(true);
    });

    it('should return false for both invalid', () => {
      expect(validateMappings(null, null)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle case-sensitive matching', () => {
      const forward = { 'ABC': 'Target' };
      const reverse = {};

      expect(getCachedMatch('ABC', forward, reverse)).not.toBeNull();
      expect(getCachedMatch('abc', forward, reverse)).toBeNull(); // Case-sensitive
    });

    it('should handle special characters', () => {
      const forward = { 'ABC & Co.': 'ABC Company' };
      const reverse = {};

      const result = getCachedMatch('ABC & Co.', forward, reverse);

      expect(result.target).toBe('ABC Company');
    });

    it('should handle Unicode characters', () => {
      const forward = { 'Société': 'Company' };
      const reverse = {};

      const result = getCachedMatch('Société', forward, reverse);

      expect(result.target).toBe('Company');
    });

    it('should handle empty mappings', () => {
      const result = getCachedMatch('Test', {}, {});

      expect(result).toBeNull();
    });

    it('should handle very long values', () => {
      const longValue = 'A'.repeat(10000);
      const forward = { [longValue]: 'Target' };

      const result = getCachedMatch(longValue, forward, {});

      expect(result.target).toBe('Target');
    });
  });

  describe('Performance', () => {
    it('should handle large forward mappings efficiently', () => {
      const largeForward = {};
      for (let i = 0; i < 10000; i++) {
        largeForward[`Company ${i}`] = `Target ${i}`;
      }

      const start = performance.now();
      const result = getCachedMatch('Company 5000', largeForward, {});
      const duration = performance.now() - start;

      expect(result.target).toBe('Target 5000');
      expect(duration).toBeLessThan(10); // Should be < 10ms for lookup
    });

    it('should handle batch operations efficiently', () => {
      const values = [];
      for (let i = 0; i < 1000; i++) {
        values.push(`Value ${i}`);
      }

      const start = performance.now();
      const matches = getCachedMatches(values, forwardMapping, reverseMapping);
      const duration = performance.now() - start;

      expect(matches.size).toBe(0); // No matches in this test
      expect(duration).toBeLessThan(50); // Should be < 50ms for 1000 lookups
    });
  });
});
