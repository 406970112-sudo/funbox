# FunBox 朋友圈产品设计方案 V1

> 版本：V1 草稿
> 日期：2026-08-02
> 状态：待评审
> 定位：在 FunBox「我的」栏目与首页快捷入口中新增「朋友圈」，让真实好友关系沉淀为可浏览、可互动、可追溯的内容流。

## 1. 背景与问题

FunBox 已经有真实账号体系、好友申请/好友列表、单聊、消息已读、在线状态和 WebSocket 实时消息，也已经有多个工具与游戏产生真实结果数据。当前的问题是：

| 现状 | 问题 |
| --- | --- |
| 好友关系只用于聊天和游戏邀请 | 好友之间缺少轻量的内容分享与互动场景 |
| 消息页只有即时聊天 | 用户不知道好友最近在玩什么、做了什么 |
| 游戏成绩、工具结果存在服务端 | 成绩没有沉淀为可分享、可讨论的内容 |
| 首页与「我的」只有工具/游戏栏目 | 缺少一个承载真实用户内容的社交栏目 |

本次引入「朋友圈」：用户发布真实动态，好友可见并点赞、评论，互动通过现有真实消息体系与 WebSocket 实时同步。

## 2. 产品目标

### 2.1 核心目标

1. 让好友关系产生真实内容沉淀：好友动态成为 FunBox 里持续更新的内容流。
2. 让发布足够轻：用户从入口到发布完成不超过 30 秒。
3. 让互动可参与：点赞、评论、回复和互动通知全部基于真实身份、真实数据。
4. 让每一条内容可追溯：动态、图片、点赞、评论、通知都来自数据库，不引入任何演示数据。

### 2.2 体验目标

- 打开朋友圈 1 秒内看到首屏真实动态或明确的空状态。
- 发布页保留上一次草稿，失败不丢内容。
- 点赞/评论即时反馈，最终状态以服务端为准。
- 互动通知与现有消息未读红点统一，不重复打扰。

### 2.3 非目标

- 一期不做陌生人广场、推荐流、算法排序。
- 一期不做转发、收藏、视频/语音动态、朋友圈广告。
- 一期不做好友动态的“仅某人可见”精细名单。

## 3. 真实数据红线

这是本方案的第一约束。以下规则在设计与实现阶段都必须满足：

1. 前端不允许硬编码或内置任何动态、图片、点赞、评论、通知、头像、昵称、时间等演示数据。
2. 后端不允许向生产数据库 seed 示例动态、示例点赞或示例评论；数据库只能保存用户真实操作产生的记录。
3. 前端所有展示内容必须来自真实 API；加载中、空状态、错误状态是唯一允许的兜底，禁止用本地假数据填充页面。
4. 头像、昵称、角色、在线状态必须复用现有 `users` / 好友体系真实数据。
5. 点赞数、评论数、未读数必须由服务端聚合返回，不允许客户端按本地猜测计数。
6. 本地只允许做乐观更新和断网缓冲，最终以服务端回执为准；服务端失败时本地状态必须回滚。
7. 测试可以创建隔离的 SQLite 测试库写入测试数据，但生产库与测试库严格分离，测试数据不得进入用户可见 feed。
8. 动态或图片被删除后，接口不得返回缓存假内容；前端按接口状态展示删除结果。
9. 评论中的文本按纯文本渲染，不执行 HTML；展示前做长度、敏感词和权限校验。
10. 发布、点赞、评论、删除全部走服务端事务，任何一步失败都不产生半条记录。

## 4. 目标用户与核心场景

| 用户 | 核心场景 | 产品应满足 |
| --- | --- | --- |
| 日常用户 | 随手记录今天做了什么 | 文字 + 最多 9 图，发布轻快 |
| 游戏用户 | 赢了五子棋/象棋，想给好友看 | 支持分享真实战绩卡片 |
| 好友关系用户 | 想知道好友最近在玩什么 | 好友动态信息流，按真实时间倒序 |
| 互动用户 | 看到动态想点赞或评论 | 一键点赞、评论回复、实时通知 |
| 内容作者 | 发错了或不想给别人看 | 我的动态、删除、切换“仅自己可见” |
| 未登录用户 | 第一次使用 FunBox | 引导登录，不展示假内容 |

## 5. 信息架构与入口

### 5.1 入口

