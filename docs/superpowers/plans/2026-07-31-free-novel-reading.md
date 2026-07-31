# 免费小说阅读功能实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务顺序实施；每个行为先写失败测试，再写最小实现，最后执行相关回归。开发在 `codex/free-reading` 隔离工作树中完成，最终以非强制方式推送到远端 `main`。

**目标：** 在 Funbox 中交付可实际使用的免费阅读功能，包括在线书城、书籍详情、书架、本地 TXT/EPUB 导入、沉浸阅读器，以及管理员上传、解析、版权确认、发布、隐藏和下架后台。

**架构：** Go 后端新增 `internal/reading` 领域，SQLite 持久化书籍、章节、书架、进度、书签、版权和同步记录；供应商通过统一接口接入，开发环境使用可替换正式密钥的 mock provider。Expo 客户端新增独立阅读路由和状态层，在线内容经后端访问，本地文件只在设备端解析与保存。管理员后台复用 Expo Web，但使用独立 `/admin/reading` 路由和管理员鉴权。

**技术栈：** Go 1.22、`net/http`、SQLite；Expo Router 6、React Native 0.81、TypeScript；`expo-document-picker`、`@react-native-async-storage/async-storage`、`fflate`、`iconv-lite`、`fast-xml-parser`。

## 设计约束与组件清单

- 色彩沿用 Funbox 主题，阅读模块增加墨蓝 `#1d2b4f`、珊瑚 `#ef6a64`、纸白 `#fffdf8`、护眼绿 `#eef3e7` 和夜读黑 `#17191d`。
- 卡片圆角不超过 8px；移动端最大内容宽度沿用 `430px`，管理端采用固定侧栏与自适应主区。
- 核心组件：阅读首页分段控件、书籍封面卡、继续阅读条、书籍详情、目录抽屉、阅读设置面板、文件导入预览、后台状态筛选、上传面板、版权信息表单、发布确认。
- 所有图标使用现有 `MaterialCommunityIcons`；不绘制自定义 SVG 图标。
- 交互必须可用：搜索与筛选、加入/移出书架、继续阅读、章节切换、目录跳转、主题与字号设置、书签、TXT/EPUB 选择与解析、管理员上传/编辑/发布/隐藏/下架。

## 任务 1：建立隔离工作区和验证基线

**文件：**
- 不修改产品代码。

**步骤：**

1. 确认 `.worktrees/` 被 Git 忽略。
2. 从当前 `main` 创建 `.worktrees/free-reading`，分支名为 `codex/free-reading`。
3. 在工作树执行 `go test ./...`、`npm install`、`npm run lint`，记录任何既有失败。
4. 确认工作树状态干净，再开始功能实现。

## 任务 2：阅读领域模型、存储和模拟供应商

**文件：**
- 新增：`backend/internal/reading/models.go`
- 新增：`backend/internal/reading/provider.go`
- 新增：`backend/internal/reading/provider_mock.go`
- 新增：`backend/internal/reading/store.go`
- 新增：`backend/internal/reading/store_test.go`
- 修改：`backend/internal/config/config.go`
- 修改：`backend/.env.example`
- 修改：`backend/cmd/api/main.go`

**失败测试：**

- 新数据库会创建 `reading_books`、`reading_chapters`、`reading_bookshelves`、`reading_progress`、`reading_bookmarks`、`reading_content_rights`、`reading_provider_sync_runs` 和审计表。
- mock provider 返回稳定的推荐书籍、目录和正文；同步后可从统一存储读取。
- 发布状态、授权有效期和下架状态分别阻止正文访问。
- 进度更新使用新时间覆盖旧时间，旧客户端时间不能回退服务端进度。

**实现：**

