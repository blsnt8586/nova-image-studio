'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface MissingApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigure: () => void;
  /**
   * 'configure'(默认):用户已有 sub2api API Key,但 nova 未选模型 → 引导打开设置。
   * 'create-key':用户在 sub2api 还没有任何 API Key → 引导去 sub2api 创建。
   */
  variant?: 'configure' | 'create-key';
}

const DIALOG_COPY = {
  configure: {
    title: '请先配置 API 密钥',
    description: 'Nova 模式需要先在设置中选择图片与文本模型，配置完成后即可生成或转换图片。',
    confirmLabel: '配置',
  },
  'create-key': {
    title: '你还没有 API 密钥',
    description: '使用 Nova 生图前，需要先在 sub2api 创建一个 API 密钥。点击下方按钮前往创建，创建完成后回到这里在设置中选择即可。',
    confirmLabel: '去创建',
  },
} as const;

export function MissingApiKeyDialog({
  open,
  onOpenChange,
  onConfigure,
  variant = 'configure',
}: MissingApiKeyDialogProps) {
  const copy = DIALOG_COPY[variant];

  const handleConfigure = () => {
    onOpenChange(false);
    onConfigure();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfigure}>
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
