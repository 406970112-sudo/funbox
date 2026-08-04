package priceradar

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	provider      *Provider
	store         *Store
	storageDir    string
	maxImageBytes int64
	maxImages     int
	publicBaseURL string
}

func NewService(
	provider *Provider,
	store *Store,
	storageDir string,
	maxImageBytes int64,
	maxImages int,
	publicBaseURL string,
) *Service {
	if storageDir == "" {
		storageDir = "data/price-radar"
	}
	if maxImageBytes <= 0 {
		maxImageBytes = 5 << 20
	}
	if maxImages <= 0 {
		maxImages = 3
	}
	return &Service{
		provider:      provider,
		store:         store,
		storageDir:    storageDir,
		maxImageBytes: maxImageBytes,
		maxImages:     maxImages,
		publicBaseURL: strings.TrimRight(strings.TrimSpace(publicBaseURL), "/"),
	}
}

func (s *Service) Search(ctx context.Context, query, provinceCode string) (SearchResult, error) {
	product, err := s.provider.SearchProduct(ctx, query)
	if err != nil {
		return SearchResult{}, err
	}
	return s.buildProductResult(ctx, product, provinceCode)
}

func (s *Service) ProductDetail(ctx context.Context, productID, provinceCode string) (SearchResult, error) {
	product, err := s.provider.ProductByID(ctx, productID)
	if err != nil {
		return SearchResult{}, err
	}
	return s.buildProductResult(ctx, product, provinceCode)
}

func (s *Service) buildProductResult(ctx context.Context, product Product, provinceCode string) (SearchResult, error) {
	markets, err := s.provider.MarketsByProvince(ctx, provinceCode)
	if err != nil {
		return SearchResult{}, err
	}
	marketIDs := make([]string, 0, len(markets))
	for _, market := range markets {
		marketIDs = append(marketIDs, market.ID)
	}
	official, err := s.provider.OfficialPrices(ctx, product.ID, marketIDs, provinceCode)
	if err != nil {
		return SearchResult{}, err
	}
	reports, _, err := s.store.ListReports(ctx, product.ID, false, 30, 0)
	if err != nil {
		return SearchResult{}, err
	}
	s.withReportURLs(reports)
	now := time.Now().UTC().Format(time.RFC3339)
	return SearchResult{
		Product:           product,
		OfficialReference: official,
		NearbyReports:     reports,
		Sources:           s.sources(official),
		FetchedAt:         now,
	}, nil
}

func (s *Service) CreateReport(
	ctx context.Context,
	userID string,
	input CreateReportInput,
	uploads []Upload,
) (Report, error) {
	input.StoreName = strings.TrimSpace(input.StoreName)
	input.PurchaseDate = strings.TrimSpace(input.PurchaseDate)
	if input.ProductID == "" || input.StoreName == "" || input.Price <= 0 || input.Unit == "" || input.PurchaseDate == "" {
		return Report{}, fmt.Errorf("%w: report fields required", ErrInvalidInput)
	}
	if len(uploads) > s.maxImages {
		return Report{}, ErrImagesTooMany
	}
	images, err := s.writeEvidence(uploads, "reports")
	if err != nil {
		return Report{}, err
	}
	report := Report{
		ID:           uuid.NewString(),
		ProductID:    input.ProductID,
		ProductName:  input.ProductName,
		StoreName:    input.StoreName,
		StoreType:    input.StoreType,
		Address:      input.Address,
		Price:        input.Price,
		Unit:         input.Unit,
		PurchaseDate: input.PurchaseDate,
		Latitude:     input.Latitude,
		Longitude:    input.Longitude,
		Status:       ReportStatusPending,
		User:         UserSummary{ID: userID},
		CreatedAt:    time.Now().UTC(),
	}
	for index := range images {
		images[index].ReportID = report.ID
	}
	created, err := s.store.CreateReport(ctx, report, images)
	if err != nil {
		s.removeEvidenceFiles(images)
		return Report{}, err
	}
	created.User = report.User
	s.withReportURLs([]Report{created})
	return created, nil
}

func (s *Service) GetEvidence(ctx context.Context, reportID, evidenceID string) (Evidence, string, error) {
	image, err := s.store.GetEvidence(ctx, reportID, evidenceID)
	if err != nil {
		return Evidence{}, "", err
	}
	return image, filepath.Join(s.storageDir, "reports", image.StoredName), nil
}

