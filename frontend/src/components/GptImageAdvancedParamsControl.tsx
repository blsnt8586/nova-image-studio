'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  GPT_IMAGE_BACKGROUND_OPTIONS,
  GPT_IMAGE_QUALITY_OPTIONS,
  GPT_IMAGE_STYLE_OPTIONS,
  type GptImageAdvancedParams,
  type GptImageBackground,
  type GptImageQuality,
  type GptImageStyle,
} from '@/lib/model-capabilities';

interface GptImageAdvancedParamsControlProps {
  value: GptImageAdvancedParams;
  onChange: (value: GptImageAdvancedParams) => void;
  disabled?: boolean;
  /**
   * 展示形态:
   * - `inline`(默认):整宽按钮 + 就地展开,适合纵向参数面板。
   * - `chip`:紧凑 outline 小药丸 + Popover,和参数条里其他控件(模型/尺寸/比例等)统一。
   */
  variant?: 'inline' | 'chip';
}

export function GptImageAdvancedParamsControl({
  value,
  onChange,
  disabled = false,
  variant = 'inline',
}: GptImageAdvancedParamsControlProps) {
  const [expanded, setExpanded] = useState(false);

  const updateQuality = (quality: GptImageQuality) => onChange({ ...value, quality });
  const updateStyle = (style: GptImageStyle) => onChange({ ...value, style });
  const updateBackground = (background: GptImageBackground) => onChange({ ...value, background });

  const groups = (
    <>
      <ParamGroup label="质量" options={GPT_IMAGE_QUALITY_OPTIONS} value={value.quality} onSelect={updateQuality} />
      <ParamGroup label="风格" options={GPT_IMAGE_STYLE_OPTIONS} value={value.style} onSelect={updateStyle} />
      <ParamGroup label="背景" options={GPT_IMAGE_BACKGROUND_OPTIONS} value={value.background} onSelect={updateBackground} />
    </>
  );

  if (variant === 'chip') {
    return (
      <Popover open={expanded} onOpenChange={setExpanded}>
        <PopoverTrigger
          disabled={disabled}
          className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
          title="高级设置(质量 / 风格 / 背景)"
        >
          <SlidersHorizontal className="h-3 w-3" />
          <span className="text-[11px]">高级</span>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2.5" align="start">
          {groups}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="space-y-2.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        disabled={disabled}
        className="w-full text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <>
            <ChevronUp className="mr-1 h-3 w-3" />
            收起高级设置
          </>
        ) : (
          <>
            <ChevronDown className="mr-1 h-3 w-3" />
            高级设置
          </>
        )}
      </Button>

      {expanded && groups}
    </div>
  );
}

interface ParamGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
}

function ParamGroup<T extends string>({ label, options, value, onSelect }: ParamGroupProps<T>) {
  return (
    <div className="space-y-2.5">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <label
            key={option.value}
            className={cn(
              'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
              option.value === value
                ? 'border-primary bg-primary text-primary-foreground shadow-md'
                : 'border-border/50 bg-background/80 hover:border-primary/60 hover:bg-muted hover:shadow-sm'
            )}
          >
            <input
              type="radio"
              name={`param-${label}`}
              value={option.value}
              checked={option.value === value}
              onChange={() => onSelect(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
