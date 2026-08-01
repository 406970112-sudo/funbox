import assert from 'node:assert/strict';
import test from 'node:test';

import iconv from 'iconv-lite';
import { zipSync, strToU8 } from 'fflate';

import { parseLocalReadingFile } from '../lib/reading-local-import.ts';

const novel = `书名：雾港来信
作者：林深

第一章 雾中的灯
灯塔在凌晨亮起。

第二章 旧邮局
那封信还在。`;

test('parses UTF-8, GB18030 and UTF-16 text novels', () => {
  const variants = [
    new TextEncoder().encode(novel),
    new Uint8Array(iconv.encode(novel, 'gb18030')),
    utf16LE(novel),
  ];

  for (const bytes of variants) {
    const result = parseLocalReadingFile('letter.txt', bytes);
    assert.equal(result.title, '雾港来信');
    assert.equal(result.author, '林深');
    assert.equal(result.chapters.length, 2);
    assert.equal(result.chapters[1].title, '第二章 旧邮局');
  }
});

test('parses EPUB 3 navigation and XHTML text', () => {
  const bytes = zipSync({
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package><metadata><dc:title>星河观测站</dc:title><dc:creator>顾远舟</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="c1" href="one.xhtml"/><item id="c2" href="two.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
    'OEBPS/nav.xhtml': strToU8(`<html><body><nav><ol><li><a href="one.xhtml">未知信号</a></li><li><a href="two.xhtml">父亲的笔记</a></li></ol></nav></body></html>`),
    'OEBPS/one.xhtml': strToU8(`<html><body><h1>Heading one</h1><p>凌晨两点十七分，警报响起。</p></body></html>`),
    'OEBPS/two.xhtml': strToU8(`<html><body><h1>Heading two</h1><p>旧柜最底层藏着一本笔记。</p></body></html>`),
  });

  const result = parseLocalReadingFile('stars.epub', bytes);
  assert.equal(result.title, '星河观测站');
  assert.equal(result.author, '顾远舟');
  assert.deepEqual(result.chapters.map((chapter) => chapter.title), ['未知信号', '父亲的笔记']);
  assert.match(result.chapters[0].content, /警报响起/);
});

test('parses EPUB 2 NCX labels before heading fallbacks', () => {
  const bytes = zipSync({
    'META-INF/container.xml': strToU8(`<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`),
    'OPS/package.opf': strToU8(`<package><metadata><title>Classic</title><creator>Writer</creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="one.xhtml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`),
    'OPS/toc.ncx': strToU8(`<ncx><navMap><navPoint><navLabel><text>Opening</text></navLabel><content src="one.xhtml"/></navPoint></navMap></ncx>`),
    'OPS/one.xhtml': strToU8(`<html><body><h1>Wrong heading</h1><p>First body.</p></body></html>`),
  });

  const result = parseLocalReadingFile('classic.epub', bytes);
  assert.equal(result.chapters[0].title, 'Opening');
});

test('rejects unsupported files and oversized local documents', () => {
  assert.throws(() => parseLocalReadingFile('notes.pdf', new Uint8Array([1, 2, 3])), /TXT 或 EPUB/);
  assert.throws(
    () => parseLocalReadingFile('huge.txt', new Uint8Array(21 * 1024 * 1024)),
    /20 MB/,
  );
});

function utf16LE(value) {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return bytes;
}
