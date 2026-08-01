# 个性化热点新闻设计规格

## 产品决策

在 FunBox 新增独立工具 `热点速览`，路由为 `/tools/hot-news`。V1 采用“每日 AI 简报优先”的首页结构：用户先在一屏内理解当天最重要的事件，再进入个性化新闻列表和热点详情。

## 核心流程

1. 用户打开 `热点速览`，看到根据兴趣排序的每日简报。
2. 用户在 `为你推荐`、`AI`、`科技`、`财经`、`社会`、`国际`之间切换。
3. 用户点击新闻事件，查看多来源摘要、关键事实、事件脉络和原文链接。
4. 用户可以收藏事件、调整兴趣标签；打开事件会轻量增加对应分类权重。
5. `热点`页按公共热度排序，`收藏`页展示本地收藏，`我的`页管理兴趣。

## 新闻数据策略

- 新闻事实只来自真实 RSS 或后续接入的授权 API，AI 不得生成新闻事实。
- 默认 RSS：36氪综合资讯、爱范儿、Solidot、BBC 中文。
- 服务端每 15 分钟增量刷新；首次启动立即刷新。
- 使用 URL 和标题指纹去重，使用中英文标题词元相似度将同一事件聚类。
- 热点分由新鲜度、来源数量和事件信息完整度组成，范围为 `0-100`。
- 仅展示标题、短摘要、来源和原文链接，不在 FunBox 内完整转载正文。

## AI 摘要策略

- 新闻摘要复用现有 `config.DeepSeekConfig`，包括 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_URL`、`DEEPSEEK_TRANSLATION_MODEL` 和 `DEEPSEEK_REQUEST_TIMEOUT_MS`。
- 不增加新闻专用 Key，不将 Key 暴露给 Expo 前端。
- 模型输入只包含当前事件的来源编号、标题和清洗后的短正文。
- 模型必须输出 JSON：`oneSentence`、`keyPoints[{text,sourceIds}]`、`uncertainty`。
- 服务端校验来源编号、空文本和数组长度；校验失败则使用确定性的提取式短摘要。
- 摘要按事件内容哈希缓存；来源内容未变化时不重复调用 DeepSeek。
- 每次刷新最多为 8 个最热事件生成摘要，其余事件先显示提取式摘要。

## 架构边界

### 后端 `internal/news`

- `source_rss.go`：并行获取 RSS，解析、清洗并规范化文章。
- `ranking.go`：分类、去重、事件聚类、热点分和每日简报。
- `summarizer_deepseek.go`：DeepSeek 请求、JSON 解码与来源引用校验。
- `service.go`：刷新调度、快照、摘要缓存、过期数据降级。

### 后端 HTTP

- `GET /api/v1/news/feed?category=<id>&limit=<n>` 返回公开新闻快照。
- 来源全部不可用且没有缓存时返回 `502 news_sources_unavailable`。
- 服务未启用时返回 `503 news_service_unavailable`。
- 有旧快照时返回 `200` 且 `stale=true`。

### 前端

- `types/news.ts`：API 合约和偏好类型。
- `lib/news.ts`：纯函数排序、筛选、兴趣权重和收藏状态。
- `lib/news-api.ts`：新闻接口请求与响应校验。
- `lib/news-preferences-storage.*.ts`：Web 使用 `localStorage`，原生使用 `SecureStore`。
- `features/tools/hot-news-screen.tsx`：首页、热点、收藏、我的、详情和错误状态。

## 响应结构

```json
{
  "generatedAt": "2026-07-31T09:41:00Z",
  "stale": false,
  "dailyBrief": {
    "title": "三分钟，了解今天真正重要的事",
    "keyPoints": ["事件一", "事件二", "事件三"],
    "eventCount": 8
  },
  "events": [
    {
      "id": "event-id",
      "category": "ai",
      "title": "新闻标题",
      "imageUrl": "https://example.com/image.jpg",
      "publishedAt": "2026-07-31T09:00:00Z",
      "updatedAt": "2026-07-31T09:20:00Z",
      "hotScore": 96,
      "summary": {
        "oneSentence": "一句话摘要",
        "keyPoints": [{"text": "关键事实", "sourceIds": ["S1"]}],
        "uncertainty": "尚待确认的信息",
        "status": "generated",
        "model": "deepseek-chat"
      },
      "sources": [{"id": "S1", "name": "来源", "url": "https://example.com", "publishedAt": "2026-07-31T09:00:00Z"}]
    }
  ]
}
```

## 个性化规则

- 默认兴趣为 `AI`、`科技`、`财经`。
- 用户主动选择的分类权重为 `3`，每次打开事件增加 `0.25`，最高行为权重为 `2`。
- 个性化只改变事件排序和“因为你关注……”提示，不改变公共摘要文本。
- 偏好和收藏仅保存在设备本地，V1 不新增账号同步接口。

## 状态与降级

- 初次加载：显示骨架和“正在整理今日热点”。
- 刷新失败且有缓存：继续显示旧数据和“数据更新稍有延迟”。
- 刷新失败且无缓存：显示重试按钮和来源不可用说明。
- DeepSeek 未配置或调用失败：显示提取式摘要，原文链接仍可使用。
- 图片缺失或加载失败：使用分类色块和图标，不显示空白容器。
- 搜索无结果、分类无结果、收藏为空均有独立空状态。

## 视觉系统

- 延续 FunBox 现有浅蓝背景、白色表面、深色 `#151b3b` 简报区和主色 `#4b6bff`。
- 内容最大宽度为现有 `430px` 移动容器。
- 首页用开放列表和细分隔线，避免卡片嵌套。
- 圆角不超过 `8px`，图标使用现有 Material Community Icons。
- 支持浅色和深色主题；文本和控件不得在 `390px` 与 `430px` 视口溢出。

## 验收标准

- `热点速览` 对所有现有角色可见并可通过动态工具路由打开。
- 默认 RSS 能获取真实新闻，部分来源失败时保留其他来源结果。
- 同 URL 去重、相似标题聚类、热点排序和分类结果可重复验证。
- DeepSeek 请求复用现有 Key，输出结构和来源引用经过校验。
- 首页、详情、搜索、刷新、兴趣、收藏和四个底部视图均可交互。
- 失败、空数据、旧缓存和摘要降级状态均可见且可恢复。
- Go 测试、前端聚焦测试、TypeScript、lint、Web 构建及现有测试全部通过。
- 在桌面与移动视口实际运行并完成截图检查，无重叠、空白或控制台错误。

## V1 不包含

- 付费新闻授权、完整正文阅读、推送通知、用户偏好云同步、复杂协同过滤、评论互动和自动交易建议。
