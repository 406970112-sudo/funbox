# 问题反馈功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已登录用户提供文字与图片问题反馈，并让管理员在移动端和桌面端后台安全查看反馈及图片。

**Architecture:** Go 后端新增独立 `feedback` 领域模块，SQLite 保存反馈与图片元数据，私有持久化目录保存图片文件；HTTP 层复用现有登录与管理员中间件。Expo/React Native 前端新增提交页、后台首页和响应式反馈工作台，移动端使用卡片详情切换，桌面端使用列表与详情双栏。

**Tech Stack:** Go 1.24、`net/http`、`database/sql`、modernc SQLite、Expo Router 6、React 19、React Native 0.81、`expo-image-picker`、`expo-image`、Node Test Runner、Playwright。

## Global Constraints

- 只有已登录用户可以提交反馈；只有 `admin` 角色可以查询反馈或读取反馈图片。
- 描述去除首尾空白后必须为 10 至 1000 个 Unicode 字符。
- 图片可选，仅支持真实内容为 JPEG、PNG、WebP 的文件，最多 3 张，单张最大 5 MB。
- 图片保存在 `STORAGE_FEEDBACK_DIR`，默认 `data/feedback-images`，且不注册公开静态目录。
- 移动端断点为宽度小于 768 px，沿用现有 430 px 内容上限和卡片风格。
- 桌面端断点为宽度不小于 768 px，内容最大宽度 1440 px，列表和详情双栏铺开。
- 管理后台本期只读，不添加回复、删除、处理状态或通知。
- 保留工作区中已有的无关修改；提交时使用路径限定并使用中文 Conventional Commit。
- 不修改当前已有未提交改动的 `frontend/package.json`，新增前端测试直接运行 `node --test --experimental-strip-types tests/feedback-model.test.mjs`。

---

## 文件结构

### 后端

- `backend/internal/feedback/store.go`：SQLite 迁移、反馈元数据事务、分页查询和图片归属查询。
- `backend/internal/feedback/store_test.go`：迁移、创建、排序、分页与图片归属测试。
- `backend/internal/feedback/service.go`：描述规范化、图片内容识别、大小/数量限制、文件写入和失败清理。
- `backend/internal/feedback/service_test.go`：图片校验、多图顺序、落盘和回滚测试。
- `backend/internal/httpapi/feedback_handlers.go`：multipart 提交、管理员列表、受保护图片响应和 JSON 映射。
- `backend/internal/httpapi/feedback_handlers_test.go`：鉴权、状态码、错误码和图片访问测试。
- `backend/internal/httpapi/server.go`：注入反馈服务并注册三条反馈路由。
- `backend/internal/config/config.go`：反馈目录、单图大小和图片数量配置。
- `backend/cmd/api/main.go`：创建反馈 Store/Service 并注入 HTTP Server。
- `backend/.env.example`、`backend/README.md`：记录反馈存储配置和接口。
- `deploy/alicloud/ubuntu-22.04/deploy-project.sh`：创建并写入共享反馈图片目录。

### 前端

- `frontend/types/feedback.ts`：提交资源、反馈记录、图片和分页响应类型。
- `frontend/lib/feedback-model.ts`：纯函数校验、断点判断、分页去重与原生上传 part 映射。
- `frontend/lib/feedback-api.ts`：Web/Native multipart、提交、管理员分页和受保护图片 source。
- `frontend/tests/feedback-model.test.mjs`：纯函数行为测试。
- `frontend/features/feedback/feedback-submit-screen.tsx`：用户反馈表单、图片选择/预览/移除和成功状态。
- `frontend/features/feedback/admin-home-screen.tsx`：管理员后台首页。
- `frontend/features/feedback/admin-feedback-detail.tsx`：反馈详情、图片网格和全屏预览。
- `frontend/features/feedback/admin-feedback-screen.tsx`：分页状态、移动详情切换和桌面双栏布局。
- `frontend/app/profile/feedback.tsx`、`frontend/app/admin/index.tsx`、`frontend/app/admin/feedback.tsx`：Expo Router 挂载文件。
- `frontend/features/profile/profile-screen.tsx`：新增用户入口并把管理员入口改为后台首页。

---

### Task 1: SQLite 反馈存储

**Files:**
- Create: `backend/internal/feedback/store.go`
- Create: `backend/internal/feedback/store_test.go`

