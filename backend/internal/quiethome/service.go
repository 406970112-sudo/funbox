package quiethome

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/social"
)

const maxLabelRunes = 40
const maxGraceMinutes = 240
const maxRepeatNotifications = 24
const expireAfter = 24 * time.Hour

type Service struct {
	store       *Store
	socialStore *social.Store
	hub         *realtime.Hub
}

func NewService(store *Store, socialStore *social.Store, hub *realtime.Hub) *Service {
	return &Service{
		store:       store,
		socialStore: socialStore,
		hub:         hub,
	}
}

func (s *Service) GetState(ctx context.Context, userID string) (State, error) {
	activeTrip, err := s.store.GetActiveTrip(ctx, userID)
	if err != nil {
		return State{}, err
	}
	contacts, err := s.ListContacts(ctx, userID)
	if err != nil {
		return State{}, err
	}
	notifications := make([]Notification, 0)
	if activeTrip != nil {
		notifications, err = s.store.ListNotificationsForTrip(ctx, activeTrip.ID)
		if err != nil {
			return State{}, err
		}
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return State{}, err
	}
	privacy, err := s.PrivacyStatus(ctx, userID)
	if err != nil {
		return State{}, err
	}
	return State{
		ActiveTrip:    activeTrip,
		Contacts:      contacts,
		Notifications: notifications,
		Settings:      settings,
		Privacy:       privacy,
	}, nil
}

func (s *Service) CreateTrip(ctx context.Context, userID string, input CreateTripInput) (Trip, error) {
	origin := strings.TrimSpace(input.OriginLabel)
	destination := strings.TrimSpace(input.DestinationLabel)
	if origin == "" || destination == "" {
		return Trip{}, fmt.Errorf("%w: origin and destination required", ErrInvalidInput)
	}
	if len([]rune(origin)) > maxLabelRunes || len([]rune(destination)) > maxLabelRunes {
		return Trip{}, fmt.Errorf("%w: label too long", ErrInvalidInput)
	}
	eta, err := time.Parse(time.RFC3339Nano, input.ETAAt)
	if err != nil || !eta.After(time.Now().UTC()) {
		return Trip{}, fmt.Errorf("%w: eta must be a future time", ErrInvalidInput)
	}
	grace := input.GraceMinutes
	if grace <= 0 {
		grace = 30
	}
	if grace > maxGraceMinutes {
		return Trip{}, fmt.Errorf("%w: grace too long", ErrInvalidInput)
	}
	contactUserID := strings.TrimSpace(input.ContactUserID)
	contactEnabled := boolValue(input.ContactReminderEnabled, false)
	if contactEnabled || contactUserID != "" {
		if err := s.ensureAgreedContact(ctx, userID, contactUserID); err != nil {
			return Trip{}, err
		}
	}
	count, err := s.store.ActiveTripCount(ctx, userID)
	if err != nil {
		return Trip{}, err
	}
	if count > 0 {
		return Trip{}, ErrActiveTripExists
	}
	trip, err := s.store.CreateTrip(ctx, userID, Trip{
		OriginLabel:             origin,
		DestinationLabel:        destination,
		ETAAt:                   eta.UTC().Format(time.RFC3339),
		GraceMinutes:            grace,
		SelfReminderEnabled:     boolValue(input.SelfReminderEnabled, true),
		ContactReminderEnabled:  contactEnabled,
		ArrivalDetectionEnabled: boolValue(input.ArrivalDetectionEnabled, false),
		LateSnapshotEnabled:     boolValue(input.LateSnapshotEnabled, false),
		ContactUserID:           contactUserID,
	})
	if err != nil {
		return Trip{}, err
	}
	if trip.ArrivalDetectionEnabled {
		_, _ = s.store.AddLocationEvent(ctx, userID, trip.ID, "only-this-trip", false)
	}
	return trip, nil
}

