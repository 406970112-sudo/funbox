# FunBox 微信小程序

这是 FunBox 原生微信小程序，代码位于 `miniprogram/`。当前已接入麻将打牌记分场景。

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

## 当前业务页面

- `pages/index/index`：首页牌局场景入口，麻将可用，斗地主和炸金花显示“敬请期待”
- `pages/auth/index`：手机号注册、登录
- `pages/score/mahjong/index`：麻将房间创建、房间码加入、扫码加入和附近房间
- `pages/score/room/index`：房间等待、批量给分、实时分数、二次确认结算和结算结果

房间密码为 4～6 位数字，服务端只保存哈希。通过房间码或附近房间加入时仍需输入密码；通过房主分享的邀请链接或小程序内扫码进入时，只需填写昵称即可加入。创建麻将房间时默认每分 1 元、默认封顶提示 10 分；封顶只用于提醒，杠牌等情况可以超过。结算使用创建时设置的每分金额，不能在结算时改价。

## 微信平台配置

- 在微信公众平台配置 `https://www.xwhub.cn` 为 request 合法域名，并将 `wss://www.xwhub.cn` 配置为 socket 合法域名。
- 首次发布前在隐私保护指引中声明定位用途：搜索附近等待加入的麻将房间。
- 邀请分享使用小程序页面路径，二维码在小程序内通过“扫一扫”识别。如后续要求微信外部扫一扫直接拉起小程序，需要另行接入微信小程序码接口。
