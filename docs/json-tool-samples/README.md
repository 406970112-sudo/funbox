# JSON 工作台真实数据样例

本目录只存放真实数据快照，供产品设计稿、验收用例与开发自测使用。禁止使用假数据或 mock 数据替换。

抓取时间：2026-08-02。

| 文件 | 来源 | 用途 |
| --- | --- | --- |
| `typescript-package.json` | https://raw.githubusercontent.com/microsoft/TypeScript/main/package.json | JSON→YAML/CSV/XML/TS/Schema 主示例 |
| `typescript-package-5.4.5.json` | https://raw.githubusercontent.com/microsoft/TypeScript/v5.4.5/package.json | 语义对比 A |
| `typescript-package-5.6.3.json` | https://raw.githubusercontent.com/microsoft/TypeScript/v5.6.3/package.json | 语义对比 B |
| `open-meteo-shanghai.json` | https://api.open-meteo.com/v1/forecast?latitude=31.2304&longitude=121.4737&timezone=Asia%2FShanghai | 数组对象→CSV、JSON→XML |
| `open-meteo-hourly.csv` | 由上一条真实 JSON 程序化生成 | CSV 输出验收 |
| `express-npm-latest.json` | https://registry.npmjs.org/express/latest | 深层嵌套与类型推断示例 |
| `express-package.json` | https://raw.githubusercontent.com/expressjs/express/master/package.json | JSON→TS 类型示例 |
| `typescript-package.yaml` | 由 `typescript-package.json` 经 `yaml.stringify` 生成 | YAML 输出验收 |
| `funbox-package-ae8b88e.json` | 本仓库提交 `ae8b88e` 的 `package.json` | 项目内真实历史快照 |
| `funbox-package-head.json` | 本仓库当前工作区 `package.json` | 项目内真实当前快照 |

说明：

- 展示时允许截取真实数据的一部分，但字段值与来源必须可追溯，不允许编造。
- 语义对比示例的差异统计（修改 25 / 新增 12 / 删除 8）由 `typescript-package-5.4.5.json` 与 `typescript-package-5.6.3.json` 程序化计算得出。
- 天气 CSV 由 `open-meteo-shanghai.json` 的 `hourly` 数组逐行展开生成。
