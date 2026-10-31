package meme

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"
)

var zone = time.FixedZone("Asia/Shanghai", 8*3600)

func (s *Store) day() string { return s.now().In(zone).Format("2006-01-02") }
func (s *Store) Event(ctx context.Context, id, kind, event, actor string) (bool, error) {
	if kind != "view" && kind != "save" || len(event) < 1 || len(event) > 160 || len(actor) < 1 || len(actor) > 160 {
		return false, ErrInvalid
	}
	return s.record(ctx, id, kind, event, "anonymous:"+actor)
}
func (s *Store) RecordUserEvent(ctx context.Context, id, kind, event, user string) (bool, error) {
	if kind != "view" && kind != "save" || event == "" || len(event) > 160 {
		return false, ErrInvalid
	}
	return s.record(ctx, id, kind, event, "user:"+user)
}
func (s *Store) record(ctx context.Context, id, kind, event, actor string) (bool, error) {
	if _, _, e := s.Get(ctx, id, ""); e != nil {
		return false, e
	}
	h := sha256.Sum256([]byte(actor))
	actor = hex.EncodeToString(h[:])
	score := 1
	if kind == "save" {
		score = 5
	}
	if kind == "favorite" {
		score = 3
	}
	r, e := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO meme_events VALUES(?,?,?,?,?,?)`, s.day(), id, actor, kind, event, score)
	if e != nil {
		return false, e
	}
	n, e := r.RowsAffected()
	return n > 0, e
}
func (s *Store) Favorite(ctx context.Context, id, user string, add bool) error {
	if user == "" {
		return ErrInvalid
	}
	if !add {
		_, e := s.db.ExecContext(ctx, `DELETE FROM meme_favorites WHERE user_id=? AND image_id=?`, user, id)
		return e
	}
	if _, _, e := s.Get(ctx, id, user); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	res, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO meme_favorites VALUES(?,?,?)`, user, id, s.now().UTC().Format(time.RFC3339))
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		h := sha256.Sum256([]byte("user:" + user))
		_, e = tx.ExecContext(ctx, `INSERT OR IGNORE INTO meme_events VALUES(?,?,?,?,?,3)`, s.day(), id, hex.EncodeToString(h[:]), "favorite", "favorite:"+id+":"+s.day())
		if e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (s *Store) Rankings(ctx context.Context, period, date string) (Ranking, error) {
	if period == "" {
		period = "day"
	}
	if period != "day" && period != "week" && period != "all" {
		return Ranking{}, ErrInvalid
	}
	if date == "" {
		date = s.day()
	}
	d, e := time.ParseInLocation("2006-01-02", date, zone)
	if e != nil || date > s.day() || period != "day" && date != s.day() {
		return Ranking{}, ErrInvalid
	}
	if period == "day" && date < s.day() {
		var raw string
		e = s.db.QueryRowContext(ctx, `SELECT data FROM meme_snapshots WHERE day=?`, date).Scan(&raw)
		if e == sql.ErrNoRows {
			return Ranking{}, ErrNotFound
		}
		if e != nil {
			return Ranking{}, e
		}
		var r Ranking
		if e = json.Unmarshal([]byte(raw), &r); e != nil {
			return r, e
		}
		_, all, e := s.visible(ctx, "")
		if e != nil {
			return r, e
		}
		visible := map[string]Image{}
		for _, im := range all {
			visible[im.ID] = im
		}
		items := []Image{}
		for _, im := range r.Items {
			if current, ok := visible[im.ID]; ok {
				current.Rank = im.Rank
				current.Score = im.Score
				items = append(items, current)
			}
		}
		if len(items) != len(r.Items) {
			r.Notice = "部分内容已下架"
		}
		r.Items = items
		return r, nil
	}
	return s.compute(ctx, period, date, d)
}
func (s *Store) compute(ctx context.Context, period, date string, d time.Time) (Ranking, error) {
	r := Ranking{Items: []Image{}, Mode: "curated", Period: period, Date: date, UpdatedAt: s.now().UTC().Format(time.RFC3339), AlgorithmVersion: "funbox-v1-1-3-5"}
	s.db.QueryRowContext(ctx, `SELECT value FROM meme_state WHERE key='data_since'`).Scan(&r.DataSince)
	start := date
	if period == "week" {
		weekday := (int(d.Weekday()) + 6) % 7
		start = d.AddDate(0, 0, -weekday).Format("2006-01-02")
	}
	if period == "all" {
		start = "0000-01-01"
	}
	rows, e := s.db.QueryContext(ctx, `SELECT image_id,SUM(score),COUNT(DISTINCT actor) FROM meme_events WHERE day>=? AND day<=? GROUP BY image_id HAVING COUNT(DISTINCT actor)>=3`, start, date)
	if e != nil {
		return r, e
	}
	scores := map[string]int{}
	for rows.Next() {
		var id string
		var score, actors int
		rows.Scan(&id, &score, &actors)
		scores[id] = score
	}
	rows.Close()
	_, all, e := s.visible(ctx, "")
	if e != nil {
		return r, e
	}
	qualified := []Image{}
	for _, im := range all {
		if score, ok := scores[im.ID]; ok {
			im.Score = score
			qualified = append(qualified, im)
		}
	}
	if len(qualified) >= 10 {
		r.Mode = "ranking"
		sort.Slice(qualified, func(i, j int) bool {
			if qualified[i].Score == qualified[j].Score {
				return qualified[i].ID < qualified[j].ID
			}
			return qualified[i].Score > qualified[j].Score
		})
		if len(qualified) > 100 {
			qualified = qualified[:100]
		}
		for i := range qualified {
			qualified[i].Rank = i + 1
		}
		r.Items = qualified
	} else {
		if len(all) > 36 {
			all = all[:36]
		}
		r.Items = all
		r.Notice = "精选推荐，热度积累中"
	}
	return r, nil
}
func (s *Store) Freeze(ctx context.Context) error {
	var since string
	e := s.db.QueryRowContext(ctx, `SELECT value FROM meme_state WHERE key='data_since'`).Scan(&since)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	t, e := time.Parse(time.RFC3339, since)
	if e != nil {
		return e
	}
	start := t.In(zone).Format("2006-01-02")
	var last sql.NullString
	s.db.QueryRowContext(ctx, `SELECT MAX(day) FROM meme_snapshots`).Scan(&last)
	if last.Valid && last.String >= start {
		d, _ := time.ParseInLocation("2006-01-02", last.String, zone)
		start = d.AddDate(0, 0, 1).Format("2006-01-02")
	}
	d, _ := time.ParseInLocation("2006-01-02", start, zone)
	today := s.now().In(zone)
	for d.Format("2006-01-02") < s.day() {
		if today.Hour() == 0 && today.Minute() < 10 && d.AddDate(0, 0, 1).Format("2006-01-02") == s.day() {
			break
		}
		date := d.Format("2006-01-02")
		r, e := s.compute(ctx, "day", date, d)
		if e != nil {
			return e
		}
		r.IsFinal = true
		b, _ := json.Marshal(r)
		if _, e = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO meme_snapshots VALUES(?,?)`, date, string(b)); e != nil {
			return e
		}
		d = d.AddDate(0, 0, 1)
	}
	return nil
}
func (s *Store) Dates(ctx context.Context) ([]string, error) {
	out := []string{}
	rows, e := s.db.QueryContext(ctx, `SELECT day FROM meme_snapshots ORDER BY day DESC`)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var d string
		rows.Scan(&d)
		if strings.TrimSpace(d) != "" {
			out = append(out, d)
		}
	}
	return out, rows.Err()
}
