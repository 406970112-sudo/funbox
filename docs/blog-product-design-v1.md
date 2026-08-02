# FunBox 博客 产品设计方案 V1

> 版本：V1 草案
> 日期：2026-08-02
> 状态：待评审
> 定位：在 FunBox 提供“真实创作、真实发布、真实互动”的博客栏目。用户发布博客文章，选择完全公开、好友可见或仅自己可见；有权限的用户可点赞、评论；作者可管理自己的文章；管理员可内容治理。

## 1. 背景与问题

FunBox 已具备真实账号体系、好友关系、WebSocket 实时消息、SQLite、Go API、图片上传与压缩能力，也已经有朋友圈这样的可见性社交内容。当前缺少一个承载“长文创作与阅读”的栏目：

| 现状 | 问题 |
| --- | --- |
| 朋友圈以图文短动态为主 | 用户没有适合沉淀长文、连载思考的载体 |
| 聊天与朋友圈只在好友圈内互动 | 缺少“完全公开”的公开内容入口 |
| 没有公开内容流 | 新用户进入后看不到平台真实文章内容 |
| 工具型功能偏即时结果 | 缺少可长期编辑、发布、管理的个人内容空间 |

本次引入“博客”：用户发布真实文章，选择可见范围，获得公开/好友/私密三类内容流，并支持阅读、点赞、评论、互动通知与内容治理。

## 2. 产品目标

### 2.1 核心目标

1. 让每个用户都能在 60 秒内从入口进入并发布第一篇真实博客。
2. 内容覆盖三种可见范围：`public` 任何人可见、`friends` 仅好友可见、`self` 仅自己可见。
3. 公开内容形成真实公开流，未登录与登录用户都能浏览，互动必须登录。
4. 发布、阅读、点赞、评论、通知全部基于真实数据库与 API，不引入任何假数据。

### 2.2 体验目标

- 打开博客首页 1 秒内看到首屏真实内容或明确空状态。
- 发布页自动保留草稿，失败不丢内容。
- 点赞、评论即时反馈，最终状态以服务端为准。
- 文章按服务端真实字数与发布时间展示，不允许客户端伪造阅读数据。

### 2.3 非目标

- 一期不做富文本/HTML 编辑器，正文按纯文本（保留换行）处理。
- 一期不做推荐算法排序、个性化推送、关注/粉丝体系。
- 一期不做站外分发、订阅邮件、评论置顶。

## 3. 真实数据红线（一票否决）

以下规则在设计、实现与验收阶段必须满足：

1. 前端不允许硬编码或内置任何文章、标题、正文、封面、字数、点赞、评论、通知、头像等演示数据。
2. 后端不允许向生产数据库 seed 示例博客或示例互动；数据库只能保存用户真实操作产生的记录。
3. 前端所有展示内容必须来自真实 API；加载中、空状态、错误状态是唯一允许的兜底。
4. 头像、昵称、身份徽标、好友关系必须复用现有 `users` / `friendships` 真实数据。
5. 点赞数、评论数、未读数、字数必须由服务端聚合或校验返回，不允许客户端本地猜测计数。
6. 本地只允许做乐观更新和断网草稿缓存，最终以服务端回执为准；服务端失败必须回滚本地状态。
7. 测试可以创建隔离的 SQLite 测试库写入测试数据，但生产库与测试库严格分离，测试数据不得进入用户可见流。
8. 文章或评论被删除后，接口不得返回缓存假内容；前端按接口状态展示删除结果。
9. 正文与评论按纯文本渲染，不执行 HTML；展示前做长度、敏感词和权限校验。
10. 发布、点赞、评论、删除全部走服务端事务，任一步骤失败都不产生半条记录。

## 4. 目标用户与核心场景

| 用户 | 核心场景 | 产品应满足 |
| --- | --- | --- |
| 创作者 | 写一篇长文、记录一段经历 | 打开即写、草稿保留、快速发布 |
| 读者 | 发现别人写的真实内容 | 公开流、文章阅读、点赞评论 |
| 好友社交用户 | 只给朋友看 | 好友流、好友可见、点赞评论通知 |
| 私密记录用户 | 写给自己 | 仅自己可见、草稿保留 |
| 未登录用户 | 第一次使用 | 可看公开流、登录引导、不展示假内容 |
| 管理员 | 内容治理 | 真实文章列表、下架、报告处理 |