**Interfaces:**
- Produces: `OpenStore(databasePath string) (*Store, error)`、`(*Store).Close() error`。
- Produces: `Create(ctx context.Context, userID, description string, images []Image) (Submission, error)`。
- Produces: `List(ctx context.Context, limit, offset int) (Page, error)`。
- Produces: `GetImage(ctx context.Context, feedbackID, imageID string) (Image, error)`。

- [ ] **Step 1: 写迁移与持久化失败测试**

```go
func TestStoreCreateAndListFeedback(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	created, err := store.Create(context.Background(), userID, "上传图片后页面没有响应", []Image{
		{ID: "image-1", StoredName: "feedback-1-image-1.png", ContentType: "image/png", SizeBytes: 128, SortOrder: 0},
	})
	if err != nil { t.Fatal(err) }
	page, err := store.List(context.Background(), 30, 0)
	if err != nil { t.Fatal(err) }
	if page.Total != 1 || len(page.Items) != 1 { t.Fatalf("unexpected page: %#v", page) }
	if page.Items[0].ID != created.ID || page.Items[0].User.ID != userID { t.Fatalf("unexpected submission: %#v", page.Items[0]) }
	if len(page.Items[0].Images) != 1 || page.Items[0].Images[0].ID != "image-1" { t.Fatalf("unexpected images: %#v", page.Items[0].Images) }
}

func TestStoreListsNewestFirstAndPaginates(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	first, _ := store.Create(context.Background(), userID, "第一个达到十个字符的问题描述", nil)
	second, _ := store.Create(context.Background(), userID, "第二个达到十个字符的问题描述", nil)
	page, err := store.List(context.Background(), 1, 0)
	if err != nil { t.Fatal(err) }
	if page.Total != 2 || page.Items[0].ID != second.ID || page.Items[0].ID == first.ID { t.Fatalf("unexpected order: %#v", page) }
}

func TestStoreGetImageChecksFeedbackOwnership(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	created, _ := store.Create(context.Background(), userID, "图片归属关系必须经过校验", []Image{{ID: "image-1", StoredName: "a.png", ContentType: "image/png", SizeBytes: 1}})
	if _, err := store.GetImage(context.Background(), "other-feedback", "image-1"); !errors.Is(err, ErrNotFound) { t.Fatalf("expected not found, got %v", err) }
	if _, err := store.GetImage(context.Background(), created.ID, "image-1"); err != nil { t.Fatal(err) }
}

func openFeedbackTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil { t.Fatal(err) }
	account, err := userStore.Create(context.Background(), "13800138000", "hash", "测试用户", "问题", "answer-hash")
	if err != nil { t.Fatal(err) }
	if err := userStore.Close(); err != nil { t.Fatal(err) }
	store, err := OpenStore(databasePath)
	if err != nil { t.Fatal(err) }
	t.Cleanup(func() { _ = store.Close() })
	return store, account.ID
}
```

- [ ] **Step 2: 运行测试并确认因包不存在而失败**

Run: `cd backend && go test ./internal/feedback -run TestStore -v`

Expected: FAIL，`backend/internal/feedback` 尚无 Go 文件或接口未定义。

- [ ] **Step 3: 实现类型、幂等迁移和查询**

```go
var ErrNotFound = errors.New("feedback record not found")

type Image struct {
	ID, FeedbackID, StoredName, ContentType string
	SizeBytes int64
	SortOrder int
}

type UserSummary struct { ID, Username, DisplayName, AvatarFile string }

type Submission struct {
	ID, Description string
	User UserSummary
	Images []Image
	CreatedAt time.Time
}

type Page struct { Items []Submission; Total, Limit, Offset int }
```

实现 `feedback_submissions`、`feedback_images` 和两个索引；`Create` 使用单个事务写入反馈与图片，`List` 使用稳定的 `created_at DESC, id DESC` 顺序并批量装配图片，`GetImage` 同时匹配 `feedback_id` 和 `id`。

- [ ] **Step 4: 运行存储测试**

Run: `cd backend && go test ./internal/feedback -run TestStore -v`

Expected: PASS。

- [ ] **Step 5: 提交存储层**

```powershell
git add -- backend/internal/feedback/store.go backend/internal/feedback/store_test.go
git commit --only -m "feat: 新增问题反馈数据存储" -- backend/internal/feedback/store.go backend/internal/feedback/store_test.go
```

