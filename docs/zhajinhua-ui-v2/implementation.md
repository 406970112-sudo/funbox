# 炸金花实施与验收记录

实施日期：2026-10-30。分支：`codex/zhajinhua-miniprogram`。保留旧麻将、通用记分和旧炸金花房间语义；新小程序房间显式使用 V2 规则。生产 API 配置未修改，未上传或部署。

## 入口与主要文件

- 创建／加入：`miniprogram/pages/score/poker/`。
- 本场、喜钱、账本、场间管理：`miniprogram/pages/score/poker-room/`。
- 服务端规则与持久化：`backend/internal/score/zjh_v2.go`。
- 接口与端到端用例：`backend/internal/httpapi/score_handlers.go`、`zjh_v2_test.go`。
- 小程序状态推导：`miniprogram/utils/poker-state.js`；共享邀请、账号与实时同步：`score-room-base.js`。

首页仅删除记分规则和牌局服务提示，并开放炸金花。积分池以精确金额、积分为主，不使用扑克牌占据数字区域。2～12 人按人数排座，小屏 12 人使用 3 列，常规宽度使用 4 列；保持座位顺序。当前行动者与下一位在吸顶提示中展示，座位同步高亮。

金额变化使用整数人民币分判断档位：200 元以下、200～499.99 元、500 元及以上。仅在服务端确认正增量后进行一次 600ms 数值强调和增量提示；减少动态／关闭金额动效时直接显示最终值。震动可关闭，无自动弃牌、自动超时或持续闪烁。

## 规则与数据

每场冻结名单及规则；底注由全部入场玩家投入。看牌不收费、不换人；跟注、加注按本人闷／看倍率支付。封顶触发动作不计入后续三整圈，比牌待结果不提前消耗回合；圈内跳过弃牌及出局玩家。比牌同大小主动方输，并从主动方之后的下一位在局玩家继续。

实体牌由玩家现场核对，小程序不识别牌。强制开牌由房主记录最终赢家；豹子、顺金喜钱由房主核对后显式确认。每个喜钱获得者从本场冻结名单的其他所有人收取，包括弃牌和比牌出局者。喜钱不进入积分池，不取决于本场输赢；服务端一次性生成零和账本。空数组明确表示无喜钱；遗漏或 null 不会结束本场。

场末以继续下一场为主要操作。撤销记录保留场号及动作，但不入账；房间成员身份、离场前累计、冻结名单和旧规则不会被新入座者改写。转让房主需接任者接受，旧房主令牌使用最新数据库角色鉴权。散场使用建房时固定金额，包括已离场玩家。

新增 SQLite 表保存 V2 设置、座位状态和手牌快照，复用既有事务、命令回执、事件通知和记分账本。兼容旧表的 8 人 CHECK 约束，通过 V2 设置提供有效的 12 人人数上限；不修改旧表约束。新玩家在已开局房间中等待房主场间接纳。

## 接口增量

- 创建：`POST /api/v1/score-rooms`，增加 `zhaJinHuaSettings`（`rulesVersion:2`、`antePoints`、`maxBetPoints`、`compareThreshold`、`baoziBonusPoints`、`shunjinBonusPoints`）。
- 行动：既有 `.../zha-jin-hua/hands/{handId}/actions`，支持 `follow/look/raise/fold/compare_pay/compare_result/showdown`；结果使用 `outcome:win|lose|tie`。
- 喜钱：`POST .../zha-jin-hua/hands/{handId}/bonus`，`bonuses:[{participantId,kind:baozi|shunjin}]`。
- 座位：`POST .../participants/{participantId}/seat`，`action:admit|leave|rejoin|offer_host|accept_host`。
- 下场规则：`PATCH .../zha-jin-hua/settings`，嵌套 `settings`。
- 所有变更携带 `clientActionId` 和 `expectedRoomVersion`；重复命令不重复扣分，版本冲突返回最新快照。

## 已完成验证

- 小程序：`node --test miniprogram/tests/*.test.js`，137/137 通过；44 个非第三方 JavaScript 文件语法检查通过。
- 微信原生编译器：10 个 WXML、11 个 WXSS 编译通过。
- 后端：`go test ./internal/score ./internal/httpapi ./internal/wechatminiprogram ./internal/config -count=1` 通过；新增 13 个 V2 服务测试及 2 个 HTTP 多人流程验收测试。
- 可执行程序：`go build -o /tmp/funbox-poker-api ./cmd/api` 通过。
- HTTP 验收覆盖跟注／看牌／比牌平局、重复付款重放、喜钱零和、离场／新入座／房主转让、继续下一场、撤销、固定金额散场，以及封顶后三整圈强制开牌和显式无喜钱。
- 微信开发者工具 Stable 2.02.2608060、基础库 3.17.5、iPhone 12/13 模拟器实测。使用独立临时项目与本地 SQLite 测试后端，验证首页入口、创建页、12 人座位与分享按钮、精确池金额、看牌不收费、跟注换人及比牌付费／选人／同大小确认。示例：¥600.00／1200 分，看牌后不变；跟注后 ¥700.00／1400 分并切换行动者；比牌仅追加一次应跟分。

## 验证范围与既有问题

本地未配置微信 AppSecret，因此未向微信服务申请真实邀请码；已验证接口测试、请求流程、错误提示、二维码回退及转发按钮展示。未真实转发给联系人，未执行真机扫码或触觉体验。

仓库完整 `go test ./...` 仍有以下既有问题；在未修改的 HEAD 独立副本中运行相同包，复现同样失败：

1. `internal/access`：测试使用 `testing.B.Context`，与模块声明的 Go 1.22 兼容性检查冲突。
2. `internal/dnfactivity`：`TestOverview`、`TestListFiltersAndSort` 的活动日期样本已过期。
3. `internal/homerecommendation`：`TestEventsDeduplicateAndAudit` 的统计结果为空。

炸金花及相关接口、微信客户端、配置测试均通过。上述既有问题未在本次功能中修改。
