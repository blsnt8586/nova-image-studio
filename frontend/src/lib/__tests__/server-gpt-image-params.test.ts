import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);
// GPT Image 请求体构造逻辑已抽到独立模块(便于单测);转发字段断言读这里。
const gptImageRequestSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/src/proxy/gpt-image-request.js'),
  'utf8',
);

describe('backend GPT Image advanced params forwarding', () => {
  it('does not contain legacy GPT Image SKU gating or token suffix logic', () => {
    expect(serverSource).not.toContain('gpt-image-2-fast');
    expect(serverSource).not.toContain('gpt-image-2-plus');
    expect(serverSource).not.toContain('gpt-image-2-pro');
    expect(serverSource).not.toContain('TOKEN_SUFFIX');
    expect(serverSource).not.toContain('supportsGptImageAdvancedParams(');
  });

  it('forwards quality/background/output_format and conditional style in multipart edits', () => {
    expect(gptImageRequestSource).toContain("formData.append('quality', advancedParams.quality)");
    expect(gptImageRequestSource).toContain("formData.append('background', advancedParams.background)");
    expect(gptImageRequestSource).toContain("formData.append('output_format', 'png')");
    expect(gptImageRequestSource).toContain("formData.append('style', advancedParams.style)");
  });

  it('forwards quality/background/output_format and conditional style in JSON generations', () => {
    expect(gptImageRequestSource).toContain('quality: advancedParams.quality');
    expect(gptImageRequestSource).toContain('background: advancedParams.background');
    expect(gptImageRequestSource).toContain("output_format: 'png'");
    expect(gptImageRequestSource).toContain("advancedParams.style === 'vivid' || advancedParams.style === 'natural' ? { style: advancedParams.style } : {}");
  });

  it('routes OpenAI image endpoint by mode rather than legacy model names', () => {
    expect(serverSource).toContain("request.mode === 'image-to-image'");
    expect(serverSource).toContain("/v1/images/edits");
    expect(serverSource).toContain("/v1/images/generations");
  });
});