### Task 2: 图片校验与原子清理服务

**Files:**
- Create: `backend/internal/feedback/service.go`
- Create: `backend/internal/feedback/service_test.go`

**Interfaces:**
- Consumes: Task 1 的 `Store.Create`、`Store.List`、`Store.GetImage`。
- Produces: `NewService(store *Store, storageDir string, maxImageBytes int64, maxImages int) *Service`。
- Produces: `Create(ctx context.Context, userID, description string, uploads []Upload) (Submission, error)`。
- Produces: `List`、`GetImage` 代理和 `ImagePath(image Image) string`。

- [ ] **Step 1: 写描述与图片失败清理测试**

```go
func TestServiceRejectsInvalidDescriptionAndImages(t *testing.T) {
	service, userID, _ := openFeedbackTestService(t, 8, 3)
	if _, err := service.Create(context.Background(), "user-1", " 太短 ", nil); !errors.Is(err, ErrDescriptionInvalid) { t.Fatalf("got %v", err) }
	bad := Upload{Reader: strings.NewReader("not-an-image")}
	if _, err := service.Create(context.Background(), userID, "这是一个长度合法的问题描述", []Upload{bad}); !errors.Is(err, ErrImageTypeInvalid) { t.Fatalf("got %v", err) }
	tooLarge := Upload{Reader: bytes.NewReader(append(pngHeader, bytes.Repeat([]byte{1}, 9)...))}
	if _, err := service.Create(context.Background(), userID, "这是一个长度合法的问题描述", []Upload{tooLarge}); !errors.Is(err, ErrImageTooLarge) { t.Fatalf("got %v", err) }
}

func TestServicePersistsMultipleImagesInSelectionOrder(t *testing.T) {
	service, userID, storageDir := openFeedbackTestService(t, 5<<20, 3)
	created, err := service.Create(context.Background(), userID, "图片顺序应该和用户选择顺序一致", []Upload{
		{Reader: bytes.NewReader(validPNG)},
		{Reader: bytes.NewReader(validJPEG)},
	})
	if err != nil { t.Fatal(err) }
	if len(created.Images) != 2 || created.Images[0].SortOrder != 0 || created.Images[1].SortOrder != 1 { t.Fatalf("unexpected images: %#v", created.Images) }
	for _, image := range created.Images {
		if _, err := os.Stat(filepath.Join(storageDir, image.StoredName)); err != nil { t.Fatal(err) }
	}
}

func openFeedbackTestService(t *testing.T, maxBytes int64, maxImages int) (*Service, string, string) {
	t.Helper()
	store, userID := openFeedbackTestStore(t)
	storageDir := filepath.Join(t.TempDir(), "feedback-images")
	return NewService(store, storageDir, maxBytes, maxImages), userID, storageDir
}

func encodeTestImage(t *testing.T, format string) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	imageValue := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var err error
	if format == "png" { err = png.Encode(buffer, imageValue) } else { err = jpeg.Encode(buffer, imageValue, nil) }
	if err != nil { t.Fatal(err) }
	return buffer.Bytes()
}
```

在测试文件中用 `validPNG := encodeTestImage(t, "png")`、`validJPEG := encodeTestImage(t, "jpeg")`，并以 `validPNG[:8]` 作为 `pngHeader`，避免依赖仓库外部夹具。

- [ ] **Step 2: 运行测试确认服务尚未实现**

Run: `cd backend && go test ./internal/feedback -run TestService -v`

Expected: FAIL，`NewService`、`Upload` 或校验错误未定义。

- [ ] **Step 3: 实现服务与失败清理**

```go
const MinDescriptionRunes = 10
const MaxDescriptionRunes = 1000

type Upload struct { Reader io.Reader }

func NormalizeDescription(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < MinDescriptionRunes || length > MaxDescriptionRunes { return "", ErrDescriptionInvalid }
	return normalized, nil
}
```

对每个上传使用 `io.LimitReader(reader, maxImageBytes+1)`，读取后用 `http.DetectContentType` 校验 `image/jpeg`、`image/png`、`image/webp`。先用服务端 UUID 文件名写入最终目录；任一写入或数据库事务失败时删除本批已写文件。成功后由 Store 返回完整 Submission。

- [ ] **Step 4: 运行反馈模块测试**

Run: `cd backend && go test ./internal/feedback -v`

Expected: PASS。

