import { Buffer } from 'buffer';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';

import type { ReadingChapter } from '../types/reading.ts';

const maxSourceBytes = 20 * 1024 * 1024;
const maxExtractedBytes = 100 * 1024 * 1024;
const maxEntries = 2_000;

const xmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: true,
});

export type ParsedLocalReadingFile = {
  author: string;
  chapters: ReadingChapter[];
  format: 'txt' | 'epub';
  title: string;
  warnings: string[];
};

export function parseLocalReadingFile(
  fileName: string,
  source: Uint8Array,
): ParsedLocalReadingFile {
  if (source.byteLength > maxSourceBytes) {
    throw new Error('本地图书不能超过 20 MB');
  }
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'txt') return parseTextNovel(fileName, source);
  if (extension === 'epub') return parseEPUBNovel(fileName, source);
  throw new Error('仅支持 TXT 或 EPUB 文件');
}

function parseTextNovel(fileName: string, source: Uint8Array): ParsedLocalReadingFile {
  const text = decodeText(source).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const title = metadataValue(lines, /^(?:书名|title)\s*[：:]/i)
    || fileStem(fileName);
  const author = metadataValue(lines, /^(?:作者|author)\s*[：:]/i) || '未知作者';
  const contentLines = lines.filter(
    (line) => !/^(?:书名|title|作者|author)\s*[：:]/i.test(line.trim()),
  );
  const chapters = splitTextChapters(contentLines);
  if (chapters.length === 0) throw new Error('TXT 中没有可阅读的正文');
  return { author, chapters, format: 'txt', title, warnings: [] };
}

function decodeText(source: Uint8Array) {
  if (source[0] === 0xff && source[1] === 0xfe) {
    return decodeUTF16(source.subarray(2), true);
  }
  if (source[0] === 0xfe && source[1] === 0xff) {
    return decodeUTF16(source.subarray(2), false);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return iconv.decode(Buffer.from(source), 'gb18030');
  }
}

function decodeUTF16(source: Uint8Array, littleEndian: boolean) {
  let result = '';
  for (let index = 0; index + 1 < source.length; index += 2) {
    const code = littleEndian
      ? source[index] | (source[index + 1] << 8)
      : (source[index] << 8) | source[index + 1];
    result += String.fromCharCode(code);
  }
  return result;
}

function splitTextChapters(lines: string[]): ReadingChapter[] {
  const heading = /^\s*(?:第[零〇一二三四五六七八九十百千万两0-9]+[章节回卷部篇](?:\s+|[:：、.-]*).+|chapter\s+\d+(?:\s+|[:：.-]+).+)\s*$/i;
  const chapters: ReadingChapter[] = [];
  let currentTitle = '';
  let current: string[] = [];
  const flush = () => {
    const content = normalizeBody(current.join('\n'));
    if (!content) return;
    const index = chapters.length + 1;
    chapters.push(chapterRecord(index, currentTitle || `第 ${index} 章`, content));
  };
  for (const line of lines) {
    if (heading.test(line.trim())) {
      flush();
      currentTitle = line.trim();
      current = [];
    } else {
      current.push(line);
    }
  }
  flush();
  if (chapters.length > 0) return chapters;

  const body = normalizeBody(lines.join('\n'));
  if (!body) return [];
  const chunks = body.match(/[\s\S]{1,12000}(?:\n\n|$)/g) ?? [body];
  return chunks.map((content, index) => chapterRecord(index + 1, `第 ${index + 1} 章`, content.trim()));
}

