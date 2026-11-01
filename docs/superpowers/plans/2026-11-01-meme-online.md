# 联网表情搜索接入计划

用户已选择“保留现有图库，新增联网搜图，多站聚合并复用收藏、预览和保存”；随后明确仅实施小程序，Web 不介入。本次不自动提交/推送/部署。已有首页“不加我的藏图”要求继续有效。

## 决策和边界

采用 Go 后端适配 o98k-ok/meme 的多源搜索，而不是给小程序直接接 stdio MCP 或运行额外进程。保留上游归属说明；不复制其关闭 TLS 校验、明文响应日志、无限读取响应等实现。上游是搜索器，不提供可用的全网热榜或统一实时流行时间。

UI 在现有图库页增加“图库 / 联网搜图”模式切换，联网模式有关键词、来源选择、来源状态、部分失败提示、上一页下一页。已有全部/分类/榜单/藏图不改变语义。未输入关键词不发送搜索；网络结果顺序不是热度排名。展示标题和来源，图片走现有自有HTTPS媒体路径。

## 接口约定

所有路径 /api/v1 前缀，返回URL为自有后端地址。

- GET /memes/online/sources → {items:[{id,title,enabled,reason?}],attribution:{name,url}}
- GET /memes/online/search?q=猫&sources=doutula,pdan&page=1&limit=36 → {items:Image[],page:number,hasMore:boolean,sources:[{id,title,status:'ok'|'empty'|'error'|'disabled',message?:string}],cached:boolean,notice?:string}
- Image 延续现有全部字段，新增可选 sourceId/sourceName/sourcePageUrl；id稳定，GET /memes/{id}、收藏、事件、媒体接口均可读取在线结果。不可返回客户端任意URL代理参数。
- 未配置Cookie的抖音返回disabled；其他来源根据适配情况注册，失败单独提示，不把失败当零结果。单源超时/空结果不影响其他来源。分页只有真实可翻页来源推进；不支持分页来源不得重复第一页。
- 本地图库主列表/分类计数不被临时联网搜索结果污染；在线记录持久保存以支持收藏，原图库同步不能删除这些记录。源失效显示错误与重试，收藏仍保留安全占位。

## 安全与体验

后台并发/超时、结果数量/长度、响应大小/缓存数量和查询频率均设上限。外链必须HTTPS公共IP、阻止本机/私网/元数据服务、固定提供方请求地址，媒体仅通过登记ID读取，DNS/重定向每跳校验，Cookie只发至抖音指定主机且不输出日志/响应。媒体验证MIME/尺寸/长度并缓存，下架和限流继续生效。搜索缓存按关键词+来源+页/数量，响应不可无限增长。

上游代码依据README声明MIT使用，保留来源和适配说明；新增来源的图片权利归原作者，不把代码许可当图片授权。

## 任务

- [x] 后端：适配providers（默认非凭据源、可配置抖音），联网搜索/来源列表、部分失败、缓存限流、在线记录与现有收藏详情媒体桥接；行为测试+SSRF/分页/同步保留/上下架回归。owner backend/**。
- [x] Web 不在本次范围：已撤回本轮全部 frontend 改动，原有 Web 功能保持基线。
- [x] 小程序：同等联网入口与状态、来源选择、已有详情收藏保存可用，保留现有HTTPS网关规则。owner miniprogram/**。
- [x] 集成：真实来源探测、API+小程序模拟器验证、完整相关测试、说明文档与独立复核。

## 工作区约束

当前基线 f2f3a88；miniprogram/packages/meme/library/index.wxml 与 index.wxss 存在用户未提交的CSS图标/来源复制/可访问性调整。必须在此基础上增量改动，不恢复HEAD版本；原始patch已另存 /tmp/funbox-online-preexisting.patch。继续使用当前checkout功能分支，禁止自动提交或改写他人改动。

完成记录：仅小程序+后端，frontend零改动；211项小程序测试、Go全测与竞态/定向安全回归通过。真实API及微信开发工具验证通过，尚未提交或部署。