## 5. 信息架构与入口

### 5.1 入口

- 底部 Tab 新增“博客”，登录后默认进入博客首页；未登录进入后展示公开流与登录引导。
- “我的”页“社交”栏目新增“博客”入口，显示我的文章与互动未读。
- 首页工具网格新增“博客”快捷入口，可被搜索命中“博客、文章、写作、长文”。
- 消息 Tab 未读红点合并聊天未读与博客互动未读，进入后分为“聊天”与“互动通知”两个页签。

### 5.2 页面清单

| 页面 | 说明 |
| --- | --- |
| 博客首页（发现） | 公开流 + 好友流，分段切换 |
| 发布文章 | 标题、摘要、正文、封面、可见范围、发布 |
| 文章详情 | 完整正文、点赞、评论、报告 |
| 我的博客 | 我的文章，编辑、删除、改可见范围 |
| 互动通知 | 点赞、评论、回复、@通知 |
| 未登录引导 | 公开内容可读，互动引导登录 |
| 管理员内容治理 | 文章/评论真实列表、下架、报告处理 |

## 6. 功能设计

### 6.1 可见性与权限模型

- 可见范围三档：`public` 完全公开、`friends` 仅好友可见、`self` 仅自己可见。
- 公开内容：任何登录或未登录用户可浏览列表与文章详情。
- 好友内容：仅作者好友可见；非好友访问返回权限错误，不展示占位假内容。
- 私密内容：仅作者本人可见，好友也不可见。
- 作者可在“我的博客”中随时修改文章可见范围；公开改为好友/私密后，已产生的点赞评论保留但仅可见范围内的人可查看。
- 评论可见性跟随文章可见范围；删除好友关系后，原好友可见内容立即不可见。

### 6.2 发布文章

- 文章字段：标题（1-80 字，必填）、摘要（0-300 字，可选）、正文（1-10000 字，必填）、封面（可选，单张 ≤2MB，JPG/PNG/WebP）、可见范围（默认 `public`）。
- 正文按纯文本处理，保留换行与空格；服务端校验长度与敏感词，命中后拒绝发布并提示，不静默替换。
- 封面选择复用现有图片上传与压缩能力，可移除后回退为无封面样式。
- 发布页自动保存本地草稿（标题、正文、封面、可见范围），发布成功后清除；发布失败保留草稿并提示重试。
- 发布流程：填写内容 -> 本地校验 -> 上传封面（可选，可并行）-> 服务端事务创建文章 -> 返回真实记录。
- 发布成功后自己的流立即插入该文章；好友/公众通过实时事件或下拉刷新看到。
- 字数统计由服务端计算真实字符数返回，客户端只展示，不自行推测。

### 6.3 发现流

- 博客首页两个页签：`公开`、`好友`。
- 公开流：全部 `visibility = public` 且 `status = active` 的文章，按 `published_at DESC, id DESC` 游标分页。
- 好友流：当前用户与好友的 `friends` 文章 + 自己的全部文章，同样按发布时间倒序。
- 每条文章卡片展示：真实封面（无封面用标题首字占位色块）、标题、摘要、作者真实头像与昵称、发布时间、真实字数、点赞数、评论数。
- 空状态：无文章显示“还没有公开博客”；无好友显示“添加好友后能看到好友博客”。

### 6.4 文章详情

- 展示真实封面、标题、作者信息、发布时间、字数、摘要、完整正文。
- 正文按纯文本渲染，保留换行；接口不做富文本解析，前端不做 HTML 执行。
- 底部操作：点赞/取消、评论入口、报告；点赞数、评论数由服务端聚合。
- 评论支持一级评论与回复；评论正文 1-200 字，纯文本渲染；删除权限为评论作者、文章作者、管理员。
- 删除一级评论时级联删除其回复；删除文章时级联隐藏点赞、评论、通知。
- 支持 @ 好友：输入 `@` 唤起真实好友选择器，发送时对 @ 用户产生 `blog.post.mention` 通知。
- 被下架或删除的文章对用户显示“该文章已不可见”，不伪造占位内容。

### 6.5 我的博客

