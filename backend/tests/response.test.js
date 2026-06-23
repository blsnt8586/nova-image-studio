import { describe, it, expect } from 'vitest';
import { ok, fail, send } from '../src/http/response.js';

describe('http/response', () => {
  describe('ok', () => {
    it('wraps data in a success envelope', () => {
      expect(ok({ id: 1 })).toEqual({ success: true, data: { id: 1 } });
    });

    it('normalizes undefined data to null', () => {
      expect(ok(undefined)).toEqual({ success: true, data: null });
    });

    it('includes meta when provided', () => {
      expect(ok([1, 2], { total: 2, page: 1, limit: 10 })).toEqual({
        success: true,
        data: [1, 2],
        meta: { total: 2, page: 1, limit: 10 },
      });
    });

    it('omits meta when not provided', () => {
      expect(ok('x')).not.toHaveProperty('meta');
    });
  });

  describe('fail', () => {
    it('wraps an error string in a failure envelope', () => {
      expect(fail('boom')).toEqual({ success: false, error: 'boom' });
    });

    it('falls back to a generic message for non-strings', () => {
      expect(fail(undefined)).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  describe('send', () => {
    it('writes status, JSON content-type and serialized body', () => {
      const calls = { head: null, body: null };
      const res = {
        writeHead(status, headers) {
          calls.head = { status, headers };
        },
        end(payload) {
          calls.body = payload;
        },
      };

      send(res, 201, ok({ ok: true }));

      expect(calls.head.status).toBe(201);
      expect(calls.head.headers['Content-Type']).toMatch(/application\/json/);
      expect(JSON.parse(calls.body)).toEqual({ success: true, data: { ok: true } });
    });
  });
});
