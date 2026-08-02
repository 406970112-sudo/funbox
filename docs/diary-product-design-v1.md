# FunBox 日记本 产品设计方案 V1

> 版本：V1 草案
> 日期：2026-08-02
> 状态：待评审
> 定位：在 FunBox 中提供「多日记本、每天一篇、日记本级可选密码」的私人记录能力；所有内容均为用户真实数据，前后端不引入任何 mock、演示或 seed 数据。

## 1. 背景与问题

FunBox 已经有真实账号体系、好友关系、WebSocket、SQLite 和 Go API，但缺少一个私人的、可持续的记录空间。用户目前：

| 现状 | 问题 |
| --- | --- |
| 工具和游戏产生的是即时结果 | 缺少把当天心情、经历沉淀下来的长期空间 |
| 聊天和朋友圈是社交内容 | 无法满足「只写给自己看」的私密记录 |
| 不同生活主题混在一起 | 工作、旅行、私密心情需要分本管理 |
| 普通日记 App 密码体系重 | 密码通常绑定整个账号，用户不想要复杂流程 |

本方案引入「日记本」：用户可创建多个日记本，每本可独立设置密码，也可以不设置。设置密码后，查看该本历史日记必须输入密码；所有写入、读取、统计都基于真实数据库，不做任何假数据兜底。

## 2. 产品目标

1. 从首页工具入口到写完一篇日记不超过 60 秒。
2. 支持多日记本，每本可选独立密码；设密码后历史列表与详情必须验证。
3. 所有日记、图片、心情、统计均来自 SQLite/API，任何页面不允许 mock 数据。
4. 解锁会话安全且短暂：30 分钟无操作自动失效，退出登录或手动上锁立即失效。
5. 空状态、加载态、错误态成为唯一兜底，不做演示内容填充。

## 3. 真实数据红线（一票否决）

这是本方案的第一约束，设计和实现阶段都必须满足：

1. 前端不允许硬编码或内置任何日记正文、标题、心情、天气、图片、统计数字。
2. 后端不允许向生产数据库 seed 示例日记；数据库只能保存用户真实操作产生的记录。
3. 前端所有展示内容必须来自真实 API；加载中、空状态、错误状态是唯一允许的兜底。
4. 测试可以创建隔离的 SQLite 测试库写入测试数据，但生产库与测试库严格分离，测试数据不得进入用户可见页面。
5. 日记或图片删除后，接口不得返回缓存假内容；前端按接口状态展示删除结果。
6. 密码只存哈希，列表接口不返回正文、密码、密码哈希。
7. 日记数量、连续天数、心情分布等服务端聚合返回，客户端不得本地猜测计数。
8. 本地只允许做乐观更新和断网草稿缓存，最终以服务端回执为准；服务端失败必须回滚本地状态。

## 4. 目标用户与核心场景

| 用户 | 核心场景 | 产品应满足 |
| --- | --- | --- |
| 日常记录者 | 睡前写今天发生了什么 | 打开即写、当日可反复修改、保存快 |
| 多主题记录者 | 工作、旅行、私人感悟分开记 | 多日记本、封面色区分、按本查看 |
| 注重隐私用户 | 私密本不想被家人/同事看到 | 每本独立密码，历史强制解锁 |
| 新用户 | 第一次进入日记本 | 明确空状态，不展示任何假日记 |
| 忘记密码用户 | 密码丢失后无法进入 | 提供可解释的「重建本子」路径，不弱化安全 |

## 5. 信息架构与入口

- 首页工具网格新增「日记本」，分类「记录」，未登录点击进入登录引导。
- 工具列表搜索可命中「日记、日记本、记录、写日记」。
- 进入后主页为「我的日记本」列表；列表展示真实元数据，不展示正文摘要。
- 「我的」页面最近使用复用现有 `recent-usage` 真实记录，日记本被打开后才出现。

## 6. 页面与功能清单

| 页面 | 阶段 | 说明 |
| --- | --- | --- |
| 日记本首页 | 一期 | 我的日记本列表、新建入口、真实统计摘要 |
| 写日记 / 编辑 | 一期 | 每日一篇，标题、正文、心情、天气、图片 |
| 历史日记 | 一期 | 日历月视图 + 日期列表，按真实日期读取 |
| 解锁弹窗 | 一期 | 输入日记本密码，错误提示与次数限制 |
| 日记本设置 | 一期 | 重命名、封面色、设置/修改/移除密码、每日提醒 |
| 搜索 | 一期 | 已解锁本内按标题/正文搜索，服务端真实检索 |
| 统计 | 一期 | 连续天数、本月篇数、心情分布 |
| 导出 | 一期 | 将真实日记导出为 Markdown/TXT |
| 每日提醒 | 一期 | 本地通知或 Codex 自动化提醒写日记 |

## 7. 核心流程