- 展示我发布的全部文章（含 `self`），按时间倒序。
- 操作：编辑文章资料、修改可见范围、删除文章（二次确认）。
- 删除为软删除：`status = deleted`，级联隐藏；删除后所有入口不展示，通知跳转显示“该文章已不可见”。
- 文章被删除后封面文件先清理引用再删除，接口不得返回缓存假内容。

### 6.6 互动通知

- 通知类型：`post.like`、`post.comment`、`post.reply`、`post.mention`。
- 通知列表聚合展示真实文案，点击跳转对应文章详情并标记该文章相关通知已读。
- 未读数由服务端聚合，消息 Tab 红点 = 聊天未读 + 博客互动未读。
- 已读同步沿用现有消息已读语义，新增 `blog.notification.read` 事件。

### 6.7 内容安全与管理

- 发布接口服务端校验标题/正文/摘要长度、封面上传类型与大小，复用现有限流。
- 正文与评论经过敏感词过滤，命中后拒绝发布并提示，不静默替换。
- 用户可报告文章、评论；同一用户对同一对象只能报告一次，`UNIQUE(target_type, target_id, reporter_id)` 保证。
- 管理员后台新增“博客管理”：文章/评论真实列表，含作者、状态、报告数、下架操作；下架后对用户显示“该文章已不可见”。

## 7. 数据模型

新增表均使用 SQLite，与现有 `users`、`friendships`、`messages` 同一数据库。

### 7.1 blog_posts

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| author_id | TEXT NOT NULL | 作者，FK users.id，ON DELETE CASCADE |
| title | TEXT NOT NULL | 标题 1-80 字 |
| summary | TEXT NULL | 摘要 0-300 字 |
| body | TEXT NOT NULL | 正文 1-10000 字 |
| cover_path | TEXT NULL | 封面文件相对路径 |
| word_count | INTEGER NOT NULL | 服务端计算真实字数 |
| visibility | TEXT NOT NULL | `public` / `friends` / `self` |
| status | TEXT NOT NULL | `active` / `deleted` / `hidden` |
| published_at | INTEGER NOT NULL | 发布时间 |
| created_at | INTEGER NOT NULL | Unix 毫秒 |
| updated_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_blog_posts_feed(author_id, published_at DESC)`、`idx_blog_posts_public(status, visibility, published_at DESC)`。

### 7.2 blog_likes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| post_id | TEXT NOT NULL | FK blog_posts.id，ON DELETE CASCADE |
| user_id | TEXT NOT NULL | FK users.id，ON DELETE CASCADE |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

主键：`PRIMARY KEY(post_id, user_id)`；索引：`idx_blog_likes_post(post_id, created_at DESC)`。

### 7.3 blog_comments

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| post_id | TEXT NOT NULL | FK blog_posts.id，ON DELETE CASCADE |
| author_id | TEXT NOT NULL | FK users.id |
| parent_id | TEXT NULL | 回复时指向父评论 |
| body | TEXT NOT NULL | 1-200 字 |
| status | TEXT NOT NULL | `active` / `deleted` / `hidden` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |
| updated_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_blog_comments_post(post_id, created_at DESC)`、`idx_blog_comments_parent(parent_id)`。

