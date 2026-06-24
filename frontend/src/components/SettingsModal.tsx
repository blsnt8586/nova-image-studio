'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  ImageIcon,
  Info,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { BackupProgress } from '@/components/BackupProgress';
import {
  BUILTIN_IMAGE_PRESETS,
  DEFAULT_DEFAULTS,
  generateModelId,
  getImageModelOutputSizes,
  humanModelName,
  loadRegistry,
  saveRegistry,
  type DefaultModels,
  type ImageModelConfig,
  type TextModelConfig,
} from '@/lib/nova-models';
import { syncDynamicModelExports } from '@/lib/gemini-config';
import { exportAllData, importAllData, downloadBlob, generateBackupFilename, type BackupProgress as BackupProgressType } from '@/lib/backup-utils';
import { checkModelsAvailability, type ModelStatus } from '@/lib/ccode-task-client';
import { loadSub2apiKeys, loadSub2apiModels, PROXY_BASE_PATH, type Sub2apiKeyEntry, type Sub2apiModelEntry } from '@/lib/sub2api-bootstrap';
import { SUB2API_PROXY_API_KEY } from '@/lib/sub2api-token';
import { hasAnyApiKey } from '@/lib/settings-storage';
import { BA_RANDOM_URL, BING_WALLPAPER_URL } from '@/lib/constants';
import { PROMPT_DATA_SOURCES, getPromptSourceLabel } from '@/lib/prompt-gallery-data';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApiKeyChange?: (hasKey: boolean) => void;
}

function cloneImageModel(model: ImageModelConfig): ImageModelConfig {
  return { ...model };
}

function cloneTextModel(model: TextModelConfig): TextModelConfig {
  return { ...model };
}

/** 图片模型草稿:固定走 sub2api 代理,apiKey 用哨兵,baseUrl 固定,modelId/keyId 待用户选择。 */
function createImageModelDraft(origin: string): ImageModelConfig {
  const preset = BUILTIN_IMAGE_PRESETS['gpt-image-2'];
  return {
    id: generateModelId('img'),
    protocol: 'openai',
    name: '',
    modelId: '',
    apiKey: SUB2API_PROXY_API_KEY,
    baseUrl: origin + PROXY_BASE_PATH,
    builtinPreset: preset.id,
    maxRefImages: preset.maxRefImages,
    maxOutputSize: preset.maxOutputSize,
    supportsAdvancedParams: preset.supportsAdvancedParams,
    source: 'sub2api',
  };
}

/** 文本模型草稿:固定走 sub2api 代理,apiKey 用哨兵,baseUrl 固定,modelId/keyId 待用户选择。 */
function createTextModelDraft(origin: string): TextModelConfig {
  return {
    id: generateModelId('txt'),
    protocol: 'openai',
    name: '',
    modelId: '',
    apiKey: SUB2API_PROXY_API_KEY,
    baseUrl: origin + PROXY_BASE_PATH,
    note: 'sub2api',
    source: 'sub2api',
  };
}

function isCompleteImageModel(model: ImageModelConfig): boolean {
  return Boolean(model.name?.trim() && model.modelId?.trim() && model.apiKey?.trim() && model.baseUrl?.trim());
}

function isCompleteTextModel(model: TextModelConfig): boolean {
  return Boolean(model.name?.trim() && model.modelId?.trim() && model.apiKey?.trim() && model.baseUrl?.trim());
}

/**
 * 构造 sub2api API Key 下拉选项,label 始终显示 Key 名称。
 * 若当前选中的 keyId 不在已加载列表里(列表未就绪),补一条占位项,
 * 用列表中的同名或回退文案,避免直接把裸 keyId 当名称展示。
 */
function sub2apiKeyOptions(
  keys: Sub2apiKeyEntry[],
  selectedKeyId: string | undefined,
): Array<{ value: string; label: string }> {
  const options = keys.map((k) => ({ value: k.id, label: k.name || `Key #${k.id}` }));
  if (selectedKeyId && !options.some((o) => o.value === selectedKeyId)) {
    options.unshift({ value: selectedKeyId, label: `Key #${selectedKeyId}（加载中…）` });
  }
  return options;
}

