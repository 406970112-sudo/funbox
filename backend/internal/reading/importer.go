package reading

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/text/encoding/simplifiedchinese"
	unicodeencoding "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

type ImporterOptions struct {
	StorageDir          string
	MaxUploadBytes      int64
	MaxExtractedBytes   int64
	MaxEntries          int
	MaxCompressionRatio float64
}

type Importer struct {
	store   *Store
	options ImporterOptions
}

type parsedBook struct {
	Title    string
	Author   string
	Chapters []parsedChapter
	Warnings []string
}

type parsedChapter struct {
	Title   string
	Content string
}

func NewImporter(store *Store, options ImporterOptions) *Importer {
	if options.MaxUploadBytes <= 0 {
		options.MaxUploadBytes = 50 << 20
	}
	if options.MaxExtractedBytes <= 0 {
		options.MaxExtractedBytes = 200 << 20
	}
	if options.MaxEntries <= 0 {
		options.MaxEntries = 2000
	}
	if options.MaxCompressionRatio <= 0 {
		options.MaxCompressionRatio = 1000
	}
	return &Importer{store: store, options: options}
}

func (i *Importer) Import(ctx context.Context, source io.Reader, fileName, actorID string) (ImportResult, error) {
	fileName = filepath.Base(strings.TrimSpace(fileName))
	extension := strings.ToLower(filepath.Ext(fileName))
	if extension != ".txt" && extension != ".epub" {
		return ImportResult{}, errors.New("only TXT and EPUB files are supported")
	}
	data, err := io.ReadAll(io.LimitReader(source, i.options.MaxUploadBytes+1))
	if err != nil {
		return ImportResult{}, fmt.Errorf("read uploaded book: %w", err)
	}
	if int64(len(data)) > i.options.MaxUploadBytes {
		return ImportResult{}, fmt.Errorf("uploaded book exceeds %d bytes", i.options.MaxUploadBytes)
	}
	if len(data) == 0 {
		return ImportResult{}, errors.New("uploaded book is empty")
	}

	var parsed parsedBook
	if extension == ".txt" {
		parsed, err = parseTXT(data, strings.TrimSuffix(fileName, extension))
	} else {
		parsed, err = i.parseEPUB(data, strings.TrimSuffix(fileName, extension))
	}
	if err != nil {
		return ImportResult{}, err
	}
	if len(parsed.Chapters) == 0 {
		return ImportResult{}, errors.New("book contains no readable chapters")
	}

	importID := uuid.NewString()
	bookID := "admin-" + uuid.NewString()
	root := filepath.Join(i.options.StorageDir, "imports", importID)
	chapterRoot := filepath.Join(root, "chapters")
	if err := os.MkdirAll(chapterRoot, 0o700); err != nil {
		return ImportResult{}, fmt.Errorf("create private import directory: %w", err)
	}
	originalPath := filepath.Join(root, "original"+extension)
	if err := os.WriteFile(originalPath, data, 0o600); err != nil {
		return ImportResult{}, fmt.Errorf("store original book: %w", err)
	}

	chapters := make([]Chapter, 0, len(parsed.Chapters))
	totalWords := 0
	for index, item := range parsed.Chapters {
		chapterID := uuid.NewString()
		chapterPath := filepath.Join(chapterRoot, fmt.Sprintf("%05d-%s.txt", index+1, chapterID))
		content := strings.TrimSpace(item.Content)
		if err := os.WriteFile(chapterPath, []byte(content), 0o600); err != nil {
			return ImportResult{}, fmt.Errorf("store chapter %d: %w", index+1, err)
		}
		hash := sha256.Sum256([]byte(content))
		wordCount := utf8.RuneCountInString(content)
		totalWords += wordCount
		chapters = append(chapters, Chapter{ID: chapterID, BookID: bookID, Title: item.Title,
			SortOrder: index + 1, WordCount: wordCount, ContentPath: chapterPath,
			ContentHash: hex.EncodeToString(hash[:]), Status: "ready"})
	}
	book := Book{ID: bookID, SourceType: SourceAdmin, Title: fallback(parsed.Title, strings.TrimSuffix(fileName, extension)),
		Author: fallback(parsed.Author, "未知作者"), Intro: "管理员上传内容，发布前请完成元数据与版权审核。",
		Category: "文学", Tags: []string{}, SerialStatus: "completed", PublishStatus: StatusDraft,
		AllowOffline: true, WordCount: totalWords}
	if err := i.store.UpsertBook(ctx, book, chapters, nil); err != nil {
		return ImportResult{}, err
	}
	job := ImportJob{ID: importID, BookID: bookID, FileName: fileName, FilePath: originalPath,
		Format: strings.TrimPrefix(extension, "."), Status: "completed", Warnings: parsed.Warnings,
		CreatedBy: actorID, CreatedAt: book.CreatedAt, UpdatedAt: book.UpdatedAt}
	if job.CreatedAt.IsZero() {
		job.CreatedAt = timeNowUTC()
		job.UpdatedAt = job.CreatedAt
	}
	if err := i.store.SaveImportJob(ctx, job); err != nil {
		return ImportResult{}, err
	}
	storedBook, err := i.store.GetBook(ctx, bookID)
	if err != nil {
		return ImportResult{}, err
	}
	return ImportResult{ImportID: importID, Book: storedBook, Chapters: chapters, Warnings: parsed.Warnings}, nil
}

