import TOML from '@iarna/toml';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonFormat = 'json' | 'jsonc' | 'jsonl';

export type JsonSummary = {
  bytes: number;
  depth: number;
  nodes: number;
};

export type JsonParseError = {
  column: number;
  line: number;
  message: string;
};

export type JsonParseResult =
  | { ok: true; error?: never; format: JsonFormat; summary: JsonSummary; value: JsonValue }
  | { ok: false; error: JsonParseError; format?: never; summary?: never; value?: never };

export type KeyCase = 'none' | 'camel' | 'snake' | 'kebab';

export type CleanOptions = {
  dedupeArrays: boolean;
  ignoreEmpty: boolean;
  indent: number;
  keyCase: KeyCase;
  maskSensitive: boolean;
  sortKeys: boolean;
};

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  dedupeArrays: false,
  ignoreEmpty: false,
  indent: 2,
  keyCase: 'none',
  maskSensitive: false,
  sortKeys: false,
};

export type OutputFormat =
  | 'csv'
  | 'json'
  | 'jsonl'
  | 'schema'
  | 'sql'
  | 'typescript'
  | 'xml'
  | 'yaml';

export type InputFormat = 'csv' | 'json' | 'toml' | 'xml' | 'yaml';

export type ArrayDiffMode = 'index' | 'unique';
export type NumericPrecision = 'exact' | 'numeric';

export type DiffOptions = {
  arrayMode: ArrayDiffMode;
  caseSensitive: boolean;
  ignoreEmpty: boolean;
  ignoreKeyOrder: boolean;
  numericPrecision: NumericPrecision;
  uniqueKey?: string;
};

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  arrayMode: 'index',
  caseSensitive: true,
  ignoreEmpty: false,
  ignoreKeyOrder: true,
  numericPrecision: 'exact',
};

export type ChangeType = 'added' | 'modified' | 'removed';

export type DiffItem = {
  after: JsonValue | undefined;
  before: JsonValue | undefined;
  path: string;
  type: ChangeType;
};

export type DiffResult = {
  added: number;
  changes: DiffItem[];
  modified: number;
  removed: number;
  unchanged: number;
};

export type TextDiffLine = {
  text: string;
  type: 'added' | 'removed' | 'same';
};

export type FieldTransformRule = {
  path: string;
  transform: 'round2' | 'timestamp';
};

export const SENSITIVE_KEY_PATTERN =
  /authorization|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key/i;

export function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripComments(text: string): string {
  let result = '';
  let index = 0;
  let inString = false;
  let stringQuote = '';

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      result += char;
      if (char === '\\') {
        result += next ?? '';
        index += 2;
        continue;
      }
      if (char === stringQuote) inString = false;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length - 1 && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index = Math.min(text.length, index + 2);
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function removeTrailingCommas(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/,\s*$/, '');
}

function positionFromError(text: string, message: string): JsonParseError {
  const match = /position (\d+)/i.exec(message);
  if (!match) {
    return { column: 1, line: 1, message: 'JSON 语法错误，请检查括号、引号与逗号。' };
  }
  const index = Number(match[1]);
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = index - lastNewline;
  return { column, line, message: 'JSON 语法错误，请检查括号、引号与逗号。' };
}

export function parseJsonInput(text: string): JsonParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: { column: 1, line: 1, message: '请输入 JSON 内容。' } };
  }

  try {
    const value = JSON.parse(trimmed) as JsonValue;
    return { format: 'json', ok: true, summary: summarizeJson(value), value };
  } catch (error) {
    const firstMessage = error instanceof Error ? error.message : '';

    const cleaned = removeTrailingCommas(stripComments(trimmed));
    try {
      const value = JSON.parse(cleaned) as JsonValue;
      return { format: 'jsonc', ok: true, summary: summarizeJson(value), value };
    } catch {
      const lines = trimmed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > 1) {
        const parsedLines: JsonValue[] = [];
        for (const line of lines) {
          try {
            parsedLines.push(JSON.parse(line) as JsonValue);
          } catch {
            return {
              error: { column: 1, line: 1, message: '不是合法 JSON，也不是 JSON Lines：请检查首行内容。' },
              ok: false,
            };
          }
        }
        return {
          format: 'jsonl',
          ok: true,
          summary: summarizeJson(parsedLines),
          value: parsedLines,
        };
      }
      return { error: positionFromError(trimmed, firstMessage), ok: false };
    }
  }
}

