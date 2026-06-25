'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactSketchCanvas, type ReactSketchCanvasRef } from 'react-sketch-canvas';
import { Brush, Eraser, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { getImageNaturalSize, paintDataUrlToMaskDataUrl } from '@/lib/mask-canvas';

interface MaskEditDialogProps {
  open: boolean;
  /** 被编辑的参考图(dataURL),作为涂抹底图。 */
  imageSrc: string;
  /** 预填提示词(来自工作台当前输入)。 */
  initialPrompt?: string;
  onOpenChange: (open: boolean) => void;
  /** 涂抹完成并确认:回传 mask dataURL 和本次提示词,直接触发生成。 */
  onSubmit: (maskDataUrl: string, prompt: string) => void;
}

const BRUSH_MIN = 8;
const BRUSH_MAX = 120;
const BRUSH_DEFAULT = 40;
// 涂抹笔刷用半透明红,方便用户看清已涂区域;导出后按 alpha 反相为 mask。
const BRUSH_COLOR = 'rgba(244, 63, 94, 0.5)';

// 画布最大显示边长(CSS 像素);导出时会按原图真实分辨率重采样。
const MAX_DISPLAY_SIDE = 760;

export function MaskEditDialog({ open, imageSrc, initialPrompt, onOpenChange, onSubmit }: MaskEditDialogProps) {
  const canvasRef = useRef<ReactSketchCanvasRef>(null);
  const [brushSize, setBrushSize] = useState(BRUSH_DEFAULT);
  const [erasing, setErasing] = useState(false);
  const [maskPrompt, setMaskPrompt] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时读取原图尺寸,按比例算出受限的显示尺寸。
  useEffect(() => {
    if (!open || !imageSrc) return;
    let cancelled = false;
    setError(null);
    setNaturalSize(null);
    setDisplaySize(null);
    getImageNaturalSize(imageSrc)
      .then(({ width, height }) => {
        if (cancelled) return;
        setNaturalSize({ width, height });
        // 动态计算可用空间：对话框其他内容约 350px（标题+工具栏+输入框+按钮+间距）
        const availableHeight = window.innerHeight * 0.9 - 350;
        const availableWidth = Math.min(900, window.innerWidth * 0.9) - 80; // 对话框padding
        const scale = Math.min(1, MAX_DISPLAY_SIDE / Math.max(width, height), availableHeight / height, availableWidth / width);
        setDisplaySize({ width: Math.round(width * scale), height: Math.round(height * scale) });
      })
      .catch(() => {
        if (!cancelled) setError('图片加载失败，无法编辑');
      });
    return () => {
      cancelled = true;
    };
  }, [open, imageSrc]);

  // 每次打开重置画笔/橡皮状态,并同步外部传入的初始提示词。
  useEffect(() => {
    if (!open) return;
    setErasing(false);
    setBrushSize(BRUSH_DEFAULT);
    setMaskPrompt(initialPrompt ?? '');
  }, [open]);

  const handleToggleEraser = useCallback((next: boolean) => {
    setErasing(next);
    canvasRef.current?.eraseMode(next);
  }, []);

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleClear = useCallback(() => {
    canvasRef.current?.resetCanvas();
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!naturalSize) return;
    if (!maskPrompt.trim()) {
      setError('请输入重绘描述');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const paintDataUrl = await canvasRef.current?.exportImage('png');
      if (!paintDataUrl) {
        setError('请先涂抹要修改的区域');
        return;
      }
      const maskDataUrl = await paintDataUrlToMaskDataUrl(paintDataUrl, naturalSize.width, naturalSize.height);
      if (!maskDataUrl) {
        setError('请先涂抹要修改的区域');
        return;
      }
      onSubmit(maskDataUrl, maskPrompt.trim());
      onOpenChange(false);
    } catch {
      setError('生成蒙版失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [naturalSize, maskPrompt, onSubmit, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>智能重绘</DialogTitle>
          <DialogDescription>
          涂抹要重新绘制的区域，未涂抹处会尽量保留。在下方输入描述后点「开始生成」直接提交。<br />
          <span className="text-xs">💡 提示：擦除内容时描述填「白色背景」或「延续周边背景」效果更准确，避免填「删除」。</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-3">
          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              <Button
                type="button"
                variant={erasing ? 'ghost' : 'default'}
                size="sm"
                className="gap-1"
                onClick={() => handleToggleEraser(false)}
              >
                <Brush className="h-4 w-4" />
                画笔
              </Button>
              <Button
                type="button"
                variant={erasing ? 'default' : 'ghost'}
                size="sm"
                className="gap-1"
                onClick={() => handleToggleEraser(true)}
              >
                <Eraser className="h-4 w-4" />
                橡皮
              </Button>
            </div>

            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">笔刷 {brushSize}</span>
              <Slider
                value={[brushSize]}
                onValueChange={value => setBrushSize(value[0])}
                min={BRUSH_MIN}
                max={BRUSH_MAX}
                step={2}
                className="flex-1"
              />
            </div>

            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={handleUndo}>
              <Undo2 className="h-4 w-4" />
              撤销
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={handleClear}>
              <RotateCcw className="h-4 w-4" />
              清空
            </Button>
          </div>

          {/* 涂抹画布 */}
          <div className="flex justify-center rounded-xl border bg-muted/30 p-3">
            {displaySize ? (
              <div
                className="overflow-hidden rounded-lg shadow-sm"
                style={{ width: displaySize.width, height: displaySize.height }}
              >
                <ReactSketchCanvas
                  ref={canvasRef}
                  width={`${displaySize.width}px`}
                  height={`${displaySize.height}px`}
                  strokeWidth={brushSize}
                  eraserWidth={brushSize}
                  strokeColor={BRUSH_COLOR}
                  canvasColor="transparent"
                  backgroundImage={imageSrc}
                  preserveBackgroundImageAspectRatio="xMidYMid meet"
                  withTimestamp={false}
                />
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {error || '正在加载图片…'}
              </div>
            )}
          </div>

          {error && displaySize && <p className="text-sm text-destructive">{error}</p>}

          {/* 重绘描述 */}
          <textarea
            value={maskPrompt}
            onChange={e => setMaskPrompt(e.target.value)}
            placeholder="描述要重新绘制的内容，例如：延续周边背景、替换为一束花…"
            rows={2}
            className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || !displaySize}>
            {busy ? '生成中…' : '开始生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
