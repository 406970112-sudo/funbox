# 免费小说阅读功能设计

日期：2026-07-31

## 1. 决策摘要

在现有 Funbox Expo 客户端和 Go 后端中增加“免费阅读”工具。产品公开上线后对用户永久免费、无广告，不提供充值、会员或付费章节。

内容由三类来源组成：

1. 正版内容供应商 API，首选阅文在线文学 API。
2. 管理员上传并确认拥有传播权限的 TXT 或 EPUB。
3. 用户在自己设备上导入的 TXT 或 EPUB。

供应商内容和管理员内容进入统一书城、书架与阅读器，但保留各自独立的来源、授权和下架规则。用户导入文件不上传服务器，首版阅读进度也只保存在本机。

## 2. 产品目标

- 用户可以发现、搜索、收藏和免费阅读已获授权的在线小说。
- 用户可以导入自己的 TXT/EPUB，并获得与在线小说一致的核心阅读体验。
- 管理员可以上传、检查、发布和下架自有授权内容。
- 内容供应商可以通过适配器接入，不让供应商字段和密钥渗透到客户端。
- 在供应商合同、出版资质或备案未完成时，可以关闭线上书城而不影响本地阅读功能的开发和使用。

## 3. 非目标

首版不包含以下能力：

- 付费章节、充值、会员或广告。
- 作者投稿、评论、书圈或社交分享流。
- AI 问书、自动摘要或内容改写。
- 听书和文字转语音。
- 用户导入文件的云端备份或跨设备同步。
- 同时接入多个正式内容供应商。

## 4. 用户与权限

### 普通用户

- 浏览书城、搜索图书、查看详情和目录。
- 收藏在线图书、保存在线阅读进度和书签。
- 导入、管理和阅读本机 TXT/EPUB。
- 在合同允许时缓存在线章节供离线阅读。

### 管理员

- 上传 TXT/EPUB 和封面。
- 编辑书籍元数据，检查解析结果，填写版权信息。
- 发布、隐藏和下架管理员内容。
- 查看供应商同步状态、失败任务和下架记录。
- 控制供应商、在线书城和离线缓存功能开关。

## 5. 信息架构

阅读工具使用四个一级视图：

1. **书城**：推荐、分类、搜索、连载状态筛选和图书详情。
2. **书架**：在线收藏、最近阅读、本地导入和下载状态。
3. **阅读器**：正文、目录、书签、阅读设置和章节导航。
4. **本地导入**：选择文件、解析预览、错误修复提示和导入结果。

管理员通过独立的 Web 管理页维护线上内容，管理功能不出现在普通用户客户端入口中。

## 6. 核心体验

### 6.1 在线图书

1. 用户从书城或搜索结果进入图书详情。
2. 详情页展示封面、书名、作者、简介、分类、连载状态、来源和目录。
3. 用户点击“免费阅读”后进入第一章或上次阅读位置。
4. 客户端向 Funbox 后端请求章节，后端再调用供应商适配器。
5. 阅读位置按账号同步，用户可以加入书架和添加书签。

供应商密钥只保存在后端。书籍元数据和目录允许缓存；章节正文默认实时获取并使用短期缓存。是否允许持久离线缓存由供应商合同和单书授权共同决定。

### 6.2 管理员上传图书

1. 管理员上传 TXT/EPUB，文件先进入草稿状态。
2. 服务端解析元数据、目录、章节和正文，并生成解析报告。
3. 管理员修正书名、作者、封面、分类、章节拆分和排序。
4. 管理员必须填写授权方、授权范围、有效期和权利证明备注。
5. 管理员预览后发布，图书才会出现在书城。
6. 授权到期、人工下架或内容审核失败时立即停止公开访问。

### 6.3 用户本地导入

1. 用户从系统文件选择器选择 TXT 或 EPUB。
2. 客户端在本机完成解析并展示书名和目录预览。
3. 用户确认后加入本地书架。
4. 文件、正文、书签和进度均保存在设备本地。

TXT 优先识别 UTF-8、GB18030/GBK 和 UTF-16，并根据常见章节标题生成目录。无法可靠识别时按固定篇幅分段并提示用户。EPUB 使用其导航目录；缺失目录时按文档顺序生成章节。

### 6.4 阅读器

阅读器提供：

- 上一章、下一章和目录跳转。
- 滚动阅读与分页阅读。
- 字号、行距、页边距和字体选择。
- 亮色、护眼和深色主题。
- 阅读进度、书签和返回书架。
- 章节预加载、加载失败重试和网络状态提示。

排版设置按设备保存。在线内容的进度和书签按用户账号保存；本地导入内容只保存在本机。