export function summarizeJson(value: JsonValue): JsonSummary {
  let nodes = 0;
  let depth = 0;

  function walk(item: JsonValue, level: number) {
    nodes += 1;
    depth = Math.max(depth, level);
    if (Array.isArray(item)) {
      item.forEach((child) => walk(child, level + 1));
    } else if (isJsonObject(item)) {
      Object.values(item).forEach((child) => walk(child, level + 1));
    }
  }

  walk(value, 1);
  return { bytes: JSON.stringify(value).length, depth, nodes };
}

export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function toCamelCase(key: string): string {
  return key.replace(/_+([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

export function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-+/g, '_').toLowerCase();
}

export function toKebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_+/g, '-').toLowerCase();
}

export function renameKeyCase(key: string, keyCase: KeyCase): string {
  if (keyCase === 'camel') return toCamelCase(key);
  if (keyCase === 'snake') return toSnakeCase(key);
  if (keyCase === 'kebab') return toKebabCase(key);
  return key;
}

export function cleanJsonValue(value: JsonValue, options: CleanOptions): JsonValue {
  let next = cloneJson(value);

  if (options.ignoreEmpty) {
    next = dropEmptyValues(next);
  }
  if (options.dedupeArrays) {
    next = dedupeArrays(next);
  }
  if (options.keyCase !== 'none') {
    next = renameKeysRecursively(next, (key) => renameKeyCase(key, options.keyCase));
  }
  if (options.sortKeys) {
    next = sortKeysRecursively(next);
  }
  if (options.maskSensitive) {
    next = maskSensitiveValues(next);
  }
  return next;
}

export function formatJson(value: JsonValue, options: Partial<CleanOptions> = {}): string {
  const indent = options.indent ?? DEFAULT_CLEAN_OPTIONS.indent;
  return JSON.stringify(value, null, indent);
}

export function minifyJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function dropEmptyValues(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(dropEmptyValues);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== '')
        .map(([key, item]) => [key, dropEmptyValues(item)]),
    );
  }
  return value;
}

function dedupeArrays(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const result: JsonValue[] = [];
    for (const item of value) {
      const key = canonicalJson(dedupeArrays(item));
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(dedupeArrays(item));
    }
    return result;
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dedupeArrays(item)]));
  }
  return value;
}

function sortKeysRecursively(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysRecursively(value[key])]),
    );
  }
  return value;
}

function renameKeysRecursively(value: JsonValue, rename: (key: string) => string): JsonValue {
  if (Array.isArray(value)) return value.map((item) => renameKeysRecursively(item, rename));
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [rename(key), renameKeysRecursively(item, rename)]),
    );
  }
  return value;
}

export function maskSensitiveValues(
  value: JsonValue,
  keys: string[] = ['token', 'secret', 'password', 'key', 'authorization'],
): JsonValue {
  const matcher = new RegExp(keys.map(escapeRegExp).join('|'), 'i');

  if (Array.isArray(value)) return value.map((item) => maskSensitiveValues(item, keys));
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        matcher.test(key) && !isJsonObject(item) && !Array.isArray(item)
          ? '****'
          : maskSensitiveValues(item, keys),
      ]),
    );
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function objectToRecords(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) {
    if (!value.every(isJsonObject)) {
      throw new Error('仅支持对象数组转 CSV。');
    }
    return value as JsonObject[];
  }

  if (!isJsonObject(value)) {
    throw new Error('仅支持对象数组或含等长数组的对象转 CSV。');
  }

  const arraySource = findArrayObject(value) ?? value;
  const arrayEntries = Object.entries(arraySource).filter(
    ([, item]) => Array.isArray(item),
  ) as [string, JsonValue[]][];
  if (arrayEntries.length === 0) {
    return [arraySource];
  }

  const length = Math.min(...arrayEntries.map(([, items]) => items.length));
  const scalarEntries = Object.entries(arraySource).filter(([, item]) => !Array.isArray(item));
  const records: JsonObject[] = [];
  for (let index = 0; index < length; index += 1) {
    const record: JsonObject = Object.fromEntries(scalarEntries);
    arrayEntries.forEach(([key, items]) => {
      record[key] = items[index];
    });
    records.push(record);
  }
  return records;
}

