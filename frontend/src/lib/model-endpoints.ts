'use client';

import {
  getDefaultTextModel,
  getTextModelById,
  loadRegistry,
  type ImageModelSource,
  type ProviderProtocol,
  type TextModelConfig,
} from '@/lib/nova-models';
import { resolveAuthApiKey } from '@/lib/sub2api-token';

function withResolvedKey<T extends { apiKey: string }>(model: T): T {
  return { ...model, apiKey: resolveAuthApiKey(model.apiKey) };
}

function trimTrailingSlashes(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function ensureOpenAiBaseUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl);
  if (!normalized) return '';
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
}

function ensureGoogleBaseUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl);
  if (!normalized) return '';
  return normalized.endsWith('/v1beta') ? normalized.slice(0, -7) : normalized;
}

export function normalizeModelBaseUrl(protocol: ProviderProtocol, baseUrl: string): string {
  return protocol === 'google'
    ? ensureGoogleBaseUrl(baseUrl)
    : ensureOpenAiBaseUrl(baseUrl);
}

export function buildResponsesApiUrl(baseUrl: string): string {
  return `${ensureOpenAiBaseUrl(baseUrl)}/v1/responses`;
}

export function buildGeminiStreamGenerateContentUrl(baseUrl: string, modelId: string): string {
  return `${ensureGoogleBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
}

export function getConfiguredTextModel(modelId: string): TextModelConfig | undefined {
  const registry = loadRegistry();
  const model = getTextModelById(registry, modelId);
  return model ? withResolvedKey(model) : undefined;
}

export function getDefaultConfiguredTextModel(
  task: 'reversePrompt' | 'agent' | 'promptOptimize' | 'imageDescribe',
): TextModelConfig | undefined {
  const registry = loadRegistry();
  const model = getDefaultTextModel(registry, task);
  return model ? withResolvedKey(model) : undefined;
}

export function requireDefaultConfiguredTextModel(
  task: 'reversePrompt' | 'agent' | 'promptOptimize' | 'imageDescribe',
): TextModelConfig {
  const configured = getDefaultConfiguredTextModel(task);
  if (!configured?.apiKey || !configured.baseUrl || !configured.modelId) {
    throw new Error('请先在设置中完成默认文本模型配置');
  }
  return configured;
}

export interface TextAuthHeaderInput {
  apiKey: string;
  protocol: ProviderProtocol;
  /** 仅 sub2api 模型携带,用于让后端换成对应 sk- key(key 不进浏览器)。 */
  source?: ImageModelSource;
  keyId?: string;
}

/**
 * 构造文本模型请求的鉴权头。
 * - OpenAI:`Authorization: Bearer <key>`
 * - Google:额外带 `x-goog-api-key`
 * - sub2api 模型且有 keyId 时:额外带 `X-Sub2api-Key-Id`(后端据此换 sk- key)
 */
export function buildTextAuthHeaders(input: TextAuthHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
  };
  if (input.protocol === 'google') {
    headers['x-goog-api-key'] = input.apiKey;
  }
  const keyId = input.keyId !== undefined && input.keyId !== null ? String(input.keyId).trim() : '';
  if (input.source === 'sub2api' && keyId) {
    headers['X-Sub2api-Key-Id'] = keyId;
  }
  return headers;
}

