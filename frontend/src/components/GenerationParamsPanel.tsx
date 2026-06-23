'use client';

import { useCallback } from 'react';
import { Sparkles, Maximize2, Layout, Layers, Zap, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { GptImageAdvancedParamsControl } from '@/components/GptImageAdvancedParamsControl';
import { cn } from '@/lib/utils';
import { MODEL_OPTIONS, isGptImageModel, type ModelId } from '@/lib/gemini-config';
import {
  getAspectRatioOptions,
  getGptImageAdvancedParamsForModel,
  getSizeOptions,
  supportsAutoLayout,
  supportsGptImageAdvancedParams,
  type GptImageAdvancedParams,
  type ParallelCount,
} from '@/lib/model-capabilities';
import type { OutputSize, AspectRatio } from '@/lib/job-store';

export type GenerationParamsValue = {
  model: ModelId;
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  parallelCount: ParallelCount;
  gptImageAdvancedParams: GptImageAdvancedParams;
};

interface GenerationParamsPanelProps {
  value: GenerationParamsValue;
  onChange: (patch: Partial<GenerationParamsValue>) => void;
  className?: string;
}

/**
 * 垂直展开的生成参数面板,每个参数一行(标签+控件+说明),替代紧凑的 GenerationParamsBar。
 * 用于生图工作台左侧,让用户清晰看到所有参数及其含义。
 */
export function GenerationParamsPanel({ value, onChange, className }: GenerationParamsPanelProps) {
  const model = value.model;
  const sizeOptions = getSizeOptions(model);
  const aspectRatioOptions = getAspectRatioOptions(model, value.outputSize);
  const supportsTemperature = !isGptImageModel(model);
  const supportsAdvancedParams = supportsGptImageAdvancedParams(model);
  const autoLayoutAvailable = supportsAutoLayout(model);
  const autoLayoutLocked = autoLayoutAvailable && value.outputSize === 'auto';
  const showSizeControl = model !== 'gpt-image-2';

  const handleModelChange = (newModel: ModelId) => {
    const nextGpt = getGptImageAdvancedParamsForModel(newModel, value.gptImageAdvancedParams);
    const nextSizeOptions = getSizeOptions(newModel);
    const nextOutputSize: OutputSize = value.outputSize === 'auto' && supportsAutoLayout(newModel)
      ? 'auto'
      : (nextSizeOptions.find(s => s.value === value.outputSize)?.value || nextSizeOptions[0].value);
    const aspectOptions = getAspectRatioOptions(newModel, nextOutputSize);
    const nextAspectRatio: AspectRatio = aspectOptions.find(a => a.value === value.aspectRatio)
      ? value.aspectRatio
      : (aspectOptions[0]?.value || '1:1');
    onChange({
      model: newModel,
      outputSize: nextOutputSize,
      customSize: undefined,
      aspectRatio: nextAspectRatio,
      gptImageAdvancedParams: nextGpt
    });
  };

  const handleSizeChange = (newSize: OutputSize) => {
    const aspectOptions = getAspectRatioOptions(model, newSize);
    const nextAspectRatio: AspectRatio = aspectOptions.find(a => a.value === value.aspectRatio)
      ? value.aspectRatio
      : (aspectOptions[0]?.value || '1:1');
    onChange({ outputSize: newSize, customSize: undefined, aspectRatio: nextAspectRatio });
  };

  const handleAutoLayoutChange = (enabled: boolean) => {
    if (enabled) {
      onChange({ outputSize: 'auto', aspectRatio: 'auto', customSize: undefined });
      return;
    }
    onChange({ outputSize: '1K', aspectRatio: '1:1' });
  };

  const handleAspectRatioChange = (newRatio: AspectRatio) => {
    onChange({ aspectRatio: newRatio, customSize: undefined });
  };

  const handleParallelCountChange = (count: ParallelCount) => {
    onChange({ parallelCount: count });
  };

  const handleAdvancedParamsChange = (nextParams: GptImageAdvancedParams) => {
    onChange({ gptImageAdvancedParams: nextParams });
  };

  return (
    <div className={cn('space-y-5 rounded-xl bg-gradient-to-br from-muted/30 to-muted/10 p-4', className)}>
      {/* 模型选择 */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <label className="text-xs font-semibold text-foreground">AI 模型</label>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODEL_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className={cn(
                'group cursor-pointer rounded-lg border-2 px-3.5 py-1.5 text-xs font-medium transition-all',
                model === opt.value
                  ? 'scale-105 border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                  : 'border-border/50 bg-background/80 hover:scale-[1.02] hover:border-primary/60 hover:bg-muted hover:shadow-md'
              )}
            >
              <input
                type="radio"
                name="model"
                value={opt.value}
                checked={model === opt.value}
                onChange={(e) => handleModelChange(e.target.value as ModelId)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* 输出尺寸 */}
      {showSizeControl && !autoLayoutLocked && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Maximize2 className="h-3.5 w-3.5 text-primary" />
            <label className="text-xs font-semibold text-foreground">输出尺寸</label>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map(opt => (
              <label
                key={opt.value}
                className={cn(
                  'cursor-pointer rounded-lg border-2 px-3.5 py-1.5 text-xs font-medium transition-all',
                  value.outputSize === opt.value
                    ? 'scale-105 border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                    : 'border-border/50 bg-background/80 hover:scale-[1.02] hover:border-primary/60 hover:bg-muted hover:shadow-md'
                )}
              >
                <input
                  type="radio"
                  name="outputSize"
                  value={opt.value}
                  checked={value.outputSize === opt.value}
                  onChange={(e) => handleSizeChange(e.target.value as OutputSize)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 宽高比 */}
      {!autoLayoutLocked && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Layout className="h-3.5 w-3.5 text-primary" />
            <label className="text-xs font-semibold text-foreground">宽高比</label>
          </div>
          <div className="flex flex-wrap gap-2">
            {aspectRatioOptions.map(opt => (
              <label
                key={opt.value}
                className={cn(
                  'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                  value.aspectRatio === opt.value
                    ? 'border-primary bg-primary text-primary-foreground shadow-md'
                    : 'border-border/50 bg-background/80 hover:border-primary/60 hover:bg-muted hover:shadow-sm'
                )}
              >
                <input
                  type="radio"
                  name="aspectRatio"
                  value={opt.value}
                  checked={value.aspectRatio === opt.value}
                  onChange={(e) => handleAspectRatioChange(e.target.value as AspectRatio)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 自动布局 + 并发数量 - 一行显示 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* 自动布局 */}
        {autoLayoutAvailable && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoLayoutLocked}
                onChange={(e) => handleAutoLayoutChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">自动布局</span>
                </div>
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  AI 自动选择最佳尺寸和宽高比
                </p>
              </div>
            </label>
          </div>
        )}

        {/* 并发数量 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-primary" />
              <label className="text-xs font-semibold text-foreground">并发数量</label>
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {value.parallelCount} 张
            </span>
          </div>
          <Slider
            value={[value.parallelCount]}
            onValueChange={([v]) => handleParallelCountChange(v as ParallelCount)}
            min={1}
            max={4}
            step={1}
            className="w-full"
          />
        </div>
      </div>

      {/* 温度 */}
      {supportsTemperature && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5 text-primary" />
              <label className="text-xs font-semibold text-foreground">创意度</label>
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {value.temperature.toFixed(1)}
            </span>
          </div>
          <Slider
            value={[value.temperature]}
            onValueChange={([v]) => onChange({ temperature: v })}
            min={0}
            max={2}
            step={0.1}
            className="w-full"
          />
          <p className="text-[10px] text-muted-foreground">
            较低值更精确，较高值更有创意
          </p>
        </div>
      )}

      {/* GPT-Image 高级设置 */}
      {supportsAdvancedParams && (
        <GptImageAdvancedParamsControl
          value={value.gptImageAdvancedParams}
          onChange={handleAdvancedParamsChange}
          variant="inline"
        />
      )}
    </div>
  );
}