- 定义 `Provider`：`ListBooks`、`GetBook`、`ListChapters`、`GetChapter`、`ListUpdatedBooks`、`ListRemovedBooks`。
- `Store` 负责事务、查询和迁移，不在 HTTP 层拼 SQL。
- `Service` 统一处理目录、正文、版权、下架和 provider 同步。
- mock provider 内置 3 本完整演示书，每本至少 3 章，内容与设计稿一致且不依赖网络。
- 配置增加 `READING_PROVIDER_MODE`、`READING_LIBRARY_ENABLED`、`STORAGE_READING_DIR`、上传和解压大小限制；生产默认关闭线上书城，开发与测试允许 mock。

**验证：**

```powershell
go test ./internal/reading -run 'Test(Store|MockProvider|Rights|Progress)' -count=1
```

## 任务 3：用户书城、书架、进度和书签 API

**文件：**
- 新增：`backend/internal/httpapi/reading_handlers.go`
- 新增：`backend/internal/httpapi/reading_handlers_test.go`
- 修改：`backend/internal/httpapi/server.go`
- 修改：`backend/cmd/api/main.go`

**失败测试：**

- 匿名用户只能浏览已发布且授权有效的目录和正文。
- 登录用户可加入/移出书架、保存进度、创建和删除自己的书签。
- 用户 A 不能读取或删除用户 B 的书签。
- 被隐藏、下架、授权过期的书籍无法通过直接正文 URL 读取。
- 在线书城关闭时列表返回可识别的功能关闭状态，本地导入不受影响。

**实现路由：**

```text
GET    /api/v1/reading/books
GET    /api/v1/reading/books/{bookID}
GET    /api/v1/reading/books/{bookID}/chapters
GET    /api/v1/reading/books/{bookID}/chapters/{chapterID}
GET    /api/v1/reading/bookshelf
PUT    /api/v1/reading/bookshelf/{bookID}
DELETE /api/v1/reading/bookshelf/{bookID}
PUT    /api/v1/reading/progress/{bookID}
GET    /api/v1/reading/bookmarks
POST   /api/v1/reading/bookmarks
DELETE /api/v1/reading/bookmarks/{bookmarkID}
```

**验证：**

```powershell
go test ./internal/httpapi -run 'TestReading' -count=1
```

## 任务 4：安全 TXT/EPUB 解析与管理员发布 API

**文件：**
- 新增：`backend/internal/reading/importer.go`
- 新增：`backend/internal/reading/importer_txt.go`
- 新增：`backend/internal/reading/importer_epub.go`
- 新增：`backend/internal/reading/importer_test.go`
- 新增：`backend/internal/httpapi/reading_admin_handlers.go`
- 新增：`backend/internal/httpapi/reading_admin_handlers_test.go`
- 修改：`backend/internal/httpapi/server.go`

**失败测试：**

- TXT 能识别 UTF-8、GB18030/GBK 和 UTF-16，并按常见中文章节标题拆章。
- 无标题 TXT 按稳定篇幅拆章并返回人工检查警告。
- EPUB 优先读取 EPUB3 nav，回退 NCX，再回退 OPF spine 顺序。
- EPUB 拒绝绝对路径、`..` 路径、超压缩比、过多条目和超出解压上限的压缩包。
- 非管理员访问全部管理接口返回 `403`。
- 未填写授权方、授权范围、有效期或证明备注时不能发布。
- 上传后为草稿；只有发布后才进入书城；隐藏和下架后正文立即不可访问。

**实现路由：**

```text
GET    /api/v1/admin/reading/books
POST   /api/v1/admin/reading/imports
GET    /api/v1/admin/reading/imports/{importID}
PATCH  /api/v1/admin/reading/books/{bookID}
PATCH  /api/v1/admin/reading/books/{bookID}/chapters/{chapterID}
POST   /api/v1/admin/reading/books/{bookID}/publish
POST   /api/v1/admin/reading/books/{bookID}/hide
POST   /api/v1/admin/reading/books/{bookID}/remove
GET    /api/v1/admin/reading/provider-sync-runs
POST   /api/v1/admin/reading/providers/{providerKey}/sync
```

