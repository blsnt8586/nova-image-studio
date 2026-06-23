'use client';

import { SUB2API_PROXY_API_KEY } from '@/lib/sub2api-token';
import { PROXY_BASE_PATH } from '@/lib/sub2api-bootstrap';

export type ProviderProtocol = 'google' | 'openai';
export type ImageOutputSize = '512' | '1K' | '2K' | '4K';
/** 模型来源:sub2api 入口下发(走代理) vs 用户手动添加。 */
export type ImageModelSource = 'sub2api' | 'manual';
export type BuiltinImagePresetId =
  | 'gemini-2.5-flash-image'
  | 'gemini-3-pro-image-preview'
  | 'gemini-3.1-flash-image-preview'
  | 'gpt-image-2';

export interface ImageModelConfig {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  builtinPreset: BuiltinImagePresetId;
  maxRefImages: number;
  maxOutputSize: ImageOutputSize;
  supportsAdvancedParams: boolean;
  /** sub2api 模型固定走代理;手动模型用户自配。旧配置可能缺省。 */
  source?: ImageModelSource;
  /** sub2api 模型选中的 API Key id(只存 keyId,sk- key 不进浏览器)。 */
  keyId?: string;
}

export interface TextModelConfig {
  id: string;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  note?: string;
  /** sub2api 模型固定走代理;手动模型用户自配。旧配置可能缺省。 */
  source?: ImageModelSource;
  /** sub2api 模型选中的 API Key id(只存 keyId,sk- key 不进浏览器)。 */
  keyId?: string;
}

export interface BuiltinImagePreset {
  id: BuiltinImagePresetId;
  protocol: ProviderProtocol;
  name: string;
  modelId: string;
  baseUrl: string;
  maxRefImages: number;
  maxOutputSize: ImageOutputSize;
  supportsAdvancedParams: boolean;
}

export interface DefaultModels {
  textToImage: string;
  imageToImage: string;
  reversePrompt: string;
  agent: string;
  promptOptimize: string;
  imageDescribe: string;
}

export interface NovaModelRegistry {
  imageModels: ImageModelConfig[];
  textModels: TextModelConfig[];
  defaults: DefaultModels;
}

const REGISTRY_KEY = 'nova-model-registry';

/** 导出仅供测试断言持久化 key(不要在业务代码里依赖)。 */
export const REGISTRY_KEY_FOR_TEST = REGISTRY_KEY;

export const BUILTIN_IMAGE_PRESETS: Record<BuiltinImagePresetId, BuiltinImagePreset> = {
  'gemini-2.5-flash-image': {
    id: 'gemini-2.5-flash-image',
    protocol: 'google',
    name: 'Banana',
    modelId: 'gemini-2.5-flash-image',
    baseUrl: 'https://generativelanguage.googleapis.com',
    maxRefImages: 3,
    maxOutputSize: '1K',
    supportsAdvancedParams: false,
  },
  'gemini-3-pro-image-preview': {
    id: 'gemini-3-pro-image-preview',
    protocol: 'google',
    name: 'Banana Pro',
    modelId: 'gemini-3-pro-image-preview',
    baseUrl: 'https://generativelanguage.googleapis.com',
    maxRefImages: 11,
    maxOutputSize: '4K',
    supportsAdvancedParams: false,
  },
  'gemini-3.1-flash-image-preview': {
    id: 'gemini-3.1-flash-image-preview',
    protocol: 'google',
    name: 'Banana 2',
    modelId: 'gemini-3.1-flash-image-preview',
    baseUrl: 'https://generativelanguage.googleapis.com',
    maxRefImages: 14,
    maxOutputSize: '4K',
    supportsAdvancedParams: false,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    protocol: 'openai',
    name: 'GPT Image 2',
    modelId: 'gpt-image-2',
    baseUrl: 'https://api.openai.com',
    maxRefImages: 16,
    maxOutputSize: '4K',
    supportsAdvancedParams: true,
  },
};

