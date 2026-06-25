import { beforeEach, describe, expect, it } from 'vitest';
import { supportsMaskEdit } from '@/lib/model-capabilities';
import { saveRegistry, type NovaModelRegistry } from '@/lib/nova-models';

function seed(overrides: Partial<NovaModelRegistry['imageModels'][number]> = {}) {
  const registry: NovaModelRegistry = {
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
        source: 'sub2api',
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
  saveRegistry(registry);
}

describe('supportsMaskEdit', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('模型开启 supportsMaskEdit 时返回 true', () => {
    seed({ supportsMaskEdit: true });
    expect(supportsMaskEdit('m1')).toBe(true);
  });

  it('模型未开启时返回 false', () => {
    seed({ supportsMaskEdit: false });
    expect(supportsMaskEdit('m1')).toBe(false);
  });

  it('缺省(旧配置)时返回 false', () => {
    seed({});
    expect(supportsMaskEdit('m1')).toBe(false);
  });

  it('未知模型返回 false', () => {
    seed({ supportsMaskEdit: true });
    expect(supportsMaskEdit('not-exist')).toBe(false);
  });
});