- 上传采用 multipart，独立大小限制，不受 JSON 64KB 限制。
- 原文件进入私有 `data/reading/imports`；正文进入私有章节文件，公开接口从不暴露路径。
- 文件名由服务端生成；所有管理写操作记录管理员、动作和时间。

**验证：**

```powershell
go test ./internal/reading ./internal/httpapi -run 'Test(Import|AdminReading|EPUB|TXT)' -count=1
```

## 任务 5：前端领域类型、API、状态与本地导入

**文件：**
- 新增：`frontend/lib/reading-api.ts`
- 新增：`frontend/lib/reading-local-import.ts`
- 新增：`frontend/lib/reading-local-storage.ts`
- 新增：`frontend/lib/reading-state.ts`
- 新增：`frontend/tests/reading-local-import.test.mjs`
- 新增：`frontend/tests/reading-state.test.mjs`
- 修改：`frontend/package.json`
- 修改：`frontend/package-lock.json`

**失败测试：**

- TXT 编码与章节拆分与后端规则一致。
- EPUB nav、NCX 和 spine 回退顺序稳定，路径规范化不能越出压缩包根。
- 阅读进度限制在 `[0, 1]`，换章后正确恢复位置。
- 主题、字号、行距、页边距和阅读模式经过序列化后可恢复。
- 本地书籍删除只影响 `funbox.reading.local.*` 命名空间。

**实现：**

- `reading-api.ts` 统一处理鉴权、错误码和响应映射。
- `reading-local-import.ts` 使用 `fflate`、`fast-xml-parser`、`iconv-lite` 纯客户端解析，不向后端发送用户文件。
- `reading-local-storage.ts` 用 AsyncStorage 保存元数据、章节、书签、进度和设置；Web 与 Native 使用同一接口。
- `reading-state.ts` 提供纯函数，UI 状态逻辑保持可测试。

**验证：**

```powershell
npm run test:reading
```

## 任务 6：书城、书籍详情、书架和本地导入界面

**文件：**
- 新增：`frontend/features/reading/reading-home-screen.tsx`
- 新增：`frontend/features/reading/bookstore-view.tsx`
- 新增：`frontend/features/reading/bookshelf-view.tsx`
- 新增：`frontend/features/reading/book-card.tsx`
- 新增：`frontend/features/reading/book-detail-screen.tsx`
- 新增：`frontend/features/reading/local-import-screen.tsx`
- 新增：`frontend/features/reading/reading-ui.tsx`
- 新增：`frontend/app/reading/books/[bookId].tsx`
- 新增：`frontend/app/reading/import.tsx`
- 修改：`frontend/features/tools/tool-detail-screen.tsx`
- 修改：`frontend/app/_layout.tsx`
- 修改：`backend/internal/access/feature_registry.json`

**实现：**

- `/tools/free-reading` 首屏就是可用书城/书架，不做营销落地页。
- 书城首屏包含搜索、分类筛选、精选书籍和最近更新；空态、加载、错误和重试状态完整。
- 书籍详情显示来源、授权状态、简介、目录、加入书架和继续阅读。
- 书架同时显示在线收藏、最近阅读和本地书籍；来源有清晰视觉区分。
- 本地导入使用系统文件选择器，展示解析进度、目录预览、警告和确认导入。
- 超长书名、空列表和 320px 宽屏不溢出。

**验证：**

```powershell
npx tsc --noEmit
npm run lint
```

## 任务 7：沉浸阅读器

**文件：**
- 新增：`frontend/features/reading/reader-screen.tsx`
- 新增：`frontend/features/reading/reader-toolbar.tsx`
- 新增：`frontend/features/reading/reader-drawer.tsx`
- 新增：`frontend/features/reading/reader-settings.tsx`
- 新增：`frontend/app/reading/books/[bookId]/chapters/[chapterId].tsx`
- 修改：`frontend/app/_layout.tsx`

