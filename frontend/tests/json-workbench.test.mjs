import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  convertJsonToFormat,
  convertTextToJson,
  DEFAULT_DIFF_OPTIONS,
  diffJson,
  diffTextLines,
  flattenJson,
  maskSensitiveValues,
  mergeDiff,
  parseJsonInput,
  summarizeJson,
  unflattenJson,
} from '../lib/json-workbench.ts';

async function readSample(name) {
  return readFile(new URL(`../../docs/json-tool-samples/${name}`, import.meta.url), 'utf8');
}

test('真实 TypeScript package.json 可以解析并统计', async () => {
  const text = await readSample('typescript-package.json');
  const parsed = parseJsonInput(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.format, 'json');
  assert.equal(parsed.value.name, 'typescript');
  assert.equal(parsed.value.version, '6.0.0');
  assert.ok(summarizeJson(parsed.value).nodes > 40);
});

test('真实 package.json 转 YAML 后可以无损解析回原值', async () => {
  const text = await readSample('typescript-package.json');
  const parsed = parseJsonInput(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const yaml = convertJsonToFormat(parsed.value, 'yaml');
  const restored = convertTextToJson(yaml, 'yaml');
  assert.deepEqual(restored, parsed.value);
});

test('真实 Open-Meteo 天气数据转 CSV 行数与数组一致', async () => {
  const text = await readSample('open-meteo-shanghai.json');
  const parsed = parseJsonInput(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const csv = convertJsonToFormat(parsed.value, 'csv');
  const rows = csv.split('\n');
  assert.equal(rows.length, parsed.value.hourly.time.length + 1);
  assert.match(rows[0], /^time,temperature_2m/);
  assert.match(rows[1], /^2026-08-02T00:00,29.8/);

  const restored = convertTextToJson(csv, 'csv');
  assert.equal(restored.length, parsed.value.hourly.time.length);
  assert.equal(restored[0].time, '2026-08-02T00:00');
});

test('XML 转换与解析可以往返', () => {
  const source = {
    name: 'typescript',
    version: '6.0.0',
    files: ['bin', 'lib'],
  };
  const xml = convertJsonToFormat(source, 'xml');
  assert.match(xml, /<name>typescript<\/name>/);
  assert.deepEqual(convertTextToJson(xml, 'xml'), source);
});

test('TOML 可以反向解析为 JSON', () => {
  const value = convertTextToJson(
    'title = "JSON 工作台"\nversion = 1\nfeatures = ["转换", "对比"]\n',
    'toml',
  );
  assert.deepEqual(value, {
    features: ['转换', '对比'],
    title: 'JSON 工作台',
    version: 1,
  });
});

test('真实版本对比只产生真实差异：修改 25、新增 12、删除 8', async () => {
  const aText = await readSample('typescript-package-5.4.5.json');
  const bText = await readSample('typescript-package-5.6.3.json');
  const a = parseJsonInput(aText);
  const b = parseJsonInput(bText);
  if (!a.ok || !b.ok) throw new Error('样例解析失败');
  const result = diffJson(a.value, b.value, DEFAULT_DIFF_OPTIONS);
  assert.equal(result.added, 12);
  assert.equal(result.removed, 8);
  assert.equal(result.modified, 25);
  assert.ok(result.changes.some((item) => item.path === 'version'));
  assert.ok(
    result.changes.some((item) => item.path === 'devDependencies.@dprint/formatter' && item.type === 'added'),
  );
  assert.ok(
    result.changes.some((item) => item.path === 'devDependencies.@types/glob' && item.type === 'removed'),
  );
});

test('忽略空值后 null 与缺失字段不算差异', () => {
  const result = diffJson(
    { name: 'typescript', license: null },
    { name: 'typescript' },
    { ...DEFAULT_DIFF_OPTIONS, ignoreEmpty: true },
  );
  assert.equal(result.changes.length, 0);
  assert.equal(result.unchanged, 2);
});

test('数组按唯一键对齐后重排不产生差异', () => {
  const a = { items: [{ id: 1, value: 'a' }, { id: 2, value: 'b' }] };
  const b = { items: [{ id: 2, value: 'b' }, { id: 1, value: 'a' }] };
  const result = diffJson(a, b, {
    ...DEFAULT_DIFF_OPTIONS,
    arrayMode: 'unique',
    uniqueKey: 'id',
  });
  assert.equal(result.changes.length, 0);
  assert.equal(result.unchanged, 4);
});

test('扁平化、敏感遮蔽与合并行为正确', () => {
  const flat = flattenJson({ a: { b: [1, 2] } });
  assert.deepEqual(flat, { 'a.b[0]': 1, 'a.b[1]': 2 });
  assert.deepEqual(unflattenJson(flat), { a: { b: [1, 2] } });

  assert.deepEqual(maskSensitiveValues({ token: 'abc', name: 'typescript' }), {
    name: 'typescript',
    token: '****',
  });

  const merged = mergeDiff(
    { a: 1, b: 2 },
    { a: 3, b: 2 },
    [{ after: 3, before: 1, path: 'a', type: 'modified' }],
    'b',
  );
  assert.deepEqual(merged, { a: 3, b: 2 });
});

test('文本对比和类型输出覆盖核心格式', () => {
  const lines = diffTextLines('a\nb', 'a\nc');
  assert.equal(lines.filter((line) => line.type === 'same').length, 1);
  assert.equal(lines.filter((line) => line.type === 'removed').length, 1);
  assert.equal(lines.filter((line) => line.type === 'added').length, 1);

  const source = { name: 'typescript', version: '6.0.0', keywords: ['TypeScript'] };
  assert.match(convertJsonToFormat(source, 'typescript'), /export type JsonRoot/);
  assert.match(convertJsonToFormat(source, 'schema'), /json-schema.org\/draft\/2020-12/);
  assert.match(convertJsonToFormat(source, 'sql'), /INSERT INTO "items"/);
  assert.equal(convertJsonToFormat(source, 'jsonl').split('\n').length, 1);
});