function parseEPUBNovel(fileName: string, source: Uint8Array): ParsedLocalReadingFile {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(source);
  } catch {
    throw new Error('EPUB 文件损坏或无法解压');
  }
  const names = Object.keys(archive);
  if (names.length > maxEntries) throw new Error('EPUB 文件条目过多');
  let total = 0;
  const files = new Map<string, Uint8Array>();
  for (const name of names) {
    const safe = safeArchivePath(name);
    total += archive[name].byteLength;
    if (total > maxExtractedBytes) throw new Error('EPUB 解压后不能超过 100 MB');
    files.set(safe, archive[name]);
  }

  const container = parseXML(readArchiveText(files, 'META-INF/container.xml'));
  const rootfile = first(asArray(container?.container?.rootfiles?.rootfile));
  const opfPath = safeArchivePath(attribute(rootfile, 'full-path'));
  const opf = parseXML(readArchiveText(files, opfPath));
  const pkg = opf?.package;
  if (!pkg) throw new Error('EPUB 缺少有效的 OPF 包信息');
  const base = directory(opfPath);
  const metadata = pkg.metadata ?? {};
  const title = textValue(metadata.title) || fileStem(fileName);
  const author = textValue(metadata.creator) || '未知作者';
  const manifestItems = asArray(pkg.manifest?.item);
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const item of manifestItems) {
    manifest.set(attribute(item, 'id'), {
      href: resolveArchivePath(base, attribute(item, 'href')),
      mediaType: attribute(item, 'media-type'),
      properties: attribute(item, 'properties'),
    });
  }

  const spine = pkg.spine ?? {};
  const navItem = manifestItems.find((item) => attribute(item, 'properties').split(/\s+/).includes('nav'));
  const ncxID = attribute(spine, 'toc');
  const ncxItem = manifest.get(ncxID)
    ?? [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
  let entries: { href: string; title: string }[] = [];
  if (navItem) {
    const navPath = resolveArchivePath(base, attribute(navItem, 'href'));
    entries = parseNavEntries(parseXML(readArchiveText(files, navPath)), directory(navPath));
  }
  if (entries.length === 0 && ncxItem) {
    entries = parseNCXEntries(parseXML(readArchiveText(files, ncxItem.href)), directory(ncxItem.href));
  }
  if (entries.length === 0) {
    entries = asArray(spine.itemref).flatMap((item) => {
      const manifestItem = manifest.get(attribute(item, 'idref'));
      return manifestItem ? [{ href: manifestItem.href, title: '' }] : [];
    });
  }

  const seen = new Set<string>();
  const chapters: ReadingChapter[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    const href = safeArchivePath(entry.href.split('#')[0]);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const bytes = files.get(href);
    if (!bytes) {
      warnings.push(`目录资源缺失：${href}`);
      continue;
    }
    const document = new TextDecoder().decode(bytes);
    const extracted = extractXHTML(document);
    if (!extracted.content) continue;
    chapters.push(chapterRecord(
      chapters.length + 1,
      entry.title || extracted.heading || `第 ${chapters.length + 1} 章`,
      extracted.content,
    ));
  }
  if (chapters.length === 0) throw new Error('EPUB 中没有可阅读的正文');
  return { author, chapters, format: 'epub', title, warnings };
}

function parseNavEntries(document: unknown, base: string) {
  const anchors: unknown[] = [];
  collectNamedNodes(document, 'a', anchors);
  return anchors.flatMap((node) => {
    const href = attribute(node, 'href');
    return href ? [{ href: resolveArchivePath(base, href), title: textValue(node) }] : [];
  });
}

function parseNCXEntries(document: unknown, base: string) {
  const points: unknown[] = [];
  collectNamedNodes(document, 'navPoint', points);
  return points.flatMap((point) => {
    const value = point as Record<string, unknown>;
    const href = attribute(value.content, 'src');
    return href
      ? [{ href: resolveArchivePath(base, href), title: textValue((value.navLabel as Record<string, unknown>)?.text) }]
      : [];
  });
}

function collectNamedNodes(value: unknown, target: string, result: unknown[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNamedNodes(item, target, result));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === target) result.push(...asArray(child));
    collectNamedNodes(child, target, result);
  }
}

function extractXHTML(source: string) {
  parseXML(source);
  const headingMatch = source.match(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/i);
  const heading = headingMatch ? stripMarkup(headingMatch[1]) : '';
  const content = normalizeBody(
    decodeEntities(
      source
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
  return { content, heading };
}

function parseXML(source: string): Record<string, any> {
  try {
    return xmlParser.parse(source) as Record<string, any>;
  } catch {
    throw new Error('EPUB XML 结构无效');
  }
}

function chapterRecord(index: number, title: string, content: string): ReadingChapter {
  return {
    content,
    id: `local-chapter-${index}`,
    sortOrder: index,
    title: title.trim(),
    wordCount: content.replace(/\s/g, '').length,
  };
}

function metadataValue(lines: string[], pattern: RegExp) {
  const line = lines.find((candidate) => pattern.test(candidate.trim()));
  return line?.replace(pattern, '').trim() ?? '';
}

function normalizeBody(value: string) {
  return value
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readArchiveText(files: Map<string, Uint8Array>, path: string) {
  const bytes = files.get(safeArchivePath(path));
  if (!bytes) throw new Error(`EPUB 缺少文件：${path}`);
  return new TextDecoder().decode(bytes);
}

function safeArchivePath(value: string) {
  let decoded = value.trim().replace(/\\/g, '/');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}
  const parts: string[] = [];
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error('EPUB 包含不安全的文件路径');
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (/^[a-z]:/i.test(parts[0] ?? '')) throw new Error('EPUB 包含不安全的文件路径');
  return parts.join('/');
}

function resolveArchivePath(base: string, href: string) {
  return safeArchivePath(`${base ? `${base}/` : ''}${href.split('#')[0]}`);
}

function directory(value: string) {
  const index = value.lastIndexOf('/');
  return index === -1 ? '' : value.slice(0, index);
}

function attribute(value: unknown, name: string) {
  if (!value || typeof value !== 'object') return '';
  const result = (value as Record<string, unknown>)[`@_${name}`];
  return typeof result === 'string' || typeof result === 'number' ? String(result) : '';
}

function textValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(' ').trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (record['#text'] != null) return textValue(record['#text']);
  return Object.entries(record)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, child]) => textValue(child))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function first<T>(values: T[]) {
  if (values.length === 0) throw new Error('EPUB 缺少根文档');
  return values[0];
}

function fileStem(value: string) {
  return value.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || '本地图书';
}

function stripMarkup(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return entities[entity.toLowerCase()] ?? '';
  });
}