// 把模型检测结果(status.modelId 实际是内部 id)解析为可读名称。
// 不能用 getTextModelLabel(...) || getImageModelLabel(...):未命中的一侧会
// 返回原始内部 id(真值),导致 || 短路,图片模型永远显示内部 id。
export function resolveModelStatusLabel(
  imageModels: ImageModelConfig[],
  textModels: TextModelConfig[],
  id: string,
): string {
  const found = imageModels.find((m) => m.id === id) || textModels.find((m) => m.id === id);
  return found ? humanModelName(found) : humanModelName({ name: '', modelId: '', id });
}

function normalizeDefaults(
  defaults: DefaultModels,
  imageModels: ImageModelConfig[],
  textModels: TextModelConfig[],
): DefaultModels {
  const completeImageModels = imageModels.filter(isCompleteImageModel);
  const completeTextModels = textModels.filter(isCompleteTextModel);
  const firstImageModelId = completeImageModels[0]?.id || '';
  const firstTextModelId = completeTextModels[0]?.id || '';

  return {
    textToImage: completeImageModels.some((model) => model.id === defaults.textToImage) ? defaults.textToImage : firstImageModelId,
    imageToImage: completeImageModels.some((model) => model.id === defaults.imageToImage) ? defaults.imageToImage : firstImageModelId,
    reversePrompt: completeTextModels.some((model) => model.id === defaults.reversePrompt) ? defaults.reversePrompt : firstTextModelId,
    agent: completeTextModels.some((model) => model.id === defaults.agent) ? defaults.agent : firstTextModelId,
    promptOptimize: completeTextModels.some((model) => model.id === defaults.promptOptimize) ? defaults.promptOptimize : firstTextModelId,
    imageDescribe: completeTextModels.some((model) => model.id === defaults.imageDescribe) ? defaults.imageDescribe : firstTextModelId,
  };
}