```text
新建日记本（可选设密码） → 回到列表
进入日记本（有密码 → 解锁） → 今日页
写今日 → 保存 → 服务端落库 → 返回真实记录
历史（日历点选 / 列表） → 读取该日条目
设置 → 修改 / 移除密码
空状态 / 错误态兜底
```

解锁子流程：

1. 前端请求日记本元数据，得到 `hasPassword=true`。
2. 打开历史或进入本子时，若没有有效解锁令牌，弹出密码输入。
3. 后端校验密码哈希，成功后签发短时 notebook unlock token（30 分钟）。
4. 前端用 SecureStore 保存令牌；退出登录、手动上锁、令牌过期均需重新输入。
5. 同一本子连续失败 5 次，锁定 5 分钟，沿用现有限流配置。

## 8. 功能设计

### 8.1 日记本

- 名称 1-30 字，封面色从 8 个预设色中选择；可后续修改。
- 创建时默认不设密码，用户可勾选「立即设置密码」。
- 列表卡片展示：名称、封面色、真实篇数、最近一篇日期、连续天数、锁图标。
- 列表接口只返回元数据，不返回正文或正文摘要。
- 删除为软删除（`status=deleted`）；设置过密码的本子删除前需验证密码。
- 每个日记本只属于一个用户，不做共享、公开、陌生人可见。

### 8.2 写日记

- 每天每个日记本最多一篇正式条目，由 `UNIQUE(notebook_id, entry_date)` 保证；同日再次编辑为更新，不产生第二条记录。
- 字段：标题（选填，≤50 字）、正文（必填，1-10000 字）、心情（5 档，选填）、天气（选填）。
- 保存采用乐观更新 + 服务端最终确认；失败保留本地草稿，草稿仅保存在当前用户的本地存储，不作为列表数据。
- 图片最多 9 张，单张 ≤5MB，支持 JPG/PNG/WebP/HEIC，复用现有上传与压缩能力；失败图片可重试或移除。
- 允许修改历史日期条目：通过日历选择日期后进入编辑，更新仍走同一唯一约束。

### 8.3 历史日记

- 默认日历月视图，有日记的日期显示圆点，圆点颜色对应当天心情。
- 点选日期查看该日条目；同日条目支持编辑、删除。
- 未解锁的加密本：日历只显示日期与锁状态，不显示正文摘要，点击即触发解锁。
- 列表/日历数据按 `cursor + limit` 分页，不做 offset 深分页。
- 删除后日历圆点与列表立即消失，不保留占位内容。

### 8.4 日记本密码

- 设置：6-32 位，输入两次确认；V1 不绑定安全问题，避免弱恢复。
- 修改：需当前密码；新密码规则一致。
- 移除：需当前密码；移除后该本立即无锁打开。
- 忘记密码：不提供找回（后端不存明文，且一期启用内容加密），提供「清空此本并重建」路径，需账号密码二次确认；设置页明确说明旧内容不可找回。
- 安全实现：密码使用 bcrypt/argon2id 哈希；解锁令牌为短时 JWT（scope=notebook，TTL=30 分钟）；解锁接口限流。

### 8.5 搜索与统计

- 搜索仅限已解锁的本子，按标题/正文 LIKE 检索或全文索引，返回真实命中片段。
- 统计由服务端聚合：连续天数、本月篇数、总篇数、心情分布、最近 7 天分布。
- 统计页不允许本地推算；接口失败显示错误与重试。

### 8.6 每日提醒

- 每个日记本可独立开启「每日提醒」，设置提醒时间；开启后写入日记本元数据。
- 客户端按本地时间触发通知，点击通知直接进入该日记本今日编辑页。
- 提醒设置只影响通知触发，不产生、不修改任何日记内容；数据仍全部来自真实 API。

## 9. 数据模型

新增表均使用 SQLite，与现有 `users` 等表同一数据库。

### 9.1 diary_notebooks

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| owner_id | TEXT NOT NULL | 所有者，FK users.id |
| name | TEXT NOT NULL | 1-30 字 |
| cover_color | TEXT NOT NULL | 预设色值 |
| has_password | INTEGER NOT NULL | 0/1 |
| password_hash | TEXT NULL | bcrypt/argon2id 哈希 |
| password_version | INTEGER NOT NULL | 哈希算法版本 |
| reminder_enabled | INTEGER NOT NULL | 0/1，每日提醒开关 |
| reminder_time | TEXT NULL | `HH:mm`，本地时区提醒时间 |
| status | TEXT NOT NULL | `active` / `deleted` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |
| updated_at | INTEGER NOT NULL | Unix 毫秒 |

索引：`idx_diary_notebooks_owner(owner_id, status)`、`idx_diary_notebooks_updated(owner_id, updated_at DESC)`。

