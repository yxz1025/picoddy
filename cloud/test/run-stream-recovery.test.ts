import assert from 'node:assert/strict';
import test from 'node:test';
import { streamRunEvents } from '../web/desktop/src/api/runStream.ts';

test('failed message recovery is retried without acknowledging the terminal event', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const stop = new AbortController();
  const urls: string[] = [];
  let callbacks = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: (fn: () => void) => setTimeout(fn, 0), clearTimeout,
  } });
  globalThis.fetch = async input => {
    urls.push(String(input));
    if (urls.length > 2) { stop.abort(); throw new Error('Unexpected extra retry'); }
    return new Response('id: 1\nevent: update\ndata: {"id":"1","runId":"run","type":"status","payload":{"status":"succeeded"}}\n\n');
  };
  try {
    await streamRunEvents({ runId: 'run', signal: stop.signal,
      async onEvent() {
        callbacks += 1;
        if (callbacks === 1) throw new Error('messages temporarily unavailable');
        stop.abort();
      },
      async onReconnect() { throw new Error('recovery still unavailable'); },
    });
    assert.equal(callbacks, 2);
    assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.endsWith('after=0')));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
