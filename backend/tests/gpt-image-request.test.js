import { describe, it, expect } from 'vitest';
import {
  normalizeGptImageAdvancedParams,
  createGptImageRequestInit,
} from '../src/proxy/gpt-image-request.js';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function refImage(overrides = {}) {
  return { data: SAMPLE_PNG_BASE64, mimeType: 'image/png', ...overrides };
}

async function readFormData(init) {
  // node 的 Request 可解析 FormData body,便于断言字段。
  const request = new Request('http://x', { method: 'POST', body: init.body });
  return request.formData();
}

describe('normalizeGptImageAdvancedParams', () => {
  it('补齐缺省值为 auto', () => {
    expect(normalizeGptImageAdvancedParams({})).toEqual({
      quality: 'auto',
      style: 'auto',
      background: 'auto',
    });
  });

  it('非法枚举值抛错', () => {
    expect(() => normalizeGptImageAdvancedParams({ gptImageQuality: 'ultra' })).toThrow(/quality/);
  });
});

describe('createGptImageRequestInit - 文生图(JSON)', () => {
  it('构造 JSON body,不含 mask 字段', () => {
    const init = createGptImageRequestInit('sk-test', {
      mode: 'text-to-image',
      model: 'gpt-image-2',
      prompt: '一只猫',
      images: [],
    });
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const payload = JSON.parse(init.body);
    expect(payload.prompt).toBe('一只猫');
    expect(payload.mask).toBeUndefined();
  });
});

describe('createGptImageRequestInit - 图生图(FormData)', () => {
  it('不带 mask 时 FormData 中无 mask 字段', async () => {
    const init = createGptImageRequestInit('sk-test', {
      mode: 'image-to-image',
      model: 'gpt-image-2',
      prompt: '改成夜晚',
      images: [refImage()],
    });
    const form = await readFormData(init);
    expect(form.get('prompt')).toBe('改成夜晚');
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(form.get('mask')).toBeNull();
  });

  it('带 mask 时把 mask 作为 PNG 文件附加', async () => {
    const init = createGptImageRequestInit('sk-test', {
      mode: 'image-to-image',
      model: 'gpt-image-2',
      prompt: '只改这块',
      images: [refImage()],
      mask: { data: SAMPLE_PNG_BASE64, mimeType: 'image/png' },
    });
    const form = await readFormData(init);
    const mask = form.get('mask');
    expect(mask).toBeInstanceOf(Blob);
    expect(mask.type).toBe('image/png');
    const bytes = Buffer.from(await mask.arrayBuffer());
    expect(bytes.equals(Buffer.from(SAMPLE_PNG_BASE64, 'base64'))).toBe(true);
  });

  it('mask 为空或无 data 时忽略,不附加', async () => {
    const init = createGptImageRequestInit('sk-test', {
      mode: 'image-to-image',
      model: 'gpt-image-2',
      prompt: 'x',
      images: [refImage()],
      mask: { data: '', mimeType: 'image/png' },
    });
    const form = await readFormData(init);
    expect(form.get('mask')).toBeNull();
  });

  it('透传 keyId 为内部头', () => {
    const init = createGptImageRequestInit(
      'sk-test',
      { mode: 'image-to-image', model: 'gpt-image-2', prompt: 'x', images: [refImage()] },
      undefined,
      { keyId: 'key-123' },
    );
    expect(init.headers['X-Sub2api-Key-Id']).toBe('key-123');
  });
});