export const BUILTIN_IMAGE_PRESET_OPTIONS = Object.values(BUILTIN_IMAGE_PRESETS).map((preset) => ({
  value: preset.id,
  label: preset.name,
}));

export const DEFAULT_TEXT_MODEL_TEMPLATES = [
  {
    protocol: 'openai' as const,
    name: 'GPT 5.4 Mini',
    modelId: 'gpt-5.4-mini',
    baseUrl: 'https://api.openai.com',
    note: 'OpenAI Response',
  },
  {
    protocol: 'google' as const,
    name: 'Gemini 2.5 Flash',
    modelId: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    note: 'Google Gemini',
  },
];

export function getDefaultTextModelTemplate(protocol: ProviderProtocol) {
  return DEFAULT_TEXT_MODEL_TEMPLATES.find((item) => item.protocol === protocol) || DEFAULT_TEXT_MODEL_TEMPLATES[0];
}

export const DEFAULT_DEFAULTS: DefaultModels = {
  textToImage: '',
  imageToImage: '',
  reversePrompt: '',
  agent: '',
  promptOptimize: '',
  imageDescribe: '',
};

function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return value === 'google' || value === 'openai';
}

function isBuiltinImagePresetId(value: unknown): value is BuiltinImagePresetId {
  return typeof value === 'string' && value in BUILTIN_IMAGE_PRESETS;
}

function normalizeImageOutputSize(value: unknown, fallback: ImageOutputSize): ImageOutputSize {
  return value === '512' || value === '1K' || value === '2K' || value === '4K'
    ? value
    : fallback;
}

function inferBuiltinPresetId(raw: Partial<ImageModelConfig>): BuiltinImagePresetId {
  const candidate = raw.builtinPreset || raw.id || raw.modelId;
  if (isBuiltinImagePresetId(candidate)) return candidate;
  if (String(raw.protocol || '').trim() === 'google') return 'gemini-3-pro-image-preview';
  return 'gpt-image-2';
}

function isImageModelSource(value: unknown): value is ImageModelSource {
  return value === 'sub2api' || value === 'manual';
}

/**
 * 当前部署的代理端点(`<origin>/api/proxy`)。
 * 本应用锁定为 sub2api 客户端:所有模型只走我们的后端代理,不允许指向外部服务。
 * SSR/无 window 时回退相对路径(仅用于占位,真实请求都在浏览器侧)。
 */
function proxyEndpoint(): string {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return origin + PROXY_BASE_PATH;
}

/**
 * 强制把模型收口为「走我们的代理」:source 固定 sub2api、apiKey 用哨兵(发请求时换 live JWT)、
 * baseUrl 固定当前 origin 的代理路径。用于加载/保存归一,顺带纠正历史残留(如旧的
 * localhost:3000/api/proxy 或外部 baseUrl)。仅保留用户可选的 keyId。
 */
function lockToProxy<T extends { protocol: ProviderProtocol; apiKey: string; baseUrl: string; source?: ImageModelSource }>(model: T): T {
  return {
    ...model,
    apiKey: SUB2API_PROXY_API_KEY,
    baseUrl: proxyEndpoint(),
    source: 'sub2api',
  };
}