- [ ] **Step 5: 提交服务层**

```powershell
git add -- backend/internal/feedback/service.go backend/internal/feedback/service_test.go
git commit --only -m "feat: 增加反馈图片校验与存储" -- backend/internal/feedback/service.go backend/internal/feedback/service_test.go
```

### Task 3: 反馈 HTTP API、鉴权与配置

**Files:**
- Create: `backend/internal/httpapi/feedback_handlers.go`
- Create: `backend/internal/httpapi/feedback_handlers_test.go`
- Modify: `backend/internal/httpapi/server.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/cmd/api/main.go`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: Task 2 的 `*feedback.Service`。
- Produces: `POST /api/v1/feedback`、`GET /api/v1/admin/feedback`、`GET /api/v1/admin/feedback/{feedbackID}/images/{imageID}`。
- Changes: `httpapi.NewServer(..., feedbackService *feedback.Service)`。

- [ ] **Step 1: 写路由鉴权、上传和图片读取测试**

```go
func TestFeedbackRoutesRequireAuthenticationAndAdmin(t *testing.T) {
	server, normalToken, _ := newFeedbackHTTPTestServer(t)
	if status := performFeedbackRequest(t, server, "POST", "/api/v1/feedback", nil, "", "").StatusCode; status != http.StatusUnauthorized { t.Fatalf("got %d", status) }
	if status := performFeedbackRequest(t, server, "GET", "/api/v1/admin/feedback", nil, normalToken, "").StatusCode; status != http.StatusForbidden { t.Fatalf("got %d", status) }
}

func TestFeedbackSubmissionAndAdminImageRead(t *testing.T) {
	server, normalToken, adminToken := newFeedbackHTTPTestServer(t)
	body, contentType := feedbackMultipart(t, "提交时页面一直显示加载中", [][]byte{feedbackPNGBytes(t)})
	created := performFeedbackRequest(t, server, "POST", "/api/v1/feedback", body, normalToken, contentType)
	created.Body.Close()
	if created.StatusCode != http.StatusCreated { t.Fatalf("status=%d", created.StatusCode) }
	page := performFeedbackRequest(t, server, "GET", "/api/v1/admin/feedback?limit=30&offset=0", nil, adminToken, "")
	pageBody, _ := io.ReadAll(page.Body)
	page.Body.Close()
	if page.StatusCode != http.StatusOK || !bytes.Contains(pageBody, []byte("提交时页面一直显示加载中")) { t.Fatalf("body=%s", pageBody) }
	imagePath := decodeFirstFeedbackImagePath(t, pageBody)
	imageResponse := performFeedbackRequest(t, server, "GET", imagePath, nil, adminToken, "")
	imageResponse.Body.Close()
	if imageResponse.StatusCode != http.StatusOK || imageResponse.Header.Get("Content-Type") != "image/png" { t.Fatalf("headers=%v", imageResponse.Header) }
}

func performFeedbackRequest(t *testing.T, server *httptest.Server, method, path string, body io.Reader, token, contentType string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, server.URL+path, body)
	if err != nil { t.Fatal(err) }
	if token != "" { request.Header.Set("Authorization", "Bearer "+token) }
	if contentType != "" { request.Header.Set("Content-Type", contentType) }
	response, err := server.Client().Do(request)
	if err != nil { t.Fatal(err) }
	return response
}

func feedbackMultipart(t *testing.T, description string, images [][]byte) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("description", description); err != nil { t.Fatal(err) }
	for index, imageBytes := range images {
		part, err := writer.CreateFormFile("images", fmt.Sprintf("image-%d.png", index))
		if err != nil { t.Fatal(err) }
		if _, err := part.Write(imageBytes); err != nil { t.Fatal(err) }
	}
	if err := writer.Close(); err != nil { t.Fatal(err) }
	return body, writer.FormDataContentType()
}

func feedbackPNGBytes(t *testing.T) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	if err := png.Encode(buffer, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil { t.Fatal(err) }
	return buffer.Bytes()
}

func decodeFirstFeedbackImagePath(t *testing.T, body []byte) string {
	t.Helper()
	var page struct { Items []struct { Images []struct { Path string `json:"path"` } `json:"images"` } `json:"items"` }
	if err := json.Unmarshal(body, &page); err != nil { t.Fatal(err) }
	if len(page.Items) == 0 || len(page.Items[0].Images) == 0 { t.Fatal("feedback image missing") }
	return page.Items[0].Images[0].Path
}
```

