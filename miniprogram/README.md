# FunBox 微信小程序

这是从零搭建的 FunBox 原生微信小程序，代码全部位于 `miniprogram/`。

## 项目信息

- AppID：`wx1c056466c78d8934`
- 项目类型：原生微信小程序
- 后端：复用仓库根目录下的 `backend/` Go 服务
- 生产 API：`https://www.xwhub.cn/api/v1`

小程序不维护独立后端。账号、业务数据、文件上传等能力统一调用现有 FunBox 后端，接口和鉴权方式与 Web 前端保持一致。

## 使用微信开发者工具

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择当前 `miniprogram/` 文件夹。
3. 开发者工具会自动读取 `project.config.json` 中的 AppID。
4. 生产预览和发布前，在微信公众平台配置 `www.xwhub.cn` 的 request 合法域名。

## 本地联调

本地启动 Go 后端：

```bash
cd ../backend
go run ./cmd/api
```

然后把 `config/index.js` 中的 `API_BASE_URL` 临时改为：

```text
http://127.0.0.1:3000/api/v1
```

并在微信开发者工具中关闭域名校验。真机联调时应改为局域网可访问的 HTTPS 地址，不能使用电脑本机的 `127.0.0.1`。

## 目录说明

- `app.js` / `app.json` / `app.wxss`：小程序入口与全局配置
- `config/index.js`：统一后端地址和请求配置
- `utils/request.js`：统一请求封装，支持 Bearer Token
- `pages/`：小程序页面
- `project.config.json`：微信开发者工具项目配置
