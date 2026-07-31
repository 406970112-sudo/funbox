# 游戏社交能力层设计

## 目标

在不改变现有 FunBox 视觉语言和好友体系的前提下，为游戏提供统一的好友对战与好友排行能力。首期让五子棋支持好友邀请、接受、实时落子、断线恢复和认输；让俄罗斯方块、贪吃蛇、打砖块提交最佳成绩并查看好友周榜与历史榜。

## 产品规则

- 对战类游戏必须声明 `friendMatch` 能力，并通过统一的邀请、房间、实时事件、断线恢复和服务端裁决流程运行。
- 积分类游戏必须声明 `scoreRule`，目前支持 `higher`；成绩由服务端保存个人最佳，好友榜仅展示本人和已建立好友关系的用户。
- 新游戏只实现自己的对局适配器或成绩提交通道，不重复实现好友选择、榜单、错误处理和实时连接。
- 未登录用户继续使用现有单机玩法；进入好友对战或好友榜时引导登录，不阻断原有游戏。

## 架构

后端在现有 `social.Store` 上增加独立的游戏社交文件，复用同一 SQLite 数据库和好友关系。游戏注册表负责声明能力；五子棋适配器负责校验轮次、坐标、占位与胜负，HTTP 层只做鉴权、输入解码和实时事件发布。

前端新增 `GameSocialProvider`，复用现有登录令牌和 `SocialProvider` 的好友、在线状态与实时事件。游戏页面只调用 Provider 暴露的邀请、接受、落子、认输、成绩提交和榜单查询接口。

## 数据模型

- `game_matches`：游戏、邀请者、被邀请者、状态、当前行动方、胜者、版本号、创建/更新时间。
- `game_match_moves`：对局、顺序号、玩家、客户端幂等键、落子负载、创建时间。
- `game_score_submissions`：游戏、玩家、成绩、提交时间；榜单按周或全历史聚合个人最高分。

## 接口

- `POST /api/v1/game-matches`
- `GET /api/v1/game-matches`
- `GET /api/v1/game-matches/{matchID}`
- `POST /api/v1/game-matches/{matchID}/accept`
- `POST /api/v1/game-matches/{matchID}/decline`
- `POST /api/v1/game-matches/{matchID}/moves`
- `POST /api/v1/game-matches/{matchID}/resign`
- `POST /api/v1/game-scores`
- `GET /api/v1/game-leaderboards/{gameID}?period=weekly|all-time`

## 实时事件

- `game.match.invited`
- `game.match.updated`
- `game.match.finished`
- `game.score.updated`

事件只作为即时刷新信号，完整状态始终可通过 REST 恢复，沿用现有 WebSocket 断线重连策略。

## 视觉与交互

- 沿用现有深蓝 `#151b3b`、主蓝 `#4b6bff`、青柠 `#c9f36a` 与现有圆角、间距、头像组件。
- 五子棋顶部增加“人机对战 / 好友对战”分段控件；好友模式用现有在线好友列表发起邀请，对局中不提供悔棋。
- 积分类游戏顶部或结算面板提供奖杯入口，排行榜沿用现有移动端页面结构，当前用户行使用主色弱底强调。
- 断线时保留棋盘并显示重连状态；服务端状态恢复后继续当前回合。

## 验收

- 非好友不能创建对局；同一对局只有当前行动方能落子；重复客户端落子不会产生重复记录。
- 五子棋横、竖、斜五连由服务端判胜，认输由服务端记录胜者并广播。
- 好友榜只包含本人和好友，周榜只统计当前自然周，榜单按分数降序且并列稳定排序。
- 原有人机五子棋与三个积分游戏保持可玩，未登录状态不崩溃。
- Go 测试、前端 Node 测试、Expo lint 和 TypeScript 检查通过；桌面与移动视口完成关键路径验证。
