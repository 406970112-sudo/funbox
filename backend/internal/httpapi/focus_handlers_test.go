package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/focus"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

type focusListResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Archived bool   `json:"archived"`
}

type focusTaskResponse struct {
	ID         string `json:"id"`
	ListID     string `json:"listId"`
	Title      string `json:"title"`
	Priority   string `json:"priority"`
	Status     string `json:"status"`
	DueDate    string `json:"dueDate"`
	RepeatRule string `json:"repeatRule"`
}

type focusGoalResponse struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	SourceTaskID string `json:"sourceTaskId"`
	Completed    bool   `json:"completed"`
}

type focusHabitResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Frequency    string `json:"frequency"`
	StreakDays   int    `json:"streakDays"`
	TodayChecked bool   `json:"todayChecked"`
}

type focusTodayResponse struct {
	Date     string               `json:"date"`
	Tasks    []focusTaskResponse  `json:"tasks"`
	Goals    []focusGoalResponse  `json:"goals"`
	Habits   []focusHabitResponse `json:"habits"`
	Progress struct {
		TaskCompleted  int `json:"taskCompleted"`
		TaskTotal      int `json:"taskTotal"`
		GoalCompleted  int `json:"goalCompleted"`
		GoalTotal      int `json:"goalTotal"`
		HabitCompleted int `json:"habitCompleted"`
		HabitTotal     int `json:"habitTotal"`
	} `json:"progress"`
}

type focusStatsResponse struct {
	Range             string  `json:"range"`
	TaskCompleted     int     `json:"taskCompleted"`
	TaskTotal         int     `json:"taskTotal"`
	TaskRate          float64 `json:"taskRate"`
	GoalCompleted     int     `json:"goalCompleted"`
	GoalTotal         int     `json:"goalTotal"`
	HabitTotalRecords int     `json:"habitTotalRecords"`
	Last7Days         []struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	} `json:"last7Days"`
}

func TestFocusHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	accessStore, err := access.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open access store: %v", err)
	}
	t.Cleanup(func() { _ = accessStore.Close() })
	focusStore, err := focus.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open focus store: %v", err)
	}
	t.Cleanup(func() { _ = focusStore.Close() })
	if err := accessStore.SyncRegistry(context.Background(), []access.FeatureDefinition{{
		ID:       "focus-plan",
		Name:     "效率清单",
		Route:    "/tools/focus-plan",
		Category: "效率",
	}}); err != nil {
		t.Fatalf("sync registry: %v", err)
	}

	cfg := config.Config{
		Auth: config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 64 << 10,
			RateLimitMax:        100,
			RateLimitWindow:     time.Minute,
		},
		Storage: config.StorageConfig{
			AvatarDir:      filepath.Join(tempDir, "avatars"),
			MaxAvatarBytes: 1 << 20,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServerWithReadingNewsFeedbackAndFocus(
		cfg, nil, nil, authService, socialStore, accessStore, nil, nil, nil, focusStore, nil,
	)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	session := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13700137000","password":"password-123","displayName":"效率用户","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小效"}`,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken
	today := time.Now().Format("2006-01-02")

	lists := requestJSON[map[string][]focusListResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/focus/lists",
		"",
		token,
		http.StatusOK,
	)
	if len(lists["lists"]) != 1 || lists["lists"][0].Name != "收集箱" {
		t.Fatalf("default list = %+v", lists["lists"])
	}
	defaultListID := lists["lists"][0].ID

	task := requestJSON[focusTaskResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/tasks",
		`{"listId":"`+defaultListID+`","title":"评审效率清单设计稿","priority":"high","dueDate":"`+today+`","dueTime":"09:30","repeatRule":"none"}`,
		token,
		http.StatusCreated,
	)
	if task.Priority != "high" || task.Status != "open" {
		t.Fatalf("created task = %+v", task)
	}

	goal := requestJSON[focusGoalResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/goals",
		`{"date":"`+today+`","title":"完成效率清单设计稿","sourceTaskId":"`+task.ID+`"}`,
		token,
		http.StatusCreated,
	)
	if goal.SourceTaskID != task.ID {
		t.Fatalf("goal source task = %+v", goal)
	}

	habit := requestJSON[focusHabitResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/habits",
		`{"name":"喝水 8 杯","frequency":"daily","reminderTime":"20:00","color":"#7e5bef"}`,
		token,
		http.StatusCreated,
	)
	if habit.Frequency != "daily" {
		t.Fatalf("created habit = %+v", habit)
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/habits/"+habit.ID+"/records",
		`{"date":"`+today+`"}`,
		token,
		http.StatusCreated,
	)
	requestJSON[focusGoalResponse](
		t,
		testServer.Client(),
		http.MethodPatch,
		testServer.URL+"/api/v1/focus/goals/"+goal.ID,
		`{"completed":true}`,
		token,
		http.StatusOK,
	)
	requestJSON[focusTaskResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/tasks/"+task.ID+"/complete",
		`{"completed":true,"date":"`+today+`"}`,
		token,
		http.StatusOK,
	)

	// 子任务未完成时，主任务不能被直接完成。
	parent := requestJSON[focusTaskResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/tasks",
		`{"title":"写产品文档","priority":"medium","subtasks":[{"title":"写大纲","priority":"medium"},{"title":"校对成稿","priority":"medium"}]}`,
		token,
		http.StatusCreated,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/tasks/"+parent.ID+"/complete",
		`{"completed":true,"date":"`+today+`"}`,
		token,
		http.StatusConflict,
	)

	requestJSON[focusTaskResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/focus/tasks",
		`{"title":"无日期任务","priority":"low"}`,
		token,
		http.StatusCreated,
	)

	todaySnapshot := requestJSON[focusTodayResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/focus/today?date="+today,
		"",
		token,
		http.StatusOK,
	)
	foundNoDateTask := false
	for _, task := range todaySnapshot.Tasks {
		if task.Title == "无日期任务" {
			foundNoDateTask = true
			break
		}
	}
	if !foundNoDateTask {
		t.Fatalf("today snapshot missing no-date task: %+v", todaySnapshot.Tasks)
	}
	if todaySnapshot.Progress.TaskCompleted != 1 {
		t.Fatalf("today task progress = %+v", todaySnapshot.Progress)
	}
	if todaySnapshot.Progress.GoalCompleted != 1 || todaySnapshot.Progress.GoalTotal != 1 {
		t.Fatalf("today goal progress = %+v", todaySnapshot.Progress)
	}
	if todaySnapshot.Progress.HabitCompleted != 1 || todaySnapshot.Progress.HabitTotal != 1 {
		t.Fatalf("today habit progress = %+v", todaySnapshot.Progress)
	}

	stats := requestJSON[focusStatsResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/focus/stats?range=week",
		"",
		token,
		http.StatusOK,
	)
	if stats.TaskCompleted < 1 || stats.TaskRate <= 0 || stats.HabitTotalRecords != 1 {
		t.Fatalf("stats = %+v", stats)
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/focus/calendar?month="+today[:7],
		"",
		token,
		http.StatusOK,
	)
}
