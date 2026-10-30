# 通用记分 V2 实施记录

2026-10-30，功能分支 `codex/general-score`。已完成本地实施与验证，按用户要求提交并合入 `main`；生产部署另行执行。

## 实现范围

- 首页只在既有麻将、炸金花之后新增通用记分卡片。去掉新增卡片后的 WXML 与 HEAD 完全一致；既有文案、插画、分类标题和卡片样式保留。
- 新增 `miniprogram/pages/score/general/index`，沿用麻将建房样式、房间名／密码原位编辑和昵称输入。主题插画为独立透明 PNG：`miniprogram/assets/illustrations/general-score.png`。创建阶段没有人数或每分金额配置。
- 创建参数为 `gameType: generic, scene: generic, maxPlayers: 0`；人数不预设固定名额，2 人可开始。等待时支持扫码、分享与手动加入，开始后沿用原有不能加入规则。
- 共享房间通过服务端 `gameType` 切换中性主题、昵称头像、纵向成员列表；不显示东南西北和预设空位。延续原有批量给分、记录、实时同步和游客绑定账号逻辑。
- 房主结算默认每分 1 元，可修改后预览所有成员金额，确认后保存实际折算率；结算名单独立滚动，保留确认按钮。结果保留积分、金额和转账建议，并显示最终每分金额。
- SQLite 增加默认值为 0 的 `unlimited_players` 列，灵活人数房间标记为 1，快照还原 `maxPlayers=0`。不修改旧表人数 CHECK，旧固定容量房间仍按原上限执行。
- 大人数结算不能沿用无界穷举：超过 12 个非零余额时采用稳定债权债务匹配，最多 n−1 笔并准确结清；较小组保留原最少转账算法。大组不承诺全局最少笔数。

## 验证结果

- `node --test miniprogram/tests/*.test.js`：143/143 通过。
- 46 个非第三方 JS 文件通过语法检查。
- 微信原生编译器：11 个 WXML、12 个 WXSS 编译通过。
- `go test ./internal/score ./internal/httpapi -count=1`：通过。
- 新增服务测试涵盖 13 人建房／加入／邀请预览／开始／给分／房主 50 分每点结算、非房主拒绝、旧固定名额保护；已有旧数据库迁移回归通过。
- 新增 200 人非零余额测试验证转账方向、金额结清、确定性及笔数上界；小组仍保留最少笔数并拒绝非零和输入。
- `go build -o /tmp/funbox-general-api-final ./cmd/api`：通过。
- 独立只读审查发现的大组穷举阻塞问题已修复，复核无新增 P1/P2。

## 微信模拟器联调

使用微信开发者工具、基础库 3.17.5、591×1280 截图视口；临时项目 `/tmp/funbox-general-qa/miniprogram` 和独立 SQLite 本地后端 `127.0.0.1:3037`，未改正式 API 地址或访问生产房间。

通过真实元素交互完成：首页通用入口 → 创建房间（小林）→ 本地 HTTP 加入其余 5 名成员 → 开始记分 → 给阿杰 12 分 → 打开结算 → 输入每分 0.50 元 → 预览双方 ±6 元 → 确认结算 → 返回首页。为避免人工操作第二次原生确认框，本地自动化仅 mock `wx.showModal` 返回确认，之后恢复；建房、加入、给分、金额计算与结算均使用真实本地后端。运行时返回房间状态 `settled`，console 的 error 过滤结果为空。

截图证据保存在本机临时目录：`/tmp/funbox-general-home-final.jpg`、`/tmp/funbox-general-create.jpg`、`/tmp/funbox-general-active.jpg`、`/tmp/funbox-general-confirm.jpg`、`/tmp/funbox-general-result.jpg`。没有上传或转发给联系人。

## 验证边界与部署依赖

- 本地没有微信 AppSecret，因此未向微信申请真实小程序码；复用现有邀请码流程和二维码回退，未执行真机扫码、真实微信转发和支付。
- `go test ./...` 的 3 个既有失败模块已在未修改 HEAD 导出的独立目录复现：`internal/access` 的 `testing.B.Context` 与 Go 1.22 声明兼容检查冲突；`internal/dnfactivity` 的 `TestOverview`、`TestListFiltersAndSort` 日期样本；`internal/homerecommendation` 的 `TestEventsDeduplicateAndAudit` 空统计。本次未修改这些模块。
- 后端必须先或与小程序配套发布，旧后端会拒绝新建 `maxPlayers=0`。数据库迁移随后端启动执行。

## 插画来源

使用内置 `image_gen.imagegen`，以项目 `tabletop-atlas.png` 作风格参考，生成透明背景的两块蓝边白色记分牌，蓝色加号、珊瑚色减号，保留圆润立体高光，不含麻将、扑克牌或骰子。新图仅供新增入口、通用建房和通用邀请页使用，原图集未修改。
