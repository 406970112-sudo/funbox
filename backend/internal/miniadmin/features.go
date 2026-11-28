package miniadmin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"my-first-expo-app/backend/internal/roles"
)

var (
	ErrFeatureNotFound = errors.New("mini-program feature not found")
	ErrFeatureInvalid  = errors.New("invalid mini-program feature settings")
	ErrFeatureChanged  = errors.New("mini-program feature settings changed")
)

type FeatureSettings struct {
	Enabled           bool     `json:"enabled"`
	VisiblePlacements []string `json:"visiblePlacements"`
	Audience          string   `json:"audience"`
	Maintenance       bool     `json:"maintenance"`
}

type Feature struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Placements []string `json:"placements"`
	Revision   int      `json:"revision"`
	FeatureSettings
}

var featureCatalog = []struct {
	id         string
	name       string
	placements []string
}{
	{"mahjong", "麻将计分", []string{"home"}},
	{"poker", "炸金花", []string{"home"}},
	{"general", "通用计分", []string{"home"}},
	{"room-join", "加入房间", []string{"home", "score"}},
	{"room-resume", "继续牌局", []string{"home"}},
	{"notebook", "笔记本", []string{"home", "discover", "profile", "recent"}},
	{"memes", "表情包", []string{"home", "discover", "profile", "recent"}},
	{"holidays", "节假日倒计时", []string{"home", "discover", "recent"}},
	{"lottery", "彩票开奖查询", []string{"home", "discover", "recent"}},
	{"game-history", "牌局记录", []string{"profile"}},
	{"feedback", "功能反馈", []string{"profile"}},
	{"website", "更多网页版功能", []string{"home"}},
}

func (s *Store) ListFeatures(ctx context.Context) ([]Feature, error) {
	features := make([]Feature, 0, len(featureCatalog))
	positions := make(map[string]int, len(featureCatalog))
	for _, definition := range featureCatalog {
		positions[definition.id] = len(features)
		feature, _ := defaultFeature(definition.id)
		features = append(features, feature)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT feature_id, settings, revision FROM mini_feature_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, settings string
		var revision int
		if err := rows.Scan(&id, &settings, &revision); err != nil {
			return nil, err
		}
		position, ok := positions[id]
		if ok {
			if err := applySettings(&features[position], settings, revision); err != nil {
				return nil, err
			}
		}
	}
	return features, rows.Err()
}

func (s *Store) GetFeature(ctx context.Context, id string) (Feature, error) {
	return getFeature(ctx, s.db, id)
}

func (s *Store) UpdateFeature(ctx context.Context, id, operatorID string, revision int, settings FeatureSettings) (Feature, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Feature{}, err
	}
	defer tx.Rollback()
	current, err := getFeature(ctx, tx, id)
	if err != nil {
		return Feature{}, err
	}
	if revision != current.Revision {
		return Feature{}, ErrFeatureChanged
	}
	if !validSettings(current.Placements, settings) {
		return Feature{}, ErrFeatureInvalid
	}
	if current.Enabled == settings.Enabled && current.Audience == settings.Audience &&
		current.Maintenance == settings.Maintenance && slices.Equal(current.VisiblePlacements, settings.VisiblePlacements) {
		return current, nil
	}

	previous, _ := json.Marshal(current.FeatureSettings)
	next, _ := json.Marshal(settings)
	current.Revision++
	_, err = tx.ExecContext(ctx, `INSERT INTO mini_feature_settings(feature_id, settings, revision)
		VALUES (?, ?, ?) ON CONFLICT(feature_id) DO UPDATE SET settings = excluded.settings, revision = excluded.revision`,
		id, string(next), current.Revision)
	if err != nil {
		return Feature{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO mini_feature_changes
		(feature_id, operator_id, previous_settings, settings, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, operatorID, string(previous), string(next), time.Now().UnixMilli())
	if err != nil {
		return Feature{}, err
	}
	current.FeatureSettings = settings
	return current, tx.Commit()
}

func (f Feature) Allows(role roles.Role) bool {
	switch f.Audience {
	case "all":
		return true
	case "signed_in":
		return roles.IsValid(role)
	case "vip":
		return role == roles.VIP || role == roles.SVIP
	case "svip":
		return role == roles.SVIP
	default:
		return false
	}
}

func defaultFeature(id string) (Feature, error) {
	for _, definition := range featureCatalog {
		if definition.id == id {
			return Feature{
				ID: id, Name: definition.name, Placements: slices.Clone(definition.placements),
				FeatureSettings: FeatureSettings{
					Enabled: id != "website", Audience: "all", VisiblePlacements: slices.Clone(definition.placements),
				},
			}, nil
		}
	}
	return Feature{}, ErrFeatureNotFound
}

func getFeature(ctx context.Context, db rowQueryer, id string) (Feature, error) {
	feature, err := defaultFeature(id)
	if err != nil {
		return Feature{}, err
	}
	var settings string
	var revision int
	err = db.QueryRowContext(ctx, `SELECT settings, revision FROM mini_feature_settings WHERE feature_id = ?`, id).
		Scan(&settings, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return feature, nil
	}
	if err != nil {
		return Feature{}, err
	}
	if err := applySettings(&feature, settings, revision); err != nil {
		return Feature{}, err
	}
	return feature, nil
}

func applySettings(feature *Feature, settings string, revision int) error {
	feature.Revision = revision
	return json.Unmarshal([]byte(settings), &feature.FeatureSettings)
}

func validSettings(placements []string, settings FeatureSettings) bool {
	switch settings.Audience {
	case "all", "signed_in", "vip", "svip":
	default:
		return false
	}
	if settings.VisiblePlacements == nil {
		return false
	}
	seen := make(map[string]bool)
	for _, placement := range settings.VisiblePlacements {
		if seen[placement] || !slices.Contains(placements, placement) {
			return false
		}
		seen[placement] = true
	}
	return true
}