function findArrayObject(value: JsonObject): JsonObject | null {
  const directEntries = Object.values(value).filter(Array.isArray);
  if (directEntries.length > 0) return value;
  for (const item of Object.values(value)) {
    if (isJsonObject(item)) {
      const nested = findArrayObject(item);
      if (nested) return nested;
    }
  }
  return null;
}

function csvCell(value: JsonValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function jsonToCsv(value: JsonValue): string {
  const records = objectToRecords(value);
  const columns = Array.from(
    new Set(records.flatMap((record) => Object.keys(record))),
  );
  const lines = [columns.map(csvCell).join(',')];
  records.forEach((record) => {
    lines.push(columns.map((column) => csvCell(record[column] as JsonValue)).join(','));
  });
  return lines.join('\n');
}

export function csvToJson(text: string): JsonValue {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
      } else {
        cell += char;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  row.push(cell);
  rows.push(row);

  const nonEmpty = rows.filter((line) => line.some((item) => item.trim() !== ''));
  if (nonEmpty.length < 2) {
    throw new Error('CSV 至少需要表头与一行数据。');
  }
  const headers = nonEmpty[0];
  return nonEmpty.slice(1).map((line) => {
    const record: JsonObject = {};
    headers.forEach((header, headerIndex) => {
      const value = line[headerIndex] ?? '';
      record[header] = inferScalar(value);
    });
    return record;
  });
}

function inferScalar(value: string): JsonValue {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+[eE][+-]?\d+$/.test(trimmed)) return Number(trimmed);
  return value;
}

export function jsonToXml(value: JsonValue): string {
  const builder = new XMLBuilder({
    arrayNodeName: 'item',
    format: true,
    ignoreAttributes: false,
    suppressEmptyNode: true,
  });
  const root = isJsonObject(value) ? value : { root: value };
  return builder.build(root);
}

export function xmlToJson(text: string): JsonValue {
  const parser = new XMLParser({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    parseTagValue: false,
    textNodeName: '#text',
    trimValues: true,
  });
  const result = parser.parse(text) as JsonValue;
  if (isJsonObject(result) && Object.keys(result).length === 1) {
    const onlyValue = Object.values(result)[0];
    return onlyValue as JsonValue;
  }
  return result;
}

export function jsonToJsonLines(value: JsonValue): string {
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => JSON.stringify(item)).join('\n');
}

function tsTypeForValue(value: JsonValue, seenObjects: Set<JsonObject>): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const itemTypes = Array.from(new Set(value.map((item) => tsTypeForValue(item, seenObjects))));
    const inner = itemTypes.length === 0 ? 'unknown' : itemTypes.join(' | ');
    return `${inner}[]`;
  }
  if (isJsonObject(value)) {
    if (seenObjects.has(value)) return 'JsonObject';
    seenObjects.add(value);
    const lines = Object.entries(value).map(([key, item]) => {
      const type = tsTypeForValue(item, seenObjects);
      return `  ${JSON.stringify(key)}${type.endsWith('| null') || type === 'null' ? '?' : ''}: ${type};`;
    });
    return `{\n${lines.join('\n')}\n}`;
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

export function jsonToTypeScript(value: JsonValue, rootName = 'JsonRoot'): string {
  const seen = new Set<JsonObject>();
  return `export type ${rootName} = ${tsTypeForValue(value, seen)};\n`;
}

function schemaForValue(value: JsonValue): JsonObject {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const itemTypes = Array.from(
      new Set(value.filter((item) => item !== undefined).map((item) => JSON.stringify(schemaForValue(item)))),
    );
    return {
      items: itemTypes.length === 1 ? (JSON.parse(itemTypes[0]) as JsonValue) : { anyOf: itemTypes.map((item) => JSON.parse(item) as JsonValue) },
      type: 'array',
    };
  }
  if (isJsonObject(value)) {
    return {
      properties: Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, schemaForValue(item)]),
      ),
      required: Object.keys(value),
      type: 'object',
    };
  }
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: 'number' };
  return { type: 'boolean' };
}

