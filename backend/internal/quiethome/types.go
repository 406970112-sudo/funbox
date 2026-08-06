package quiethome

type TripStatus string

const (
	TripStatusActive    TripStatus = "active"
	TripStatusCheckedIn TripStatus = "checked_in"
	TripStatusCancelled TripStatus = "cancelled"
	TripStatusExpired   TripStatus = "expired"
)

type ContactStatus string

const (
	ContactStatusNone     ContactStatus = ""
	ContactStatusPending  ContactStatus = "pending"
	ContactStatusAgreed   ContactStatus = "agreed"
	ContactStatusDeclined ContactStatus = "declined"
	ContactStatusRemoved  ContactStatus = "removed"
)

type NotificationType string

const (
	NotificationSelfReminder    NotificationType = "self_reminder"
	NotificationContactReminder NotificationType = "contact_reminder"
	NotificationSafeArrival     NotificationType = "safe_arrival"
	NotificationCancel          NotificationType = "cancel"
)

type NotificationStatus string

const (
	NotificationPending NotificationStatus = "pending"
	NotificationSent    NotificationStatus = "sent"
	NotificationFailed  NotificationStatus = "failed"
)

type Trip struct {
	ID                      string     `json:"id"`
	UserID                  string     `json:"userId"`
	OriginLabel             string     `json:"originLabel"`
	DestinationLabel        string     `json:"destinationLabel"`
	ETAAt                   string     `json:"etaAt"`
	GraceMinutes            int        `json:"graceMinutes"`
	SelfReminderEnabled     bool       `json:"selfReminderEnabled"`
	ContactReminderEnabled  bool       `json:"contactReminderEnabled"`
	ArrivalDetectionEnabled bool       `json:"arrivalDetectionEnabled"`
	LateSnapshotEnabled     bool       `json:"lateSnapshotEnabled"`
	ContactUserID           string     `json:"contactUserId,omitempty"`
	Status                  TripStatus `json:"status"`
	CreatedAt               string     `json:"createdAt"`
	UpdatedAt               string     `json:"updatedAt"`
	CheckedInAt             *string    `json:"checkedInAt,omitempty"`
	CancelledAt             *string    `json:"cancelledAt,omitempty"`
	LateMinutes             *int       `json:"lateMinutes,omitempty"`
}

type Contact struct {
	ID            string        `json:"id"`
	UserID        string        `json:"userId"`
	ContactUserID string        `json:"contactUserId"`
	Status        ContactStatus `json:"status"`
	Channels      []string      `json:"channels"`
	AgreedAt      *string       `json:"agreedAt,omitempty"`
	UpdatedAt     string        `json:"updatedAt"`
}

type FriendContact struct {
	ID          string        `json:"id"`
	Username    string        `json:"username"`
	DisplayName string        `json:"displayName"`
	AvatarFile  string        `json:"avatarFile,omitempty"`
	Status      ContactStatus `json:"status"`
	AgreedAt    *string       `json:"agreedAt,omitempty"`
	Incoming    bool          `json:"incoming,omitempty"`
}

type Notification struct {
	ID           string             `json:"id"`
	TripID       string             `json:"tripId"`
	Type         NotificationType   `json:"type"`
	TargetUserID string             `json:"targetUserId,omitempty"`
	Channel      string             `json:"channel"`
	Status       NotificationStatus `json:"status"`
	ScheduledAt  string             `json:"scheduledAt"`
	SentAt       *string            `json:"sentAt,omitempty"`
	Error        string             `json:"error,omitempty"`
}

type HistoryRecord struct {
	ID               string  `json:"id"`
	CreatedAt        string  `json:"createdAt"`
	OriginLabel      string  `json:"originLabel"`
	DestinationLabel string  `json:"destinationLabel"`
	ETAAt            string  `json:"etaAt"`
	CheckedInAt      *string `json:"checkedInAt,omitempty"`
	CancelledAt      *string `json:"cancelledAt,omitempty"`
	LateMinutes      *int    `json:"lateMinutes,omitempty"`
	ContactNotified  bool    `json:"contactNotified"`
}

type Settings struct {
	ID                     string `json:"id"`
	UserID                 string `json:"userId"`
	DefaultHome            string `json:"defaultHome"`
	GraceMinutes           int    `json:"graceMinutes"`
	SelfReminderEnabled    bool   `json:"selfReminderEnabled"`
	ContactReminderEnabled bool   `json:"contactReminderEnabled"`
	LateSnapshotEnabled    bool   `json:"lateSnapshotEnabled"`
	RetentionDays          int    `json:"retentionDays"`
	UpdatedAt              int64  `json:"updatedAt"`
}

type LocationEvent struct {
	ID       string `json:"id"`
	TripID   string `json:"tripId"`
	UsedAt   string `json:"usedAt"`
	Purpose  string `json:"purpose"`
	Snapshot bool   `json:"snapshot"`
}

type PrivacyStatus struct {
	NotificationEnabled bool            `json:"notificationEnabled"`
	LocationUsed        bool            `json:"locationUsed"`
	ContactCount        int             `json:"contactCount"`
	RetentionDays       int             `json:"retentionDays"`
	LocationEvents      []LocationEvent `json:"locationEvents"`
}

type State struct {
	ActiveTrip    *Trip           `json:"activeTrip"`
	Contacts      []FriendContact `json:"contacts"`
	Notifications []Notification  `json:"notifications"`
	Settings      Settings        `json:"settings"`
	Privacy       PrivacyStatus   `json:"privacy"`
}

type CreateTripInput struct {
	OriginLabel             string `json:"originLabel"`
	DestinationLabel        string `json:"destinationLabel"`
	ETAAt                   string `json:"etaAt"`
	GraceMinutes            int    `json:"graceMinutes"`
	SelfReminderEnabled     *bool  `json:"selfReminderEnabled"`
	ContactReminderEnabled  *bool  `json:"contactReminderEnabled"`
	ArrivalDetectionEnabled *bool  `json:"arrivalDetectionEnabled"`
	LateSnapshotEnabled     *bool  `json:"lateSnapshotEnabled"`
	ContactUserID           string `json:"contactUserId,omitempty"`
}

type UpdateTripInput struct {
	ETAAt                   *string `json:"etaAt,omitempty"`
	GraceMinutes            *int    `json:"graceMinutes,omitempty"`
	SelfReminderEnabled     *bool   `json:"selfReminderEnabled,omitempty"`
	ContactReminderEnabled  *bool   `json:"contactReminderEnabled,omitempty"`
	ArrivalDetectionEnabled *bool   `json:"arrivalDetectionEnabled,omitempty"`
	LateSnapshotEnabled     *bool   `json:"lateSnapshotEnabled,omitempty"`
	ContactUserID           *string `json:"contactUserId,omitempty"`
}

type ConsentInput struct {
	Status ContactStatus `json:"status"`
}