### 9.2 diary_entries

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| notebook_id | TEXT NOT NULL | FK diary_notebooks.id，ON DELETE CASCADE |
| owner_id | TEXT NOT NULL | 冗余归属，FK users.id |
| entry_date | TEXT NOT NULL | `YYYY-MM-DD` |
| title | TEXT NULL | ≤50 字 |
| content | TEXT NOT NULL | 1-10000 字 |
| mood | TEXT NULL | `happy` / `calm` / `tired` / `sad` / `angry` |
| weather | TEXT NULL | `sunny` / `cloudy` / `rainy` / `windy` |
| status | TEXT NOT NULL | `active` / `deleted` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |
| updated_at | INTEGER NOT NULL | Unix 毫秒 |

唯一约束：`UNIQUE(notebook_id, entry_date)`。

索引：`idx_diary_entries_date(notebook_id, entry_date)`、`idx_diary_entries_owner_created(owner_id, created_at DESC)`。

### 9.3 diary_entry_media

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| entry_id | TEXT NOT NULL | FK diary_entries.id，ON DELETE CASCADE |
| file_path | TEXT NOT NULL | 服务端存储相对路径 |
| mime_type | TEXT NOT NULL | image/jpeg 等 |
| width / height | INTEGER | 上传解析尺寸 |
| sort_order | INTEGER NOT NULL | 0-8 |

索引：`idx_diary_entry_media(entry_id, sort_order)`。

### 9.4 diary_security_events

记录设置/修改/移除密码、解锁失败、锁定事件，用于安全审计；不保存密码或正文。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| notebook_id | TEXT NOT NULL | FK diary_notebooks.id |
| user_id | TEXT NOT NULL | FK users.id |
| action | TEXT NOT NULL | `password_set` / `password_changed` / `password_removed` / `unlock_failed` / `lock` |
| created_at | INTEGER NOT NULL | Unix 毫秒 |

## 10. API 设计

所有日记接口要求 JWT 登录；设置密码的本子，正文相关接口要求 `X-Diary-Unlock-Token`。统一错误结构为 `{ "error": "code" }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/diary/notebooks` | 新建日记本（可带密码） |
| GET | `/api/v1/diary/notebooks` | 我的日记本列表（仅元数据与真实统计） |
| GET | `/api/v1/diary/notebooks/{id}` | 单本元数据 |
| PATCH | `/api/v1/diary/notebooks/{id}` | 重命名、改封面色 |
| DELETE | `/api/v1/diary/notebooks/{id}` | 软删除（有密码需解锁） |
| POST | `/api/v1/diary/notebooks/{id}/password` | 设置/修改/移除密码 |
| POST | `/api/v1/diary/notebooks/{id}/unlock` | 验证密码，签发解锁令牌 |
| POST | `/api/v1/diary/notebooks/{id}/lock` | 手动上锁，撤销令牌 |
| GET | `/api/v1/diary/notebooks/{id}/entries?date=YYYY-MM-DD` | 读取某日条目 |
| PUT | `/api/v1/diary/notebooks/{id}/entries/{date}` | 新建或更新当日条目（upsert） |
| DELETE | `/api/v1/diary/notebooks/{id}/entries/{date}` | 删除条目 |
| GET | `/api/v1/diary/notebooks/{id}/entries?month=YYYY-MM` | 日历聚合：日期、心情、有无正文 |
| GET | `/api/v1/diary/notebooks/{id}/search?q=` | 已解锁本内搜索 |
| POST | `/api/v1/diary/notebooks/{id}/entries/{date}/media` | 上传图片 |
| DELETE | `/api/v1/diary/notebooks/{id}/media/{mediaID}` | 删除图片 |
| GET | `/api/v1/diary/notebooks/{id}/stats` | 连续天数、篇数、心情分布 |
| GET | `/api/v1/diary/notebooks/{id}/export` | 导出 Markdown/TXT（真实内容） |

日记本列表响应示例（核心字段）：

```json
{
  "id": "uuid",
  "name": "旅行手记",
  "coverColor": "#4b6bff",
  "hasPassword": true,
  "entryCount": 32,
  "lastEntryDate": "2026-08-01",
  "currentStreak": 5,
  "createdAt": "2026-05-12T08:00:00Z"
}
```

解锁响应：

```json
{
  "unlockToken": "jwt-scoped-to-notebook",
  "expiresInSeconds": 1800
}
```

## 11. 安全与隐私

- 所有日记接口强制 JWT 鉴权；解锁令牌 scope 限定到单个日记本。
- 密码使用 bcrypt/argon2id 哈希，接口不返回哈希；解锁接口限流。
- 图片文件服务端随机命名，媒体读取要求登录 + 解锁令牌，不允许匿名访问。
- 管理员后台不提供日记正文查看能力，只能看到「用户是否使用日记功能」的匿名统计。
- 一期启用内容加密：日记正文使用 AES-256-GCM 加密存储，密钥由 Argon2id(密码 + 每本盐) 派生；启用后忘记密码无法找回内容，产品需在设置页明确说明。
- 退出登录时清空本地日记草稿缓存与解锁令牌。