func (s *Service) GetObjectionEvidence(ctx context.Context, evidenceID string) (Evidence, string, error) {
	image, err := s.store.GetObjectionEvidence(ctx, evidenceID)
	if err != nil {
		return Evidence{}, "", err
	}
	return image, filepath.Join(s.storageDir, "objections", image.StoredName), nil
}

func (s *Service) CreateComment(ctx context.Context, userID string, input CreateCommentInput) (Comment, error) {
	input.Body = strings.TrimSpace(input.Body)
	if input.ReportID == "" || input.Body == "" {
		return Comment{}, fmt.Errorf("%w: comment fields required", ErrInvalidInput)
	}
	if len([]rune(input.Body)) > 500 {
		return Comment{}, fmt.Errorf("%w: comment too long", ErrInvalidInput)
	}
	comment := Comment{
		ID:        uuid.NewString(),
		ReportID:  input.ReportID,
		User:      UserSummary{ID: userID},
		Body:      input.Body,
		Status:    "active",
		CreatedAt: time.Now().UTC(),
	}
	if err := s.store.CreateComment(ctx, comment); err != nil {
		return Comment{}, err
	}
	return comment, nil
}

func (s *Service) CreateObjection(ctx context.Context, userID string, input CreateObjectionInput) (Objection, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	input.Body = strings.TrimSpace(input.Body)
	if input.ReportID == "" || input.Reason == "" {
		return Objection{}, fmt.Errorf("%w: objection fields required", ErrInvalidInput)
	}
	if len(input.Images) > s.maxImages {
		return Objection{}, ErrImagesTooMany
	}
	images, err := s.writeEvidence(input.Images, "objections")
	if err != nil {
		return Objection{}, err
	}
	objection := Objection{
		ID:        uuid.NewString(),
		ReportID:  input.ReportID,
		User:      UserSummary{ID: userID},
		Reason:    input.Reason,
		Body:      input.Body,
		Status:    ObjectionStatusPending,
		CreatedAt: time.Now().UTC(),
	}
	for index := range images {
		images[index].ReportID = objection.ID
	}
	if err := s.store.CreateObjection(ctx, objection, images); err != nil {
		s.removeEvidenceFiles(images)
		return Objection{}, err
	}
	objection.Images = images
	s.withEvidenceURLs(objection.Images, "objections")
	return objection, nil
}

func (s *Service) Discussions(ctx context.Context, reportID string) (map[string]any, error) {
	comments, err := s.store.ListComments(ctx, reportID)
	if err != nil {
		return nil, err
	}
	objections, err := s.store.ListObjections(ctx, reportID)
	if err != nil {
		return nil, err
	}
	for index := range objections {
		s.withEvidenceURLs(objections[index].Images, "objections")
	}
	return map[string]any{
		"comments":   comments,
		"objections": objections,
	}, nil
}

