import test from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../lib/bus.mjs';

test('ask receives a reply from a synchronous subscriber', async () => {
  const bus = new Bus();
  bus.subscribe('agent', (env) => {
    bus.send({ from: 'agent', to: 'user', type: 'tell', body: 'pong', correlationId: env.correlationId });
  });
  const reply = await bus.ask({ from: 'user', to: 'agent', body: 'ping', timeoutMs: 50 });
  assert.equal(reply.body, 'pong');
});

test('ask rejects with AbortError and cleans up its waiter', async () => {
  const bus = new Bus();
  const ac = new AbortController();
  const pending = bus.ask({ from: 'user', to: 'agent', body: 'ping', timeoutMs: 5_000, signal: ac.signal });
  ac.abort();
  await assert.rejects(() => pending, (err) => err.name === 'AbortError');
  assert.equal(bus.waiters.size, 0);
});

test('an already-aborted signal rejects immediately', async () => {
  const bus = new Bus();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => bus.ask({ from: 'user', to: 'agent', body: 'ping', signal: ac.signal }),
    (err) => err.name === 'AbortError',
  );
  assert.equal(bus.waiters.size, 0);
});