var (
	titleLinePattern  = regexp.MustCompile(`(?i)^\s*(?:书名|title)\s*[：:]\s*(.+?)\s*$`)
	authorLinePattern = regexp.MustCompile(`(?i)^\s*(?:作者|author)\s*[：:]\s*(.+?)\s*$`)
	chapterPattern    = regexp.MustCompile(`^\s*((?:第[0-9一二三四五六七八九十百千万零〇两]+[章回卷节部集篇][^\r\n]{0,40})|(?:chapter\s+[0-9ivxlcdm]+[^\r\n]{0,40}))\s*$`)
)

func parseTXT(data []byte, fallbackTitle string) (parsedBook, error) {
	text, encodingName, err := decodeText(data)
	if err != nil {
		return parsedBook{}, err
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	result := parsedBook{Title: fallbackTitle, Warnings: []string{"检测到文本编码：" + encodingName}}
	for _, line := range lines[:minInt(len(lines), 24)] {
		if match := titleLinePattern.FindStringSubmatch(line); len(match) == 2 {
			result.Title = strings.TrimSpace(match[1])
		}
		if match := authorLinePattern.FindStringSubmatch(line); len(match) == 2 {
			result.Author = strings.TrimSpace(match[1])
		}
	}

	type boundary struct {
		index int
		title string
	}
	boundaries := make([]boundary, 0)
	for index, line := range lines {
		if match := chapterPattern.FindStringSubmatch(strings.TrimSpace(line)); len(match) == 2 {
			boundaries = append(boundaries, boundary{index: index, title: strings.TrimSpace(match[1])})
		}
	}
	if len(boundaries) > 0 {
		for index, item := range boundaries {
			end := len(lines)
			if index+1 < len(boundaries) {
				end = boundaries[index+1].index
			}
			content := strings.TrimSpace(strings.Join(lines[item.index+1:end], "\n"))
			if content != "" {
				result.Chapters = append(result.Chapters, parsedChapter{Title: item.title, Content: content})
			}
		}
	} else {
		clean := stripTXTMetadata(lines)
		chunks := splitByRunes(clean, 8000)
		for index, chunk := range chunks {
			result.Chapters = append(result.Chapters, parsedChapter{Title: fmt.Sprintf("第%d节", index+1), Content: chunk})
		}
		result.Warnings = append(result.Warnings, "未识别到章节标题，已按篇幅分段，请人工检查。")
	}
	return result, nil
}

func decodeText(data []byte) (string, string, error) {
	if bytes.HasPrefix(data, []byte{0xff, 0xfe}) {
		decoded, _, err := transform.Bytes(unicodeencoding.UTF16(unicodeencoding.LittleEndian, unicodeencoding.ExpectBOM).NewDecoder(), data)
		return string(decoded), "UTF-16LE", err
	}
	if bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
		decoded, _, err := transform.Bytes(unicodeencoding.UTF16(unicodeencoding.BigEndian, unicodeencoding.ExpectBOM).NewDecoder(), data)
		return string(decoded), "UTF-16BE", err
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if utf8.Valid(data) {
		return string(data), "UTF-8", nil
	}
	decoded, _, err := transform.Bytes(simplifiedchinese.GB18030.NewDecoder(), data)
	if err != nil || !utf8.Valid(decoded) {
		return "", "", errors.New("TXT encoding is not supported")
	}
	return string(decoded), "GB18030/GBK", nil
}

type containerDocument struct {
	RootFiles []struct {
		FullPath string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}

type packageDocument struct {
	Metadata struct {
		Title   string `xml:"title"`
		Creator string `xml:"creator"`
	} `xml:"metadata"`
	Manifest []struct {
		ID         string `xml:"id,attr"`
		Href       string `xml:"href,attr"`
		MediaType  string `xml:"media-type,attr"`
		Properties string `xml:"properties,attr"`
	} `xml:"manifest>item"`
	Spine struct {
		TOC   string `xml:"toc,attr"`
		Items []struct {
			IDRef string `xml:"idref,attr"`
		} `xml:"itemref"`
	} `xml:"spine"`
}

type navEntry struct {
	Href  string
	Title string
}

func (i *Importer) parseEPUB(data []byte, fallbackTitle string) (parsedBook, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return parsedBook{}, fmt.Errorf("open EPUB: %w", err)
	}
	if len(reader.File) > i.options.MaxEntries {
		return parsedBook{}, fmt.Errorf("EPUB contains too many entries: %d", len(reader.File))
	}
	files := make(map[string]*zip.File, len(reader.File))
	var extracted uint64
	for _, file := range reader.File {
		clean, err := safeArchivePath(file.Name)
		if err != nil {
			return parsedBook{}, err
		}
		extracted += file.UncompressedSize64
		if extracted > uint64(i.options.MaxExtractedBytes) {
			return parsedBook{}, fmt.Errorf("EPUB extracted content exceeds %d bytes", i.options.MaxExtractedBytes)
		}
		if file.UncompressedSize64 > 0 {
			if file.CompressedSize64 == 0 || float64(file.UncompressedSize64)/float64(file.CompressedSize64) > i.options.MaxCompressionRatio {
				return parsedBook{}, fmt.Errorf("EPUB entry has an unsafe compression ratio: %s", file.Name)
			}
		}
		files[clean] = file
	}
	containerBytes, err := readArchiveFile(files, "META-INF/container.xml")
	if err != nil {
		return parsedBook{}, errors.New("EPUB is missing META-INF/container.xml")
	}
	var container containerDocument
	if err := xml.Unmarshal(containerBytes, &container); err != nil || len(container.RootFiles) == 0 {
		return parsedBook{}, errors.New("EPUB container is invalid")
	}
	opfPath, err := safeArchivePath(container.RootFiles[0].FullPath)
	if err != nil {
		return parsedBook{}, err
	}
	opfBytes, err := readArchiveFile(files, opfPath)
	if err != nil {
		return parsedBook{}, errors.New("EPUB package document is missing")
	}
	var pkg packageDocument
	if err := xml.Unmarshal(opfBytes, &pkg); err != nil {
		return parsedBook{}, fmt.Errorf("parse EPUB package: %w", err)
	}
	base := path.Dir(opfPath)
	manifestByID := make(map[string]string, len(pkg.Manifest))
	navPath := ""
	ncxPath := ""
	for _, item := range pkg.Manifest {
		resolved, err := resolveArchivePath(base, item.Href)
		if err != nil {
			return parsedBook{}, err
		}
		manifestByID[item.ID] = resolved
		if containsWord(item.Properties, "nav") {
			navPath = resolved
		}
		if item.ID == pkg.Spine.TOC || strings.EqualFold(item.MediaType, "application/x-dtbncx+xml") {
			ncxPath = resolved
		}
	}
	entries := make([]navEntry, 0)
	if navPath != "" {
		if navBytes, err := readArchiveFile(files, navPath); err == nil {
			entries = parseNavDocument(navBytes, path.Dir(navPath))
		}
	}
	if len(entries) == 0 && ncxPath != "" {
		if ncxBytes, err := readArchiveFile(files, ncxPath); err == nil {
			entries = parseNCXDocument(ncxBytes, path.Dir(ncxPath))
		}
	}
	if len(entries) == 0 {
		for _, item := range pkg.Spine.Items {
			if href := manifestByID[item.IDRef]; href != "" {
				entries = append(entries, navEntry{Href: href})
			}
		}
	}
	result := parsedBook{Title: fallback(strings.TrimSpace(pkg.Metadata.Title), fallbackTitle), Author: strings.TrimSpace(pkg.Metadata.Creator), Warnings: []string{}}
	seen := make(map[string]struct{})
	for index, entry := range entries {
		href := strings.Split(entry.Href, "#")[0]
		resolved, err := resolveArchivePath("", href)
		if err != nil {
			return parsedBook{}, err
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		chapterBytes, err := readArchiveFile(files, resolved)
		if err != nil {
			result.Warnings = append(result.Warnings, "目录资源缺失："+resolved)
			continue
		}
		content, heading := extractXHTMLText(chapterBytes)
		if strings.TrimSpace(content) == "" {
			continue
		}
		title := fallback(strings.TrimSpace(entry.Title), heading)
		title = fallback(title, fmt.Sprintf("第%d章", index+1))
		result.Chapters = append(result.Chapters, parsedChapter{Title: title, Content: content})
	}
	if len(result.Chapters) == 0 {
		return parsedBook{}, errors.New("EPUB contains no readable document content")
	}
	return result, nil
}

func parseNavDocument(data []byte, base string) []navEntry {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	entries := make([]navEntry, 0)
	var current *navEntry
	var text strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return entries
		}
		switch item := token.(type) {
		case xml.StartElement:
			if strings.EqualFold(item.Name.Local, "a") {
				entry := navEntry{}
				for _, attribute := range item.Attr {
					if strings.EqualFold(attribute.Name.Local, "href") {
						if resolved, err := resolveArchivePath(base, attribute.Value); err == nil {
							entry.Href = resolved
						}
					}
				}
				current = &entry
				text.Reset()
			}
		case xml.CharData:
			if current != nil {
				text.Write([]byte(item))
			}
		case xml.EndElement:
			if strings.EqualFold(item.Name.Local, "a") && current != nil {
				current.Title = normalizeWhitespace(text.String())
				if current.Href != "" {
					entries = append(entries, *current)
				}
				current = nil
			}
		}
	}
	return entries
}