func (s *Service) UpdateTrip(ctx context.Context, userID, id string, input UpdateTripInput) (Trip, error) {
	trip, err := s.store.GetTrip(ctx, userID, id)
	if err != nil {
		return Trip{}, err
	}
	if trip.Status != TripStatusActive {
		return Trip{}, fmt.Errorf("%w: trip is not active", ErrInvalidInput)
	}
	if input.ETAAt != nil {
		eta, parseErr := time.Parse(time.RFC3339Nano, *input.ETAAt)
		if parseErr != nil || !eta.After(time.Now().UTC()) {
			return Trip{}, fmt.Errorf("%w: eta must be a future time", ErrInvalidInput)
		}
		trip.ETAAt = eta.UTC().Format(time.RFC3339)
	}
	if input.GraceMinutes != nil {
		if *input.GraceMinutes <= 0 || *input.GraceMinutes > maxGraceMinutes {
			return Trip{}, fmt.Errorf("%w: invalid grace minutes", ErrInvalidInput)
		}
		trip.GraceMinutes = *input.GraceMinutes
	}
	if input.SelfReminderEnabled != nil {
		trip.SelfReminderEnabled = *input.SelfReminderEnabled
	}
	if input.ContactReminderEnabled != nil {
		trip.ContactReminderEnabled = *input.ContactReminderEnabled
	}
	if input.ArrivalDetectionEnabled != nil {
		trip.ArrivalDetectionEnabled = *input.ArrivalDetectionEnabled
	}
	if input.LateSnapshotEnabled != nil {
		trip.LateSnapshotEnabled = *input.LateSnapshotEnabled
	}
	if input.ContactUserID != nil {
		trip.ContactUserID = strings.TrimSpace(*input.ContactUserID)
	}
	if trip.ContactReminderEnabled && trip.ContactUserID != "" {
		if err := s.ensureAgreedContact(ctx, userID, trip.ContactUserID); err != nil {
			return Trip{}, err
		}
	}
	updated, err := s.store.UpdateTrip(ctx, trip)
	if err != nil {
		return Trip{}, err
	}
	if input.ETAAt != nil || input.GraceMinutes != nil || input.ContactReminderEnabled != nil {
		if err := s.store.DeletePendingNotificationsForTrip(ctx, trip.ID); err != nil {
			return Trip{}, err
		}
	}
	if trip.ArrivalDetectionEnabled {
		_, _ = s.store.AddLocationEvent(ctx, userID, trip.ID, "only-this-trip", false)
	}
	return updated, nil
}

func (s *Service) CheckIn(ctx context.Context, userID, tripID string) (Trip, error) {
	trip, err := s.store.GetTrip(ctx, userID, tripID)
	if err != nil {
		return Trip{}, err
	}
	if trip.Status != TripStatusActive {
		return Trip{}, fmt.Errorf("%w: trip is not active", ErrInvalidInput)
	}
	now := time.Now().UTC()
	eta, _ := time.Parse(time.RFC3339Nano, trip.ETAAt)
	lateMinutes := 0
	if now.After(eta) {
		lateMinutes = int(now.Sub(eta).Minutes())
		if lateMinutes < 0 {
			lateMinutes = 0
		}
	}
	checkedAt := now.Format(time.RFC3339)
	trip.Status = TripStatusCheckedIn
	trip.CheckedInAt = &checkedAt
	trip.LateMinutes = &lateMinutes
	notifications, _ := s.store.ListNotificationsForTrip(ctx, trip.ID)
	contactNotified := false
	for _, item := range notifications {
		if item.Type == NotificationContactReminder && item.Status == NotificationSent {
			contactNotified = true
			break
		}
	}
	updated, err := s.store.UpdateTrip(ctx, trip)
	if err != nil {
		return Trip{}, err
	}
	if err := s.store.DeletePendingNotificationsForTrip(ctx, trip.ID); err != nil {
		return Trip{}, err
	}
	if contactNotified && trip.ContactUserID != "" {
		notification := Notification{
			TripID:       trip.ID,
			Type:         NotificationSafeArrival,
			TargetUserID: trip.ContactUserID,
			Channel:      "in_app",
			Status:       NotificationPending,
			ScheduledAt:  now.Format(time.RFC3339),
		}
		created, addErr := s.store.AddNotification(ctx, notification)
		if addErr == nil {
			s.deliverIfOnline(ctx, created)
		}
	}
	return updated, nil
}

