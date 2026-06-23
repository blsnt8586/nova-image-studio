import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readJsonBody } from '../src/http/body.js';

function makeReq(chunks) {
  const req = new EventEmitter();
  setImmediate(() => {
    for (const c of chunks) req.emit('data', Buffer.from(c));
    req.emit('end');
  });
  return req;
}

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const body = await readJsonBody(makeReq(['{"a":', '1}']));
    expect(body).toEqual({ a: 1 });
  });

  it('returns empty object for empty body', async () => {
    const body = await readJsonBody(makeReq([]));
    expect(body).toEqual({});
  });

  it('throws on invalid JSON', async () => {
    await expect(readJsonBody(makeReq(['not json']))).rejects.toThrow();
  });

  it('throws when body exceeds maxBytes', async () => {
    const big = 'x'.repeat(50);
    await expect(readJsonBody(makeReq([big]), { maxBytes: 10 })).rejects.toThrow();
  });

  it('rejects on stream error', async () => {
    const req = new EventEmitter();
    setImmediate(() => req.emit('error', new Error('boom')));
    await expect(readJsonBody(req)).rejects.toThrow('boom');
  });
});