function normalizeImageModelConfig(raw: Partial<ImageModelConfig>): ImageModelConfig | null {
  const presetId = inferBuiltinPresetId(raw);
  const preset = BUILTIN_IMAGE_PRESETS[presetId];
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const protocol = isProviderProtocol(raw.protocol) ? raw.protocol : preset.protocol;
  const model: ImageModelConfig = {
    id,
    protocol,
    name: String(raw.name || '').trim(),
    modelId: String(raw.modelId || '').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    baseUrl: String(raw.baseUrl || preset.baseUrl).trim(),
    builtinPreset: presetId,
    maxRefImages: Number.isFinite(raw.maxRefImages) && Number(raw.maxRefImages) > 0
      ? Math.max(1, Math.floor(Number(raw.maxRefImages)))
      : preset.maxRefImages,
    maxOutputSize: normalizeImageOutputSize(raw.maxOutputSize, preset.maxOutputSize),
    supportsAdvancedParams: protocol === 'openai'
      ? (typeof raw.supportsAdvancedParams === 'boolean' ? raw.supportsAdvancedParams : preset.supportsAdvancedParams)
      : false,
  };

  // 可选字段:仅在合法时保留,保持旧配置向后兼容。
  if (isImageModelSource(raw.source)) {
    model.source = raw.source;
  }
  if (raw.keyId !== undefined && raw.keyId !== null && String(raw.keyId).trim()) {
    model.keyId = String(raw.keyId).trim();
  }
  // 收口:所有图片模型只走我们的代理(纠正历史残留 / 外部 baseUrl)。
  return lockToProxy(model);
}

function normalizeTextModelConfig(raw: Partial<TextModelConfig>): TextModelConfig | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const protocol = isProviderProtocol(raw.protocol) ? raw.protocol : 'openai';
  const template = getDefaultTextModelTemplate(protocol);
  const model: TextModelConfig = {
    id,
    protocol,
    name: String(raw.name || '').trim(),
    modelId: String(raw.modelId || '').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    baseUrl: String(raw.baseUrl || template.baseUrl).trim(),
    note: typeof raw.note === 'string' ? raw.note : template.note,
  };

  // 可选字段:仅在合法时保留,保持旧配置向后兼容。
  if (isImageModelSource(raw.source)) {
    model.source = raw.source;
  }
  if (raw.keyId !== undefined && raw.keyId !== null && String(raw.keyId).trim()) {
    model.keyId = String(raw.keyId).trim();
  }
  // 收口:所有文本模型只走我们的代理(纠正历史残留 / 外部 baseUrl)。
  return lockToProxy(model);
}

function isCompleteImageModel(model: Partial<ImageModelConfig>): model is ImageModelConfig {
  return Boolean(
    model.id
    && model.name?.trim()
    && model.modelId?.trim()
    && model.apiKey?.trim()
    && model.baseUrl?.trim()
  );
}

function isCompleteTextModel(model: Partial<TextModelConfig>): model is TextModelConfig {
  return Boolean(
    model.id
    && model.name?.trim()
    && model.modelId?.trim()
    && model.apiKey?.trim()
    && model.baseUrl?.trim()
  );
}

function ensureImageModels(raw?: unknown): ImageModelConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeImageModelConfig((item || {}) as Partial<ImageModelConfig>))
    .filter((item): item is ImageModelConfig => Boolean(item))
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
}

function ensureTextModels(raw?: unknown): TextModelConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeTextModelConfig((item || {}) as Partial<TextModelConfig>))
    .filter((item): item is TextModelConfig => Boolean(item))
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
}

function ensureDefaults(raw: Partial<DefaultModels> | undefined, imageModels: ImageModelConfig[], textModels: TextModelConfig[]): DefaultModels {
  const completeImageModels = imageModels.filter(isCompleteImageModel);
  const completeTextModels = textModels.filter(isCompleteTextModel);
  const firstImageModelId = completeImageModels[0]?.id || '';
  const firstTextModelId = completeTextModels[0]?.id || '';
  const next = { ...DEFAULT_DEFAULTS, ...raw };

  if (!completeImageModels.some((model) => model.id === next.textToImage)) next.textToImage = firstImageModelId;
  if (!completeImageModels.some((model) => model.id === next.imageToImage)) next.imageToImage = firstImageModelId;
  if (!completeTextModels.some((model) => model.id === next.reversePrompt)) next.reversePrompt = firstTextModelId;
  if (!completeTextModels.some((model) => model.id === next.agent)) next.agent = firstTextModelId;
  if (!completeTextModels.some((model) => model.id === next.promptOptimize)) next.promptOptimize = firstTextModelId;
  if (!completeTextModels.some((model) => model.id === next.imageDescribe)) next.imageDescribe = firstTextModelId;

  return next;
}