export function jsonToJsonSchema(value: JsonValue, rootName = 'JsonRoot'): string {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...schemaForValue(value),
    title: rootName,
  };
  return JSON.stringify(schema, null, 2);
}

function sqlLiteral(value: JsonValue): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function jsonToSqlInsert(value: JsonValue, table = 'items'): string {
  const records = objectToRecords(value);
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  if (columns.length === 0) {
    throw new Error('CSV/SQL 转换至少需要一个字段。');
  }
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  const valueLines = records.map((record) => {
    const values = columns.map((column) => sqlLiteral(record[column] as JsonValue)).join(', ');
    return `  (${values})`;
  });
  return `INSERT INTO "${table}" (${columnList})\nVALUES\n${valueLines.join(',\n')};\n`;
}

export function convertJsonToFormat(
  value: JsonValue,
  format: OutputFormat,
  options: Partial<CleanOptions> = {},
): string {
  const cleaned = cleanJsonValue(value, { ...DEFAULT_CLEAN_OPTIONS, ...options });
  if (format === 'json') return formatJson(cleaned, options);
  if (format === 'yaml') return stringifyYaml(cleaned);
  if (format === 'csv') return jsonToCsv(cleaned);
  if (format === 'xml') return jsonToXml(cleaned);
  if (format === 'jsonl') return jsonToJsonLines(cleaned);
  if (format === 'typescript') return jsonToTypeScript(cleaned);
  if (format === 'schema') return jsonToJsonSchema(cleaned);
  return jsonToSqlInsert(cleaned);
}

export function convertTextToJson(text: string, format: InputFormat): JsonValue {
  if (format === 'json') {
    const parsed = parseJsonInput(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  }
  if (format === 'yaml') return parseYaml(text) as JsonValue;
  if (format === 'csv') return csvToJson(text);
  if (format === 'xml') return xmlToJson(text);
  return normalizeTomlValue(TOML.parse(text));
}

function normalizeTomlValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeTomlValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeTomlValue(item),
      ]),
    );
  }
  return value as JsonPrimitive;
}

function equalLeaf(a: JsonValue | undefined, b: JsonValue | undefined, options: DiffOptions): boolean {
  if (options.ignoreEmpty) {
    const isEmpty = (value: JsonValue | undefined) =>
      value === undefined || value === null || value === '';
    if (isEmpty(a) && isEmpty(b)) return true;
  }
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && options.numericPrecision === 'numeric') {
    return Number(a.toFixed(2)) === Number(b.toFixed(2));
  }
  if (typeof a === 'string' && typeof b === 'string' && !options.caseSensitive) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
}