func (s *Service) CancelTrip(ctx context.Context, userID, tripID string) (Trip, error) {
	trip, err := s.store.GetTrip(ctx, userID, tripID)
	if err != nil {
		return Trip{}, err
	}
	if trip.Status != TripStatusActive {
		return Trip{}, fmt.Errorf("%w: trip is not active", ErrInvalidInput)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	trip.Status = TripStatusCancelled
	trip.CancelledAt = &now
	if err := s.store.DeletePendingNotificationsForTrip(ctx, trip.ID); err != nil {
		return Trip{}, err
	}
	return s.store.UpdateTrip(ctx, trip)
}

func (s *Service) ListHistory(ctx context.Context, userID string) ([]HistoryRecord, error) {
	trips, err := s.store.ListHistory(ctx, userID)
	if err != nil {
		return nil, err
	}
	items := make([]HistoryRecord, 0, len(trips))
	for _, trip := range trips {
		notifications, _ := s.store.ListNotificationsForTrip(ctx, trip.ID)
		contactNotified := false
		for _, item := range notifications {
			if item.Type == NotificationContactReminder && item.Status == NotificationSent {
				contactNotified = true
				break
			}
		}
		items = append(items, HistoryRecord{
			ID:               trip.ID,
			CreatedAt:        trip.CreatedAt,
			OriginLabel:      trip.OriginLabel,
			DestinationLabel: trip.DestinationLabel,
			ETAAt:            trip.ETAAt,
			CheckedInAt:      trip.CheckedInAt,
			CancelledAt:      trip.CancelledAt,
			LateMinutes:      trip.LateMinutes,
			ContactNotified:  contactNotified,
		})
	}
	return items, nil
}

func (s *Service) ClearHistory(ctx context.Context, userID string) error {
	return s.store.ClearHistory(ctx, userID)
}

func (s *Service) ListContacts(ctx context.Context, userID string) ([]FriendContact, error) {
	if s.socialStore == nil {
		return []FriendContact{}, nil
	}
	friends, err := s.socialStore.ListFriends(ctx, userID)
	if err != nil {
		return nil, err
	}
	contacts, err := s.store.ListContacts(ctx, userID)
	if err != nil {
		return nil, err
	}
	statusByUser := make(map[string]Contact, len(contacts))
	for _, item := range contacts {
		statusByUser[item.ContactUserID] = item
	}
	items := make([]FriendContact, 0, len(friends))
	for _, friend := range friends {
		item := FriendContact{
			ID:          friend.User.ID,
			Username:    friend.User.Username,
			DisplayName: friend.User.DisplayName,
			AvatarFile:  friend.User.AvatarFile,
			Status:      ContactStatusNone,
		}
		if contact, ok := statusByUser[friend.User.ID]; ok {
			item.Status = contact.Status
			item.AgreedAt = contact.AgreedAt
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) AddContact(ctx context.Context, userID, contactUserID string) (FriendContact, error) {
	contactUserID = strings.TrimSpace(contactUserID)
	if contactUserID == "" || contactUserID == userID {
		return FriendContact{}, fmt.Errorf("%w: invalid contact", ErrInvalidInput)
	}
	if err := s.ensureFriend(ctx, userID, contactUserID); err != nil {
		return FriendContact{}, err
	}
	item := Contact{
		UserID:        userID,
		ContactUserID: contactUserID,
		Status:        ContactStatusPending,
		Channels:      []string{"in_app"},
	}
	if _, err := s.store.UpsertContact(ctx, item); err != nil {
		return FriendContact{}, err
	}
	return FriendContact{
		ID:     contactUserID,
		Status: ContactStatusPending,
	}, nil
}

func (s *Service) RespondContact(ctx context.Context, userID, contactUserID string, input ConsentInput) (FriendContact, error) {
	contactUserID = strings.TrimSpace(contactUserID)
	if input.Status != ContactStatusAgreed && input.Status != ContactStatusDeclined {
		return FriendContact{}, fmt.Errorf("%w: invalid consent status", ErrInvalidInput)
	}
	pair, err := s.store.GetContactPair(ctx, userID, contactUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return FriendContact{}, fmt.Errorf("%w: contact request not found", ErrNotFound)
	}
	if err != nil {
		return FriendContact{}, err
	}
	if pair.UserID != userID && pair.ContactUserID != userID {
		return FriendContact{}, fmt.Errorf("%w: contact request is not for you", ErrInvalidInput)
	}
	pair.Status = input.Status
	if input.Status == ContactStatusAgreed {
		value := time.Now().UTC().Format(time.RFC3339)
		pair.AgreedAt = &value
	}
	if _, err := s.store.UpsertContact(ctx, pair); err != nil {
		return FriendContact{}, err
	}
	return FriendContact{ID: pair.ContactUserID, Status: pair.Status, AgreedAt: pair.AgreedAt}, nil
}

func (s *Service) RemoveContact(ctx context.Context, userID, contactUserID string) error {
	return s.store.DeleteContactPair(ctx, userID, contactUserID)
}

func (s *Service) GetSettings(ctx context.Context, userID string) (Settings, error) {
	settings, err := s.store.GetSettings(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	if settings.UserID == "" {
		settings = defaultSettings(userID)
		if _, err := s.store.SaveSettings(ctx, settings); err != nil {
			return Settings{}, err
		}
	}
	return settings, nil
}

func (s *Service) SaveSettings(ctx context.Context, userID string, settings Settings) (Settings, error) {
	settings.UserID = userID
	if settings.GraceMinutes <= 0 {
		settings.GraceMinutes = 30
	}
	if settings.RetentionDays <= 0 {
		settings.RetentionDays = 30
	}
	if settings.GraceMinutes > maxGraceMinutes {
		return Settings{}, fmt.Errorf("%w: invalid grace minutes", ErrInvalidInput)
	}
	if settings.RetentionDays != 7 && settings.RetentionDays != 30 && settings.RetentionDays != 90 {
		return Settings{}, fmt.Errorf("%w: retention days must be 7, 30 or 90", ErrInvalidInput)
	}
	settings.DefaultHome = strings.TrimSpace(settings.DefaultHome)
	if len([]rune(settings.DefaultHome)) > maxLabelRunes {
		return Settings{}, fmt.Errorf("%w: default home too long", ErrInvalidInput)
	}
	return s.store.SaveSettings(ctx, settings)
}

func (s *Service) PrivacyStatus(ctx context.Context, userID string) (PrivacyStatus, error) {
	events, err := s.store.ListLocationEvents(ctx, userID)
	if err != nil {
		return PrivacyStatus{}, err
	}
	contacts, err := s.store.ListContacts(ctx, userID)
	if err != nil {
		return PrivacyStatus{}, err
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return PrivacyStatus{}, err
	}
	agreed := 0
	for _, item := range contacts {
		if item.Status == ContactStatusAgreed {
			agreed++
		}
	}
	return PrivacyStatus{
		NotificationEnabled: false,
		LocationUsed:        len(events) > 0,
		ContactCount:        agreed,
		RetentionDays:       settings.RetentionDays,
		LocationEvents:      events,
	}, nil
}

func (s *Service) MarkNotificationDelivered(ctx context.Context, notificationID string) error {
	return s.store.MarkNotification(ctx, notificationID, NotificationSent, "")
}

func (s *Service) MarkNotificationFailed(ctx context.Context, notificationID, reason string) error {
	return s.store.MarkNotification(ctx, notificationID, NotificationFailed, reason)
}

func (s *Service) ProcessDue(ctx context.Context, now time.Time) error {
	trips, err := s.store.ListActiveTrips(ctx)
	if err != nil {
		return err
	}
	for _, trip := range trips {
		if err := s.ensureNotifications(ctx, trip, now); err != nil {
			return err
		}
		eta, _ := time.Parse(time.RFC3339Nano, trip.ETAAt)
		if now.After(eta.Add(expireAfter)) {
			trip.Status = TripStatusExpired
			if _, err := s.store.UpdateTrip(ctx, trip); err != nil {
				return err
			}
			_ = s.store.DeletePendingNotificationsForTrip(ctx, trip.ID)
		}
	}
	due, err := s.store.ListDueNotifications(ctx, now)
	if err != nil {
		return err
	}
	for _, item := range due {
		s.deliverIfOnline(ctx, item)
	}
	return nil
}

func (s *Service) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if err := s.ProcessDue(ctx, now); err != nil {
				// Scheduler keeps running; REST state remains the recovery path.
				_ = err
			}
		}
	}
}

func (s *Service) ensureNotifications(ctx context.Context, trip Trip, now time.Time) error {
	existing, err := s.store.ListNotificationsForTrip(ctx, trip.ID)
	if err != nil {
		return err
	}
	has := func(itemType NotificationType, scheduled string) bool {
		for _, item := range existing {
			if item.Type == itemType && item.ScheduledAt == scheduled {
				return true
			}
		}
		return false
	}
	eta, err := time.Parse(time.RFC3339Nano, trip.ETAAt)
	if err != nil {
		return fmt.Errorf("%w: invalid stored eta", ErrInvalidInput)
	}
	if trip.SelfReminderEnabled && !now.Before(eta) && !has(NotificationSelfReminder, eta.Format(time.RFC3339)) {
		_, err = s.store.AddNotification(ctx, Notification{
			TripID:       trip.ID,
			Type:         NotificationSelfReminder,
			TargetUserID: trip.UserID,
			Channel:      "in_app",
			Status:       NotificationPending,
			ScheduledAt:  eta.Format(time.RFC3339),
		})
		if err != nil {
			return err
		}
	}
	secondAt := eta.Add(15 * time.Minute)
	if trip.SelfReminderEnabled && !now.Before(secondAt) && !has(NotificationSelfReminder, secondAt.Format(time.RFC3339)) {
		_, err = s.store.AddNotification(ctx, Notification{
			TripID:       trip.ID,
			Type:         NotificationSelfReminder,
			TargetUserID: trip.UserID,
			Channel:      "in_app",
			Status:       NotificationPending,
			ScheduledAt:  secondAt.Format(time.RFC3339),
		})
		if err != nil {
			return err
		}
	}
	if trip.ContactReminderEnabled && trip.ContactUserID != "" {
		contact, contactErr := s.store.GetContactPair(ctx, trip.UserID, trip.ContactUserID)
		if contactErr == nil && contact.Status == ContactStatusAgreed {
			firstContactAt := eta.Add(time.Duration(trip.GraceMinutes) * time.Minute)
			for i := 0; i < maxRepeatNotifications; i++ {
				scheduledAt := firstContactAt.Add(time.Duration(i) * time.Hour)
				if scheduledAt.After(now) {
					break
				}
				key := scheduledAt.Format(time.RFC3339)
				if !has(NotificationContactReminder, key) {
					_, addErr := s.store.AddNotification(ctx, Notification{
						TripID:       trip.ID,
						Type:         NotificationContactReminder,
						TargetUserID: trip.ContactUserID,
						Channel:      "in_app",
						Status:       NotificationPending,
						ScheduledAt:  key,
					})
					if addErr != nil {
						return addErr
					}
				}
			}
		}
	}
	return nil
}

func (s *Service) deliverIfOnline(ctx context.Context, item Notification) {
	if s.hub == nil || !s.hub.IsOnline(item.TargetUserID) {
		return
	}
	s.hub.Publish(item.TargetUserID, realtime.Event{
		Type: "quiet-home.notification",
		Data: item,
	})
	_ = s.store.MarkNotification(ctx, item.ID, NotificationSent, "")
}

func (s *Service) ensureAgreedContact(ctx context.Context, userID, contactUserID string) error {
	if contactUserID == "" {
		return fmt.Errorf("%w: contact user required", ErrInvalidInput)
	}
	if err := s.ensureFriend(ctx, userID, contactUserID); err != nil {
		return err
	}
	contact, err := s.store.GetContactPair(ctx, userID, contactUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrContactNotAgreed
	}
	if err != nil {
		return err
	}
	if contact.Status != ContactStatusAgreed {
		return ErrContactNotAgreed
	}
	return nil
}

func (s *Service) ensureFriend(ctx context.Context, userID, contactUserID string) error {
	if s.socialStore == nil {
		return ErrNotFriend
	}
	friends, err := s.socialStore.ListFriendIDs(ctx, userID)
	if err != nil {
		return err
	}
	for _, id := range friends {
		if id == contactUserID {
			return nil
		}
	}
	return ErrNotFriend
}

func defaultSettings(userID string) Settings {
	return Settings{
		ID:                     "settings",
		UserID:                 userID,
		GraceMinutes:           30,
		SelfReminderEnabled:    true,
		ContactReminderEnabled: false,
		LateSnapshotEnabled:    false,
		RetentionDays:          30,
	}
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}