## 12. 状态与异常处理

| 场景 | 处理 |
| --- | --- |
| 未登录进入 | 引导登录，不展示任何假内容 |
| 无日记本 | 空状态：新建第一个日记本 |
| 当日无日记 | 今日卡片显示空状态与写日记按钮 |
| 加载中 | 骨架屏，不出现空白跳动 |
| 接口失败 | 错误提示 + 重试，不清空已加载的真实内容 |
| 解锁失败 | 提示剩余次数，5 次后锁定 5 分钟 |
| 保存失败 | 保留本地草稿，提示重试，不产生半条记录 |
| 图片上传失败 | 标记失败图片，可重试或移除 |
| 日记已删除 | 日历与列表不再展示；详情返回已删除提示 |

## 13. 视觉与交互规范

- 沿用 FunBox 浅蓝背景、白色表面、主色 `#4b6bff`、深蓝 `#151b3b`、强调 `#c9f36a`。
- 日记本卡片圆角 8-12px，不使用嵌套卡片；锁、心情、天气使用图标表达。
- 支持 320px / 390px / 430px 视口，文字不溢出、元素不重叠；深色主题同步适配。
- 按钮使用图标 + 文本，重要操作（保存、解锁、删除）有明确语义标签；锁状态不只依赖颜色。

## 14. 成功指标

1. 从进入工具到保存成功 p95 ≤ 1.5s（正常网络）。
2. 解锁成功到进入历史 p95 ≤ 1s。
3. 任意页面不出现内置假数据，验收通过自动化扫描前端包。
4. 7 日内再次打开日记本的用户占新用户比例 ≥ 40%。
5. 设置密码的本子中，解锁失败率（含忘记密码）≤ 15%。
6. 生产库中不存在任何非用户产生的日记记录。

## 15. 一期实施范围（不分期）

以下功能全部在一期交付，不拆分为 MVP 或后续版本：

- 多日记本、每日一篇、编辑/删除、封面色。
- 密码设置/修改/移除、解锁会话、限流与锁定、安全审计。
- 历史日历 + 日期详情、图片上传/删除。
- 已解锁本内搜索、统计页、Markdown/TXT 导出。
- 每日提醒（复用本地通知或 Codex 自动化）。
- 日记正文 AES-256-GCM 内容加密。
- Go 后端 + SQLite 迁移 + Expo 前端 + Go/Node 测试。

## 16. 明确不做

- 不做公开日记、陌生人可见、好友可见。
- 不做自动 AI 续写/润色后直接保存；AI 只能作为用户主动调用的写作辅助，保存内容必须为用户确认的真实文本。
- 不做任何形式的 mock 数据回退或演示日记种子。
- 不做密码找回的弱方案（安全问题、明文重置）。
- 管理员不查看日记正文。

## 17. 验收清单

- [ ] 未登录进入日记本显示登录引导，不显示假内容。
- [ ] 新建日记本可选密码，创建后真实写入 `diary_notebooks`。
- [ ] 列表接口只返回元数据与真实统计，不返回正文/密码哈希。
- [ ] 设置密码的本子查看历史必须解锁，未解锁不返回正文。
- [ ] 解锁令牌 30 分钟过期，手动上锁/退出登录立即失效。
- [ ] 同日重复保存只产生一条 `diary_entries` 记录。
- [ ] 日历圆点与心情来自服务端聚合。
- [ ] 图片上传/删除真实落库；删除后接口不再返回图片。
- [ ] 生产库无 seed，前端无硬编码日记正文/统计。
- [ ] Go 测试、Node 测试、Expo lint、TypeScript 检查通过。

## 18. 风险与开放问题

| 风险 / 问题 | 当前建议 | 影响 |
| --- | --- | --- |
| 忘记密码与内容加密的取舍 | 一期即启用内容加密；忘记密码后旧内容不可找回，提供清空重建，设置页明确说明 | 需要产品文案和二次确认 |
| 图片存储与带宽 | 复用现有压缩与存储，限制 9 图 / 5MB | 需要监控存储增长 |
| 解锁令牌多端行为 | 一期每端独立解锁令牌，同一账号在不同设备分别验证日记本密码后访问 | 多端行为可预期 |
| 删除日记本是否可恢复 | V1 软删除但不提供回收站，删除后 30 天可后台清理 | 需要确认用户预期 |

## 19. 交付物

- 本文档：详细产品设计方案。
- `docs/diary-product-design-v1.html`：可交互产品设计图。
- `docs/diary-product-design-v1.png`：设计图整体截图。