### 7.4 blog_notifications

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| recipient_id | TEXT NOT NULL | 接收者，FK users.id |
| actor_id | TEXT NOT NULL | 操作者，FK users.id |
| post_id | TEXT NULL | 关联文章 |
| comment_id | TEXT NULL | 关联评论 |
| type | TEXT NOT NULL | `post.like` / `post.comment` / `post.reply` / `post.mention` |
| read_at | INTEGER NULL | 未读为 NULL |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_blog_notifications_recipient(recipient_id, read_at, created_at DESC)`。

### 7.5 blog_reports

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| target_type | TEXT NOT NULL | `post` / `comment` |
| target_id | TEXT NOT NULL | 对应对象 ID |
| reporter_id | TEXT NOT NULL | FK users.id |
| reason | TEXT NOT NULL | 报告原因 |
| status | TEXT NOT NULL | `pending` / `resolved` / `dismissed` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

唯一约束：`UNIQUE(target_type, target_id, reporter_id)`。

## 8. API 设计

除公开流与公开文章外均需 JWT 鉴权；统一错误结构 `{ "error": "code" }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/blog/feed?tab=public&cursor=&limit=20` | 公开/好友流（未登录仅 public） |
| POST | `/api/v1/blog/posts` | 发布文章（multipart：标题+摘要+正文+封面+可见范围） |
| GET | `/api/v1/blog/posts/{postID}` | 文章详情（校验可见性） |
| PATCH | `/api/v1/blog/posts/{postID}` | 编辑文章/改可见范围 |
| DELETE | `/api/v1/blog/posts/{postID}` | 删除自己的文章 |
| POST | `/api/v1/blog/posts/{postID}/like` | 点赞 |
| DELETE | `/api/v1/blog/posts/{postID}/like` | 取消点赞 |
| GET | `/api/v1/blog/posts/{postID}/likes?cursor=` | 点赞人列表 |
| POST | `/api/v1/blog/posts/{postID}/comments` | 发表评论/回复 |
| GET | `/api/v1/blog/posts/{postID}/comments?cursor=` | 评论列表 |
| DELETE | `/api/v1/blog/comments/{commentID}` | 删除评论 |
| POST | `/api/v1/blog/posts/{postID}/report` | 报告文章 |
| POST | `/api/v1/blog/comments/{commentID}/report` | 报告评论 |
| GET | `/api/v1/blog/me/posts?cursor=` | 我的文章 |
| GET | `/api/v1/blog/notifications?cursor=` | 互动通知 |
| POST | `/api/v1/blog/notifications/read` | 标记已读 |
| GET | `/api/v1/admin/blog/posts?status=&cursor=` | 管理员文章列表 |
| GET | `/api/v1/admin/blog/comments?status=&cursor=` | 管理员评论列表 |
| POST | `/api/v1/admin/blog/posts/{postID}/hide` | 管理员下架文章 |
| GET | `/api/v1/admin/blog/reports?status=&cursor=` | 报告处理列表 |

响应示例（公开流单条）：
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
  "title": "文章标题",
  "summary": "文章摘要",
  "coverUrl": "/api/v1/blog-media/cover/uuid.webp",
  "wordCount": 1240,
  "likeCount": 2,
  "likedByMe": false,
  "commentCount": 1,
  "visibility": "public",
  "publishedAt": "2026-08-02T09:30:00Z"
}
```

## 9. 实时事件

沿用现有 WebSocket 通道，事件只作刷新信号，完整状态始终以 REST 返回的真实数据为准。

| 事件 | 语义 |
| --- | --- |
| `blog.post.created` | 公开/好友范围内出现新文章 |
| `blog.post.like.created` | 文章被点赞 |
| `blog.post.like.removed` | 点赞被取消 |
| `blog.post.comment.created` | 文章被评论/回复/@ |
| `blog.post.comment.removed` | 评论被删除 |
| `blog.post.deleted` | 文章被删除或下架 |
| `blog.notification.read` | 通知已读同步 |

## 10. 权限与安全

- 所有博客接口强制 JWT 鉴权；公开流与公开文章可匿名。
- 服务端在查询层校验好友关系与可见范围，前端隐藏按钮不等于服务端不校验。
- 封面上传复用现有存储目录与限流；服务端校验真实 MIME、大小，文件名随机化，禁止路径穿越。
- 点赞/评论/通知写入使用事务与唯一约束，避免重复点赞、重复通知。
- 正文与评论只按纯文本展示，接口不做富文本解析。
- 发布、评论、通知读取接口接入现有限流。
- 管理员接口复用管理员鉴权，普通用户不能调用。

## 11. 状态与异常处理

| 场景 | 处理 |
| --- | --- |
| 未登录进入 | 显示公开流与登录引导，不展示假内容 |
| 无文章/无好友 | 真实空状态：还没有公开博客 / 添加好友后能看到好友博客 |
| 加载中 | 骨架屏，不出现空白跳动 |
| 接口失败 | 错误提示 + 重试，不清空已加载的真实内容 |
| 发布失败 | 保留草稿，提示重试，不产生半条记录 |
| 封面上传失败 | 标记失败封面，可重试或移除 |
| 重复点赞 | 服务端幂等返回当前状态，不重复计数 |
| 内容已删除 | 显示“该文章已不可见”，不展示占位假内容 |
| 通知点击 | 跳转文章详情并标记该文章相关通知已读 |
| 好友关系解除 | 原好友可见内容立即不可见，已产生的互动保留但不展示给无权限用户 |