- 「我的」页新增「社交」栏目，第一项为「朋友圈」，显示真实头像/昵称摘要与互动未读角标。
- 首页工具网格新增「朋友圈」快捷入口，未登录时点击进入登录引导。
- 「消息」Tab 的未读红点合并聊天未读与朋友圈互动未读，进入消息页后分成「聊天」与「互动通知」两个页签。

### 5.2 页面清单

| 页面 | 说明 |
| --- | --- |
| 朋友圈信息流 | 好友动态 + 我的动态，按发布时间倒序，游标分页 |
| 发布动态 | 文字、图片、可见范围、发布/取消 |
| 动态详情 | 完整内容、图片、点赞列表、评论与回复 |
| 我的动态 | 我发布的所有动态，删除/改可见范围 |
| 互动通知 | 点赞、评论、回复聚合列表，已读/未读 |
| 未登录引导 | 登录说明与注册入口 |
| 空状态 | 无好友、无动态、动态已删除等真实空状态 |

## 6. 功能设计

### 6.1 发布动态

- 支持纯文字或图文；正文 1-500 字，空白内容不允许发布。
- 图片最多 9 张，单张不超过 5MB，支持 JPG/PNG/WebP/HEIC；上传前复用现有图片压缩能力。
- 图片选择支持相机、相册、最近图片；9 宫格带删除和预览。
- 可见范围默认「仅好友可见」，可切换「仅自己可见」；发布后「我的动态」中可再次修改可见范围。
- 发布流程：选择内容 -> 本地校验 -> 上传图片（可并行） -> 服务端创建动态 -> 返回真实记录；任一环节失败都保留草稿。
- 发布成功后，自己的信息流立即插入该动态；好友通过实时事件或下拉刷新看到。
- 支持附加「战绩卡片」（一期交付）：卡片引用 `game_matches` / `game_score_submissions` 的真实记录快照，不允许前端拼接假战绩。

### 6.2 朋友圈信息流

- 信息流 = 当前用户自己的动态 + 所有好友的动态，且动态 `visibility = friends`、`status = active`。
- 排序：`created_at DESC, id DESC`，使用游标分页（`cursor` + `limit=20`），不做 offset 深分页。
- 每条动态展示：真实头像、真实昵称、身份徽标（若启用）、发布时间、正文、图片网格、点赞摘要、评论摘要。
- 点赞摘要显示最近 3 位点赞人的真实昵称，其余显示「+N」；总数由服务端返回。
- 评论摘要显示最近 1-2 条真实评论；点击进入详情。
- 支持下拉刷新与上拉加载；加载中显示骨架，加载失败显示错误与重试，不显示假内容。
- 无好友：显示「还没有好友，添加好友后就能看到彼此动态」；无动态：显示「发布第一条动态」。

### 6.3 点赞

- 每个用户对同一动态最多一个赞，由 `UNIQUE(moment_id, user_id)` 保证。
- 已点赞状态展示实心图标，再次点击取消；取消后计数与点赞人列表由服务端重新聚合。
- 点赞即时反馈采用乐观更新，服务端失败时回滚。
- 点赞后向动态作者产生一条互动通知；作者进入互动通知后标记已读。
- 允许给自己的动态点赞，不允许重复点赞；点赞人列表分页返回。

### 6.4 评论与回复

- 支持一级评论与回复；评论正文 1-200 字，按纯文本渲染。
- 评论展示真实头像、昵称、时间、正文；回复在父评论下缩进展示。
- 支持 @ 好友：输入框内输入 `@` 唤起真实好友选择器，选中后插入 `@昵称`，发送时同时创建对被 @ 用户的通知。
- 删除权限：评论作者、动态作者、管理员可以删除；删除一级评论时其子回复一并删除；删除动态时级联删除点赞、评论、通知。
- 评论新增后通过实时事件推送给动态作者与相关被 @ 用户；REST 再次拉取作为最终一致。

### 6.5 互动通知

- 通知类型：`moment.like`、`moment.comment`、`moment.reply`、`moment.mention`。
- 通知列表聚合展示：`某某 赞了你的动态`、`某某 评论了你`、`某某 回复了你`、`某某 @了你`。
- 每条通知可跳转到对应动态详情并定位评论；点击后该动态相关通知标记已读。
- 未读数由服务端聚合，前端消息 Tab 红点 = 聊天未读 + 互动未读，统一展示。
- 已读同步走现有 `conversation.read` 类似语义，新增 `moment.notification.read` 事件。

### 6.6 我的动态

