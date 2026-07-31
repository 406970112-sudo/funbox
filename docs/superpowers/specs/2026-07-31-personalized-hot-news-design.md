# 个性化热点新闻设计规格

## 产品决策

FunBox 新增独立工具 `热点速览`，路由为 `/tools/hot-news`。V1 采用已经确认的 A 方案：首屏优先展示“每日 AI 简报”，随后是可搜索、可筛选、可收藏的开放新闻列表。

## 核心流程

1. 用户进入工具后先阅读当天简报，再浏览按兴趣和阅读行为排序的事件。
2. 首页支持“为你推荐”、AI、科技、财经、社会、国际分类和关键词搜索。
3. 详情展示一句话摘要、带来源编号的关键事实、事件脉络和原文链接。
4. 底部提供首页、热点、收藏、我的四个视图；“热点”始终按公共热度排序。
5. 兴趣、阅读权重和收藏保存在本机。个性化只改变排序，不改变公共摘要事实。

## 数据与摘要

- 新闻事实只来自真实 RSS，AI 不得生成新闻事实。
- 默认来源：36氪、爱范儿、Solidot、BBC 中文；部分来源失败时保留其他来源。
- 服务端每 15 分钟刷新，首个请求在没有快照时同步刷新。
- 相同 URL 先去重，再用中英文标题词元 Jaccard 相似度聚合同一事件。
- 热度由新鲜度、独立来源数量和信息完整度组成，范围为 `0-100`。
- AI 摘要复用现有 `config.DeepSeekConfig`，包括 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_URL`、`DEEPSEEK_TRANSLATION_MODEL` 和 `DEEPSEEK_REQUEST_TIMEOUT_MS`。
- 模型必须返回 `oneSentence`、`keyPoints[{text,sourceIds}]`、`uncertainty`；服务端校验所有来源编号。
- DeepSeek 未配置、调用失败或返回非法引用时，使用仅基于标题与导语的提取式摘要。
- 摘要按事件内容哈希缓存，同一内容不重复调用模型；每次刷新最多生成 8 个 AI 摘要。

## HTTP 合约

`GET /api/v1/news/feed?category=<id>&limit=<n>` 返回：

```json
{
  "generatedAt": "2026-07-31T09:41:00Z",
  "stale": false,
  "dailyBrief": {
    "title": "三分钟，了解今天真正重要的事",
    "keyPoints": ["事件一"],
    "eventCount": 8
  },
  "events": [
    {
      "id": "evt_id",
      "category": "ai",
      "title": "新闻标题",
      "hotScore": 96,
      "sourceCount": 2,
      "summary": {
        "oneSentence": "一句话摘要",
        "keyPoints": [{"text": "关键事实", "sourceIds": ["S1"]}],
        "uncertainty": "尚待确认的信息",
        "status": "generated",
        "model": "deepseek-chat"
      },
      "sources": [{"id": "S1", "name": "来源", "url": "https://example.com"}]
    }
  ]
}
```

- 服务未注入：`503 news_service_unavailable`。
- 来源全不可用且无快照：`502 news_sources_unavailable`。
- 刷新失败但有快照：`200` 且 `stale=true`。
- 无效分类或 `limit`：`400 invalid_news_query`。

## 个性化规则

- 默认兴趣为 AI、科技、财经。
- 主动兴趣权重为 `3`。
- 每次打开事件增加对应分类 `0.25` 行为权重，最高为 `2`。
- 同等个性化分数下使用公共热度和发布时间排序。

## 视觉与状态

- 延续 FunBox 浅蓝背景、白色表面、`#151b3b` 深色简报区和 `#4b6bff` 主色。
- 内容最大宽度为 `430px`，热点新闻内的圆角不超过 `8px`，采用开放列表而非嵌套卡片。
- 支持浅色和深色主题以及 `390px` 移动视口。
- 必须覆盖首次加载、失败重试、旧快照、摘要降级、缺图、无搜索结果和空收藏状态。

## V1 不包含

付费新闻授权、完整正文转载、推送通知、账号偏好云同步、评论互动和投资建议。