## 12. 视觉与交互规范

- 沿用 FunBox 现有浅蓝背景、白色表面、主色 `#4b6bff`、深蓝 `#151b3b`、强调 `#c9f36a`。
- 卡片圆角不超过 16px，信息行圆角 8-10px；不新增嵌套卡片风格。
- 图标沿用 lucide / Material Community Icons 语义，按钮使用图标+文本，重要操作用图标按钮并带无障碍标签。
- 内容区最大宽度 430px，支持 320px、390px、430px 视口；文字不溢出、元素不重叠。
- 支持浅色/深色主题；状态信息不只用颜色表达。
- 编辑器与评论输入保持原生控件语义，支持键盘与读屏。

## 13. 成功指标

1. 发布成功率 ≥99%，发布失败率（含封面上传）≤1%。
2. 公开流首屏真实内容可加载 p95 ≤1.5s（正常网络）。
3. 30 天内发布过博客的用户占比 ≥15%。
4. 有博客内容的用户中，产生点赞/评论的用户占比 ≥40%。
5. 消息 Tab 未读数与实际未读通知一致率 100%。
6. 任何页面不出现内置假数据，验收通过自动扫描前端包内硬编码动态文案。

## 14. 一期全量交付范围

本方案不分期，以下功能必须在一期一次性完成并验收：

- 文章发布（标题、摘要、正文、封面、三档可见范围、本地草稿保留）。
- 公开流、好友流、文章详情、完整正文阅读。
- 点赞/取消、评论/回复、@好友、删除文章/评论、报告。
- 互动通知、消息 Tab 未读合并、实时事件。
- 我的博客管理与可见范围修改。
- 管理员博客管理列表与下架、报告处理。
- 封面上传压缩复用、真实字数统计。
- Go 后端 + SQLite 迁移 + Expo 前端 + Node/Go 测试全量通过。

## 15. 明确不做

- 不做富文本/HTML 编辑器、Markdown 渲染。
- 不做推荐算法排序、个性化推送、关注/粉丝体系。
- 不做站外分发、订阅邮件、评论置顶。
- 不做任何形式的 mock 数据回退或演示文章种子。

## 16. 验收清单

- [ ] 底部 Tab 与“我的”页出现博客入口，首页工具可搜索命中。
- [ ] 未登录可见公开流并可阅读公开文章，互动提示登录。
- [ ] 发布文章成功后数据库存在对应 `blog_posts` 记录与真实封面文件。
- [ ] 非好友访问好友可见文章返回权限错误。
- [ ] `self` 内容仅本人可见，好友也不可见。
- [ ] 点赞幂等，重复请求不产生重复记录。
- [ ] 评论与回复持久化，删除权限符合设计。
- [ ] 点赞、评论、回复产生真实通知，消息 Tab 未读数一致。
- [ ] 删除文章后流、详情、通知跳转均不再展示。
- [ ] 前端构建产物扫描无硬编码动态文案/图片/昵称。
- [ ] 测试使用隔离测试库，生产库无 seed 内容。
- [ ] 320px、390px、430px 视口无文字溢出与元素重叠，浅/深色主题可用。
- [ ] Go 测试、Node 测试、Expo lint、TypeScript 检查通过。

## 17. 风险与开放问题

| 风险/问题 | 当前建议 | 影响 |
| --- | --- | --- |
| 长文存储与传输 | 正文 ≤10000 字，纯文本，游标分页 | 需要监控单条正文长度 |
| 内容安全 | 敏感词 + 报告 + 管理员下架，公开内容范围受控 | 需运营后台配合 |
| 公开内容版权风险 | 发布即声明原创/已授权，报告处理闭环 | 需运营规则 |
| 好友关系变更 | 解除好友后立即不可见，互动记录保留 | 需明确产品口径 |
| 未读数合并 | 统一消息 Tab 聚合，分页签展示 | 需梳理现有未读模型 |

## 18. 交付物

- 本文件：详细产品设计方案。
- `docs/blog-product-design-v1.html`：可交互产品设计图。
- `docs/blog-product-design-v1.png`：设计图整体截图。