`newFeedbackHTTPTestServer` 使用一个临时数据库依次打开 `user.Store`、`social.Store`、`access.Store`、`feedback.Store`，创建 `auth.Service` 和 `feedback.Service` 后调用新版 `NewServer`。通过现有 `requestJSON` 注册手机号 `13800138000` 和 `13900139000`，再调用 `userStore.UpdateRoleByUsername(ctx, "13900139000", roles.Admin)`，返回两个会话的 token。`decodeFirstFeedbackImagePath` 解码列表 JSON 的 `items[0].images[0].path`，没有数据时立即 `t.Fatal`。

- [ ] **Step 2: 运行 HTTP 测试确认路由不存在**

Run: `cd backend && go test ./internal/httpapi -run Feedback -v`

Expected: FAIL，路由返回 404 或 `NewServer` 尚无反馈服务参数。

- [ ] **Step 3: 增加配置与服务注入**

```go
type StorageConfig struct {
	AudioDir, AvatarDir, FeedbackDir string
	MaxAvatarBytes, MaxFeedbackImageBytes int64
	MaxFeedbackImages int
}
```

默认读取 `STORAGE_FEEDBACK_DIR=data/feedback-images`、`STORAGE_MAX_FEEDBACK_IMAGE_BYTES=5242880`、`STORAGE_MAX_FEEDBACK_IMAGES=3`。`main.go` 打开 Store、创建 Service、延迟关闭 Store，并传给 `NewServer`。

- [ ] **Step 4: 实现三个处理器与稳定 JSON**

```go
mux.HandleFunc("POST /api/v1/feedback", api.withAuth(api.withFeedbackUploadPipeline(api.handleCreateFeedback)))
mux.HandleFunc("GET /api/v1/admin/feedback", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleListFeedback))))
mux.HandleFunc("GET /api/v1/admin/feedback/{feedbackID}/images/{imageID}", api.withAuth(api.withAdmin(api.handleFeedbackImage)))
```

`handleCreateFeedback` 用 `http.MaxBytesReader` 限制总请求，解析 `description` 和重复的 `images`；错误映射为 `description_invalid`、`feedback_images_too_many`、`feedback_image_too_large`、`feedback_image_type_invalid`。列表返回 `{ items, total, limit, offset }`，图片元数据包含受保护 API 路径；图片响应设置 `Cache-Control: private, max-age=300`。

- [ ] **Step 5: 运行 HTTP 与后端全量测试**

Run: `cd backend && go test ./internal/httpapi -run Feedback -v`

Expected: PASS。

Run: `cd backend && go test ./...`

Expected: PASS。

- [ ] **Step 6: 提交 API 与配置**

```powershell
git add -- backend/internal/httpapi/feedback_handlers.go backend/internal/httpapi/feedback_handlers_test.go backend/internal/httpapi/server.go backend/internal/config/config.go backend/cmd/api/main.go backend/.env.example
git commit --only -m "feat: 提供问题反馈与管理员查询接口" -- backend/internal/httpapi/feedback_handlers.go backend/internal/httpapi/feedback_handlers_test.go backend/internal/httpapi/server.go backend/internal/config/config.go backend/cmd/api/main.go backend/.env.example
```

### Task 4: 前端领域模型与 API 客户端

**Files:**
- Create: `frontend/types/feedback.ts`
- Create: `frontend/lib/feedback-model.ts`
- Create: `frontend/lib/feedback-api.ts`
- Create: `frontend/tests/feedback-model.test.mjs`

**Interfaces:**
- Produces: `validateFeedback(description, assets) => FeedbackValidationResult`。
- Produces: `feedbackLayoutForWidth(width) => 'mobile' | 'desktop'`。
- Produces: `mergeFeedbackPages(current, incoming) => FeedbackSubmission[]`。
- Produces: `submitFeedback`、`listAdminFeedback`、`feedbackImageSource`。

- [ ] **Step 1: 写纯函数失败测试**

