# 前端说明

这里是 Expo 前端项目。

常用启动方式：

```bash
cd frontend
npm install
npm run web
```

如果你要改页面，优先看这些目录：

- `app/`
- `components/`
- `constants/`
- `hooks/`

## 图标字体

生产 Web 使用按源码实际引用图标生成的字体子集，避免启动时下载完整的
Ionicons 和 MaterialCommunityIcons 字体。

新增或修改图标后执行：

```bash
npm run fonts:subset
npm run test:icon-fonts
```

`fonts:subset` 需要本机可用的 `hb-subset`（HarfBuzz 命令行工具）。应用构建只使用仓库内已经生成的字体文件，不要求构建机安装 HarfBuzz。

采集首页启动阶段耗时时可使用 `EXPO_PUBLIC_STARTUP_METRICS=1` 构建；默认关闭，不会在正常生产构建中输出启动日志。

前端环境变量示例在：

[frontend/.env.example](c:/Users/Administrator/Desktop/my-first-expo-app/frontend/.env.example)