export function diffJson(a: JsonValue, b: JsonValue, options: DiffOptions = DEFAULT_DIFF_OPTIONS): DiffResult {
  const changes: DiffItem[] = [];
  let unchanged = 0;

  function push(path: string, type: ChangeType, before: JsonValue | undefined, after: JsonValue | undefined) {
    changes.push({ after, before, path, type });
  }

  function walk(
    before: JsonValue | undefined,
    after: JsonValue | undefined,
    path: string[],
  ) {
    if (before === undefined || after === undefined) {
      if (options.ignoreEmpty && equalLeaf(before, after, options)) {
        unchanged += 1;
        return;
      }
      if (before === undefined) {
        push(joinPath(path), 'added', undefined, after);
      } else {
        push(joinPath(path), 'removed', before, undefined);
      }
      return;
    }

    const beforeArray = Array.isArray(before);
    const afterArray = Array.isArray(after);
    const beforeObject = isJsonObject(before);
    const afterObject = isJsonObject(after);

    if (beforeArray !== afterArray || beforeObject !== afterObject) {
      push(joinPath(path), 'modified', before, after);
      return;
    }

    if (beforeObject && afterObject) {
      const beforeKeys = Object.keys(before);
      const afterKeys = Object.keys(after);
      const afterKeySet = new Set(afterKeys);
      const beforeKeySet = new Set(beforeKeys);

      for (const key of beforeKeys) {
        if (!afterKeySet.has(key)) {
          if (!(options.ignoreEmpty && equalLeaf(before[key], undefined, options))) {
            push(joinPath([...path, key]), 'removed', before[key], undefined);
          } else {
            unchanged += 1;
          }
        }
      }
      for (const key of afterKeys) {
        if (!beforeKeySet.has(key)) {
          if (!(options.ignoreEmpty && equalLeaf(undefined, after[key], options))) {
            push(joinPath([...path, key]), 'added', undefined, after[key]);
          } else {
            unchanged += 1;
          }
        }
      }
      for (const key of beforeKeys) {
        if (afterKeySet.has(key)) {
          walk(before[key], after[key], [...path, key]);
        }
      }
      return;
    }

    if (beforeArray && afterArray) {
      if (options.arrayMode === 'unique' && options.uniqueKey) {
        const beforeItems = before as JsonObject[];
        const afterItems = after as JsonObject[];
        const afterById = new Map<string, JsonObject>();
        afterItems.forEach((item) => {
          if (isJsonObject(item)) {
            const id = String(item[options.uniqueKey!]);
            if (!afterById.has(id)) afterById.set(id, item);
          }
        });
        const afterUsed = new Set<string>();
        beforeItems.forEach((item) => {
          const id = isJsonObject(item) ? String(item[options.uniqueKey!]) : '';
          const match = afterById.get(id);
          if (match && !afterUsed.has(id)) {
            afterUsed.add(id);
            walk(item, match, [...path, id]);
          } else {
            push(joinPath([...path, String(id || beforeItems.indexOf(item))]), 'removed', item, undefined);
          }
        });
        afterItems.forEach((item) => {
          const id = isJsonObject(item) ? String(item[options.uniqueKey!]) : '';
          if (afterUsed.has(id)) return;
          push(joinPath([...path, id]), 'added', undefined, item);
        });
        return;
      }

      const maxLength = Math.max(before.length, after.length);
      for (let index = 0; index < maxLength; index += 1) {
        walk(before[index], after[index], [...path, String(index)]);
      }
      return;
    }

    if (equalLeaf(before, after, options)) {
      unchanged += 1;
    } else {
      push(joinPath(path), 'modified', before, after);
    }
  }

  walk(a, b, []);
  return {
    added: changes.filter((item) => item.type === 'added').length,
    changes,
    modified: changes.filter((item) => item.type === 'modified').length,
    removed: changes.filter((item) => item.type === 'removed').length,
    unchanged,
  };
}

function joinPath(segments: string[]): string {
  return segments.reduce((path, segment) => {
    if (/^\d+$/.test(segment)) return `${path}[${segment}]`;
    return path ? `${path}.${segment}` : segment;
  }, '');
}

export function diffTextLines(beforeText: string, afterText: string): TextDiffLine[] {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  if (before.length + after.length > 2000) {
    return after.map((text) => ({ text, type: 'same' as const }));
  }

  const rows = before.length + 1;
  const columns = after.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (let row = rows - 2; row >= 0; row -= 1) {
    for (let column = columns - 2; column >= 0; column -= 1) {
      if (before[row] === after[column]) {
        dp[row][column] = dp[row + 1][column + 1] + 1;
      } else {
        dp[row][column] = Math.max(dp[row + 1][column], dp[row][column + 1]);
      }
    }
  }

  const result: TextDiffLine[] = [];
  let row = 0;
  let column = 0;
  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      result.push({ text: before[row], type: 'same' });
      row += 1;
      column += 1;
    } else if (dp[row + 1][column] >= dp[row][column + 1]) {
      result.push({ text: before[row], type: 'removed' });
      row += 1;
    } else {
      result.push({ text: after[column], type: 'added' });
      column += 1;
    }
  }
  while (row < before.length) {
    result.push({ text: before[row], type: 'removed' });
    row += 1;
  }
  while (column < after.length) {
    result.push({ text: after[column], type: 'added' });
    column += 1;
  }
  return result;
}