## 7. 内容供应商策略

首个正式供应商采用阅文在线文学 API。选择在线模式的原因：

- 章节正文实时请求，授权和下架控制更直接。
- 服务端只长期保存书籍元数据和目录，减少正文存储责任。
- 官方接口覆盖书籍、目录、正文、EPUB、更新和下架流程。
- 合作模式可以由商务配置为用户免费阅读。

后端定义统一的供应商接口：

```go
type Provider interface {
    ListBooks(ctx context.Context, cursor string) (BookPage, error)
    GetBook(ctx context.Context, externalID string) (ProviderBook, error)
    ListChapters(ctx context.Context, externalID string, cursor string) (ChapterPage, error)
    GetChapter(ctx context.Context, externalBookID, externalChapterID, userID string) (ChapterContent, error)
    ListUpdatedBooks(ctx context.Context, from, to time.Time) ([]string, error)
    ListRemovedBooks(ctx context.Context, from, to time.Time) ([]string, error)
}
```

开发环境提供一个模拟供应商，正式密钥不可用时仍能完成产品开发、自动化测试和演示。第二家供应商只有在完成商务授权后才新增适配器，不提前设计多供应商推荐和结算能力。

## 8. 系统架构

```text
Expo App
  |-- Online library, bookshelf, progress, bookmarks
  |       |
  |       +-- Go Reading API
  |              |-- Catalog service
  |              |-- Reader service
  |              |-- Provider adapter (mock / Yuewen)
  |              |-- Admin ingestion service
  |              |-- Rights and takedown service
  |              +-- SQLite + data/books + data/book-covers
  |
  +-- Local import service
          |-- TXT parser
          |-- EPUB parser
          +-- Device file storage and local progress
```

后端新增独立 `internal/reading` 模块，HTTP 层只负责鉴权、参数校验和响应映射。供应商调用、解析任务、书库查询和授权判断分别保持独立边界。

## 9. 数据模型

### books

- `id`
- `source_type`: `provider` 或 `admin`
- `provider_key` 与 `external_id`
- `title`、`author`、`intro`、`cover_url`
- `category`、`tags`、`serial_status`
- `publish_status`: `draft`、`published`、`hidden`、`removed`
- `allow_offline`
- `created_at`、`updated_at`

### chapters

- `id`、`book_id`
- `external_id`
- `title`、`sort_order`、`word_count`
- `content_path`：仅管理员内容使用
- `content_hash`
- `status`

### bookshelves

- `user_id`、`book_id`
- `added_at`

### reading_progress

- `user_id`、`book_id`、`chapter_id`
- `chapter_progress`
- `updated_at`

### bookmarks

- `id`、`user_id`、`book_id`、`chapter_id`
- `position`、`note`、`created_at`

### content_rights

- `book_id`
- `licensor`、`scope`、`proof_note`
- `valid_from`、`valid_until`
- `reviewed_by`、`reviewed_at`

### provider_sync_runs

- `provider_key`、`sync_type`
- `started_at`、`finished_at`
- `status`、`cursor`、`error_summary`

用户本地导入书籍不写入这些服务端表，使用客户端独立的数据结构和命名空间。

## 10. 后端接口

用户接口：

- `GET /api/v1/reading/books`
- `GET /api/v1/reading/books/{bookID}`
- `GET /api/v1/reading/books/{bookID}/chapters`
- `GET /api/v1/reading/books/{bookID}/chapters/{chapterID}`
- `GET /api/v1/reading/bookshelf`
- `PUT /api/v1/reading/bookshelf/{bookID}`
- `DELETE /api/v1/reading/bookshelf/{bookID}`
- `PUT /api/v1/reading/progress/{bookID}`
- `GET /api/v1/reading/bookmarks`
- `POST /api/v1/reading/bookmarks`
- `DELETE /api/v1/reading/bookmarks/{bookmarkID}`

管理员接口：

- `POST /api/v1/admin/reading/imports`
- `GET /api/v1/admin/reading/imports/{importID}`
- `PATCH /api/v1/admin/reading/books/{bookID}`
- `PATCH /api/v1/admin/reading/books/{bookID}/chapters/{chapterID}`
- `POST /api/v1/admin/reading/books/{bookID}/publish`
- `POST /api/v1/admin/reading/books/{bookID}/hide`
- `POST /api/v1/admin/reading/books/{bookID}/remove`
- `GET /api/v1/admin/reading/provider-sync-runs`
- `POST /api/v1/admin/reading/providers/{providerKey}/sync`

所有正文接口都在返回前检查图书状态、授权期限和供应商可用状态。

## 11. 同步与下架

