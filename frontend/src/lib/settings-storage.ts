'use client';

import { getCompleteImageModels, getCompleteTextModels, loadRegistry } from '@/lib/nova-models';

/**
 * 模型注册表保存后派发的窗口事件名。
 * SettingsModal 保存时 dispatch,各处「是否已配置模型」的状态据此实时重算,
 * 避免「配置完不刷新页面仍提示未配置」(挂载时只算一次的陈旧 state)。
 */
export const MODEL_REGISTRY_UPDATED_EVENT = 'nova-model-registry-updated';

export function getStoredApiKey(): string {
  const registry = loadRegistry();
  const imageModel = getCompleteImageModels(registry)[0];
  const textModel = getCompleteTextModels(registry)[0];
  return imageModel?.apiKey || textModel?.apiKey || '';
}

export function setStoredApiKey(): boolean {
  return true;
}

export function removeStoredApiKey(): void {
  // 开源版改为模型级别独立存储，不再提供全局 key 写入口。
}

export const getStoredCcodeKey = getStoredApiKey;
export const setStoredCcodeKey = setStoredApiKey;
export const removeStoredCcodeKey = removeStoredApiKey;

export function getApiKeyFromStorage(): string {
  return getStoredApiKey();
}

export function hasAnyApiKey(): boolean {
  const registry = loadRegistry();
  return getCompleteImageModels(registry).length > 0 && getCompleteTextModels(registry).length > 0;
}

export function loadJsonFromStorage<T>(key: string): Partial<T> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : {};
}

export function saveJsonToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}