export function SettingsModal({ isOpen, onClose, onApiKeyChange }: SettingsModalProps) {
  const [imageModels, setImageModels] = useState<ImageModelConfig[]>([]);
  const [textModels, setTextModels] = useState<TextModelConfig[]>([]);
  const [defaults, setDefaults] = useState<DefaultModels>(DEFAULT_DEFAULTS);
  const [selectedImageModelId, setSelectedImageModelId] = useState('');
  const [selectedTextModelId, setSelectedTextModelId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkingModels, setCheckingModels] = useState(false);
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[] | null>(null);
  const [modelCheckError, setModelCheckError] = useState<string | null>(null);
  // sub2api API Key 列表(供模型下拉选 keyId)
  const [sub2apiKeys, setSub2apiKeys] = useState<Sub2apiKeyEntry[]>([]);
  // 各 keyId 可用模型缓存:`${keyId || '__default__'}` → 模型列表
  const [sub2apiModelsByKey, setSub2apiModelsByKey] = useState<Record<string, Sub2apiModelEntry[]>>({});
  // 正在加载模型的 keyId 集合(避免重复请求 / 显示加载态)
  const [loadingModelKeys, setLoadingModelKeys] = useState<Record<string, boolean>>({});

  const [backupProgress, setBackupProgress] = useState<BackupProgressType>({ percent: 0, message: '' });
  const [isBackupActive, setIsBackupActive] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 已发起/已完成加载的 cacheKey 集合(用 ref 防重,避免在 effect 中同步 setState)。
  const modelFetchStartedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    const registry = loadRegistry();
    setImageModels(registry.imageModels.map(cloneImageModel));
    setTextModels(registry.textModels.map(cloneTextModel));
    setDefaults(normalizeDefaults(registry.defaults, registry.imageModels, registry.textModels));
    setSelectedImageModelId(registry.imageModels[0]?.id || '');
    setSelectedTextModelId(registry.textModels[0]?.id || '');
    setError(null);
    setSuccess(null);
    setModelStatuses(null);
    setModelCheckError(null);
    setBackupError(null);
    setBackupSuccess(null);
    // 重置模型加载缓存(账户/Key 可能已变)
    modelFetchStartedRef.current = new Set();
    setSub2apiModelsByKey({});
    setLoadingModelKeys({});
  }, [isOpen]);

  // 弹窗打开时拉取 sub2api API Key 列表(用已存 JWT)。失败/无 token 静默置空。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadSub2apiKeys({})
      .then((keys) => {
        if (!cancelled) setSub2apiKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setSub2apiKeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 按需拉取某个 keyId 可用的模型列表(带缓存,避免重复请求)。
  // 仅在异步回调里 setState(不在渲染/effect 同步阶段),符合 React 副作用约束。
  const ensureModelsForKey = useCallback((keyId: string | undefined) => {
    const cacheKey = keyId && keyId.trim() ? keyId.trim() : '__default__';
    if (modelFetchStartedRef.current.has(cacheKey)) return;
    modelFetchStartedRef.current.add(cacheKey);
    setLoadingModelKeys((l) => ({ ...l, [cacheKey]: true }));
    void loadSub2apiModels(keyId, {})
      .then((models) => {
        setSub2apiModelsByKey((m) => ({ ...m, [cacheKey]: models }));
      })
      .catch(() => {
        setSub2apiModelsByKey((m) => ({ ...m, [cacheKey]: [] }));
      })
      .finally(() => {
        setLoadingModelKeys((l) => {
          const next = { ...l };
          delete next[cacheKey];
          return next;
        });
      });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setDefaults((prev) => {
      const next = normalizeDefaults(prev, imageModels, textModels);
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [imageModels, isOpen, textModels]);

  const selectedImageModel = useMemo(
    () => imageModels.find((model) => model.id === selectedImageModelId) || null,
    [imageModels, selectedImageModelId],
  );
  const selectedTextModel = useMemo(
    () => textModels.find((model) => model.id === selectedTextModelId) || null,
    [selectedTextModelId, textModels],
  );

  // 选中的 sub2api 模型变化(或其 keyId 变化)时,按需拉取该 key 的可用模型。
  useEffect(() => {
    if (!isOpen) return;
    if (selectedImageModel?.source === 'sub2api') ensureModelsForKey(selectedImageModel.keyId);
  }, [isOpen, selectedImageModel?.source, selectedImageModel?.keyId, ensureModelsForKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedTextModel?.source === 'sub2api') ensureModelsForKey(selectedTextModel.keyId);
  }, [isOpen, selectedTextModel?.source, selectedTextModel?.keyId, ensureModelsForKey]);

  // 取某个 sub2api 模型当前 keyId 对应的模型下拉选项。
  const modelOptionsFor = useCallback((keyId: string | undefined) => {
    const cacheKey = keyId && keyId.trim() ? keyId.trim() : '__default__';
    const list = sub2apiModelsByKey[cacheKey] || [];
    return list.map((m) => ({ value: m.id, label: m.name || m.id }));
  }, [sub2apiModelsByKey]);

  const isLoadingModelsFor = useCallback((keyId: string | undefined) => {
    const cacheKey = keyId && keyId.trim() ? keyId.trim() : '__default__';
    return !!loadingModelKeys[cacheKey];
  }, [loadingModelKeys]);

  const handleAddImageModel = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const draft = createImageModelDraft(origin);
    setImageModels((prev) => [...prev, draft]);
    setSelectedImageModelId(draft.id);
    ensureModelsForKey(draft.keyId);
  };

  const handleUpdateImageModel = (id: string, patch: Partial<ImageModelConfig>) => {
    setImageModels((prev) => prev.map((model) => {
      if (model.id !== id) return model;
      const next = { ...model, ...patch };
      if (patch.builtinPreset) {
        const preset = BUILTIN_IMAGE_PRESETS[patch.builtinPreset];
        next.protocol = preset.protocol;
        next.name = preset.name;
        next.modelId = preset.modelId;
        // sub2api 模型的 baseUrl 固定指向代理,不随预设重置
        if (model.source !== 'sub2api') {
          next.baseUrl = preset.baseUrl;
        }
        next.maxRefImages = preset.maxRefImages;
        next.maxOutputSize = preset.maxOutputSize;
        next.supportsAdvancedParams = preset.supportsAdvancedParams;
      }
      if (patch.protocol === 'google') {
        next.supportsAdvancedParams = false;
      }
      // sub2api 模型切换 Key 时清空已选模型(不同 Key 可用模型可能不同),并触发拉取。
      if (model.source === 'sub2api' && patch.keyId !== undefined && patch.keyId !== model.keyId) {
        next.modelId = '';
        ensureModelsForKey(patch.keyId);
      }
      return next;
    }));
  };

  const handleDeleteImageModel = (id: string) => {
    const nextModels = imageModels.filter((model) => model.id !== id);
    setImageModels(nextModels);
    setDefaults((prev) => ({
      ...prev,
      textToImage: prev.textToImage === id ? '' : prev.textToImage,
      imageToImage: prev.imageToImage === id ? '' : prev.imageToImage,
    }));
    if (selectedImageModelId === id) {
      setSelectedImageModelId(nextModels[0]?.id || '');
    }
  };

  const handleAddTextModel = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const draft = createTextModelDraft(origin);
    setTextModels((prev) => [...prev, draft]);
    setSelectedTextModelId(draft.id);
    ensureModelsForKey(draft.keyId);
  };

  const handleUpdateTextModel = (id: string, patch: Partial<TextModelConfig>) => {
    setTextModels((prev) => prev.map((model) => {
      if (model.id !== id) return model;
      const next = { ...model, ...patch };
      // sub2api 模型切换 Key 时清空已选模型,并触发拉取。
      if (model.source === 'sub2api' && patch.keyId !== undefined && patch.keyId !== model.keyId) {
        next.modelId = '';
        ensureModelsForKey(patch.keyId);
      }
      return next;
    }));
  };

  const handleDeleteTextModel = (id: string) => {
    const nextModels = textModels.filter((model) => model.id !== id);
    setTextModels(nextModels);
    setDefaults((prev) => ({
      ...prev,
      reversePrompt: prev.reversePrompt === id ? '' : prev.reversePrompt,
      agent: prev.agent === id ? '' : prev.agent,
      promptOptimize: prev.promptOptimize === id ? '' : prev.promptOptimize,
      imageDescribe: prev.imageDescribe === id ? '' : prev.imageDescribe,
    }));
    if (selectedTextModelId === id) {
      setSelectedTextModelId(nextModels[0]?.id || '');
    }
  };

  const persistRegistry = () => {
    if (imageModels.length === 0) {
      setError('至少填写一个图片模型');
      return;
    }
    if (textModels.length === 0) {
      setError('至少填写一个文本模型');
      return;
    }
    if (!imageModels.some(isCompleteImageModel)) {
      setError('至少完成一个图片模型的全部信息');
      return;
    }
    if (!textModels.some(isCompleteTextModel)) {
      setError('至少完成一个文本模型的全部信息');
      return;
    }

    const registry = {
      imageModels,
      textModels,
      defaults: normalizeDefaults(defaults, imageModels, textModels),
    };

    saveRegistry(registry);
    syncDynamicModelExports();
    window.dispatchEvent(new Event('nova-model-registry-updated'));
    onApiKeyChange?.(hasAnyApiKey());
    setSuccess('设置已保存');
    setError(null);
    setModelStatuses(null);
    setModelCheckError(null);
  };

  const handleCheckModels = async () => {
    const configuredModels = [
      ...imageModels.filter(isCompleteImageModel),
      ...textModels.filter(isCompleteTextModel),
    ];
    if (configuredModels.length === 0) {
      setModelCheckError('请先完成至少一个图片模型或文本模型配置');
      return;
    }

    setCheckingModels(true);
    setModelCheckError(null);
    setModelStatuses(null);
    try {
      const statuses = await checkModelsAvailability(configuredModels.map((model) => model.id));
      setModelStatuses(statuses);
      if (statuses.length === 0) {
        // checkModelsAvailability 只校验「已保存」registry 里的模型。
        // 若有未保存的新增/修改,这里会查不到 → 提示先保存。
        setModelCheckError('没有可检查的已保存模型。如果刚新增或修改了模型,请先点「保存设置」再检查。');
      }
    } catch (err) {
      setModelCheckError(err instanceof Error ? err.message : '检查模型失败');
    } finally {
      setCheckingModels(false);
    }
  };

  const handleExport = async () => {
    setIsBackupActive(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const blob = await exportAllData((progress) => setBackupProgress(progress));
      const filename = generateBackupFilename();
      downloadBlob(blob, filename);
      setBackupSuccess(`数据已成功导出为 ${filename}`);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setIsBackupActive(false);
    }
  };

  const handleImport = async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setBackupError('请选择有效的备份文件（.zip 格式）');
      return;
    }

    setIsBackupActive(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      await importAllData(file, (progress) => setBackupProgress(progress));
      setBackupSuccess('数据已成功导入，页面将在 2 秒后刷新。');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '导入失败');
      setIsBackupActive(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleImport(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const completeImageOptions = imageModels.filter(isCompleteImageModel).map((model) => ({ value: model.id, label: humanModelName(model) }));
  const completeTextOptions = textModels.filter(isCompleteTextModel).map((model) => ({ value: model.id, label: humanModelName(model) }));
  const selectedImageOutputSizes = selectedImageModel ? getImageModelOutputSizes(selectedImageModel) : ['1K'];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && isBackupActive) return;
      if (!open) onClose();
    }}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden p-0 pt-0 gap-0 sm:max-w-5xl">
        <DialogHeader className="p-4 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <DialogTitle>设置</DialogTitle>
          </div>
          <DialogDescription>按模型分别配置协议、URL 和 API Key。至少完成一个图片模型和一个文本模型后，外部功能才会解锁。</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="models" className="min-h-0 flex-1 gap-0">
          <TabsList className="w-full rounded-none border-b bg-transparent h-auto p-0">
            <TabsTrigger value="models" className="gap-2 rounded-none border-b-2 border-transparent data-active:border-primary data-active:bg-transparent data-active:shadow-none px-4 py-3">
              <ImageIcon className="w-4 h-4" />
              模型配置
            </TabsTrigger>
            <TabsTrigger value="backup" className="gap-2 rounded-none border-b-2 border-transparent data-active:border-primary data-active:bg-transparent data-active:shadow-none px-4 py-3">
              <Database className="w-4 h-4" />
              备份
            </TabsTrigger>
            <TabsTrigger value="about" className="gap-2 rounded-none border-b-2 border-transparent data-active:border-primary data-active:bg-transparent data-active:shadow-none px-4 py-3">
              <Info className="w-4 h-4" />
              关于
            </TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="min-h-0 overflow-y-auto p-4 sm:p-6 mt-0 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">模型级独立配置</p>
                <p className="text-xs text-muted-foreground">每个模型选择 API Key 与模型 ID 即可,统一经本服务代理调用。外部只显示配置完整的模型。</p>
              </div>
              <Button onClick={persistRegistry} className="gap-2">
                <Save className="w-4 h-4" />
                保存设置
              </Button>
            </div>

            {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">{success}</div>}

            <div className="rounded-xl border p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">图片模型</p>
                  <p className="text-xs text-muted-foreground">无默认示范记录。请至少完成一个图片模型。</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleAddImageModel}>
                  <Plus className="w-4 h-4" />
                  新增图片模型
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-2">
                  {imageModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setSelectedImageModelId(model.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selectedImageModelId === model.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                    >
                      <div className="font-medium">{humanModelName(model)}</div>
                      <div className="text-xs text-muted-foreground">{isCompleteImageModel(model) ? '配置完成' : '待补全'}</div>
                    </button>
                  ))}
                </div>

                {selectedImageModel && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">API Key</label>
                      <Select
                        value={selectedImageModel.keyId || ''}
                        onValueChange={(value) => handleUpdateImageModel(selectedImageModel.id, { keyId: value })}
                        options={sub2apiKeyOptions(sub2apiKeys, selectedImageModel.keyId)}
                      />
                      <p className="text-xs text-muted-foreground">由 sub2api 提供,可选;留空将使用账户的第一个 Key。</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">模型 ID</label>
                      <Select
                        value={selectedImageModel.modelId}
                        onValueChange={(value) => {
                          const opt = modelOptionsFor(selectedImageModel.keyId).find((o) => o.value === value);
                          handleUpdateImageModel(selectedImageModel.id, {
                            modelId: value,
                            ...(selectedImageModel.name?.trim() ? {} : { name: opt?.label || value }),
                          });
                        }}
                        options={modelOptionsFor(selectedImageModel.keyId)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {isLoadingModelsFor(selectedImageModel.keyId)
                          ? '正在加载该 Key 可用的模型…'
                          : modelOptionsFor(selectedImageModel.keyId).length === 0
                            ? '未获取到可用模型,请确认已选择正确的 API Key。'
                            : '从该 API Key 可用的模型中选择(图片模型请选图片类模型)。'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">显示名称</label>
                      <Input value={selectedImageModel.name} onChange={(event) => handleUpdateImageModel(selectedImageModel.id, { name: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">最大参考图数量</label>
                      <Input type="number" min={1} value={selectedImageModel.maxRefImages} onChange={(event) => handleUpdateImageModel(selectedImageModel.id, { maxRefImages: Number(event.target.value) || 1 })} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">最大分辨率</label>
                      <Select
                        value={selectedImageModel.maxOutputSize}
                        onValueChange={(value) => handleUpdateImageModel(selectedImageModel.id, { maxOutputSize: value as ImageModelConfig['maxOutputSize'] })}
                        options={selectedImageOutputSizes.map((size) => ({ value: size, label: size === '512' ? '0.5K' : size }))}
                      />
                    </div>
                    {selectedImageModel.protocol === 'openai' && (
                      <div className="flex items-center justify-between rounded-lg border px-3 py-2 md:col-span-2">
                        <div>
                          <p className="text-sm font-medium">Image 2 额外参数</p>
                          <p className="text-xs text-muted-foreground">透明度、质量、风格控件默认开启，用户可手动关闭。</p>
                        </div>
                        <Switch
                          checked={selectedImageModel.supportsAdvancedParams}
                          onCheckedChange={(checked) => handleUpdateImageModel(selectedImageModel.id, { supportsAdvancedParams: checked })}
                        />
                      </div>
                    )}
                    <div className="md:col-span-2 flex justify-end">
                      <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => handleDeleteImageModel(selectedImageModel.id)}>
                        <Trash2 className="w-4 h-4" />
                        删除模型
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">文本模型</p>
                  <p className="text-xs text-muted-foreground">无默认示范记录。请至少完成一个文本模型。</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleAddTextModel}>
                  <Plus className="w-4 h-4" />
                  新增文本模型
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-2">
                  {textModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setSelectedTextModelId(model.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selectedTextModelId === model.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                    >
                      <div className="font-medium">{humanModelName(model)}</div>
                      <div className="text-xs text-muted-foreground">{isCompleteTextModel(model) ? '配置完成' : '待补全'}</div>
                    </button>
                  ))}
                </div>

                {selectedTextModel && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">API Key</label>
                      <Select
                        value={selectedTextModel.keyId || ''}
                        onValueChange={(value) => handleUpdateTextModel(selectedTextModel.id, { keyId: value })}
                        options={sub2apiKeyOptions(sub2apiKeys, selectedTextModel.keyId)}
                      />
                      <p className="text-xs text-muted-foreground">由 sub2api 提供,可选;留空将使用账户的第一个 Key。</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">模型 ID</label>
                      <Select
                        value={selectedTextModel.modelId}
                        onValueChange={(value) => {
                          const opt = modelOptionsFor(selectedTextModel.keyId).find((o) => o.value === value);
                          handleUpdateTextModel(selectedTextModel.id, {
                            modelId: value,
                            ...(selectedTextModel.name?.trim() ? {} : { name: opt?.label || value }),
                          });
                        }}
                        options={modelOptionsFor(selectedTextModel.keyId)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {isLoadingModelsFor(selectedTextModel.keyId)
                          ? '正在加载该 Key 可用的模型…'
                          : modelOptionsFor(selectedTextModel.keyId).length === 0
                            ? '未获取到可用模型,请确认已选择正确的 API Key。'
                            : '从该 API Key 可用的模型中选择(文本模型请选文本类模型)。'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">显示名称</label>
                      <Input value={selectedTextModel.name} onChange={(event) => handleUpdateTextModel(selectedTextModel.id, { name: event.target.value })} />
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                      <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => handleDeleteTextModel(selectedTextModel.id)}>
                        <Trash2 className="w-4 h-4" />
                        删除模型
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">默认模型</p>
                  <p className="text-xs text-muted-foreground">这里只会显示已经配置完整的模型。</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleCheckModels} disabled={checkingModels}>
                  <RefreshCw className={`w-4 h-4 ${checkingModels ? 'animate-spin' : ''}`} />
                  {checkingModels ? '检查中...' : '检查模型'}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">文生图默认模型</label>
                  <Select value={defaults.textToImage} onValueChange={(value) => setDefaults((prev) => ({ ...prev, textToImage: value }))} options={completeImageOptions} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">图生图默认模型</label>
                  <Select value={defaults.imageToImage} onValueChange={(value) => setDefaults((prev) => ({ ...prev, imageToImage: value }))} options={completeImageOptions} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">反推提示词默认模型</label>
                  <Select value={defaults.reversePrompt} onValueChange={(value) => setDefaults((prev) => ({ ...prev, reversePrompt: value }))} options={completeTextOptions} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Agent 默认模型</label>
                  <Select value={defaults.agent} onValueChange={(value) => setDefaults((prev) => ({ ...prev, agent: value }))} options={completeTextOptions} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">提示词优化默认模型</label>
                  <Select value={defaults.promptOptimize} onValueChange={(value) => setDefaults((prev) => ({ ...prev, promptOptimize: value }))} options={completeTextOptions} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">图片描述默认模型</label>
                  <Select value={defaults.imageDescribe} onValueChange={(value) => setDefaults((prev) => ({ ...prev, imageDescribe: value }))} options={completeTextOptions} />
                </div>
              </div>

              {modelCheckError && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{modelCheckError}</div>}
              {modelStatuses && (
                <div className="grid gap-2 md:grid-cols-2">
                  {modelStatuses.map((status) => (
                    <div key={status.modelId} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{resolveModelStatusLabel(imageModels, textModels, status.modelId)}</div>
                        <div className="truncate text-xs text-muted-foreground">{status.message || status.actualName || status.modelId}</div>
                      </div>
                      {status.available ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-destructive" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="backup" className="min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 mt-0">
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-base font-medium">数据备份与恢复</h3>
                <p className="text-sm text-muted-foreground">导出所有数据（模型配置、任务历史、设置、图片）为 ZIP 压缩包，或从备份文件恢复数据。</p>
              </div>

              <BackupProgress percent={backupProgress.percent} message={backupProgress.message} isActive={isBackupActive} />

              {backupSuccess && !isBackupActive && (
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600 dark:text-emerald-500 mt-0.5" />
                  <p className="text-sm text-emerald-900 dark:text-emerald-100">{backupSuccess}</p>
                </div>
              )}

              {backupError && !isBackupActive && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
                  <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive break-all">{backupError}</p>
                </div>
              )}

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <Download className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <h4 className="font-medium">导出数据</h4>
                    <p className="text-sm text-muted-foreground">将所有数据打包为 ZIP 文件下载到本地。备份文件包含模型配置和本地记录，请自行保管。</p>
                    <Button onClick={handleExport} disabled={isBackupActive} className="gap-2">
                      <Download className="w-4 h-4" />
                      全量备份
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <Upload className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <h4 className="font-medium">导入数据</h4>
                    <p className="text-sm text-muted-foreground">从备份文件恢复数据。<span className="font-medium text-destructive">警告：这会覆盖现有数据。</span></p>
                    <input ref={fileInputRef} type="file" accept=".zip" onChange={handleFileSelect} className="hidden" />
                    <Button onClick={() => fileInputRef.current?.click()} disabled={isBackupActive} variant="outline" className="gap-2">
                      <Upload className="w-4 h-4" />
                      选择备份文件
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="about" className="min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 mt-0">
            <div className="space-y-4 text-sm">
              <h3 className="text-lg font-medium">Nova Image <span className="text-xs text-muted-foreground font-normal">v{process.env.NEXT_PUBLIC_APP_VERSION}</span></h3>
              <p className="text-sm text-muted-foreground">
                项目地址：
                {' '}
                <a
                  href="https://github.com/tianjiangqiji/nova-image-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  tianjiangqiji/nova-image-studio <ExternalLink className="w-3 h-3" />
                </a>
              </p>

              <details className="group rounded-lg bg-muted/50 p-3">
                <summary className="flex cursor-pointer select-none items-center gap-2 font-medium">
                  <span className="text-[10px] opacity-60 transition-transform group-open:rotate-90">▶</span>
                  使用方法
                </summary>
                <ol className="mt-3 list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>先完成至少一个图片模型和一个文本模型的全部信息。</li>
                  <li>保存后，外部工作区只会显示这些配置完整的模型。</li>
                  <li>再为各工作流指定默认模型，即可开始生图、反推或 Agent 工作流。</li>
                </ol>
              </details>

              <details className="group rounded-lg bg-muted/50 p-3">
                <summary className="flex cursor-pointer select-none items-center gap-2 font-medium">
                  <span className="text-[10px] opacity-60 transition-transform group-open:rotate-90">▶</span>
                  数据来源
                </summary>
                <ul className="mt-3 list-disc list-inside space-y-2 text-muted-foreground">
                  <li>
                    <span className="text-foreground">提示词广场</span> - 提示词来源：
                    <ul className="mt-1 ml-5 list-disc list-inside space-y-1">
                      {PROMPT_DATA_SOURCES.map((source) => (
                        <li key={source.name}>
                          <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            {getPromptSourceLabel(source.sourceUrl)} <ExternalLink className="w-3 h-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li>
                    <span className="text-foreground">随机图片 · BA人物</span> -{' '}
                    <a href={BA_RANDOM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      img.catcdn.cn <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                  <li>
                    <span className="text-foreground">随机图片 · Bing壁纸</span> -{' '}
                    <a href={BING_WALLPAPER_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      bing.img.run <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                </ul>
              </details>

              <details className="group rounded-lg bg-muted/50 p-3">
                <summary className="flex cursor-pointer select-none items-center gap-2 font-medium">
                  <span className="text-[10px] opacity-60 transition-transform group-open:rotate-90">▶</span>
                  隐私条款
                </summary>
                <ul className="mt-3 list-disc list-inside space-y-2 text-muted-foreground">
                  <li>本站为本地优先应用：模型配置、任务历史、设置与生成图片默认保存在你的浏览器本地。</li>
                  <li>所有模型调用统一经本服务代理转发,不直连第三方上游,你的密钥不会进入浏览器。</li>
                  <li>生图、反推、Agent、提示词优化等功能会把你当前选择的提示词、参考图或对话内容发送到对应模型配置的上游接口。</li>
                  <li>备份文件可能包含模型配置、本地任务记录与图片数据，请自行妥善保管。</li>
                </ul>
              </details>

              <details className="group rounded-lg bg-muted/50 p-3">
                <summary className="flex cursor-pointer select-none items-center gap-2 font-medium">
                  <span className="text-[10px] opacity-60 transition-transform group-open:rotate-90">▶</span>
                  参考项目
                </summary>
                <ul className="mt-3 list-disc list-inside space-y-2 text-muted-foreground">
                  <li>
                    项目仓库：
                    {' '}
                    <a href="https://github.com/tianjiangqiji/nova-image-studio" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      tianjiangqiji/nova-image-studio <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                  <li>
                    基于
                    {' '}
                    <a href="https://github.com/aaronkwhite/nanobanana-studio-web" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      aaronkwhite/nanobanana-studio-web <ExternalLink className="w-3 h-3" />
                    </a>
                    {' '}
                    修改而来。
                  </li>
                  <li>
                    无限画布工作区参考
                    {' '}
                    <a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      basketikun/infinite-canvas <ExternalLink className="w-3 h-3" />
                    </a>
                    。
                  </li>
                </ul>
              </details>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
