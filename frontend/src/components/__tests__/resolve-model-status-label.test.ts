import { describe, expect, it } from 'vitest';
import { resolveModelStatusLabel } from '@/components/SettingsModal';
import type { ImageModelConfig, TextModelConfig } from '@/lib/nova-models';

const imageModel = {
  id: 'sub2api_1782097476153_137ok0',
  protocol: 'openai',
  name: 'sub2api_1782097476153_137ok0', // dirty: name stores internal id
  modelId: 'gpt-image-2',
  apiKey: '__sub2api_proxy__',
  baseUrl: 'https://nova.test/api/proxy',
} as unknown as ImageModelConfig;

const textModel = {
  id: 'txt_1782132741498_bhmu66',
  protocol: 'openai',
  name: 'txt_1782132741498_bhmu66',
  modelId: 'gpt-5.5',
  apiKey: '__sub2api_proxy__',
  baseUrl: 'https://nova.test/api/proxy',
} as unknown as TextModelConfig;

describe('resolveModelStatusLabel', () => {
  it('resolves an image model id to its readable modelId (not the internal id)', () => {
    expect(resolveModelStatusLabel([imageModel], [textModel], imageModel.id)).toBe('gpt-image-2');
  });

  it('resolves a text model id to its readable modelId', () => {
    expect(resolveModelStatusLabel([imageModel], [textModel], textModel.id)).toBe('gpt-5.5');
  });

  it('does not short-circuit on the image model (regression: || returned raw internal id)', () => {
    // image model present only in imageModels; must NOT echo the internal id
    expect(resolveModelStatusLabel([imageModel], [], imageModel.id)).not.toContain('sub2api_');
  });

  it('uses the clean name when name is a real display name', () => {
    const clean = { ...imageModel, name: 'My Image Model' } as unknown as ImageModelConfig;
    expect(resolveModelStatusLabel([clean], [], clean.id)).toBe('My Image Model');
  });

  it('falls back to 未命名模型 for an unknown internal id', () => {
    expect(resolveModelStatusLabel([], [], 'sub2api_9999999999_zzzzzz')).toBe('未命名模型');
  });
});