func parseNCXDocument(data []byte, base string) []navEntry {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	entries := make([]navEntry, 0)
	var current *navEntry
	inLabel := false
	var label strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return entries
		}
		switch item := token.(type) {
		case xml.StartElement:
			switch strings.ToLower(item.Name.Local) {
			case "navpoint":
				current = &navEntry{}
				label.Reset()
			case "text":
				if current != nil {
					inLabel = true
				}
			case "content":
				if current != nil {
					for _, attribute := range item.Attr {
						if strings.EqualFold(attribute.Name.Local, "src") {
							if resolved, err := resolveArchivePath(base, attribute.Value); err == nil {
								current.Href = resolved
							}
						}
					}
				}
			}
		case xml.CharData:
			if current != nil && inLabel {
				label.Write([]byte(item))
			}
		case xml.EndElement:
			switch strings.ToLower(item.Name.Local) {
			case "text":
				inLabel = false
			case "navpoint":
				if current != nil {
					current.Title = normalizeWhitespace(label.String())
					if current.Href != "" {
						entries = append(entries, *current)
					}
				}
				current = nil
				inLabel = false
			}
		}
	}
	return entries
}

func extractXHTMLText(data []byte) (string, string) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var content strings.Builder
	heading := ""
	skipDepth := 0
	inHeading := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch item := token.(type) {
		case xml.StartElement:
			name := strings.ToLower(item.Name.Local)
			if name == "script" || name == "style" {
				skipDepth++
			}
			if name == "h1" || name == "h2" {
				inHeading = true
			}
		case xml.CharData:
			if skipDepth == 0 {
				value := normalizeWhitespace(string(item))
				if value != "" {
					if inHeading && heading == "" {
						heading = value
					}
					content.WriteString(value)
					content.WriteByte(' ')
				}
			}
		case xml.EndElement:
			name := strings.ToLower(item.Name.Local)
			if name == "script" || name == "style" {
				if skipDepth > 0 {
					skipDepth--
				}
			}
			if name == "h1" || name == "h2" {
				inHeading = false
			}
			if skipDepth == 0 && (name == "p" || name == "div" || name == "h1" || name == "h2" || name == "br") {
				content.WriteString("\n\n")
			}
		}
	}
	return strings.TrimSpace(regexp.MustCompile(`\n{3,}`).ReplaceAllString(content.String(), "\n\n")), heading
}