```js
test('validates normalized description and image constraints', () => {
  assert.equal(validateFeedback(' 1234567890 ', []).description, '1234567890');
  assert.equal(validateFeedback('太短', []).error, 'description_invalid');
  assert.equal(validateFeedback('有效的问题描述文字', Array.from({ length: 4 }, makeAsset)).error, 'feedback_images_too_many');
  assert.equal(validateFeedback('有效的问题描述文字', [makeAsset({ fileSize: 5 * 1024 * 1024 + 1 })]).error, 'feedback_image_too_large');
});

test('selects responsive layout at 768px', () => {
  assert.equal(feedbackLayoutForWidth(767), 'mobile');
  assert.equal(feedbackLayoutForWidth(768), 'desktop');
});

test('merges paged feedback without duplicate ids', () => {
  assert.deepEqual(mergeFeedbackPages([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]).map(item => item.id), ['a', 'b']);
});
```

- [ ] **Step 2: 运行测试确认模块缺失**

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Expected: FAIL，`feedback-model.ts` 不存在。

- [ ] **Step 3: 实现类型与纯函数**

```ts
export const FEEDBACK_MIN_DESCRIPTION = 10;
export const FEEDBACK_MAX_DESCRIPTION = 1000;
export const FEEDBACK_MAX_IMAGES = 3;
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function feedbackLayoutForWidth(width: number) {
  return width < 768 ? 'mobile' as const : 'desktop' as const;
}
```

`FeedbackAsset` 包含 `uri`、`fileName`、`mimeType`、`fileSize`；`FeedbackSubmission` 包含用户、描述、时间和 `FeedbackImage[]`；校验类型只接受 `image/jpeg`、`image/png`、`image/webp`。

- [ ] **Step 4: 实现跨平台 API**

```ts
export async function submitFeedback(token: string, description: string, assets: FeedbackAsset[]) {
  const formData = new FormData();
  formData.append('description', description);
  for (const asset of assets) await appendFeedbackAsset(formData, asset);
  return requestFeedbackJSON<FeedbackCreated>('/api/v1/feedback', token, { body: formData, method: 'POST' });
}

export function listAdminFeedback(token: string, limit = 30, offset = 0) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestFeedbackJSON<FeedbackPage>(`/api/v1/admin/feedback?${query}`, token);
}

export function feedbackImageSource(token: string, imagePath: string) {
  return { headers: { Authorization: `Bearer ${token}` }, uri: `${getAPIBaseUrl()}${imagePath}` };
}

async function requestFeedbackJSON<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new FeedbackAPIError(payload.error || 'request_failed', response.status);
  return payload;
}

async function appendFeedbackAsset(formData: FormData, asset: FeedbackAsset) {
  const fileName = asset.fileName || 'feedback-image.jpg';
  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    formData.append('images', await response.blob(), fileName);
    return;
  }
  formData.append('images', {
    name: fileName,
    type: asset.mimeType || 'image/jpeg',
    uri: asset.uri,
  } as never);
}
```

Web 将资源 URI `fetch` 为 Blob 后追加到 `FormData`；Native 追加 `{ uri, name, type } as never`。统一错误类 `FeedbackAPIError` 和中文 `getFeedbackErrorMessage`。

- [ ] **Step 5: 运行前端模型测试与 TypeScript 检查**

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Expected: PASS。

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交前端模型**

```powershell
git add -- frontend/types/feedback.ts frontend/lib/feedback-model.ts frontend/lib/feedback-api.ts frontend/tests/feedback-model.test.mjs
git commit --only -m "feat: 增加反馈前端模型与接口" -- frontend/types/feedback.ts frontend/lib/feedback-model.ts frontend/lib/feedback-api.ts frontend/tests/feedback-model.test.mjs
```

### Task 5: 用户反馈提交页

**Files:**
- Create: `frontend/features/feedback/feedback-submit-screen.tsx`
- Create: `frontend/app/profile/feedback.tsx`
- Modify: `frontend/features/profile/profile-screen.tsx`

**Interfaces:**
- Consumes: Task 4 的 `validateFeedback`、`submitFeedback`、`FeedbackAsset` 和错误映射。
- Produces: `/profile/feedback` 页面和“我的 > 账户 > 问题反馈”入口。

- [ ] **Step 1: 在入口测试中表达已登录可见规则**

在 `feedback-model.test.mjs` 增加纯函数 `shouldShowFeedbackEntry(authStatus)` 测试：

```js
test('shows feedback entry only for authenticated users', () => {
  assert.equal(shouldShowFeedbackEntry('authenticated'), true);
  assert.equal(shouldShowFeedbackEntry('anonymous'), false);
  assert.equal(shouldShowFeedbackEntry('loading'), false);
});
```

