package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/partymemorycard"
)

func registerPartyMemoryCardRoutes(mux *http.ServeMux, api *Server) {
	if api.partyMemoryCardStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/party-memory-card/summary", api.withAuth(api.withAPIPipeline(api.handlePartyMemoryCardSummary)))
	mux.HandleFunc("GET /api/v1/party-memory-card/cards", api.withAuth(api.withAPIPipeline(api.handlePartyMemoryCardCards)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards", api.withAuth(api.withAPIPipeline(api.handleCreatePartyMemoryCard)))
	mux.HandleFunc("GET /api/v1/party-memory-card/cards/{cardID}", api.withAuth(api.withAPIPipeline(api.handleGetPartyMemoryCard)))
	mux.HandleFunc("PATCH /api/v1/party-memory-card/cards/{cardID}", api.withAuth(api.withAPIPipeline(api.handleUpdatePartyMemoryCard)))
	mux.HandleFunc("DELETE /api/v1/party-memory-card/cards/{cardID}", api.withAuth(api.withAPIPipeline(api.handleDeletePartyMemoryCard)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards/{cardID}/participants", api.withAuth(api.withAPIPipeline(api.handleAddPartyParticipant)))
	mux.HandleFunc("PATCH /api/v1/party-memory-card/cards/{cardID}/participants/{participantID}", api.withAuth(api.withAPIPipeline(api.handleUpdatePartyParticipant)))
	mux.HandleFunc("DELETE /api/v1/party-memory-card/cards/{cardID}/participants/{participantID}", api.withAuth(api.withAPIPipeline(api.handleRemovePartyParticipant)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards/{cardID}/photos", api.withAuth(api.withPartyMemoryCardUploadPipeline(api.handleUploadPartyMemoryCardPhoto)))
	mux.HandleFunc("DELETE /api/v1/party-memory-card/cards/{cardID}/photos/{photoID}", api.withAuth(api.withAPIPipeline(api.handleDeletePartyMemoryCardPhoto)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards/{cardID}/dishes", api.withAuth(api.withAPIPipeline(api.handleCreatePartyDish)))
	mux.HandleFunc("PATCH /api/v1/party-memory-card/cards/{cardID}/dishes/{dishID}", api.withAuth(api.withAPIPipeline(api.handleUpdatePartyDish)))
	mux.HandleFunc("DELETE /api/v1/party-memory-card/cards/{cardID}/dishes/{dishID}", api.withAuth(api.withAPIPipeline(api.handleDeletePartyDish)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards/{cardID}/dishes/{dishID}/vote", api.withAuth(api.withAPIPipeline(api.handleVotePartyDish)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards/{cardID}/venue-notes", api.withAuth(api.withAPIPipeline(api.handleAddPartyVenueNote)))
	mux.HandleFunc("DELETE /api/v1/party-memory-card/cards/{cardID}/venue-notes/{noteID}", api.withAuth(api.withAPIPipeline(api.handleDeletePartyVenueNote)))
	mux.HandleFunc("POST /api/v1/party-memory-card/cards/{cardID}/again-vote", api.withAuth(api.withAPIPipeline(api.handleAddPartyAgainVote)))
	mux.HandleFunc("GET /api/v1/party-memory-card/next-prep", api.withAuth(api.withAPIPipeline(api.handlePartyNextPrep)))
	mux.HandleFunc("GET /api/v1/party-memory-card/export", api.withAuth(api.withAPIPipeline(api.handlePartyMemoryCardExport)))
	mux.HandleFunc("GET /party-memory-card-media/", api.withAuth(api.handleServePartyMemoryCardMedia))
}

func (s *Server) withPartyMemoryCardUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "party-memory-card-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxPartyMemoryCardImageBytes
		maxImages := s.cfg.Storage.MaxPartyMemoryCardImages
		if maxBytes <= 0 {
			maxBytes = 5 << 20
		}
		if maxImages <= 0 {
			maxImages = 30
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes*int64(maxImages)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handlePartyMemoryCardSummary(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	summary, err := s.partyMemoryCardStore.Summary(r.Context(), account.ID)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	for i := range summary.RecentCards {
		summary.RecentCards[i].CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(summary.RecentCards[i].CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handlePartyMemoryCardCards(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	filter := partymemorycard.CardFilter{
		Query:    strings.TrimSpace(r.URL.Query().Get("q")),
		HostType: strings.TrimSpace(r.URL.Query().Get("hostType")),
		HasPhoto: strings.TrimSpace(r.URL.Query().Get("hasPhoto")),
		Again:    strings.TrimSpace(r.URL.Query().Get("again")),
		Sort:     strings.TrimSpace(r.URL.Query().Get("sort")),
	}
	cards, err := s.partyMemoryCardStore.ListCards(r.Context(), account.ID, filter)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	for i := range cards {
		cards[i].CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(cards[i].CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"cards": cards})
}

func (s *Server) handleCreatePartyMemoryCard(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.CardInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	card, err := s.partyMemoryCardStore.CreateCard(r.Context(), account.ID, input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	card.CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(card.CoverPhotoURL)
	writeJSON(w, http.StatusCreated, card)
}

func (s *Server) handleGetPartyMemoryCard(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	detail, err := s.partyMemoryCardStore.GetCardDetail(r.Context(), account.ID, r.PathValue("cardID"))
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	detail.CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(detail.CoverPhotoURL)
	for i := range detail.Photos {
		detail.Photos[i].FileURL = s.publicPartyMemoryCardPhotoURL(detail.Photos[i].FileURL)
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleUpdatePartyMemoryCard(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.CardInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	card, err := s.partyMemoryCardStore.UpdateCard(r.Context(), account.ID, r.PathValue("cardID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	card.CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(card.CoverPhotoURL)
	writeJSON(w, http.StatusOK, card)
}

func (s *Server) handleDeletePartyMemoryCard(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.partyMemoryCardStore.DeleteCard(r.Context(), account.ID, r.PathValue("cardID")); err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleAddPartyParticipant(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.ParticipantInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	participant, err := s.partyMemoryCardStore.AddParticipant(r.Context(), account.ID, r.PathValue("cardID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, participant)
}

func (s *Server) handleUpdatePartyParticipant(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.ParticipantUpdateInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	participant, err := s.partyMemoryCardStore.UpdateParticipant(r.Context(), account.ID, r.PathValue("cardID"), r.PathValue("participantID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, participant)
}

func (s *Server) handleRemovePartyParticipant(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.partyMemoryCardStore.RemoveParticipant(r.Context(), account.ID, r.PathValue("cardID"), r.PathValue("participantID")); err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleUploadPartyMemoryCardPhoto(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_multipart"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing_file"})
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".heic": true}
	if !allowed[ext] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_file_type"})
		return
	}
	if header.Size > s.cfg.Storage.MaxPartyMemoryCardImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}
	relativeDir := filepath.Join(account.ID, "photos")
	dir := filepath.Join(s.cfg.Storage.PartyMemoryCardDir, relativeDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	fileName := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), shortID(), ext)
	target := filepath.Join(dir, fileName)
	out, err := os.Create(target)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		_ = out.Close()
		_ = os.Remove(target)
		s.writePartyMemoryCardError(w, err)
		return
	}
	_ = out.Close()
	relativeURL := "/party-memory-card-media/" + relativeDir + "/" + fileName
	kind := strings.TrimSpace(r.FormValue("kind"))
	if kind == "" {
		kind = "photo"
	}
	takenAt := int64(0)
	if value := strings.TrimSpace(r.FormValue("takenAt")); value != "" {
		if parsed, parseErr := time.Parse(time.RFC3339, value); parseErr == nil {
			takenAt = parsed.Unix()
		}
	}
	cover := strings.TrimSpace(r.FormValue("cover")) == "true"
	photo, err := s.partyMemoryCardStore.AddPhoto(r.Context(), account.ID, r.PathValue("cardID"), relativeURL, kind, takenAt, cover)
	if err != nil {
		_ = os.Remove(target)
		s.writePartyMemoryCardError(w, err)
		return
	}
	photo.FileURL = s.publicPartyMemoryCardPhotoURL(photo.FileURL)
	writeJSON(w, http.StatusCreated, photo)
}

func (s *Server) handleDeletePartyMemoryCardPhoto(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	cardID := r.PathValue("cardID")
	photoID := r.PathValue("photoID")
	photo, err := s.partyMemoryCardStore.GetPhoto(r.Context(), account.ID, photoID)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	if photo.CardID != cardID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "party_memory_card_not_found"})
		return
	}
	if err := s.partyMemoryCardStore.DeletePhoto(r.Context(), account.ID, cardID, photoID); err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	s.removePartyMemoryCardPhotoFile(photo.FileURL)
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCreatePartyDish(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.DishInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	dish, err := s.partyMemoryCardStore.CreateDish(r.Context(), account.ID, r.PathValue("cardID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, dish)
}

func (s *Server) handleUpdatePartyDish(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.DishInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	dish, err := s.partyMemoryCardStore.UpdateDish(r.Context(), account.ID, r.PathValue("cardID"), r.PathValue("dishID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dish)
}

func (s *Server) handleDeletePartyDish(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.partyMemoryCardStore.DeleteDish(r.Context(), account.ID, r.PathValue("cardID"), r.PathValue("dishID")); err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleVotePartyDish(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.DishVoteInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	vote, err := s.partyMemoryCardStore.VoteDish(r.Context(), account.ID, r.PathValue("cardID"), r.PathValue("dishID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, vote)
}

func (s *Server) handleAddPartyVenueNote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.VenueNoteInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	note, err := s.partyMemoryCardStore.AddVenueNote(r.Context(), account.ID, r.PathValue("cardID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, note)
}

func (s *Server) handleDeletePartyVenueNote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.partyMemoryCardStore.DeleteVenueNote(r.Context(), account.ID, r.PathValue("cardID"), r.PathValue("noteID")); err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleAddPartyAgainVote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input partymemorycard.AgainVoteInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	vote, err := s.partyMemoryCardStore.AddAgainVote(r.Context(), account.ID, r.PathValue("cardID"), input)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, vote)
}

func (s *Server) handlePartyNextPrep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	prep, err := s.partyMemoryCardStore.GetNextPrep(r.Context(), account.ID)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	if prep.Card != nil {
		prep.Card.CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(prep.Card.CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, prep)
}

func (s *Server) handlePartyMemoryCardExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	snapshot, err := s.partyMemoryCardStore.Export(r.Context(), account.ID)
	if err != nil {
		s.writePartyMemoryCardError(w, err)
		return
	}
	for i := range snapshot.Cards {
		snapshot.Cards[i].CoverPhotoURL = s.publicPartyMemoryCardPhotoURL(snapshot.Cards[i].CoverPhotoURL)
		for j := range snapshot.Cards[i].Photos {
			snapshot.Cards[i].Photos[j].FileURL = s.publicPartyMemoryCardPhotoURL(snapshot.Cards[i].Photos[j].FileURL)
		}
	}
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if format == "csv" {
		var builder strings.Builder
		builder.WriteString("cardId,title,partyDate,venueName,venueAddress,hostType,hostName,totalAmountCents,participantCount,photoCount,dishCount,createdAt,updatedAt\n")
		for _, card := range snapshot.Cards {
			amount := ""
			if card.TotalAmountCents != nil {
				amount = fmt.Sprint(*card.TotalAmountCents)
			}
			fields := []string{
				csvField(card.ID), csvField(card.Title), card.PartyDate.Format(time.RFC3339),
				csvField(card.VenueName), csvField(card.VenueAddress), csvField(card.HostType),
				csvField(card.HostParticipantName), amount, fmt.Sprint(card.ParticipantCount),
				fmt.Sprint(card.PhotoCount), fmt.Sprint(card.DishCount),
				card.CreatedAt.Format(time.RFC3339), card.UpdatedAt.Format(time.RFC3339),
			}
			builder.WriteString(strings.Join(fields, ","))
			builder.WriteString("\n")
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="party-memory-card-export.csv"`)
		_, _ = w.Write([]byte(builder.String()))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="party-memory-card-export.json"`)
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleServePartyMemoryCardMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/party-memory-card-media/")
	parts := strings.SplitN(relative, "/", 2)
	if len(parts) != 2 || parts[0] != account.ID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	fileName := filepath.Base(parts[1])
	filePath := filepath.Join(s.cfg.Storage.PartyMemoryCardDir, account.ID, "photos", fileName)
	file, err := os.Open(filePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "read_file_failed"})
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func (s *Server) writePartyMemoryCardError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, partymemorycard.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "party_memory_card_not_found"})
	case errors.Is(err, partymemorycard.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "party_memory_card_forbidden"})
	case errors.Is(err, partymemorycard.ErrParticipantLimit):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "party_memory_card_participant_limit"})
	case errors.Is(err, partymemorycard.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "party_memory_card_invalid_input"})
	default:
		log.Printf("party memory card request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "party_memory_card_request_failed"})
	}
}

func (s *Server) publicPartyMemoryCardPhotoURL(relativeURL string) string {
	if relativeURL == "" {
		return ""
	}
	if strings.HasPrefix(relativeURL, "http") {
		return relativeURL
	}
	if baseURL := strings.TrimRight(s.cfg.Server.PublicBaseURL, "/"); baseURL != "" {
		return baseURL + relativeURL
	}
	return relativeURL
}

func (s *Server) removePartyMemoryCardPhotoFile(relativeURL string) {
	if !strings.HasPrefix(relativeURL, "/party-memory-card-media/") {
		return
	}
	relative := strings.TrimPrefix(relativeURL, "/party-memory-card-media/")
	parts := strings.SplitN(relative, "/", 2)
	if len(parts) != 2 {
		return
	}
	fileName := filepath.Base(parts[1])
	_ = os.Remove(filepath.Join(s.cfg.Storage.PartyMemoryCardDir, parts[0], "photos", fileName))
}