- 展示我发布的全部动态（含仅自己可见），支持按时间倒序分页。
- 操作：删除动态（二次确认）、切换可见范围、查看点赞与评论。
- 删除动态是软删除：`status = deleted`，级联隐藏，不删除图片文件前先清理引用；一期采用软删除避免通知跳转 404，列表与详情均不展示。

### 6.7 内容安全与管理

- 发布接口服务端校验正文长度、图片数量、文件类型与大小；复用现有文件上传目录与限流。
- 正文经过敏感词过滤，命中后拒绝发布并提示，不静默替换。
- 用户可举报动态/评论；举报写入真实记录，管理员在后台查看。
- 管理员后台新增「内容管理」列表：真实动态、作者、状态、举报数、删除/下架操作。
- 被下架动态对用户展示「该动态已不可见」，不伪造占位内容。

## 7. 数据模型

新增表均使用 SQLite，与现有 `users`、`friendships`、`messages` 同一数据库：

### 7.1 moments

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| author_id | TEXT NOT NULL | 作者，FK users.id，ON DELETE CASCADE |
| body | TEXT NOT NULL | 正文，1-500 字 |
| visibility | TEXT NOT NULL | `friends` / `self`，默认 `friends` |
| status | TEXT NOT NULL | `active` / `deleted` / `hidden` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |
| updated_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_moments_feed(author_id, created_at DESC)`、`idx_moments_status_created(status, created_at DESC)`。

### 7.2 moment_media

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| moment_id | TEXT NOT NULL | FK moments.id，ON DELETE CASCADE |
| file_path | TEXT NOT NULL | 服务端存储相对路径 |
| mime_type | TEXT NOT NULL | image/jpeg 等 |
| width / height | INTEGER | 上传解析尺寸 |
| sort_order | INTEGER NOT NULL | 0-8 |

索引：`idx_moment_media_moment(moment_id, sort_order)`。

### 7.3 moment_likes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| moment_id | TEXT NOT NULL | FK moments.id，ON DELETE CASCADE |
| user_id | TEXT NOT NULL | FK users.id，ON DELETE CASCADE |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

主键：`PRIMARY KEY(moment_id, user_id)`；索引：`idx_moment_likes_moment_created(moment_id, created_at DESC)`。

### 7.4 moment_comments

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| moment_id | TEXT NOT NULL | FK moments.id，ON DELETE CASCADE |
| author_id | TEXT NOT NULL | FK users.id，ON DELETE CASCADE |
| parent_id | TEXT NULL | 回复时指向父评论，FK moment_comments.id |
| body | TEXT NOT NULL | 1-200 字 |
| status | TEXT NOT NULL | `active` / `deleted` / `hidden` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |
| updated_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_moment_comments_moment_created(moment_id, created_at DESC)`、`idx_moment_comments_parent(parent_id)`。

### 7.5 moment_notifications

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| recipient_id | TEXT NOT NULL | 接收者，FK users.id |
| actor_id | TEXT NOT NULL | 操作者，FK users.id |
| moment_id | TEXT NULL | 关联动态，FK moments.id，ON DELETE CASCADE |
| comment_id | TEXT NULL | 关联评论 |
| type | TEXT NOT NULL | `like` / `comment` / `reply` / `mention` |
| read_at | INTEGER NULL | 未读为 NULL |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_moment_notifications_recipient(recipient_id, read_at, created_at DESC)`。

### 7.6 moment_reports

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| moment_id | TEXT NOT NULL | FK moments.id |
| reporter_id | TEXT NOT NULL | FK users.id |
| reason | TEXT NOT NULL | 举报原因 |
| status | TEXT NOT NULL | `pending` / `resolved` / `dismissed` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

唯一约束：`UNIQUE(moment_id, reporter_id)`，同一用户对同一动态只能举报一次。

### 7.7 moment_attachments

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| moment_id | TEXT NOT NULL | FK moments.id，ON DELETE CASCADE |
| attachment_type | TEXT NOT NULL | `game_result` |
| ref_table | TEXT NOT NULL | `game_matches` / `game_score_submissions` |
| ref_id | TEXT NOT NULL | 真实战绩记录 ID |
| payload_json | TEXT NOT NULL | 服务端生成的战绩快照，用于展示 |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_moment_attachments_moment(moment_id)`；`ref_table + ref_id` 由服务端校验必须存在且属于作者。

## 8. API 设计

