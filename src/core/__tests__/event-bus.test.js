/** Event Bus Tests - Core functionality only */
import { EventBus, eventBus } from '../event-bus.js';

describe('EventBus', () => {
  let bus;
  beforeEach(() => { bus = new EventBus(); });

  it('emits to all listeners with payload', () => {
    const h1 = jest.fn(), h2 = jest.fn();
    bus.on('test', h1);
    bus.on('test', h2);
    bus.emit('test', { data: 1 });
    expect(h1).toHaveBeenCalledWith({ data: 1 });
    expect(h2).toHaveBeenCalledWith({ data: 1 });
  });

  it('isolates handler errors', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const bad = jest.fn(() => { throw new Error('fail'); });
    const good = jest.fn();
    bus.on('test', bad);
    bus.on('test', good);
    bus.emit('test');
    expect(good).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('unsubscribe removes listener', () => {
    const h = jest.fn();
    const unsub = bus.on('test', h);
    unsub();
    bus.emit('test');
    expect(h).not.toHaveBeenCalled();
  });

  it('emitAsync runs sequentially', async () => {
    const order = [];
    bus.on('test', async () => { await new Promise(r => setTimeout(r, 5)); order.push(1); });
    bus.on('test', () => order.push(2));
    await bus.emitAsync('test');
    expect(order).toEqual([1, 2]);
  });
});
