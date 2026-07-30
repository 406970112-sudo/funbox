package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/social"
)

type socialUserResponse struct {
	AvatarURL   string `json:"avatarUrl"`
	DisplayName string `json:"displayName"`
	ID          string `json:"id"`
	Online      bool   `json:"online"`
	Username    string `json:"username"`
}

type friendRequestResponse struct {
	CreatedAt string             `json:"createdAt"`
	ID        string             `json:"id"`
	Recipient socialUserResponse `json:"recipient"`
	Sender    socialUserResponse `json:"sender"`
	Status    string             `json:"status"`
	UpdatedAt string             `json:"updatedAt"`
}

type friendResponse struct {
	CreatedAt string             `json:"createdAt"`
	User      socialUserResponse `json:"user"`
}

type messageResponse struct {
	Body            string `json:"body"`
	ClientMessageID string `json:"clientMessageId"`
	ConversationID  string `json:"conversationId"`
	CreatedAt       string `json:"createdAt"`
	ID              string `json:"id"`
	Read            bool   `json:"read"`
	SenderID        string `json:"senderId"`
}

type conversationResponse struct {
	ID          string             `json:"id"`
	LastMessage *messageResponse   `json:"lastMessage"`
	Peer        socialUserResponse `json:"peer"`
	UnreadCount int                `json:"unreadCount"`
	UpdatedAt   string             `json:"updatedAt"`
}

type createFriendRequestBody struct {
	UserID string `json:"userId"`
}

type createMessageBody struct {
	Body            string `json:"body"`
	ClientMessageID string `json:"clientMessageId"`
}

func (s *Server) handleSearchUsers(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	users, err := s.socialStore.SearchUsers(r.Context(), account.ID, r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "search_users_failed"})
		return
	}
	result := make([]socialUserResponse, 0, len(users))
	for _, found := range users {
		result = append(result, s.socialUser(found))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": result})
}

func (s *Server) handleCreateFriendRequest(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body createFriendRequestBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	request, err := s.socialStore.CreateFriendRequest(
		r.Context(),
		account.ID,
		strings.TrimSpace(body.UserID),
	)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	response := s.friendRequest(request)
	s.realtimeHub.Publish(request.Recipient.ID, realtime.Event{
		Type: "friend.requested",
		Data: response,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"request": response})
}

func (s *Server) handleListFriendRequests(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	requests, err := s.socialStore.ListFriendRequests(r.Context(), account.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_friend_requests_failed"})
		return
	}
	incoming := make([]friendRequestResponse, 0, len(requests.Incoming))
	for _, request := range requests.Incoming {
		incoming = append(incoming, s.friendRequest(request))
	}
	outgoing := make([]friendRequestResponse, 0, len(requests.Outgoing))
	for _, request := range requests.Outgoing {
		outgoing = append(outgoing, s.friendRequest(request))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"incoming": incoming,
		"outgoing": outgoing,
	})
}

func (s *Server) handleAcceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	s.handleFriendRequestResponse(w, r, true)
}

func (s *Server) handleRejectFriendRequest(w http.ResponseWriter, r *http.Request) {
	s.handleFriendRequestResponse(w, r, false)
}

