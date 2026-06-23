import { describe, it, expect } from 'vitest';
import { parseXianyuMarkdown } from '@/lib/prompt-gallery-data';
import type { PromptDataSource } from '@/lib/prompt-gallery-data';

const SOURCE: PromptDataSource = {
  name: 'xianyu-gptimage2',
  url: 'https://example.com/README.md',
  sourceUrl: 'https://github.com/xianyu110/awesome-gptimage2',
  baseUrl: 'https://example.com',
  type: 'markdown-xianyu',
  modelTag: 'gpt-image-2',
};

const SAMPLE = `# Awesome GPT-Image-2

## 核心能力概览

这里也有代码块但不应被采集：

\`\`\`text
不是提示词，是说明
\`\`\`

## 提示词合集

> 以下提示词均可直接复制。

### 一、电商与产品

#### 1.1 香水电商详情页

\`\`\`text
给这个香水产品生成电商中文详情页，9:16，4k
\`\`\`

![香水电商详情页](images/perfume.png)
![香水长图](https://cdn.example.com/abs.jpg)

#### 1.2 产品精修白底图

\`\`\`text
帮我生成一张图片，将该产品进行精修，白色的背景。
\`\`\`

![白底图](./images/white.png)

### 二、品牌海报设计

#### 2.1 品牌入驻宣传海报

\`\`\`text
生成【茶颜悦色】入驻深圳的宣传海报，3:4，4k
\`\`\`

## 最新 X Prompt

#### 1. @someone

\`\`\`text
这是 X 区块，不应被主合集采集
\`\`\`
`;

describe('parseXianyuMarkdown', () => {
  it('只采集「提示词合集」区块内的条目，忽略前后其它 ## 区块', () => {
    const items = parseXianyuMarkdown(SAMPLE, SOURCE);
    const contents = items.map(i => i.content);
    expect(contents).toContain('给这个香水产品生成电商中文详情页，9:16，4k');
    expect(contents).toContain('帮我生成一张图片，将该产品进行精修，白色的背景。');
    expect(contents).toContain('生成【茶颜悦色】入驻深圳的宣传海报，3:4，4k');
    // 不能把其它 ## 区块的代码块当成提示词
    expect(contents.some(c => c.includes('不是提示词'))).toBe(false);
    expect(contents.some(c => c.includes('X 区块'))).toBe(false);
    expect(items).toHaveLength(3);
  });

  it('标题去掉编号前缀，正文取首个 fenced code block', () => {
    const items = parseXianyuMarkdown(SAMPLE, SOURCE);
    const perfume = items[0];
    expect(perfume.title).toBe('香水电商详情页');
    expect(perfume.content).toBe('给这个香水产品生成电商中文详情页，9:16，4k');
  });

  it('相对图片路径转为绝对 URL，绝对路径保持不变', () => {
    const items = parseXianyuMarkdown(SAMPLE, SOURCE);
    const perfume = items[0];
    expect(perfume.images).toEqual([
      'https://example.com/images/perfume.png',
      'https://cdn.example.com/abs.jpg',
    ]);
  });

  it('用「### 大类」名作为标签并去掉「一、二、」序号前缀', () => {
    const items = parseXianyuMarkdown(SAMPLE, SOURCE);
    expect(items[0].tags).toContain('电商与产品');
    expect(items[0].tags).toContain('gpt-image-2');
    expect(items[2].tags).toContain('品牌海报设计');
  });

  it('回填来源信息与唯一 key', () => {
    const items = parseXianyuMarkdown(SAMPLE, SOURCE);
    for (const item of items) {
      expect(item.source).toBe('xianyu-gptimage2');
      expect(item.sourceUrl).toBe('https://github.com/xianyu110/awesome-gptimage2');
      expect(item.uniqueKey.startsWith('xianyu-gptimage2-')).toBe(true);
    }
    const keys = items.map(i => i.uniqueKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