所有接口除管理端外均需登录，返回统一错误结构 `{ "error": "code" }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/moments` | 发布动态，multipart，正文 + 图片 + 可选战绩卡片引用 |
| GET | `/api/v1/moments/feed?cursor=&limit=20` | 好友动态信息流 |
| GET | `/api/v1/moments/{momentID}` | 动态详情（校验可见性） |
| GET | `/api/v1/users/{userID}/moments?cursor=` | 某个用户（限好友/自己）的动态 |
| PATCH | `/api/v1/moments/{momentID}` | 修改可见范围 |
| DELETE | `/api/v1/moments/{momentID}` | 删除自己的动态 |
| POST | `/api/v1/moments/{momentID}/like` | 点赞 |
| DELETE | `/api/v1/moments/{momentID}/like` | 取消点赞 |
| GET | `/api/v1/moments/{momentID}/likes?cursor=` | 点赞人列表 |
| POST | `/api/v1/moments/{momentID}/comments` | 发表评论/回复 |
| GET | `/api/v1/moments/{momentID}/comments?cursor=` | 评论列表（含回复） |
| DELETE | `/api/v1/moments/comments/{commentID}` | 删除评论 |
| GET | `/api/v1/moments/notifications?cursor=` | 互动通知列表 |
| POST | `/api/v1/moments/notifications/read` | 标记通知已读 |
| POST | `/api/v1/moments/{momentID}/report` | 举报 |
| GET | `/api/v1/admin/moments?status=&cursor=` | 管理员内容列表 |
| POST | `/api/v1/admin/moments/{momentID}/hide` | 管理员下架 |

响应示例（信息流单条动态）：

```json
{
  "id": "uuid",
  "author": {
    "id": "uuid",
    "username": "alice",
    "displayName": "Alice",
    "avatarUrl": "/api/v1/avatars/alice.png",
    "role": "vip"
  },
  "body": "今天第一次五子棋五连胜",
  "images": [
    { "url": "/api/v1/moment-media/uuid.png", "width": 1080, "height": 810 }
  ],
  "visibility": "friends",
  "likeCount": 3,
  "likedByMe": false,
  "recentLikers": [
    { "id": "uuid", "displayName": "Bob", "avatarUrl": "/api/v1/avatars/bob.png" }
  ],
  "commentCount": 2,
  "attachments": [
    {
      "type": "game_result",
      "gameId": "gomoku",
      "title": "五子棋好友对局",
      "result": "胜利",
      "refId": "uuid"
    }
  ],
  "recentComments": [
    {
      "id": "uuid",
      "author": { "id": "uuid", "displayName": "Bob" },
      "body": "厉害",
      "createdAt": "2026-08-02T09:41:00Z"
    }
  ],
  "createdAt": "2026-08-02T09:30:00Z",
  "canDelete": true
}
```

## 9. 实时事件

沿用现有 WebSocket 通道，事件只作为刷新信号，完整状态始终由 REST 恢复：

| 事件 | 语义 |
| --- | --- |
| `moment.created` | 好友发布新动态 |
| `moment.like.created` | 动态被点赞 |
| `moment.like.removed` | 动态被取消点赞 |
| `moment.comment.created` | 动态被评论/回复/@ |
| `moment.comment.removed` | 评论被删除 |
| `moment.deleted` | 动态被删除或下架 |
| `moment.notification.read` | 通知已读同步 |

## 10. 权限与安全

- 所有朋友圈接口强制 JWT 鉴权；信息流只返回自己和好友的 `active` 动态。
- 服务端在查询层校验好友关系，前端隐藏按钮不等于服务端不校验。
- 图片上传复用现有存储目录与大小限制；服务端校验 MIME、尺寸、数量，文件名随机化，禁止路径穿越。
- 点赞/评论/通知写入使用事务与唯一约束，避免重复点赞、重复通知。
- 评论正文只按纯文本展示，接口不做富文本解析。
- 发布、评论、点赞、通知读取接口接入现有限流，避免刷量。
- 管理端接口复用管理员鉴权，不能由普通用户调用。

## 11. 状态与异常处理

| 场景 | 处理 |
| --- | --- |
| 未登录进入 | 显示登录引导，不显示任何假动态 |
| 无好友 | 空状态：添加好友后可看到动态 |
| 无动态 | 空状态：发布第一条动态 |
| 加载中 | 骨架屏，不出现空白跳动 |
| 接口失败 | 错误提示 + 重试，不清空已加载的真实内容 |
| 发布失败 | 保留草稿，提示重试，不产生半条记录 |
| 图片上传失败 | 标记失败图片，可重试或移除 |
| 重复点赞 | 服务端幂等返回当前状态，不重复计数 |
| 动态已删除 | 显示「该动态已不可见」，不展示占位假内容 |
| 通知点击 | 跳转动态详情，标记该动态相关通知已读 |

