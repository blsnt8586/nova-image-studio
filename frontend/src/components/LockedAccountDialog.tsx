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

export type AccountLockVariant = 'out-of-funds' | 'no-key';

interface LockedAccountDialogProps {
  open: boolean;
  variant: AccountLockVariant;
  /** 重新检测账户状态(充值/创建后自助恢复);通过则上层关闭弹窗。 */
  onRecheck: () => void;
  /** 去 sub2api 创建密钥(仅 no-key 变体显示)。 */
  onCreateKey?: () => void;
  /** 正在重新检测,禁用按钮防重复点击。 */
  rechecking?: boolean;
}

const LOCK_COPY = {
  'out-of-funds': {
    title: '账户余额不足',
    description: '你的账户余额已用尽，且没有有效的订阅。请联系管理员充值后，点击下方「重新检测」继续使用。',
  },
  'no-key': {
    title: '请先创建 API 密钥',
    description: '使用 Nova 前需要在 sub2api 创建一个 API 密钥。点击「去创建」前往，创建完成后点击「重新检测」继续。',
  },
} as const;

/**
 * 账户硬阻断弹窗。余额不足 / 无 API 密钥时「封印」界面:
 * 不可点遮罩、ESC 或右上角关闭,只能通过自助操作(充值/创建)后「重新检测」解除。
 */
export function LockedAccountDialog({
  open,
  variant,
  onRecheck,
  onCreateKey,
  rechecking = false,
}: LockedAccountDialogProps) {
  const copy = LOCK_COPY[variant];

  // 封印:disablePointerDismissal 禁外部点击;不提供 onOpenChange,受控 open 不变 → ESC 也关不掉;
  // showCloseButton={false} 去掉右上角 X。只能靠下方按钮自助恢复。
  return (
    <Dialog open={open} disablePointerDismissal modal>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {variant === 'no-key' && onCreateKey && (
            <Button variant="outline" onClick={onCreateKey} disabled={rechecking}>
              去创建
            </Button>
          )}
          <Button onClick={onRecheck} disabled={rechecking}>
            {rechecking ? '检测中…' : '重新检测'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
