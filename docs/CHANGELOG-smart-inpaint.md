# 智能重绘 & 体验优化变更说明

> 提交：`702cf6e` · 分支：`main`
> 范围：智能重绘 UX 重构、大图预览重绘、提示词广场大图、Agent 超时

---

## 1. 智能重绘（Smart Inpainting）

### 1.1 交互重构

旧流程（5 步）：底部工具栏点画笔 → 弹窗涂抹 → 点「应用蒙版」→ 回工作台 → 提交生成。

新流程（3 步）：
1. 鼠标悬停**第一张参考图缩略图** → 右下角浮现刷子按钮
2. 点击 → 打开对话框，**涂抹 + 输入重绘描述同框完成**
3. 点「开始生成」直接提交

涉及文件：
- `frontend/src/components/MaskEditDialog.tsx` — 对话框加 prompt 输入，`onSubmit(maskDataUrl, prompt)` 直接触发生成
- `frontend/src/components/AttachmentChips.tsx` — 第一张图 hover 显示刷子按钮（`onMaskEdit`）
- `frontend/src/components/ImageGenerationWorkbench.tsx` — 接线新流程，移除旧的 `maskDataUrl` 常驻状态（mask 改为一次性）

### 1.2 对话框自适应高度

- `DialogContent`：`max-h-[90vh] flex flex-col`，头/尾 `shrink-0`
- 画布尺寸**动态计算**：同时受限于 `MAX_DISPLAY_SIDE(760)`、视口可用高度（`innerHeight*0.9 - 350`）、可用宽度，避免出现滚动条

### 1.3 后端 mask 代理

- `backend/src/proxy/gpt-image-request.js` — image-to-image 模式下，把同尺寸 PNG mask 附加进 `FormData`（字段名 `mask`），运行时透传不落库
- mask 语义：**透明区(alpha=0)=允许修改**，不透明区=保留
- 带 mask 时在 prompt 前注入系统引导词，要求模型只改 mask 区域

### 1.4 ⚠️ gpt-image-2 的 mask 局限性（重要）

用真实接口实测（脚本对底部工具栏 / 顶部红按钮做白色填充）结论：

| 验证项 | 结果 |
|--------|------|
| mask 格式（RGBA PNG，alpha=0 可编辑） | ✅ 正确，符合 OpenAI 规范 |
| 模型能否感知 mask | ✅ 非 mask 区域基本保留（像素差 1~3） |
| 模型是否执行填充指令 | ❌ 要求填白色，结果几乎不变（变化量仅 3~23） |

**根因**：gpt-image-2 的 mask 是「focus guide（焦点提示）」而非严格几何边界，它是内容感知编辑模型，不做 Photoshop 式精准 inpainting。三种提示词（模糊 / 明确 alpha 语义 / 详细分步）实测效果几乎一致，**优化提示词无法解决**。

OpenAI 官方文档亦说明：「GPT Image masking is prompt-based and may not follow the exact mask shape with full precision.」

**结论**：当前功能保留可用，但用户需理解它不精准。若业务需要严格局部修改，应换用 Stable Diffusion Inpainting / Flux-Fill 等传统 inpainting 模型（需重写后端代理）。

参考资料：
- https://www.aifreeapi.com/en/posts/openai-image-edit-api-mask
- https://community.openai.com/t/understanding-how-gpt-image-models-on-edits-see-mask-and-transparency/1381752

---

## 2. 大图预览智能重绘

生图结果区点缩略图看大图后，底部工具栏新增**刷子按钮**，可直接对结果图做智能重绘。

数据流：
```
HistoryImagePreview(刷子按钮)
  → CompletedJobCard.handleMaskEdit(打开 MaskEditDialog)
  → handleMaskSubmit(从 job 复用生成参数 + mask)
  → HistoryJobList.onMaskSubmit
  → WorkspaceShell.submitImageToImage
```

涉及文件：
- `HistoryImagePreview.tsx` — 加 `showMaskEdit` / `onMaskEdit` props 与按钮
- `CompletedJobCard.tsx` — 加 `onMaskSubmit` props、mask 状态、MaskEditDialog 渲染
- `HistoryJobList.tsx` / `WorkspaceShell.tsx` — 透传 `onMaskSubmit`

---

## 3. 提示词广场大图

`PromptGallerySubcomponents.tsx` 大图预览从**全屏**改为 `80vw × 80vh` 圆角容器 + 半透明遮罩（点击遮罩关闭），与生图结果大图（`HistoryImagePreview`）视觉一致。

---

## 4. Agent 请求超时

`agent-chat-client.ts`：单次请求超时 `AGENT_CHAT_ATTEMPT_TIMEOUT_MS` 从 **45s → 300s（5 分钟）**，适配慢模型。重试机制不变（最多 3 次，超时可重试）。

---

## 5. 设置持久化说明（非本次改动，排查记录）

设置走 `localStorage ↔ PostgreSQL` 双向同步（`settings-sync.ts`），数据**确实存 DB**。但 token 存于 `sessionStorage`，且会话依赖 URL 的 token 参数：

- ✅ 通过 sub2api iframe 入口（URL 带 token）打开 → 私密窗口也能同步恢复
- ❌ 直接访问 URL（无 token 参数）→ 判定未登录 → 不拉后端 → 设置为空

属预期行为，非 bug。


