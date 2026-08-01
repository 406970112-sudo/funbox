package focus

type ListInput struct {
	Name      string `json:"name"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
	Archived  *bool  `json:"archived"`
}

type TaskInput struct {
	ListID       string      `json:"listId"`
	Title        string      `json:"title"`
	Note         string      `json:"note"`
	Priority     string      `json:"priority"`
	DueDate      *string     `json:"dueDate"`
	DueTime      *string     `json:"dueTime"`
	RepeatRule   string      `json:"repeatRule"`
	ParentTaskID string      `json:"parentTaskId"`
	Status       string      `json:"status"`
	SortOrder    int         `json:"sortOrder"`
	Subtasks     []TaskInput `json:"subtasks"`
}

type GoalInput struct {
	Date         string `json:"date"`
	Title        string `json:"title"`
	SourceTaskID string `json:"sourceTaskId"`
	SortOrder    int    `json:"sortOrder"`
	Completed    *bool  `json:"completed"`
}

type HabitInput struct {
	Name         string  `json:"name"`
	Icon         string  `json:"icon"`
	Color        string  `json:"color"`
	Frequency    string  `json:"frequency"`
	Weekdays     []int   `json:"weekdays"`
	ReminderTime *string `json:"reminderTime"`
	SortOrder    int     `json:"sortOrder"`
	Archived     *bool   `json:"archived"`
}
