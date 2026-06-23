import { describe, expect, it } from 'vitest';
import { buildTextAuthHeaders } from '@/lib/model-endpoints';

describe('buildTextAuthHeaders', () => {
  it('builds OpenAI bearer headers without a key-id by default', () => {
    const h = buildTextAuthHeaders({ apiKey: 'sk-x', protocol: 'openai' });
    expect(h.Authorization).toBe('Bearer sk-x');
    expect(h).not.toHaveProperty('X-Sub2api-Key-Id');
    expect(h).not.toHaveProperty('x-goog-api-key');
  });

  it('adds x-goog-api-key for the google protocol', () => {
    const h = buildTextAuthHeaders({ apiKey: 'sk-x', protocol: 'google' });
    expect(h.Authorization).toBe('Bearer sk-x');
    expect(h['x-goog-api-key']).toBe('sk-x');
  });

  it('adds X-Sub2api-Key-Id only for sub2api models with a keyId', () => {
    const h = buildTextAuthHeaders({ apiKey: 'sk-x', protocol: 'openai', source: 'sub2api', keyId: '9' });
    expect(h['X-Sub2api-Key-Id']).toBe('9');
  });

  it('omits the key-id header for sub2api models without a keyId', () => {
    const h = buildTextAuthHeaders({ apiKey: 'sk-x', protocol: 'openai', source: 'sub2api' });
    expect(h).not.toHaveProperty('X-Sub2api-Key-Id');
  });

  it('omits the key-id header for manual models even when a keyId is present', () => {
    const h = buildTextAuthHeaders({ apiKey: 'sk-x', protocol: 'openai', source: 'manual', keyId: '9' });
    expect(h).not.toHaveProperty('X-Sub2api-Key-Id');
  });
});
