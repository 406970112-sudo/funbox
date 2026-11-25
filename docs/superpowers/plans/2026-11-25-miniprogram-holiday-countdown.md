# FunBox 小程序节假日倒计时实施计划

> 执行方式采用 Superpowers 的逐项测试流程。

**目标**是交付首页「发现更多」单排轮播、全部入口页和中国大陆假期日历。

**实现**沿用原生 WXML、WXSS、JavaScript 和现有 Go API。两处发现入口复用卡片模板与导航规则，公历自然日按北京时间计算。

**设计**见 [节假日倒计时](../specs/2026-11-25-miniprogram-holiday-countdown-design.md)。

## 数据

- [x] 测试 `GET /api/v1/holiday-calendar` 在无登录态时返回 2026 和 2027 年公告。验证春节 9 天及前后两个补班日。
- [x] 在 `backend/internal/httpapi` 注册公开只读接口并内嵌已核对的日历，提供版本号和各年的公告来源。
- [x] 用 `go test ./internal/httpapi -run TestHolidayCalendar` 验证。

## 倒计时

- [x] 测试 `getHolidayView(calendar, now, selectedYear)` 的跨年、北京时间零点、单日假期、补班和后续公告缺失状态。
- [x] 在 `miniprogram/utils/holiday-calendar.js` 实现自然日计算和 `watchHolidayCalendar(update)`。共享请求，读取最后可用本机缓存，页面隐藏后停止回调和计时。
- [x] 测试首次离线进入、有效缓存回退、无效响应和重试更新。

## 页面

- [x] 首页用原生 `swiper` 横滑，每屏两张卡片。保留笔记本登录返回流程和表情包路由，点击「发现更多」进入独立的全部入口页。
- [x] 复用发现入口的卡片尺寸、圆角、颜色和素材。倒计时卡片的文字及插画走独立布局，全部入口页与首页使用同一模板。
- [x] 新增「假期日历」原生页，默认查看最近假期所属年份，支持年份切换、调休、重试和复制公告链接。
- [x] 运行小程序及 Go 全套测试，并通过原生编译和模拟器检查首页、全部入口与 320 px 窄屏。
