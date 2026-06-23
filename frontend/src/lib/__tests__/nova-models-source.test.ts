import { beforeEach, describe, expect, it } from 'vitest';
import {
  saveRegistry,
  loadRegistry,
  type NovaModelRegistry,
} from '@/lib/nova-models';

function baseRegistry(overrides: Partial<NovaModelRegistry['imageModels'][number]> = {}): NovaModelRegistry {
  return {
    imageModels: [
      {
        id: 'm1',
        protocol: 'openai',
        name: 'sub2api 模型',
        modelId: 'gpt-image-2',
        apiKey: '__sub2api_proxy__',
        baseUrl: 'https://nova.test/api/proxy',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 4,
        maxOutputSize: '2K',
        supportsAdvancedParams: true,
        ...overrides,
      },
    ],
    textModels: [],
    defaults: {
      textToImage: 'm1',
      imageToImage: 'm1',
      reversePrompt: '',
      agent: '',
      promptOptimize: '',
      imageDescribe: '',
    },
  };
}

describe('nova-models — source/keyId 字段', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const PROXY = 'http://localhost:3000/api/proxy';

  it('保留用户选择的 keyId,并强制收口为代理(source=sub2api)', () => {
    saveRegistry(baseRegistry({ source: 'sub2api', keyId: '7' }));
    const reg = loadRegistry();
    expect(reg.imageModels[0].source).toBe('sub2api');
    expect(reg.imageModels[0].keyId).toBe('7');
    expect(reg.imageModels[0].apiKey).toBe('__sub2api_proxy__');
    expect(reg.imageModels[0].baseUrl).toBe(PROXY);
  });

  it('即使旧配置缺省 source 也强制收口为 sub2api 代理', () => {
    saveRegistry(baseRegistry());
    const reg = loadRegistry();
    expect(reg.imageModels[0].source).toBe('sub2api');
    expect(reg.imageModels[0].baseUrl).toBe(PROXY);
    expect(reg.imageModels[0].keyId).toBeUndefined();
  });

  it('keyId 为数字时归一为字符串', () => {
    // @ts-expect-error 故意传 number 测试归一化
    saveRegistry(baseRegistry({ source: 'sub2api', keyId: 7 }));
    const reg = loadRegistry();
    expect(reg.imageModels[0].keyId).toBe('7');
  });

  it('外部 baseUrl / 非法 apiKey 被强制纠正回代理(锁定为我们的服务)', () => {
    saveRegistry(baseRegistry({ baseUrl: 'https://api.openai.com', apiKey: 'sk-evil' }));
    const reg = loadRegistry();
    expect(reg.imageModels[0].baseUrl).toBe(PROXY);
    expect(reg.imageModels[0].apiKey).toBe('__sub2api_proxy__');
    expect(reg.imageModels[0].source).toBe('sub2api');
  });
});

function textRegistry(overrides: Partial<NovaModelRegistry['textModels'][number]> = {}): NovaModelRegistry {
  return {
    imageModels: [],
    textModels: [
      {
        id: 't1',
        protocol: 'openai',
        name: 'sub2api 文本模型',
        modelId: 'gpt-5.4',
        apiKey: '__sub2api_proxy__',
        baseUrl: 'https://nova.test/api/proxy',
        note: 'OpenAI Response',
        ...overrides,
      },
    ],
    defaults: {
      textToImage: '',
      imageToImage: '',
      reversePrompt: 't1',
      agent: 't1',
      promptOptimize: 't1',
      imageDescribe: 't1',
    },
  };
}

describe('nova-models — 文本模型 source/keyId 字段', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const PROXY = 'http://localhost:3000/api/proxy';

  it('保留 keyId 并强制收口为代理(source=sub2api)', () => {
    saveRegistry(textRegistry({ source: 'sub2api', keyId: '5' }));
    const reg = loadRegistry();
    expect(reg.textModels[0].source).toBe('sub2api');
    expect(reg.textModels[0].keyId).toBe('5');
    expect(reg.textModels[0].apiKey).toBe('__sub2api_proxy__');
    expect(reg.textModels[0].baseUrl).toBe(PROXY);
  });

  it('即使旧配置缺省 source 也强制收口为 sub2api 代理', () => {
    saveRegistry(textRegistry());
    const reg = loadRegistry();
    expect(reg.textModels[0].source).toBe('sub2api');
    expect(reg.textModels[0].baseUrl).toBe(PROXY);
    expect(reg.textModels[0].keyId).toBeUndefined();
  });

  it('keyId 为数字时归一为字符串', () => {
    // @ts-expect-error 故意传 number 测试归一化
    saveRegistry(textRegistry({ source: 'sub2api', keyId: 5 }));
    const reg = loadRegistry();
    expect(reg.textModels[0].keyId).toBe('5');
  });

  it('外部 baseUrl / 非法 apiKey 被强制纠正回代理', () => {
    saveRegistry(textRegistry({ baseUrl: 'https://api.openai.com', apiKey: 'sk-evil' }));
    const reg = loadRegistry();
    expect(reg.textModels[0].baseUrl).toBe(PROXY);
    expect(reg.textModels[0].apiKey).toBe('__sub2api_proxy__');
    expect(reg.textModels[0].source).toBe('sub2api');
  });
});