## 12. 视觉与交互规范

- 沿用 FunBox 现有浅蓝背景、白色表面、主色 `#4b6bff`、深蓝 `#151b3b`、强调 `#c9f36a`。
- 卡片圆角不超过 16px，信息行圆角 8-10px；不新增嵌套卡片风格。
- 图标沿用 Material Community Icons / lucide 语义，按钮使用图标 + 文本，重要操作用图标按钮并带无障碍标签。
- 内容区最大宽度 430px，支持 320px、390px、430px 视口；文字不溢出、元素不重叠。
- 支持浅色/深色主题；状态信息不只依赖颜色表达。
- 列表、分段控件、发布面板均保持原生控件语义，支持键盘与读屏。

## 13. 成功指标

1. 发布成功率 ≥ 99%，发布失败率（含图片上传）≤ 1%。
2. 信息流首屏真实内容可加载 p95 ≤ 1.2s（正常网络）。
3. 30 天内发布过动态的用户占比 ≥ 20%。
4. 有动态的用户中，产生点赞/评论的用户占比 ≥ 40%。
5. 互动通知从产生到前端收到实时事件 p95 ≤ 2s。
6. 消息 Tab 未读数与实际未读通知一致率 100%。
7. 任何页面不出现内置假数据，验收通过自动扫描前端包内硬编码动态文案。

## 14. 一期全量交付范围

本方案不分期，以下功能必须在一期一次性完成并验收：

- 发布图文动态（最多 9 图）、真实战绩卡片分享、好友信息流、游标分页。
- 点赞/取消、评论/回复、@ 好友、删除动态/评论。
- 互动通知、消息 Tab 未读合并、实时事件、批量已读。
- 我的动态、可见范围切换、举报、管理员内容管理列表与下架。
- 图片压缩接入现有 TinyPNG，通知分页。
- Go 后端 + SQLite 迁移 + Expo 前端 + Node/Go 测试全量通过。

## 15. 明确不做

- 不做陌生人广场、公开 feed、关注/粉丝关系。
- 不做基于推荐的算法排序。
- 不做转发、收藏、视频/语音动态、朋友圈广告。
- 不做任何形式的 mock 数据回退或演示动态种子。

## 16. 验收清单

- [ ] 「我的」页出现「朋友圈」栏目入口，首页有快捷入口，未登录可引导。
- [ ] 登录后信息流只显示自己和好友的 `active` 动态，按真实时间倒序。
- [ ] 发布图文成功后服务端数据库存在对应 `moments` 与 `moment_media` 记录。
- [ ] 非好友访问动态详情/点赞/评论返回权限错误。
- [ ] 点赞/取消幂等，重复请求不产生重复记录。
- [ ] 评论与回复持久化，删除权限符合设计。
- [ ] 点赞、评论、回复产生真实通知，消息 Tab 未读数一致。
- [ ] 删除动态后 feed、详情、通知跳转均不再展示。
- [ ] 前端构建产物扫描无硬编码动态文案/图片/昵称。
- [ ] 测试使用隔离测试库，生产库无 seed 内容。
- [ ] 320px、390px、430px 视口无文字溢出与元素重叠，浅/深色主题可用。
- [ ] Go 测试、Node 测试、Expo lint、TypeScript 检查通过。

## 17. 风险与开放问题

| 风险/问题 | 当前建议 | 影响 |
| --- | --- | --- |
| 内容安全审核成本 | 一期服务端敏感词 + 举报 + 管理员下架，仅好友可见控制范围 | 需要运营后台配合 |
| 图片存储与带宽成本 | 复用现有压缩与存储，限制 9 图/5MB | 需要监控存储增长 |
| 未读数与聊天未读合并 | 统一消息 Tab 聚合，分页签展示 | 需要梳理现有未读模型 |
| 好友关系变更 | 解除好友后，好友动态立即不可见；已产生的点赞/评论保留记录但不可见 | 需明确产品口径 |
| 通知跳转失效 | 动态删除后跳转显示「已不可见」 | 需实现软删除一致性 |
| 实时事件与 REST 一致 | 事件只做刷新信号，始终以 REST 为最终数据源 | 可接受短暂延迟 |

## 18. 交付物

- 本文件：详细产品设计方案。
- `docs/moments-product-design-v1.html`：可交互产品设计图。
- `docs/moments-product-design-v1.png`：设计图整体截图。