func safeArchivePath(value string) (string, error) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if value == "" || strings.HasPrefix(value, "/") || regexp.MustCompile(`^[A-Za-z]:`).MatchString(value) {
		return "", fmt.Errorf("unsafe EPUB path: %q", value)
	}
	clean := path.Clean(value)
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("unsafe EPUB path: %q", value)
	}
	return clean, nil
}

func resolveArchivePath(base, href string) (string, error) {
	href = strings.Split(strings.TrimSpace(href), "#")[0]
	decoded, err := urlPathUnescape(href)
	if err == nil {
		href = decoded
	}
	return safeArchivePath(path.Join(base, href))
}

func readArchiveFile(files map[string]*zip.File, name string) ([]byte, error) {
	file, ok := files[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func stripTXTMetadata(lines []string) string {
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		if titleLinePattern.MatchString(line) || authorLinePattern.MatchString(line) {
			continue
		}
		filtered = append(filtered, line)
	}
	return strings.TrimSpace(strings.Join(filtered, "\n"))
}

func splitByRunes(value string, size int) []string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) == 0 {
		return nil
	}
	result := make([]string, 0, (len(runes)+size-1)/size)
	for start := 0; start < len(runes); start += size {
		end := minInt(start+size, len(runes))
		result = append(result, strings.TrimSpace(string(runes[start:end])))
	}
	return result
}

func normalizeWhitespace(value string) string { return strings.Join(strings.Fields(value), " ") }

func containsWord(value, wanted string) bool {
	for _, part := range strings.Fields(value) {
		if part == wanted {
			return true
		}
	}
	return false
}

func fallback(value, alternative string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(alternative)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func timeNowUTC() time.Time { return time.Now().UTC() }

func urlPathUnescape(value string) (string, error) {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value, err
	}
	return decoded, nil
}
