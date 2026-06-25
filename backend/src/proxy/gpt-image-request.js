'use strict';

/**
 * GPT Image(OpenAI 兼容)请求体构造。
 * 从 server.js 抽出以便单测覆盖,逻辑保持一致:
 * - text-to-image:JSON body,images 以 data URL 形式放入 image 数组
 * - image-to-image:multipart/form-data,参考图作为 image 文件附加
 *   并在「智能重绘」时附带同尺寸 PNG mask(透明区=允许修改)
 *
 * mask 字段同参考图,仅在运行时透传,绝不落库。
 */

const GPT_IMAGE_QUALITIES = new Set(['auto', 'high', 'medium', 'low']);
const GPT_IMAGE_STYLES = new Set(['auto', 'vivid', 'natural']);
const GPT_IMAGE_BACKGROUNDS = new Set(['auto', 'transparent', 'opaque']);
const DEFAULT_GPT_IMAGE_ADVANCED_PARAMS = {
  quality: 'auto',
  style: 'auto',
  background: 'auto',
};

function validateEnumValue(value, validValues, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!validValues.has(value)) {
    throw new Error(`${fieldName} 参数无效`);
  }
  return value;
}

function normalizeGptImageAdvancedParams(params = {}) {
  const quality = validateEnumValue(params.gptImageQuality, GPT_IMAGE_QUALITIES, 'quality');
  const style = validateEnumValue(params.gptImageStyle, GPT_IMAGE_STYLES, 'style');
  const background = validateEnumValue(params.gptImageBackground, GPT_IMAGE_BACKGROUNDS, 'background');

  return {
    quality: quality || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.quality,
    style: style || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.style,
    background: background || DEFAULT_GPT_IMAGE_ADVANCED_PARAMS.background,
  };
}

function getGptImageRequestAdvancedParams(request) {
  return normalizeGptImageAdvancedParams(request);
}

/** 把 {data(base64), mimeType} 转成带文件名的 Blob;data 为空返回 null。 */
function imageEntryToBlob(entry, fallbackName) {
  if (!entry || typeof entry.data !== 'string' || entry.data.length === 0) return null;
  const mimeType = entry.mimeType || 'image/png';
  const extension = mimeType.split('/')[1] || 'png';
  const bytes = Buffer.from(entry.data, 'base64');
  return { blob: new Blob([bytes], { type: mimeType }), filename: `${fallbackName}.${extension}` };
}

function createGptImageRequestInit(apiKey, request, resolvedSize, options = {}) {
  // 智能重绘:带 mask 时在提示词前加引导,帮助模型聚焦 mask 区域,减少全局修改。
  const hasMask = request.mask && typeof request.mask.data === 'string' && request.mask.data.length > 0;
  const prompt = hasMask
    ? `Edit ONLY the transparent masked region. Keep every pixel outside the mask 100% identical to the original. For the masked region, apply this change: ${request.prompt}. If removing or erasing content, fill the region with plain background color matching the surrounding area (no text, no numbers, no symbols).`
    : request.prompt;
  const advancedParams = getGptImageRequestAdvancedParams(request);
  const stream = Boolean(options.stream);
  // sub2api 模型:把选中的 keyId 作为内部头传给 loopback 代理(代理据此代查 sk- key)
  const keyIdHeader = options.keyId ? { 'X-Sub2api-Key-Id': String(options.keyId) } : {};

  if (request.mode === 'image-to-image') {
    const formData = new FormData();
    formData.append('model', request.model);
    formData.append('prompt', prompt);
    formData.append('n', '1');
    if (stream) {
      formData.append('stream', 'true');
    }
    if (advancedParams) {
      formData.append('quality', advancedParams.quality);
      formData.append('background', advancedParams.background);
      formData.append('output_format', 'png');
      if (advancedParams.style === 'vivid' || advancedParams.style === 'natural') {
        formData.append('style', advancedParams.style);
      }
    }
    if (resolvedSize) {
      formData.append('size', resolvedSize);
    }

    request.images.forEach((img, index) => {
      const entry = imageEntryToBlob(img, `image-${index}`);
      if (entry) formData.append('image', entry.blob, entry.filename);
    });

    // 智能重绘:附带同尺寸 PNG mask(透明区=允许修改)。仅运行时透传,不落库。
    const maskEntry = imageEntryToBlob(request.mask, 'mask');
    if (maskEntry) {
      formData.append('mask', maskEntry.blob, maskEntry.filename);
    }

    return {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...keyIdHeader,
      },
      body: formData,
    };
  }

  const payload = {
    prompt,
    model: request.model,
    ...(stream ? { stream: true } : {}),
    ...(resolvedSize ? { size: resolvedSize } : {}),
    ...(advancedParams ? {
      quality: advancedParams.quality,
      background: advancedParams.background,
      output_format: 'png',
      ...(advancedParams.style === 'vivid' || advancedParams.style === 'natural' ? { style: advancedParams.style } : {}),
    } : {}),
    ...(request.images.length > 0 ? { image: request.images.map(img => `data:${img.mimeType};base64,${img.data}`) } : {}),
  };

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...keyIdHeader,
    },
    body: JSON.stringify(payload),
  };
}

module.exports = {
  GPT_IMAGE_QUALITIES,
  GPT_IMAGE_STYLES,
  GPT_IMAGE_BACKGROUNDS,
  DEFAULT_GPT_IMAGE_ADVANCED_PARAMS,
  validateEnumValue,
  normalizeGptImageAdvancedParams,
  getGptImageRequestAdvancedParams,
  createGptImageRequestInit,
};