- 每日同步供应商全量书籍 ID，用于发现漏同步记录。
- 每十分钟同步更新、上架和下架事件。
- 内容更新后刷新元数据和目录；正文缓存按内容哈希失效。
- 收到供应商下架事件后，先原子地关闭用户访问，再清除正文缓存和供应商要求删除的元数据，并记录审计日志。
- 用户书架只保留不含供应商书名、简介、封面或正文的中性下架记录，用于解释条目不可继续阅读。
- 管理员内容在授权到期时自动隐藏，管理员可以续期后重新发布。
- 同步失败采用有限次数退避重试，持续失败时在后台显示告警，不向用户展示供应商内部错误。

## 12. 错误与状态设计

- 供应商临时不可用：已缓存且仍获授权的章节可继续阅读，否则显示重试入口。
- 图书已下架：从书城隐藏，书架仅保留不含受限内容的不可读占位和下架说明。
- 授权过期：立即拒绝新正文请求并清理受限缓存。
- 文件格式不支持：保留原文件，不创建书籍，返回可理解的解析原因。
- TXT 编码或目录识别不确定：进入人工预览，不自动发布。
- EPUB 缺少部分资源：导入可继续时给出警告，正文结构损坏时终止导入。
- 进度保存失败：客户端暂存并在网络恢复后重试，阅读本身不中断。

## 13. 安全与合规

- 供应商密钥、签名密钥和白名单配置只存在于后端。
- 管理员上传限制文件类型、体积和解压后总体积，阻止路径穿越和 EPUB 解压炸弹。
- 上传文件先进入不可公开目录，解析和权限审核完成后才能发布。
- 权利证明、发布、下架和管理员修改均保留审计记录。
- 服务端不接收用户本地导入文件。
- 线上书城由独立功能开关控制；供应商授权、网络出版相关资质和 APP 备案未完成时保持关闭。
- 上线前由具备中国大陆网络出版合规经验的专业人员复核许可证、内容审核流程和合同授权范围。

## 14. 测试策略

### 单元测试

- TXT 编码识别、章节拆分和异常文件处理。
- EPUB 目录、资源路径和缺失目录处理。
- 阅读进度换章、恢复和冲突覆盖规则。
- 权限期限、上下架和离线授权判断。
- 供应商字段映射、签名和错误码转换。

### 集成测试

- 模拟供应商的书籍、目录、正文、更新和下架全流程。
- 管理员上传、解析、编辑、发布和下架流程。
- 登录用户的书架、进度和书签接口。
- 供应商下架后正文不可访问且缓存被清理。

### 客户端验收

- Android、iOS 和 Web 的书城、详情、书架和阅读器布局。
- TXT/EPUB 导入、续读、主题和字号设置。
- 长章节、超长书名、空目录和断网状态。
- 小屏手机与桌面浏览器均无文字遮挡或控件重叠。

## 15. 验收标准

- 用户可以从书城找到图书，加入书架并连续阅读多个章节。
- 在线阅读位置在同一账号的不同设备间恢复。
- 用户可以在本机导入常见 TXT/EPUB，退出后仍可续读。
- 管理员可以完成上传、解析预览、版权确认、发布和下架闭环。
- 模拟供应商可以完整替代正式密钥完成测试。
- 供应商下架事件在下一轮十分钟同步内生效。
- 未授权、过期或已下架正文不能通过直接 API 地址读取。
- 线上书城关闭时，本地导入功能仍能独立使用。

## 16. 实施顺序

1. 定义阅读领域模型、服务端接口和模拟供应商。
2. 实现本地 TXT/EPUB 导入与统一阅读器。
3. 实现在线书城、详情、书架、进度和书签。
4. 实现管理员上传、解析预览、版权信息和发布流程。
5. 实现阅文适配器、定时同步、缓存与下架机制。
6. 完成跨端验收、安全检查和上线开关。
7. 取得正式授权和相关资质后开启公开书城。

## 17. 官方依据

- 阅文文学 API 概述：https://open.yuewen.com/docs/guide/
- 阅文开放平台接入指南：https://open.yuewen.com/docsv2/guide/1000.html
- 阅文在线文学 API：https://open.yuewen.com/docs/1012.html
- 阅文在线文学业务规则：https://open.yuewen.com/docs/1013.html
- 阅文落地文学业务规则：https://open.yuewen.com/docs/1004.html
- 国家新闻出版署《网络出版服务管理规定》：https://www.nppa.gov.cn/xxfb/zcfg/bmgz/201602/t20160206_4403.html
- 工业和信息化部 APP 备案通知：https://www.miit.gov.cn/jgsj/xgj/wjfb/art/2023/art_dd783a581c9644a4aee10afa582811db.html