func (s *Service) MyContributions(ctx context.Context, userID string) (map[string]any, error) {
	reports, err := s.store.ListMyReports(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.withReportURLs(reports)
	return map[string]any{"reports": reports}, nil
}

func (s *Service) AdminPending(ctx context.Context) (map[string]any, error) {
	reports, err := s.store.ListPendingReports(ctx)
	if err != nil {
		return nil, err
	}
	objections, err := s.store.ListPendingObjections(ctx)
	if err != nil {
		return nil, err
	}
	s.withReportURLs(reports)
	for index := range objections {
		s.withEvidenceURLs(objections[index].Images, "objections")
	}
	return map[string]any{
		"reports":    reports,
		"objections": objections,
	}, nil
}

func (s *Service) AdminDecideReport(ctx context.Context, reportID, action, reviewerID, note string) error {
	if action != "approve" && action != "reject" && action != "offline" {
		return fmt.Errorf("%w: invalid report decision", ErrInvalidInput)
	}
	return s.store.DecideReport(ctx, reportID, action, reviewerID, note)
}

func (s *Service) AdminDecideObjection(ctx context.Context, objectionID, action, reviewerID, resolution string) error {
	if action != "support" && action != "keep" {
		return fmt.Errorf("%w: invalid objection decision", ErrInvalidInput)
	}
	return s.store.DecideObjection(ctx, objectionID, action, reviewerID, resolution)
}

func (s *Service) Sources(ctx context.Context) []SourceStatus {
	_ = ctx
	return s.sources(nil)
}

func (s *Service) Reports(
	ctx context.Context,
	productID string,
	includePending bool,
	limit int,
	offset int,
) (map[string]any, error) {
	reports, total, err := s.store.ListReports(ctx, productID, includePending, limit, offset)
	if err != nil {
		return nil, err
	}
	s.withReportURLs(reports)
	return map[string]any{
		"items": reports,
		"total": total,
	}, nil
}

func (s *Service) sources(official []OfficialPrice) []SourceStatus {
	officialStatus := "已配置"
	updatedAt := "以官方发布为准"
	if len(official) > 0 {
		officialStatus = "今日已更新"
		updatedAt = official[0].CapturedAt
	}
	return []SourceStatus{
		{
			ID:        "pfsc",
			Name:      "农业农村部信息中心",
			Kind:      "official",
			Status:    officialStatus,
			UpdatedAt: updatedAt,
			Detail:    "全国农产品批发市场价格信息系统 · 批发市场日度价 · 元/公斤",
		},
		{
			ID:        "local-monitor",
			Name:      "地方发改委 / 商务局",
			Kind:      "official",
			Status:    "以官方发布为准",
			UpdatedAt: "",
			Detail:    "城市级零售监测均价 · 农贸市场与超市分列 · 元/500克",
		},
		{
			ID:        "partner",
			Name:      "合作商户开放接口",
			Kind:      "partner",
			Status:    "未接入不展示",
			UpdatedAt: "",
			Detail:    "仅展示正式授权商户；未接入区域不展示",
		},
		{
			ID:        "user-evidence",
			Name:      "用户凭证",
			Kind:      "user",
			Status:    "人工核验",
			UpdatedAt: "",
			Detail:    "小票/发票 + 结构化信息 · 待核验 / 已核验 / 已驳回",
		},
	}
}

func (s *Service) writeEvidence(uploads []Upload, folder string) ([]Evidence, error) {
	if len(uploads) == 0 {
		return nil, nil
	}
	dir := filepath.Join(s.storageDir, folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create price radar storage directory: %w", err)
	}
	images := make([]Evidence, 0, len(uploads))
	written := make([]string, 0, len(uploads))
	cleanup := func() {
		for _, path := range written {
			_ = os.Remove(path)
		}
	}
	for index, upload := range uploads {
		data, err := io.ReadAll(io.LimitReader(upload.Reader, s.maxImageBytes+1))
		if err != nil {
			cleanup()
			return nil, fmt.Errorf("read price radar evidence: %w", err)
		}
		if int64(len(data)) > s.maxImageBytes {
			cleanup()
			return nil, ErrImageTooLarge
		}
		contentType := http.DetectContentType(data)
		switch contentType {
		case "image/jpeg", "image/png", "image/webp":
		default:
			cleanup()
			return nil, ErrImageTypeInvalid
		}
		id := uuid.NewString()
		extension := extensionFor(contentType)
		storedName := id + extension
		path := filepath.Join(dir, storedName)
		if err := writeFileAtomically(path, data); err != nil {
			cleanup()
			return nil, fmt.Errorf("write price radar evidence: %w", err)
		}
		written = append(written, path)
		images = append(images, Evidence{
			ID:          id,
			StoredName:  storedName,
			ContentType: contentType,
			SizeBytes:   int64(len(data)),
			Visibility:  EvidenceVisibilityPublic,
			SortOrder:   index,
		})
	}
	return images, nil
}

func (s *Service) removeEvidenceFiles(images []Evidence) {
	for _, image := range images {
		_ = os.Remove(filepath.Join(s.storageDir, "reports", image.StoredName))
		_ = os.Remove(filepath.Join(s.storageDir, "objections", image.StoredName))
	}
}

func (s *Service) withReportURLs(reports []Report) {
	for index := range reports {
		s.withEvidenceURLs(reports[index].Images, "reports")
	}
}

func (s *Service) withEvidenceURLs(images []Evidence, folder string) {
	for index := range images {
		urlPath := fmt.Sprintf("/api/v1/price-radar/evidence/%s/%s", images[index].ReportID, images[index].ID)
		if folder == "objections" {
			urlPath = fmt.Sprintf("/api/v1/price-radar/objection-evidence/%s", images[index].ID)
		}
		if s.publicBaseURL != "" {
			urlPath = s.publicBaseURL + urlPath
		}
		images[index].URL = urlPath
	}
}

func extensionFor(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

func writeFileAtomically(path string, data []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".price-radar-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}