function getInitialRegistry(): NovaModelRegistry {
  return {
    imageModels: [],
    textModels: [],
    defaults: DEFAULT_DEFAULTS,
  };
}

export function loadRegistry(): NovaModelRegistry {
  if (typeof window === 'undefined') {
    return getInitialRegistry();
  }

  const raw = localStorage.getItem(REGISTRY_KEY);
  if (!raw) {
    return getInitialRegistry();
  }

  const parsed = JSON.parse(raw) as Partial<NovaModelRegistry>;
  const imageModels = ensureImageModels(parsed.imageModels);
  const textModels = ensureTextModels(parsed.textModels);
  const defaults = ensureDefaults(parsed.defaults, imageModels, textModels);
  return { imageModels, textModels, defaults };
}

export function saveRegistry(registry: NovaModelRegistry): void {
  if (typeof window === 'undefined') return;

  const imageModels = ensureImageModels(registry.imageModels);
  const textModels = ensureTextModels(registry.textModels);
  const normalized: NovaModelRegistry = {
    imageModels,
    textModels,
    defaults: ensureDefaults(registry.defaults, imageModels, textModels),
  };

  localStorage.setItem(REGISTRY_KEY, JSON.stringify(normalized));
}

export function getImageModelById(registry: NovaModelRegistry, id: string): ImageModelConfig | undefined {
  return registry.imageModels.find((model) => model.id === id);
}

export function getTextModelById(registry: NovaModelRegistry, id: string): TextModelConfig | undefined {
  return registry.textModels.find((model) => model.id === id);
}

export function getDefaultImageModel(
  registry: NovaModelRegistry,
  task: keyof Pick<DefaultModels, 'textToImage' | 'imageToImage'>,
): ImageModelConfig | undefined {
  return getImageModelById(registry, registry.defaults[task]);
}

export function getDefaultTextModel(
  registry: NovaModelRegistry,
  task: keyof Pick<DefaultModels, 'reversePrompt' | 'agent' | 'promptOptimize' | 'imageDescribe'>,
): TextModelConfig | undefined {
  return getTextModelById(registry, registry.defaults[task]);
}

export function getCompleteImageModels(registry: NovaModelRegistry): ImageModelConfig[] {
  return registry.imageModels.filter(isCompleteImageModel);
}

export function getCompleteTextModels(registry: NovaModelRegistry): TextModelConfig[] {
  return registry.textModels.filter(isCompleteTextModel);
}

export function getImageModelOutputSizes(model: ImageModelConfig): ImageOutputSize[] {
  switch (model.maxOutputSize) {
    case '4K':
      return model.builtinPreset === 'gemini-3.1-flash-image-preview'
        ? ['512', '1K', '2K', '4K']
        : ['1K', '2K', '4K'];
    case '2K':
      return model.builtinPreset === 'gemini-3.1-flash-image-preview'
        ? ['512', '1K', '2K']
        : ['1K', '2K'];
    case '512':
      return ['512'];
    case '1K':
    default:
      return model.builtinPreset === 'gemini-3.1-flash-image-preview'
        ? ['512', '1K']
        : ['1K'];
  }
}

export function generateModelId(prefix: string = 'model'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Matches internal ids produced by generateModelId, e.g. `sub2api_1782097476153_137ok0`.
const INTERNAL_ID_PATTERN = /^(img|txt|sub2api|model)_\d{10,}_[a-z0-9]+$/i;

function usableLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (INTERNAL_ID_PATTERN.test(trimmed)) return '';
  return trimmed;
}

// Returns a human-readable label for a model. Historical dirty data stored the
// internal generated id in `name`, so we skip it when it looks like one and fall
// back to the real modelId, then the id.
export function humanModelName(model: {
  name?: string;
  modelId?: string;
  id?: string;
}): string {
  return usableLabel(model.name) || usableLabel(model.modelId) || usableLabel(model.id) || '未命名模型';
}