func (s *Server) handleFriendRequestResponse(w http.ResponseWriter, r *http.Request, accept bool) {
	account, _ := authenticatedUserFromContext(r.Context())
	request, conversation, err := s.socialStore.RespondToFriendRequest(
		r.Context(),
		r.PathValue("requestID"),
		account.ID,
		accept,
	)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	response := s.friendRequest(request)
	payload := map[string]any{"request": response}
	if conversation != nil {
		converted := s.conversation(*conversation)
		payload["conversation"] = converted
		s.realtimeHub.Publish(request.Sender.ID, realtime.Event{
			Type: "friend.accepted",
			Data: map[string]any{"request": response},
		})
	} else {
		s.realtimeHub.Publish(request.Sender.ID, realtime.Event{
			Type: "friend.rejected",
			Data: map[string]any{"request": response},
		})
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleListFriends(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	friends, err := s.socialStore.ListFriends(r.Context(), account.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_friends_failed"})
		return
	}
	result := make([]friendResponse, 0, len(friends))
	for _, friend := range friends {
		result = append(result, friendResponse{
			CreatedAt: formatSocialTime(friend.CreatedAt),
			User:      s.socialUser(friend.User),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"friends": result})
}

func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	conversations, err := s.socialStore.ListConversations(r.Context(), account.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_conversations_failed"})
		return
	}
	result := make([]conversationResponse, 0, len(conversations))
	for _, conversation := range conversations {
		result = append(result, s.conversation(conversation))
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": result})
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	messages, err := s.socialStore.ListMessages(
		r.Context(),
		r.PathValue("conversationID"),
		account.ID,
		before,
		limit,
	)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	result := make([]messageResponse, 0, len(messages))
	for _, message := range messages {
		result = append(result, s.message(message))
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": result})
}

func (s *Server) handleCreateMessage(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body createMessageBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	message, peerID, err := s.socialStore.SendMessage(
		r.Context(),
		r.PathValue("conversationID"),
		account.ID,
		strings.TrimSpace(body.ClientMessageID),
		body.Body,
	)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	response := s.message(message)
	s.realtimeHub.Publish(peerID, realtime.Event{Type: "message.created", Data: response})
	writeJSON(w, http.StatusCreated, map[string]any{"message": response})
}

func (s *Server) handleMarkConversationRead(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	readAt, peerID, err := s.socialStore.MarkConversationRead(
		r.Context(),
		r.PathValue("conversationID"),
		account.ID,
	)
	if err != nil {
		writeSocialError(w, err)
		return
	}
	payload := map[string]any{
		"conversationId": r.PathValue("conversationID"),
		"readAt":         formatSocialTime(readAt),
		"userId":         account.ID,
	}
	s.realtimeHub.Publish(peerID, realtime.Event{Type: "conversation.read", Data: payload})
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleCreateRealtimeTicket(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	ticket, expiresAt, err := s.realtimeHub.IssueTicket(account.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "create_realtime_ticket_failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"expiresAt": formatSocialTime(expiresAt),
		"ticket":    ticket,
	})
}

func (s *Server) handleRealtime(w http.ResponseWriter, r *http.Request) {
	if !s.allowOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
		return
	}
	userID, err := s.realtimeHub.ConsumeTicket(strings.TrimSpace(r.URL.Query().Get("ticket")))
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "realtime_ticket_invalid"})
		return
	}
	_ = s.realtimeHub.ServeWS(w, r, userID, s.publishPresence)
}

func (s *Server) publishPresence(userID string, online bool) {
	friendIDs, err := s.socialStore.ListFriendIDs(context.Background(), userID)
	if err != nil {
		return
	}
	for _, friendID := range friendIDs {
		s.realtimeHub.Publish(friendID, realtime.Event{
			Type: "presence.changed",
			Data: map[string]any{"online": online, "userId": userID},
		})
	}
}

func (s *Server) socialUser(account social.UserSummary) socialUserResponse {
	avatarURL := ""
	if account.AvatarFile != "" {
		avatarURL = "/avatars/" + account.AvatarFile
		if baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.Server.PublicBaseURL), "/"); baseURL != "" {
			avatarURL = baseURL + avatarURL
		}
	}
	return socialUserResponse{
		AvatarURL:   avatarURL,
		DisplayName: account.DisplayName,
		ID:          account.ID,
		Online:      s.realtimeHub.IsOnline(account.ID),
		Username:    account.Username,
	}
}

func (s *Server) friendRequest(request social.FriendRequest) friendRequestResponse {
	return friendRequestResponse{
		CreatedAt: formatSocialTime(request.CreatedAt),
		ID:        request.ID,
		Recipient: s.socialUser(request.Recipient),
		Sender:    s.socialUser(request.Sender),
		Status:    request.Status,
		UpdatedAt: formatSocialTime(request.UpdatedAt),
	}
}

func (s *Server) conversation(conversation social.Conversation) conversationResponse {
	var lastMessage *messageResponse
	if conversation.LastMessage != nil {
		converted := s.message(*conversation.LastMessage)
		lastMessage = &converted
	}
	return conversationResponse{
		ID:          conversation.ID,
		LastMessage: lastMessage,
		Peer:        s.socialUser(conversation.Peer),
		UnreadCount: conversation.UnreadCount,
		UpdatedAt:   formatSocialTime(conversation.UpdatedAt),
	}
}

func (s *Server) message(message social.Message) messageResponse {
	return messageResponse{
		Body:            message.Body,
		ClientMessageID: message.ClientMessageID,
		ConversationID:  message.ConversationID,
		CreatedAt:       formatSocialTime(message.CreatedAt),
		ID:              message.ID,
		Read:            message.Read,
		SenderID:        message.SenderID,
	}
}

func writeSocialError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, social.ErrSelfRequest):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cannot_add_yourself"})
	case errors.Is(err, social.ErrAlreadyFriends):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "already_friends"})
	case errors.Is(err, social.ErrRequestExists):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "friend_request_exists"})
	case errors.Is(err, social.ErrMessageInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "message_invalid"})
	case errors.Is(err, social.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
	case errors.Is(err, social.ErrNotFound), errors.Is(err, social.ErrConversationNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "social_request_failed"})
	}
}

func formatSocialTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}
