/**
 * Event Bus Tests
 *
 * Comprehensive test suite for the event bus implementation
 */

import { EventBus, eventBus } from '../event-bus.js';
import { Events } from '../events.js';

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on() - Register listeners', () => {
    it('should register a listener and return unsubscribe function', () => {
      const handler = jest.fn();
      const unsubscribe = bus.on('test:event', handler);

      expect(typeof unsubscribe).toBe('function');
      expect(bus.listenerCount('test:event')).toBe(1);
    });

    it('should allow multiple listeners for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      bus.on('test:event', handler1);
      bus.on('test:event', handler2);

      expect(bus.listenerCount('test:event')).toBe(2);
    });

    it('should support different events independently', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      bus.on('event:one', handler1);
      bus.on('event:two', handler2);

      expect(bus.listenerCount('event:one')).toBe(1);
      expect(bus.listenerCount('event:two')).toBe(1);
    });
  });

  describe('emit() - Trigger events', () => {
    it('should call all registered listeners with payload', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const payload = { data: 'test' };

      bus.on('test:event', handler1);
      bus.on('test:event', handler2);
      bus.emit('test:event', payload);

      expect(handler1).toHaveBeenCalledWith(payload);
      expect(handler2).toHaveBeenCalledWith(payload);
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle no listeners gracefully', () => {
      expect(() => {
        bus.emit('nonexistent:event', { data: 'test' });
      }).not.toThrow();
    });

    it('should call listeners in registration order', () => {
      const order = [];

      bus.on('test:event', () => order.push(1));
      bus.on('test:event', () => order.push(2));
      bus.on('test:event', () => order.push(3));

      bus.emit('test:event');

      expect(order).toEqual([1, 2, 3]);
    });

    it('should catch and log errors in handlers without stopping other handlers', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const handler1 = jest.fn(() => { throw new Error('Handler error'); });
      const handler2 = jest.fn();

      bus.on('test:event', handler1);
      bus.on('test:event', handler2);
      bus.emit('test:event');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('off() - Unregister listeners', () => {
    it('should remove specific listener', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      bus.on('test:event', handler1);
      bus.on('test:event', handler2);
      bus.off('test:event', handler1);

      expect(bus.listenerCount('test:event')).toBe(1);

      bus.emit('test:event');
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should handle removing non-existent listener gracefully', () => {
      const handler = jest.fn();

      expect(() => {
        bus.off('test:event', handler);
      }).not.toThrow();
    });

    it('should clean up empty listener arrays', () => {
      const handler = jest.fn();

      bus.on('test:event', handler);
      bus.off('test:event', handler);

      expect(bus.hasListeners('test:event')).toBe(false);
    });

    it('should work via unsubscribe function', () => {
      const handler = jest.fn();
      const unsubscribe = bus.on('test:event', handler);

      unsubscribe();

      bus.emit('test:event');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emitAsync() - Async event handling', () => {
    it('should call async handlers sequentially', async () => {
      const order = [];

      bus.on('test:event', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push(1);
      });
      bus.on('test:event', async () => {
        order.push(2);
      });

      await bus.emitAsync('test:event');

      expect(order).toEqual([1, 2]);
    });

    it('should catch async errors without stopping other handlers', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const handler1 = jest.fn(async () => {
        throw new Error('Async error');
      });
      const handler2 = jest.fn();

      bus.on('test:event', handler1);
      bus.on('test:event', handler2);

      await bus.emitAsync('test:event');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('clear() - Remove all listeners', () => {
    it('should clear all listeners for specific event', () => {
      bus.on('event:one', jest.fn());
      bus.on('event:one', jest.fn());
      bus.on('event:two', jest.fn());

      bus.clear('event:one');

      expect(bus.hasListeners('event:one')).toBe(false);
      expect(bus.hasListeners('event:two')).toBe(true);
    });

    it('should clear all events when no argument provided', () => {
      bus.on('event:one', jest.fn());
      bus.on('event:two', jest.fn());

      bus.clear();

      expect(bus.hasListeners('event:one')).toBe(false);
      expect(bus.hasListeners('event:two')).toBe(false);
    });
  });

  describe('Utility methods', () => {
    it('listenerCount() should return correct count', () => {
      expect(bus.listenerCount('test:event')).toBe(0);

      bus.on('test:event', jest.fn());
      expect(bus.listenerCount('test:event')).toBe(1);

      bus.on('test:event', jest.fn());
      expect(bus.listenerCount('test:event')).toBe(2);
    });

    it('hasListeners() should return correct boolean', () => {
      expect(bus.hasListeners('test:event')).toBe(false);

      bus.on('test:event', jest.fn());
      expect(bus.hasListeners('test:event')).toBe(true);
    });
  });

  describe('Singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(eventBus).toBeInstanceOf(EventBus);
    });

    it('singleton should maintain state across imports', () => {
      const handler = jest.fn();

      eventBus.on('singleton:test', handler);
      eventBus.emit('singleton:test', { data: 'test' });

      expect(handler).toHaveBeenCalledWith({ data: 'test' });

      // Clean up
      eventBus.clear();
    });
  });

  describe('Integration with Events constants', () => {
    it('should work with predefined event constants', () => {
      const handler = jest.fn();

      bus.on(Events.CELL_PROCESSING_COMPLETE, handler);
      bus.emit(Events.CELL_PROCESSING_COMPLETE, {
        cellKey: '1:1',
        result: { target: 'test' }
      });

      expect(handler).toHaveBeenCalledWith({
        cellKey: '1:1',
        result: { target: 'test' }
      });
    });
  });
});