**实现：**

- 默认正文为纸白背景、适中行宽、无干扰控制条；轻触正文显示或隐藏工具栏。
- 支持上一章、下一章、目录跳转、滚动/分页模式、字号、行距、页边距、字体和三套主题。
- 阅读位置节流保存；在线书同步服务端，本地书写设备存储。
- 目录显示当前章和完成度；书签支持创建、定位和删除。
- 章节预加载、网络错误重试、下架/授权过期提示完整。

**验证：**

```powershell
npm run test:reading
npx tsc --noEmit
npm run lint
```

## 任务 8：管理员上传与发布后台

**文件：**
- 新增：`frontend/features/reading/admin-reading-screen.tsx`
- 新增：`frontend/features/reading/admin-upload-panel.tsx`
- 新增：`frontend/features/reading/admin-book-editor.tsx`
- 新增：`frontend/app/admin/reading.tsx`
- 修改：`frontend/app/_layout.tsx`

**实现：**

- 管理端使用桌面工作台布局：左侧导航、顶部统计、内容表格、右侧详情/上传面板。
- 支持拖放/选择 TXT 或 EPUB、解析状态轮询、元数据编辑、章节预览和排序。
- 版权表单要求授权方、范围、起止日期和证明备注；未完成时发布按钮禁用并解释原因。
- 内容表支持全部、草稿、已发布、已隐藏、已下架筛选；发布、隐藏、下架有二次确认和结果反馈。
- provider 同步按钮展示最近运行状态和错误摘要，mock 模式可立即完成同步。

**验证：**

```powershell
npx tsc --noEmit
npm run lint
```

## 任务 9：端到端验证与视觉对照

**文件：**
- 必要时仅修改本功能文件。

**自动验证：**

```powershell
go test ./... -count=1
npm run test:reading
npx tsc --noEmit
npm run lint
npx expo export --platform web
```

**浏览器验证：**

1. 启动后端和 Expo Web，使用浏览器依次验证书城、搜索、详情、加入书架、阅读、设置、书签和继续阅读。
2. 使用管理员账号验证 TXT 上传、解析、版权填写、发布、书城出现、隐藏和下架。
3. 在 `390x844`、`430x932` 和 `1440x1000` 视口截图。
4. 使用 `view_image` 同时查看已确认设计图 `docs/free-reading-product-design-v1.png` 和最新实现截图。
5. 记录至少五项保真对照：信息架构、首屏层级、色彩与排版、卡片与控件、阅读器沉浸感、管理台密度。
6. 核对首屏文案差异，确认没有重叠、截断、不可读按钮或控制台错误。

## 任务 10：提交并推送到 main

**步骤：**

1. 运行任务 9 的全部命令并保存新鲜结果。
2. `git diff --check`，确认没有无关文件。
3. 按职责拆分中文 commit，例如：

```text
feat: 新增免费阅读后端与内容导入
feat: 新增书城书架与沉浸阅读器
feat: 新增阅读内容管理后台
test: 完善免费阅读端到端测试
```

4. `git fetch origin main`，确认 `origin/main` 是功能分支祖先；若远端前进，则在隔离工作树中变基后重新运行全量验证。
5. 执行非强制推送：`git push origin HEAD:main`。
6. 保留原 `main` 工作区的未提交改动，不在本地强行合并或清理。

## 完成定义

- mock provider、在线书城、书架、进度和书签 API 均有通过的自动测试。
- 管理员可以完成 TXT/EPUB 上传、解析、版权确认、发布、隐藏和下架闭环。
- 用户可以导入本地 TXT/EPUB，退出后继续阅读，文件不上传服务器。
- 书城、书架、详情、阅读器和管理后台在目标视口可用且与已确认设计稿保持一致。
- 所有新 commit 使用中文说明和约定式前缀。
- 功能分支通过完整验证，并已成功推送到远端 `main`。
