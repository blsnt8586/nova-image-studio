import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from '@/components/ui/select';

describe('Select trigger label resolution', () => {
  it('shows the selected option label (not the raw value) on the trigger', () => {
    render(
      <Select
        value="img_123"
        onValueChange={() => {}}
        options={[
          { value: 'img_123', label: 'GPT Image 2' },
          { value: 'img_456', label: 'Banana' },
        ]}
      />,
    );
    // 触发器应显示 label,而不是内部 id 值
    expect(screen.queryByText('GPT Image 2')).not.toBeNull();
    expect(screen.queryByText('img_123')).toBeNull();
  });
});