- [ ] **Step 2: 运行测试确认入口规则未实现**

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Expected: FAIL，`shouldShowFeedbackEntry` 未导出。

- [ ] **Step 3: 实现入口规则和路由**

```tsx
export default function FeedbackRoute() {
  return <FeedbackSubmitScreen />;
}
```

在 `ProfileScreen` 的“修改密码”和管理员入口之间增加 `message-alert-outline` 图标的 `AccountAction`，点击进入 `/profile/feedback`；仅认证用户渲染整个账户区，因此匿名用户不出现入口。

- [ ] **Step 4: 实现反馈表单完整状态**

页面使用 `Redirect` 保护匿名访问；图片选择器设置：

```ts
await ImagePicker.launchImageLibraryAsync({
  allowsMultipleSelection: true,
  mediaTypes: ['images'],
  quality: 0.9,
  selectionLimit: FEEDBACK_MAX_IMAGES - assets.length,
});
```

表单包含字符计数、多行输入、3 个稳定尺寸预览槽、每张图片的关闭图标按钮、内联错误、禁用/加载提交按钮和成功结果。选图后先做客户端 MIME、大小、数量校验；提交使用当前 `accessToken`。

- [ ] **Step 5: 运行模型测试、lint 与 TypeScript**

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Expected: PASS。

Run: `cd frontend && npm run lint`

Expected: PASS。

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交用户页面**

```powershell
git add -- frontend/features/feedback/feedback-submit-screen.tsx frontend/app/profile/feedback.tsx frontend/features/profile/profile-screen.tsx frontend/lib/feedback-model.ts frontend/tests/feedback-model.test.mjs
git commit --only -m "feat: 新增用户问题反馈入口与表单" -- frontend/features/feedback/feedback-submit-screen.tsx frontend/app/profile/feedback.tsx frontend/features/profile/profile-screen.tsx frontend/lib/feedback-model.ts frontend/tests/feedback-model.test.mjs
```

### Task 6: 响应式管理后台

**Files:**
- Create: `frontend/features/feedback/admin-home-screen.tsx`
- Create: `frontend/features/feedback/admin-feedback-detail.tsx`
- Create: `frontend/features/feedback/admin-feedback-screen.tsx`
- Create: `frontend/app/admin/index.tsx`
- Create: `frontend/app/admin/feedback.tsx`
- Modify: `frontend/features/profile/profile-screen.tsx`

**Interfaces:**
- Consumes: Task 4 的分页、图片 source、布局与分页合并函数。
- Produces: `/admin` 后台首页和 `/admin/feedback` 响应式工作台。

- [ ] **Step 1: 增加移动详情状态纯函数测试**

```js
test('keeps a valid selection and falls back to the first feedback item', () => {
  assert.equal(resolveFeedbackSelection([{ id: 'a' }, { id: 'b' }], 'b'), 'b');
  assert.equal(resolveFeedbackSelection([{ id: 'a' }], 'missing'), 'a');
  assert.equal(resolveFeedbackSelection([], 'a'), null);
});
```

- [ ] **Step 2: 运行测试确认选择规则未实现**

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Expected: FAIL，`resolveFeedbackSelection` 未导出。

- [ ] **Step 3: 实现后台首页与路由迁移**

```tsx
export default function AdminIndexRoute() { return <AdminHomeScreen />; }
export default function AdminFeedbackRoute() { return <AdminFeedbackScreen />; }
```

后台首页验证 `user.role === 'admin'`，显示深色概览区和两个入口卡片：“入口权限”进入 `/admin/permissions`，“问题反馈”进入 `/admin/feedback`。个人中心管理员操作改为进入 `/admin`。

- [ ] **Step 4: 实现反馈列表、详情和响应式排列**

`AdminFeedbackScreen` 使用 `useWindowDimensions` 和 `feedbackLayoutForWidth`。桌面根容器最大宽度 1440 px，`flexDirection: 'row'`，列表列固定 380 px，详情列 `flex: 1`；移动端复用 `MobileScreen`，未选择时显示单列卡片，选择后显示详情与返回列表按钮。

`AdminFeedbackDetail` 显示用户头像占位、昵称、账号、格式化时间、完整描述和图片网格。`expo-image` 的 `source` 使用 `feedbackImageSource` 传入鉴权头；点击图片打开 `Modal` 全屏预览，并提供 `close` 图标按钮和系统返回关闭行为。

