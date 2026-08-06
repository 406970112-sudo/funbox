package shoppingroute

import "time"

const (
	MaxListNameLength   = 20
	MaxStoreNameLength  = 30
	MaxAddressLength    = 120
	MaxZoneNameLength   = 12
	MaxItemNameLength   = 30
	MaxQuantityLength   = 20
	MaxUnitLength       = 10
	MaxBarcodeLength    = 32
	MaxNoteLength       = 60
	MaxListsPerUser     = 30
	MaxStoresPerUser    = 30
	MaxItemsPerList     = 200
	MaxZonesPerStore    = 30
	MaxMappingsPerUser  = 500
	RouteStatusActive   = "active"
	RouteStatusComplete = "complete"

	ZoneTypeProduce   = "produce"
	ZoneTypeDairy     = "dairy"
	ZoneTypeFrozen    = "frozen"
	ZoneTypeMeat      = "meat"
	ZoneTypeGrain     = "grain"
	ZoneTypeHousehold = "household"
	ZoneTypePersonal  = "personal"
	ZoneTypeSnacks    = "snacks"
	ZoneTypeBakery    = "bakery"
	ZoneTypeOther     = "other"

	SourceUser          = "user"
	SourceCookingGuide  = "cooking-guide"
	SourceOpenFoodFacts = "openfoodfacts"
	SourceVerified      = "verified"
	SourceOfficial      = "official"
)

type List struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Name      string `json:"name"`
	Items     []Item `json:"items,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type ProductMeta struct {
	Name      string `json:"name"`
	Brand     string `json:"brand"`
	Category  string `json:"category"`
	ImageURL  string `json:"imageUrl"`
	Source    string `json:"source"`
	FetchedAt int64  `json:"fetchedAt"`
}

type Item struct {
	ID             string       `json:"id"`
	ListID         string       `json:"listId"`
	UserID         string       `json:"userId"`
	Name           string       `json:"name"`
	NormalizedName string       `json:"normalizedName"`
	Quantity       string       `json:"quantity"`
	Unit           string       `json:"unit"`
	Barcode        string       `json:"barcode"`
	Note           string       `json:"note"`
	Source         string       `json:"source"`
	ProductMeta    *ProductMeta `json:"productMeta,omitempty"`
	CreatedAt      int64        `json:"createdAt"`
	UpdatedAt      int64        `json:"updatedAt"`
}

type StoreProfile struct {
	ID             string `json:"id"`
	UserID         string `json:"userId"`
	Name           string `json:"name"`
	Address        string `json:"address"`
	Lat            string `json:"lat"`
	Lon            string `json:"lon"`
	Note           string `json:"note"`
	EntryZoneID    string `json:"entryZoneId"`
	CheckoutZoneID string `json:"checkoutZoneId"`
	Zones          []Zone `json:"zones,omitempty"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
}

type Zone struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	StoreID   string `json:"storeId"`
	Name      string `json:"name"`
	ZoneType  string `json:"zoneType"`
	Position  int    `json:"position"`
	Source    string `json:"source"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type Mapping struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	ItemKey     string `json:"itemKey"`
	ZoneType    string `json:"zoneType"`
	StoreID     string `json:"storeId"`
	ZoneID      string `json:"zoneId"`
	Source      string `json:"source"`
	SourceRef   string `json:"sourceRef"`
	ConfirmedAt int64  `json:"confirmedAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type VerifiedMapping struct {
	ProductKey string   `json:"productKey"`
	Names      []string `json:"names"`
	ZoneType   string   `json:"zoneType"`
	Source     string   `json:"source"`
	SourceRef  string   `json:"sourceRef"`
	ReviewedAt string   `json:"reviewedAt"`
}

type RouteItem struct {
	Item      Item   `json:"item"`
	ZoneID    string `json:"zoneId"`
	ZoneType  string `json:"zoneType"`
	Mapped    bool   `json:"mapped"`
	Source    string `json:"source"`
	Completed bool   `json:"completed"`
}

type RouteZone struct {
	Zone      Zone        `json:"zone"`
	Items     []RouteItem `json:"items"`
	Completed int         `json:"completed"`
	Total     int         `json:"total"`
}

type Route struct {
	ID             string      `json:"id"`
	UserID         string      `json:"userId"`
	ListID         string      `json:"listId"`
	StoreID        string      `json:"storeId"`
	Status         string      `json:"status"`
	EntryZoneID    string      `json:"entryZoneId"`
	CheckoutZoneID string      `json:"checkoutZoneId"`
	Zones          []RouteZone `json:"zones"`
	Unmapped       []RouteItem `json:"unmapped"`
	MappedCount    int         `json:"mappedCount"`
	TotalCount     int         `json:"totalCount"`
	UnmappedCount  int         `json:"unmappedCount"`
	Completeness   float64     `json:"completeness"`
	CreatedAt      int64       `json:"createdAt"`
	CompletedAt    int64       `json:"completedAt"`
}

type Home struct {
	Lists                []List         `json:"lists"`
	Stores               []StoreProfile `json:"stores"`
	ActiveRoute          *Route         `json:"activeRoute,omitempty"`
	TotalItems           int            `json:"totalItems"`
	MappedItems          int            `json:"mappedItems"`
	UnmappedItems        int            `json:"unmappedItems"`
	VerifiedMappingCount int            `json:"verifiedMappingCount"`
	UserMappingCount     int            `json:"userMappingCount"`
	UpdatedAt            int64          `json:"updatedAt"`
}

type StoreInput struct {
	Name           string `json:"name"`
	Address        string `json:"address"`
	Lat            string `json:"lat"`
	Lon            string `json:"lon"`
	Note           string `json:"note"`
	EntryZoneID    string `json:"entryZoneId"`
	CheckoutZoneID string `json:"checkoutZoneId"`
}

type ZoneInput struct {
	Name     string `json:"name"`
	ZoneType string `json:"zoneType"`
}

type MappingInput struct {
	ItemID   string `json:"itemId"`
	StoreID  string `json:"storeId"`
	ZoneID   string `json:"zoneId"`
	ZoneType string `json:"zoneType"`
}

type Suggestion struct {
	ItemID     string `json:"itemId"`
	Name       string `json:"name"`
	ZoneType   string `json:"zoneType"`
	ZoneName   string `json:"zoneName"`
	ZoneID     string `json:"zoneId"`
	Source     string `json:"source"`
	SourceRef  string `json:"sourceRef"`
	ReviewedAt string `json:"reviewedAt"`
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func NowMillis() int64 {
	return nowMillis()
}
