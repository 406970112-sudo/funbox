package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/shoppingroute"
)

func registerShoppingRouteRoutes(mux *http.ServeMux, api *Server) {
	if api.shoppingRouteStore == nil {
		return
	}
	register := func(method, path string, handler http.HandlerFunc) {
		mux.HandleFunc(method+" "+path, api.withAuth(api.withAPIPipeline(handler)))
	}
	register("GET", "/api/v1/shopping-route/home", api.handleShoppingRouteHome)
	register("GET", "/api/v1/shopping-route/lists", api.handleShoppingRouteListLists)
	register("POST", "/api/v1/shopping-route/lists", api.handleShoppingRouteCreateList)
	register("GET", "/api/v1/shopping-route/lists/{listID}", api.handleShoppingRouteListDetail)
	register("DELETE", "/api/v1/shopping-route/lists/{listID}", api.handleShoppingRouteDeleteList)
	register("POST", "/api/v1/shopping-route/lists/{listID}/items", api.handleShoppingRouteAddItem)
	register("PATCH", "/api/v1/shopping-route/items/{itemID}", api.handleShoppingRouteUpdateItem)
	register("DELETE", "/api/v1/shopping-route/items/{itemID}", api.handleShoppingRouteDeleteItem)
	register("POST", "/api/v1/shopping-route/imports/cooking-guide", api.handleShoppingRouteImportCookingGuide)
	register("GET", "/api/v1/shopping-route/stores", api.handleShoppingRouteListStores)
	register("POST", "/api/v1/shopping-route/stores", api.handleShoppingRouteCreateStore)
	register("GET", "/api/v1/shopping-route/stores/{storeID}", api.handleShoppingRouteGetStore)
	register("PUT", "/api/v1/shopping-route/stores/{storeID}", api.handleShoppingRouteUpdateStore)
	register("DELETE", "/api/v1/shopping-route/stores/{storeID}", api.handleShoppingRouteDeleteStore)
	register("PUT", "/api/v1/shopping-route/stores/{storeID}/zones", api.handleShoppingRouteSetZones)
	register("POST", "/api/v1/shopping-route/mappings", api.handleShoppingRouteSaveMapping)
	register("GET", "/api/v1/shopping-route/mapping-suggestions", api.handleShoppingRouteMappingSuggestions)
	register("POST", "/api/v1/shopping-route/routes", api.handleShoppingRouteCreateRoute)
	register("GET", "/api/v1/shopping-route/routes/{routeID}", api.handleShoppingRouteGetRoute)
	register("PATCH", "/api/v1/shopping-route/routes/{routeID}/items", api.handleShoppingRouteUpdateRouteItem)
	register("POST", "/api/v1/shopping-route/routes/{routeID}/complete", api.handleShoppingRouteCompleteRoute)
	register("GET", "/api/v1/shopping-route/history", api.handleShoppingRouteHistory)
	register("GET", "/api/v1/shopping-route/products/{barcode}", api.handleShoppingRouteProduct)
}