export function parsePath(path: string): (string | number)[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

export function getByPath(value: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of parsePath(path)) {
    if (current === undefined || current === null) return undefined;
    if (typeof segment === 'number' && Array.isArray(current)) {
      current = current[segment];
    } else if (typeof segment === 'string' && isJsonObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setByPath(value: JsonValue, path: string, next: JsonValue): JsonValue {
  const segments = parsePath(path);
  if (segments.length === 0) return next;
  const root = cloneJson(value);
  let current: JsonValue = root;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (typeof segment === 'number' && Array.isArray(current)) {
      if (last) {
        current[segment] = next;
      } else {
        current[segment] = ensureContainer(current[segment], segments[index + 1]);
        current = current[segment];
      }
      return;
    }
    if (typeof segment === 'string' && isJsonObject(current)) {
      if (last) {
        current[segment] = next;
      } else {
        current[segment] = ensureContainer(current[segment], segments[index + 1]);
        current = current[segment];
      }
    }
  });
  return root;
}

function ensureContainer(value: JsonValue | undefined, nextSegment: string | number): JsonValue {
  if (value === undefined || value === null) {
    return typeof nextSegment === 'number' ? [] : {};
  }
  return value;
}

export function deleteByPath(value: JsonValue, path: string): JsonValue {
  const segments = parsePath(path);
  if (segments.length === 0) return value;
  const root = cloneJson(value);
  let current: JsonValue = root;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (typeof segment === 'number' && Array.isArray(current)) {
      if (last) {
        current.splice(segment, 1);
      } else {
        current = current[segment] as JsonValue;
      }
      return;
    }
    if (typeof segment === 'string' && isJsonObject(current)) {
      if (last) {
        delete current[segment];
      } else {
        current = current[segment] as JsonValue;
      }
    }
  });
  return root;
}

export function mergeDiff(a: JsonValue, b: JsonValue, changes: DiffItem[], prefer: 'a' | 'b' = 'b'): JsonValue {
  let result = cloneJson(a);
  for (const change of changes) {
    if (change.type === 'removed') {
      result = deleteByPath(result, change.path);
      continue;
    }
    if (change.type === 'added' || prefer === 'b') {
      result = setByPath(result, change.path, cloneJson(change.after as JsonValue));
    }
  }
  return result;
}

export function flattenJson(value: JsonValue, separator = '.'): JsonObject {
  const result: JsonObject = {};

  function walk(item: JsonValue, prefix: string) {
    if (Array.isArray(item)) {
      item.forEach((child, index) => walk(child, prefix ? `${prefix}[${index}]` : `[${index}]`));
    } else if (isJsonObject(item)) {
      Object.entries(item).forEach(([key, child]) => walk(child, prefix ? `${prefix}${separator}${key}` : key));
    } else {
      result[prefix || 'value'] = item;
    }
  }

  walk(value, '');
  return result;
}

export function unflattenJson(flat: JsonObject, separator = '.'): JsonValue {
  let result: JsonValue = {};
  Object.entries(flat).forEach(([path, value]) => {
    result = setByPath(result, path.replaceAll(separator, '.'), value as JsonValue);
  });
  return result;
}

export function renameKeys(value: JsonValue, mapping: Record<string, string>): JsonValue {
  return renameKeysRecursively(value, (key) => mapping[key] ?? key);
}

export function filterByPaths(value: JsonValue, paths: string[]): JsonValue {
  const root: JsonValue = {};
  paths.forEach((path) => {
    const current = getByPath(value, path);
    if (current !== undefined) {
      setByPath(root, path, cloneJson(current));
    }
  });
  return root;
}

export function applyTemplate(value: JsonValue, template: JsonObject): JsonValue {
  function resolve(templateValue: JsonValue): JsonValue {
    if (Array.isArray(templateValue)) return templateValue.map(resolve);
    if (isJsonObject(templateValue)) {
      return Object.fromEntries(Object.entries(templateValue).map(([key, item]) => [key, resolve(item)]));
    }
    if (typeof templateValue === 'string') {
      const match = /^\{\{\s*([^}]+)\s*\}\}$/.exec(templateValue.trim());
      if (match) {
        const resolved = getByPath(value, match[1].trim());
        return resolved ?? templateValue;
      }
    }
    return templateValue;
  }
  return resolve(template);
}

export function applyFieldTransforms(value: JsonValue, rules: FieldTransformRule[]): JsonValue {
  let result = cloneJson(value);
  rules.forEach((rule) => {
    const current = getByPath(result, rule.path);
    if (current === undefined) return;
    if (rule.transform === 'round2' && typeof current === 'number') {
      result = setByPath(result, rule.path, Number(current.toFixed(2)));
    }
    if (rule.transform === 'timestamp' && typeof current === 'number') {
      result = setByPath(result, rule.path, new Date(current).toISOString());
    }
  });
  return result;
}
