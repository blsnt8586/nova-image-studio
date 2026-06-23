import type { ModelOption, OutputSize, AspectRatio } from '@/lib/gemini-config';

export interface GenerationSelection {
  model: string;
  outputSize: OutputSize | '';
  aspectRatio: AspectRatio | '';
}

export interface SelectionValidationResult {
  ok: boolean;
  /** 校验失败时的中文提示;成功为 undefined。 */
  message?: string;
}

/**
 * 生图提交前校验「AI 模型 / 输出尺寸 / 宽高比」是否已选择。
 *
 * - 模型:必须存在于当前可用模型选项(未配置模型时 options 为空 → 失败)。
 *   这能拦住新用户「默认占位模型其实没配置」的情况。
 * - 输出尺寸 / 宽高比:不能为空(`'auto'` 是合法的自动布局选择)。
 *
 * 多项缺失时按「模型 → 尺寸 → 比例」优先级返回第一条,提示更聚焦。
 */
export function validateGenerationSelection(
  selection: GenerationSelection,
  modelOptions: ModelOption[],
): SelectionValidationResult {
  const hasModel = Boolean(selection.model) && modelOptions.some((o) => o.value === selection.model);
  if (!hasModel) {
    return { ok: false, message: '请先选择 AI 模型(可在设置中配置图片模型)。' };
  }
  if (!selection.outputSize) {
    return { ok: false, message: '请先选择输出尺寸。' };
  }
  if (!selection.aspectRatio) {
    return { ok: false, message: '请先选择宽高比。' };
  }
  return { ok: true };
}