func (s *Server) handleShoppingRouteHome(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	lists, err := s.shoppingRouteStore.ListLists(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	stores, err := s.shoppingRouteStore.ListStores(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	mappings, err := s.shoppingRouteStore.ListMappings(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	totalItems := 0
	mappedItems := 0
	unmappedItems := 0
	for _, list := range lists {
		fullList, listErr := s.shoppingRouteStore.GetList(r.Context(), account.ID, list.ID)
		if listErr != nil {
			s.writeShoppingRouteError(w, listErr)
			return
		}
		for _, item := range fullList.Items {
			totalItems++
			if itemHasMapping(item, mappings) || hasVerifiedSuggestion(item) {
				mappedItems++
			} else {
				unmappedItems++
			}
		}
	}
	home := shoppingroute.Home{
		Lists:                lists,
		Stores:               stores,
		TotalItems:           totalItems,
		MappedItems:          mappedItems,
		UnmappedItems:        unmappedItems,
		VerifiedMappingCount: len(shoppingroute.VerifiedMappings()),
		UserMappingCount:     len(mappings),
		UpdatedAt:            nowMillis(),
	}
	if latest, err := s.shoppingRouteStore.LatestActiveRoute(r.Context(), account.ID); err == nil {
		home.ActiveRoute = &latest
	}
	writeJSON(w, http.StatusOK, home)
}

func (s *Server) handleShoppingRouteListLists(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	lists, err := s.shoppingRouteStore.ListLists(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": lists})
}

func (s *Server) handleShoppingRouteCreateList(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	list, err := s.shoppingRouteStore.CreateList(r.Context(), account.ID, input.Name)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, list)
}

func (s *Server) handleShoppingRouteListDetail(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	list, err := s.shoppingRouteStore.GetList(r.Context(), account.ID, strings.TrimSpace(r.PathValue("listID")))
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleShoppingRouteDeleteList(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.shoppingRouteStore.DeleteList(r.Context(), account.ID, strings.TrimSpace(r.PathValue("listID"))); err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleShoppingRouteAddItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input shoppingroute.Item
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	input.ListID = strings.TrimSpace(r.PathValue("listID"))
	input.Source = shoppingroute.SourceUser
	if strings.TrimSpace(input.Barcode) != "" && s.shoppingRouteProvider != nil {
		meta, lookupErr := s.shoppingRouteProvider.LookupProduct(r.Context(), input.Barcode)
		if lookupErr == nil && meta != nil {
			input.ProductMeta = meta
			input.Source = shoppingroute.SourceOpenFoodFacts
			if strings.TrimSpace(input.Name) == "" {
				input.Name = meta.Name
			}
		}
	}
	item, err := s.shoppingRouteStore.AddItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleShoppingRouteUpdateItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input shoppingroute.Item
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	input.ID = strings.TrimSpace(r.PathValue("itemID"))
	if strings.TrimSpace(input.Barcode) != "" && s.shoppingRouteProvider != nil {
		meta, lookupErr := s.shoppingRouteProvider.LookupProduct(r.Context(), input.Barcode)
		if lookupErr == nil && meta != nil {
			input.ProductMeta = meta
			input.Source = shoppingroute.SourceOpenFoodFacts
			if strings.TrimSpace(input.Name) == "" {
				input.Name = meta.Name
			}
		}
	}
	item, err := s.shoppingRouteStore.UpdateItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleShoppingRouteDeleteItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.shoppingRouteStore.DeleteItem(r.Context(), account.ID, strings.TrimSpace(r.PathValue("itemID"))); err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleShoppingRouteImportCookingGuide(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.cookingGuideService == nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cooking_guide_unavailable"})
		return
	}
	var input struct {
		DishID   string `json:"dishId"`
		ListID   string `json:"listId"`
		ListName string `json:"listName"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	shoppingList, err := s.cookingGuideService.ShoppingList(r.Context(), input.DishID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cooking_guide_dish_not_found"})
		return
	}
	listID := strings.TrimSpace(input.ListID)
	if listID == "" {
		name := strings.TrimSpace(input.ListName)
		if name == "" {
			name = "菜谱备菜清单"
		}
		created, createErr := s.shoppingRouteStore.CreateList(r.Context(), account.ID, name)
		if createErr != nil {
			s.writeShoppingRouteError(w, createErr)
			return
		}
		listID = created.ID
	}
	for _, ingredient := range shoppingList.Items {
		quantity := strings.TrimSpace(ingredient.Measure)
		if quantity == "" {
			quantity = "1份"
		}
		_, addErr := s.shoppingRouteStore.AddItem(r.Context(), account.ID, shoppingroute.Item{
			ListID:   listID,
			Name:     ingredient.Name,
			Quantity: quantity,
			Source:   shoppingroute.SourceCookingGuide,
		})
		if addErr != nil {
			s.writeShoppingRouteError(w, addErr)
			return
		}
	}
	list, err := s.shoppingRouteStore.GetList(r.Context(), account.ID, listID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleShoppingRouteListStores(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	stores, err := s.shoppingRouteStore.ListStores(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": stores})
}

func (s *Server) handleShoppingRouteCreateStore(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input shoppingroute.StoreProfile
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	store, err := s.shoppingRouteStore.CreateStore(r.Context(), account.ID, input)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, store)
}

func (s *Server) handleShoppingRouteGetStore(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	store, err := s.shoppingRouteStore.GetStore(r.Context(), account.ID, strings.TrimSpace(r.PathValue("storeID")))
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, store)
}

func (s *Server) handleShoppingRouteUpdateStore(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input shoppingroute.StoreProfile
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	input.ID = strings.TrimSpace(r.PathValue("storeID"))
	store, err := s.shoppingRouteStore.UpdateStore(r.Context(), account.ID, input)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, store)
}

func (s *Server) handleShoppingRouteDeleteStore(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.shoppingRouteStore.DeleteStore(r.Context(), account.ID, strings.TrimSpace(r.PathValue("storeID"))); err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleShoppingRouteSetZones(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input []shoppingroute.ZoneInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	zones, err := s.shoppingRouteStore.SetZones(r.Context(), account.ID, strings.TrimSpace(r.PathValue("storeID")), input)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": zones})
}

func (s *Server) handleShoppingRouteSaveMapping(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input shoppingroute.MappingInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.shoppingRouteStore.GetItem(r.Context(), account.ID, strings.TrimSpace(input.ItemID))
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	mapping := shoppingroute.Mapping{
		ItemKey:  item.NormalizedName,
		ZoneType: strings.TrimSpace(input.ZoneType),
		StoreID:  strings.TrimSpace(input.StoreID),
		ZoneID:   strings.TrimSpace(input.ZoneID),
		Source:   shoppingroute.SourceUser,
	}
	if mapping.ZoneID != "" {
		store, storeErr := s.shoppingRouteStore.GetStore(r.Context(), account.ID, mapping.StoreID)
		if storeErr != nil {
			s.writeShoppingRouteError(w, storeErr)
			return
		}
		found := false
		for _, zone := range store.Zones {
			if zone.ID == mapping.ZoneID {
				mapping.ZoneType = zone.ZoneType
				mapping.StoreID = store.ID
				found = true
				break
			}
		}
		if !found {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "shopping_route_invalid_input"})
			return
		}
	}
	if mapping.ZoneType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "shopping_route_invalid_input"})
		return
	}
	saved, err := s.shoppingRouteStore.SaveMapping(r.Context(), account.ID, mapping)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleShoppingRouteMappingSuggestions(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	listID := strings.TrimSpace(r.URL.Query().Get("listId"))
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	if listID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "shopping_route_invalid_input"})
		return
	}
	list, err := s.shoppingRouteStore.GetList(r.Context(), account.ID, listID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	mappings, err := s.shoppingRouteStore.ListMappings(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	var store shoppingroute.StoreProfile
	if storeID != "" {
		store, err = s.shoppingRouteStore.GetStore(r.Context(), account.ID, storeID)
		if err != nil {
			s.writeShoppingRouteError(w, err)
			return
		}
	}
	suggestions := []shoppingroute.Suggestion{}
	for _, item := range list.Items {
		if mapping, found := findUserMapping(mappings, item.NormalizedName, storeID); found {
			zoneName := ""
			for _, zone := range store.Zones {
				if zone.ID == mapping.ZoneID || (mapping.ZoneID == "" && zone.ZoneType == mapping.ZoneType) {
					zoneName = zone.Name
					break
				}
			}
			suggestions = append(suggestions, shoppingroute.Suggestion{
				ItemID:     item.ID,
				Name:       item.Name,
				ZoneType:   mapping.ZoneType,
				ZoneName:   zoneName,
				ZoneID:     mapping.ZoneID,
				Source:     mapping.Source,
				SourceRef:  mapping.SourceRef,
				ReviewedAt: strconv.FormatInt(mapping.ConfirmedAt, 10),
			})
			continue
		}
		if verified, found := shoppingroute.FindVerifiedMapping(item.Name); found {
			zoneName := ""
			for _, zone := range store.Zones {
				if zone.ZoneType == verified.ZoneType {
					zoneName = zone.Name
					break
				}
			}
			suggestions = append(suggestions, shoppingroute.Suggestion{
				ItemID:     item.ID,
				Name:       item.Name,
				ZoneType:   verified.ZoneType,
				ZoneName:   zoneName,
				ZoneID:     zoneIDForVerified(store, verified.ZoneType),
				Source:     verified.Source,
				SourceRef:  verified.SourceRef,
				ReviewedAt: verified.ReviewedAt,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": suggestions})
}

func (s *Server) handleShoppingRouteCreateRoute(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		ListID  string `json:"listId"`
		StoreID string `json:"storeId"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	route, err := s.shoppingRouteStore.CreateRoute(r.Context(), account.ID, strings.TrimSpace(input.ListID), strings.TrimSpace(input.StoreID))
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, route)
}

func (s *Server) handleShoppingRouteGetRoute(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	route, err := s.shoppingRouteStore.GetRoute(r.Context(), account.ID, strings.TrimSpace(r.PathValue("routeID")))
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) handleShoppingRouteUpdateRouteItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		ItemID    string `json:"itemId"`
		Completed bool   `json:"completed"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	route, err := s.shoppingRouteStore.UpdateRouteItem(r.Context(), account.ID, strings.TrimSpace(r.PathValue("routeID")), strings.TrimSpace(input.ItemID), input.Completed)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) handleShoppingRouteCompleteRoute(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	route, err := s.shoppingRouteStore.CompleteRoute(r.Context(), account.ID, strings.TrimSpace(r.PathValue("routeID")))
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, route)
}

func (s *Server) handleShoppingRouteHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	routes, err := s.shoppingRouteStore.ListHistory(r.Context(), account.ID)
	if err != nil {
		s.writeShoppingRouteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": routes})
}

func (s *Server) handleShoppingRouteProduct(w http.ResponseWriter, r *http.Request) {
	_, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.shoppingRouteProvider == nil {
		writeJSON(w, http.StatusOK, map[string]any{"product": nil})
		return
	}
	meta, err := s.shoppingRouteProvider.LookupProduct(r.Context(), strings.TrimSpace(r.PathValue("barcode")))
	if err != nil {
		log.Printf("shopping route product lookup failed: %v", err)
		writeJSON(w, http.StatusOK, map[string]any{"product": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"product": meta})
}

func (s *Server) writeShoppingRouteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, shoppingroute.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "shopping_route_invalid_input"})
	case errors.Is(err, shoppingroute.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "shopping_route_not_found"})
	default:
		log.Printf("shopping route error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}

func itemHasMapping(item shoppingroute.Item, mappings []shoppingroute.Mapping) bool {
	for _, mapping := range mappings {
		if mapping.ItemKey == item.NormalizedName {
			return true
		}
	}
	return false
}

func hasVerifiedSuggestion(item shoppingroute.Item) bool {
	_, found := shoppingroute.FindVerifiedMapping(item.Name)
	return found
}

func findUserMapping(mappings []shoppingroute.Mapping, itemKey, storeID string) (shoppingroute.Mapping, bool) {
	for _, mapping := range mappings {
		if mapping.ItemKey != itemKey {
			continue
		}
		if storeID == "" || mapping.StoreID == "" || mapping.StoreID == storeID {
			return mapping, true
		}
	}
	return shoppingroute.Mapping{}, false
}

func zoneIDForVerified(store shoppingroute.StoreProfile, zoneType string) string {
	for _, zone := range store.Zones {
		if zone.ZoneType == zoneType {
			return zone.ID
		}
	}
	return ""
}

func nowMillis() int64 {
	return shoppingroute.NowMillis()
}
