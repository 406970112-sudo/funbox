package shoppingroute

import "sort"

func BuildRoute(list List, store StoreProfile, zones []Zone, mappings []Mapping) Route {
	sortedZones := append([]Zone(nil), zones...)
	sort.SliceStable(sortedZones, func(i, j int) bool {
		return sortedZones[i].Position < sortedZones[j].Position
	})
	zoneByID := make(map[string]Zone, len(sortedZones))
	zoneByType := make(map[string]Zone, len(sortedZones))
	for _, zone := range sortedZones {
		zoneByID[zone.ID] = zone
		if zone.ZoneType != "" {
			if _, exists := zoneByType[zone.ZoneType]; !exists {
				zoneByType[zone.ZoneType] = zone
			}
		}
	}

	userByKey := make(map[string]Mapping)
	for _, mapping := range mappings {
		if mapping.StoreID != "" && mapping.StoreID != store.ID {
			continue
		}
		if existing, ok := userByKey[mapping.ItemKey]; !ok || mapping.UpdatedAt > existing.UpdatedAt {
			userByKey[mapping.ItemKey] = mapping
		}
	}

	routeZones := make([]RouteZone, 0, len(sortedZones))
	zoneItems := make(map[string][]RouteItem, len(sortedZones))
	var unmapped []RouteItem
	mappedCount := 0
	total := len(list.Items)

	for _, item := range list.Items {
		key := normalizeName(item.Name)
		routeItem := RouteItem{Item: item}
		if mapping, ok := userByKey[key]; ok {
			if zone, ok := zoneByID[mapping.ZoneID]; ok {
				routeItem.ZoneID = zone.ID
				routeItem.ZoneType = zone.ZoneType
				routeItem.Mapped = true
				routeItem.Source = mapping.Source
			} else if mapping.ZoneType != "" {
				if zone, ok := zoneByType[mapping.ZoneType]; ok {
					routeItem.ZoneID = zone.ID
					routeItem.ZoneType = zone.ZoneType
					routeItem.Mapped = true
					routeItem.Source = mapping.Source
				}
			}
		}
		if !routeItem.Mapped {
			if verified, ok := findVerifiedMapping(item.Name); ok {
				if zone, ok := zoneByType[verified.ZoneType]; ok {
					routeItem.ZoneID = zone.ID
					routeItem.ZoneType = zone.ZoneType
					routeItem.Mapped = true
					routeItem.Source = SourceVerified
				}
			}
		}
		if routeItem.Mapped {
			mappedCount++
			zoneItems[routeItem.ZoneID] = append(zoneItems[routeItem.ZoneID], routeItem)
		} else {
			unmapped = append(unmapped, routeItem)
		}
	}

	for _, zone := range sortedZones {
		items := zoneItems[zone.ID]
		if items == nil {
			items = []RouteItem{}
		}
		completed := 0
		for _, item := range items {
			if item.Completed {
				completed++
			}
		}
		routeZones = append(routeZones, RouteZone{
			Zone:      zone,
			Items:     items,
			Completed: completed,
			Total:     len(items),
		})
	}

	completeness := 0.0
	if total > 0 {
		completeness = float64(mappedCount) / float64(total)
	}
	if unmapped == nil {
		unmapped = []RouteItem{}
	}
	return Route{
		UserID:         list.UserID,
		ListID:         list.ID,
		StoreID:        store.ID,
		Status:         RouteStatusActive,
		EntryZoneID:    store.EntryZoneID,
		CheckoutZoneID: store.CheckoutZoneID,
		Zones:          routeZones,
		Unmapped:       unmapped,
		MappedCount:    mappedCount,
		TotalCount:     total,
		UnmappedCount:  len(unmapped),
		Completeness:   completeness,
	}
}

func updateRouteItem(route *Route, itemID string, completed bool) {
	for index := range route.Zones {
		for itemIndex := range route.Zones[index].Items {
			if route.Zones[index].Items[itemIndex].Item.ID == itemID {
				route.Zones[index].Items[itemIndex].Completed = completed
				recountZone(&route.Zones[index])
				return
			}
		}
	}
	for index := range route.Unmapped {
		if route.Unmapped[index].Item.ID == itemID {
			route.Unmapped[index].Completed = completed
			return
		}
	}
}

func recountZone(zone *RouteZone) {
	completed := 0
	for _, item := range zone.Items {
		if item.Completed {
			completed++
		}
	}
	zone.Completed = completed
}

func routeCompleted(route Route) bool {
	for _, zone := range route.Zones {
		for _, item := range zone.Items {
			if !item.Completed {
				return false
			}
		}
	}
	for _, item := range route.Unmapped {
		if !item.Completed {
			return false
		}
	}
	return route.TotalCount > 0
}
