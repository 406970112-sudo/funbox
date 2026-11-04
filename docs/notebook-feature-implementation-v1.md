# FunBox 笔记本：实施说明 V1

## 1. 落地范围

- 首页「发现更多」改为左右两列等宽入口：笔记本 / 表情包。
- 笔记本入口需要登录；游客从首页点击后进入登录页，成功登录后返回笔记本首页。
- 小程序新增 `packages/notebook` 分包，包含：
  - 笔记本首页：筛选、最近笔记、置顶笔记、新建入口。
  - 编辑页：标题、正文、清单、标签、图片、语音、自动保存。
  - 详情页：阅读、收藏、置顶、分享、编辑和删除入口。
  - 搜索页：全文搜索、搜索范围、只看收藏、笔记本与标签筛选。
  - 笔记本管理：新建、重命名、删除空笔记本。

## 2. UI 验收基线

- 首页两张入口卡片必须同排、同高，高度固定为 `230rpx`。
- 笔记本插画必须完整显示在卡片内容区内，不裁切、不覆盖文字、不出现记分 `+ / −` 元素。
- 编辑页固定工具栏不遮挡可滚动内容，页面底部预留安全区。
- 图片、语音、标签、清单按钮必须有真实交互，不使用静态占位。
- 所有列表都有加载、失败重试、空状态；所有写操作有失败提示。
- 登录失效会清理本地会话，并回到登录流程。

## 3. 后端接口

所有接口均要求 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/notebook/books` | 笔记本列表，首次访问自动创建“工作 / 生活 / 灵感” |
| POST | `/api/v1/notebook/books` | 新建笔记本 |
| PATCH | `/api/v1/notebook/books/{bookID}` | 重命名或改色 |
| DELETE | `/api/v1/notebook/books/{bookID}` | 删除空笔记本 |
| GET | `/api/v1/notebook/notes` | 笔记列表，支持 `bookId/q/tag/favorite/limit/offset` |
| POST | `/api/v1/notebook/notes` | 新建笔记 |
| GET | `/api/v1/notebook/notes/{noteID}` | 笔记详情（含媒体） |
| PATCH | `/api/v1/notebook/notes/{noteID}` | 更新内容、笔记本、置顶或收藏 |
| DELETE | `/api/v1/notebook/notes/{noteID}` | 删除笔记 |
| POST | `/api/v1/notebook/notes/{noteID}/media` | 上传图片或语音，字段为 `kind` + `file` |
| GET | `/api/v1/notebook/media/{mediaID}` | 读取私有媒体 |
| DELETE | `/api/v1/notebook/media/{mediaID}` | 删除附件 |

## 4. 数据与存储

- 新表：`notebook_books`、`notebook_notes`、`notebook_media`。
- 清单和标签以 JSON 存储，读取时统一归一化。
- 默认笔记本使用事务初始化，避免首页并行请求造成重复创建。
- 媒体文件保存在数据库同级的 `notebook-media/` 目录，私有读取必须带登录态。
- 单条笔记限制：标题 80 字、正文 20000 字、清单 50 项、标签 8 个、图片 4 张、语音 1 条。

## 5. 测试与验收命令

```bash
cd backend
go test ./...

cd ..
node --test miniprogram/tests/*.test.js
```

微信开发者工具实际验收覆盖：

1. 首页两列入口等高，插画完整。
2. 游客登录后返回笔记本。
3. 新建笔记、自动保存、返回首页可见。
4. 清单勾选、标签添加/删除、图片选择上传、语音播放。
5. 详情收藏后，在搜索页开启“只看收藏”仍可找到。
6. 笔记本新建、重命名和空本删除。