- [ ] **Step 5: 验证前端静态检查**

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Expected: PASS。

Run: `cd frontend && npm run lint`

Expected: PASS。

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交管理后台**

```powershell
git add -- frontend/features/feedback/admin-home-screen.tsx frontend/features/feedback/admin-feedback-detail.tsx frontend/features/feedback/admin-feedback-screen.tsx frontend/app/admin/index.tsx frontend/app/admin/feedback.tsx frontend/features/profile/profile-screen.tsx frontend/lib/feedback-model.ts frontend/tests/feedback-model.test.mjs
git commit --only -m "feat: 新增响应式问题反馈管理后台" -- frontend/features/feedback/admin-home-screen.tsx frontend/features/feedback/admin-feedback-detail.tsx frontend/features/feedback/admin-feedback-screen.tsx frontend/app/admin/index.tsx frontend/app/admin/feedback.tsx frontend/features/profile/profile-screen.tsx frontend/lib/feedback-model.ts frontend/tests/feedback-model.test.mjs
```

### Task 7: 部署持久化、运行验收与推送

**Files:**
- Modify: `deploy/alicloud/ubuntu-22.04/deploy-project.sh`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: Tasks 1-6 的完整功能。
- Produces: 生产反馈图片持久化配置、桌面/移动端验收证据和推送到 `origin/main` 的提交链。

- [ ] **Step 1: 更新部署脚本与文档**

在脚本中增加：

```bash
STORAGE_FEEDBACK_DIR="${STORAGE_FEEDBACK_DIR:-data/feedback-images}"
STORAGE_MAX_FEEDBACK_IMAGE_BYTES="${STORAGE_MAX_FEEDBACK_IMAGE_BYTES:-5242880}"
STORAGE_MAX_FEEDBACK_IMAGES="${STORAGE_MAX_FEEDBACK_IMAGES:-3}"
STORAGE_FEEDBACK_DIR="$(resolve_persistent_path "$STORAGE_FEEDBACK_DIR" "data/feedback-images")"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$STORAGE_FEEDBACK_DIR"
```

把目录加入路径边界检查和生成的 `.env`。README 增加三条反馈接口、三项配置和私有图片说明。

- [ ] **Step 2: 运行完整自动化验证**

Run: `cd backend && gofmt -w internal/feedback/*.go internal/httpapi/feedback_handlers*.go internal/config/config.go cmd/api/main.go`

Run: `cd backend && go test ./...`

Run: `cd frontend && node --test --experimental-strip-types tests/feedback-model.test.mjs`

Run: `cd frontend && npm run lint`

Run: `cd frontend && npx tsc --noEmit`

Expected: 全部退出码为 0。

- [ ] **Step 3: 启动本地后端与前端**

Run: `cd backend && go run ./cmd/api`

Run: `cd frontend && npx expo start --web --port 8081`

Expected: 后端监听 3000，前端在 `http://localhost:8081` 可访问。

- [ ] **Step 4: 用 Playwright 验收用户提交与管理员查看**

在 390x844 视口用普通账号登录，从“我的”进入问题反馈，提交描述和 2 张测试图片；确认成功状态。再用管理员账号登录，在 1440x1000 视口进入后台，确认列表/详情双栏、用户、时间、描述和 2 张图片；切换到 390x844，确认卡片列表、详情返回和图片预览无重叠。检查浏览器控制台与反馈相关网络请求均无错误。

- [ ] **Step 5: 提交部署与文档**

```powershell
git add -- deploy/alicloud/ubuntu-22.04/deploy-project.sh backend/README.md
git commit --only -m "feat: 完善反馈图片持久化部署" -- deploy/alicloud/ubuntu-22.04/deploy-project.sh backend/README.md
```

- [ ] **Step 6: 完成提交范围审计**

Run: `git log --oneline 2a814cc..HEAD`

Expected: 仅包含本计划列出的中文 Conventional Commit。

Run: `git diff --name-only 2a814cc..HEAD`

Expected: 仅包含本计划列出的反馈功能文件；工作区原有无关改动仍保留且未进入这些提交。

- [ ] **Step 7: 推送 main**

Run: `git push origin main`

Expected: `main -> main`，远端包含设计、实施计划及全部功能提交。
