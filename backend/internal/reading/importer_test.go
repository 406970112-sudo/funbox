package reading

import (
	"archive/zip"
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

func TestImporterParsesUTF8GBKAndUTF16Text(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{name: "utf8", data: []byte("书名：雾港来信\n作者：林深\n\n第一章 雾中的灯\n灯塔亮了。\n\n第二章 旧邮局\n信还在。")},
		{name: "gbk", data: encodeGBK(t, "书名：雾港来信\n作者：林深\n\n第一章 雾中的灯\n灯塔亮了。\n\n第二章 旧邮局\n信还在。")},
		{name: "utf16", data: encodeUTF16LE("书名：雾港来信\r\n作者：林深\r\n\r\n第一章 雾中的灯\r\n灯塔亮了。\r\n\r\n第二章 旧邮局\r\n信还在。")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store, importer := newTestImporter(t)
			result, err := importer.Import(context.Background(), bytes.NewReader(tc.data), "letter.txt", "admin")
			if err != nil {
				t.Fatalf("import text: %v", err)
			}
			if result.Book.Title != "雾港来信" || result.Book.Author != "林深" {
				t.Fatalf("book metadata = %+v", result.Book)
			}
			if len(result.Chapters) != 2 || result.Chapters[1].Title != "第二章 旧邮局" {
				t.Fatalf("chapters = %+v", result.Chapters)
			}
			book, err := store.GetBook(context.Background(), result.Book.ID)
			if err != nil || book.PublishStatus != StatusDraft {
				t.Fatalf("stored draft = %+v, err = %v", book, err)
			}
		})
	}
}

func TestImporterParsesEPUBNavigationAndWritesPrivateChapters(t *testing.T) {
	store, importer := newTestImporter(t)
	data := makeEPUB(t, false)
	result, err := importer.Import(context.Background(), bytes.NewReader(data), "stars.epub", "admin")
	if err != nil {
		t.Fatalf("import epub: %v", err)
	}
	if result.Book.Title != "星河观测站" || result.Book.Author != "顾远舟" {
		t.Fatalf("book = %+v", result.Book)
	}
	if len(result.Chapters) != 2 || result.Chapters[0].Title != "未知信号" || result.Chapters[1].Title != "父亲的笔记" {
		t.Fatalf("chapters = %+v", result.Chapters)
	}
	stored, err := store.ListChapters(context.Background(), result.Book.ID)
	if err != nil {
		t.Fatalf("list stored chapters: %v", err)
	}
	if stored[0].ContentPath == "" || !strings.Contains(stored[0].ContentPath, result.ImportID) {
		t.Fatalf("private chapter path = %q", stored[0].ContentPath)
	}
}

func TestImporterParsesEPUB2NCXNavigation(t *testing.T) {
	_, importer := newTestImporter(t)
	result, err := importer.Import(context.Background(), bytes.NewReader(makeEPUB2NCX(t)), "classic.epub", "admin")
	if err != nil {
		t.Fatalf("import EPUB 2: %v", err)
	}
	if len(result.Chapters) != 2 || result.Chapters[0].Title != "Opening" || result.Chapters[1].Title != "Return" {
		t.Fatalf("EPUB 2 chapters = %+v", result.Chapters)
	}
}

func TestImporterRejectsPathTraversalAndOversizedExtraction(t *testing.T) {
	_, importer := newTestImporter(t)
	if _, err := importer.Import(context.Background(), bytes.NewReader(makeEPUB(t, true)), "evil.epub", "admin"); err == nil || !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("path traversal error = %v", err)
	}

	store, err := OpenStore(filepath.Join(t.TempDir(), "small.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	small := NewImporter(store, ImporterOptions{StorageDir: t.TempDir(), MaxUploadBytes: 1 << 20, MaxExtractedBytes: 256, MaxEntries: 100, MaxCompressionRatio: 100})
	if _, err := small.Import(context.Background(), bytes.NewReader(makeEPUB(t, false)), "large.epub", "admin"); err == nil || !strings.Contains(err.Error(), "extracted") {
		t.Fatalf("extracted-size error = %v", err)
	}
}

func newTestImporter(t *testing.T) (*Store, *Importer) {
	t.Helper()
	root := t.TempDir()
	store, err := OpenStore(filepath.Join(root, "reading.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, NewImporter(store, ImporterOptions{StorageDir: filepath.Join(root, "private"), MaxUploadBytes: 2 << 20, MaxExtractedBytes: 8 << 20, MaxEntries: 200, MaxCompressionRatio: 1000})
}

func encodeGBK(t *testing.T, value string) []byte {
	t.Helper()
	result, _, err := transform.Bytes(simplifiedchinese.GB18030.NewEncoder(), []byte(value))
	if err != nil {
		t.Fatalf("encode gbk: %v", err)
	}
	return result
}

func encodeUTF16LE(value string) []byte {
	result := []byte{0xff, 0xfe}
	for _, char := range []rune(value) {
		result = append(result, byte(char), byte(char>>8))
	}
	return result
}

func makeEPUB(t *testing.T, unsafe bool) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := zip.NewWriter(buffer)
	add := func(name, content string) {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create epub entry: %v", err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write epub entry: %v", err)
		}
	}
	add("mimetype", "application/epub+zip")
	add("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
	add("OEBPS/content.opf", `<?xml version="1.0"?><package><metadata><title>星河观测站</title><creator>顾远舟</creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`)
	add("OEBPS/nav.xhtml", `<?xml version="1.0"?><html><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">未知信号</a></li><li><a href="chapter2.xhtml">父亲的笔记</a></li></ol></nav></body></html>`)
	add("OEBPS/chapter1.xhtml", `<?xml version="1.0"?><html><body><h1>未知信号</h1><p>凌晨两点十七分，警报响起。</p></body></html>`)
	add("OEBPS/chapter2.xhtml", `<?xml version="1.0"?><html><body><h1>父亲的笔记</h1><p>旧柜最底层藏着一本笔记。</p></body></html>`)
	if unsafe {
		add("../escape.txt", "blocked")
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close epub: %v", err)
	}
	return buffer.Bytes()
}

func makeEPUB2NCX(t *testing.T) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := zip.NewWriter(buffer)
	add := func(name, content string) {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create EPUB 2 entry: %v", err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write EPUB 2 entry: %v", err)
		}
	}
	add("mimetype", "application/epub+zip")
	add("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`)
	add("OPS/package.opf", `<?xml version="1.0"?><package><metadata><title>Classic</title><creator>Writer</creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>`)
	add("OPS/toc.ncx", `<?xml version="1.0"?><ncx><navMap><navPoint><navLabel><text>Opening</text></navLabel><content src="one.xhtml"/></navPoint><navPoint><navLabel><text>Return</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>`)
	add("OPS/one.xhtml", `<?xml version="1.0"?><html><body><h1>Wrong heading one</h1><p>First body.</p></body></html>`)
	add("OPS/two.xhtml", `<?xml version="1.0"?><html><body><h1>Wrong heading two</h1><p>Second body.</p></body></html>`)
	if err := writer.Close(); err != nil {
		t.Fatalf("close EPUB 2: %v", err)
	}
	return buffer.Bytes()
}
