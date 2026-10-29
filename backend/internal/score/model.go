package score

import (
	"errors"
	"time"
)

var (
	ErrBalancesNotZero      = errors.New("score balances do not sum to zero")
	ErrDatabasePathRequired = errors.New("score database path is required")
	ErrRoomNotFound         = errors.New("score room not found")
)

type RoomStatus string

const (
	RoomWaiting   RoomStatus = "waiting"
	RoomActive    RoomStatus = "active"
	RoomSettled   RoomStatus = "settled"
	RoomCancelled RoomStatus = "cancelled"
)

type ScoreScene string

const (
	SceneGeneric   ScoreScene = "generic"
	SceneZhaJinHua ScoreScene = "zhajinhua"
)

type GameType string

const (
	GameTypeGeneric   GameType = "generic"
	GameTypeMahjong   GameType = "mahjong"
	GameTypeZhaJinHua GameType = "zhajinhua"
)

type ParticipantRole string

const (
	ParticipantHost  ParticipantRole = "host"
	ParticipantGuest ParticipantRole = "guest"
)

type ParticipantStatus string

const (
	ParticipantActive  ParticipantStatus = "active"
	ParticipantRemoved ParticipantStatus = "removed"
	ParticipantLeft    ParticipantStatus = "left"
)

type RoundStatus string

const (
	RoundCollecting RoundStatus = "collecting"
	RoundReview     RoundStatus = "review"
	RoundConfirmed  RoundStatus = "confirmed"
	RoundCancelled  RoundStatus = "cancelled"
)

type RoundKind string

const (
	RoundNormal   RoundKind = "normal"
	RoundReversal RoundKind = "reversal"
)

type RoomSnapshot struct {
	ID                   string            `json:"id"`
	Code                 string            `json:"code"`
	HostUserID           string            `json:"hostUserId"`
	Name                 string            `json:"name"`
	Mode                 string            `json:"mode"`
	Scene                ScoreScene        `json:"scene"`
	GameType             GameType          `json:"gameType"`
	Status               RoomStatus        `json:"status"`
	MaxPlayers           int               `json:"maxPlayers"`
	CentsPerPoint        int64             `json:"centsPerPoint"`
	CapPoints            int64             `json:"capPoints"`
	RequiresPassword     bool              `json:"requiresPassword"`
	Version              int64             `json:"version"`
	EventSequence        int64             `json:"eventSequence"`
	CreatedAt            time.Time         `json:"createdAt"`
	StartedAt            *time.Time        `json:"startedAt,omitempty"`
	SettledAt            *time.Time        `json:"settledAt,omitempty"`
	CancelledAt          *time.Time        `json:"cancelledAt,omitempty"`
	ExpiresAt            time.Time         `json:"expiresAt"`
	Participants         []Participant     `json:"participants"`
	CurrentRound         *Round            `json:"currentRound,omitempty"`
	Rounds               []Round           `json:"rounds"`
	GiftBatches          []GiftBatch       `json:"giftBatches"`
	ZhaJinHuaSettings    ZhaJinHuaSettings `json:"zhaJinHuaSettings"`
	CurrentZhaJinHuaHand *ZhaJinHuaHand    `json:"currentZhaJinHuaHand,omitempty"`
	ZhaJinHuaHands       []ZhaJinHuaHand   `json:"zhaJinHuaHands"`
	Settlement           *Settlement       `json:"settlement,omitempty"`
	SelfParticipantID    string            `json:"selfParticipantId,omitempty"`
	InviteToken          string            `json:"inviteToken,omitempty"`
	PasswordHash         string            `json:"-"`
	Latitude             *float64          `json:"-"`
	Longitude            *float64          `json:"-"`
}

type Participant struct {
	ID          string            `json:"id"`
	UserID      string            `json:"userId,omitempty"`
	DisplayName string            `json:"displayName"`
	Role        ParticipantRole   `json:"role"`
	Status      ParticipantStatus `json:"status"`
	TotalPoints int64             `json:"totalPoints"`
	AmountCents int64             `json:"amountCents"`
	JoinedAt    time.Time         `json:"joinedAt"`
	LastSeenAt  time.Time         `json:"lastSeenAt"`
}

type Round struct {
	ID              string      `json:"id"`
	RoomID          string      `json:"roomId"`
	Number          int         `json:"number"`
	Kind            RoundKind   `json:"kind"`
	ReversesRoundID string      `json:"reversesRoundId,omitempty"`
	Status          RoundStatus `json:"status"`
	Roster          []string    `json:"roster"`
	Entries         []Entry     `json:"entries"`
	CreatedBy       string      `json:"createdBy"`
	CreatedAt       time.Time   `json:"createdAt"`
	ConfirmedAt     *time.Time  `json:"confirmedAt,omitempty"`
	CancelledAt     *time.Time  `json:"cancelledAt,omitempty"`
	SubmittedCount  int         `json:"submittedCount"`
	ConfirmedCount  int         `json:"confirmedCount"`
	TotalDelta      int64       `json:"totalDelta"`
}

type Entry struct {
	ParticipantID string     `json:"participantId"`
	DeltaPoints   int64      `json:"deltaPoints"`
	Revision      int        `json:"revision"`
	Submitted     bool       `json:"submitted"`
	Confirmed     bool       `json:"confirmed"`
	SubmittedAt   *time.Time `json:"submittedAt,omitempty"`
	UpdatedAt     *time.Time `json:"updatedAt,omitempty"`
}

type GiftBatch struct {
	ID              string     `json:"id"`
	RoomID          string     `json:"roomId"`
	Number          int        `json:"number"`
	Kind            RoundKind  `json:"kind"`
	ReversesBatchID string     `json:"reversesBatchId,omitempty"`
	CreatedBy       string     `json:"createdBy"`
	CreatedAt       time.Time  `json:"createdAt"`
	Gifts           []GiftItem `json:"gifts"`
}

type GiftItem struct {
	FromParticipantID string `json:"fromParticipantId"`
	ToParticipantID   string `json:"toParticipantId"`
	Points            int64  `json:"points"`
}

type ZhaJinHuaSettings struct {
	ForceOpenThreshold int `json:"forceOpenThreshold"`
}

type ZhaJinHuaHandStatus string

const (
	ZhaJinHuaHandActive    ZhaJinHuaHandStatus = "active"
	ZhaJinHuaHandFinished  ZhaJinHuaHandStatus = "finished"
	ZhaJinHuaHandCancelled ZhaJinHuaHandStatus = "cancelled"
)

type ZhaJinHuaPlayerStatus string

const (
	ZhaJinHuaPlayerActive ZhaJinHuaPlayerStatus = "active"
	ZhaJinHuaPlayerFolded ZhaJinHuaPlayerStatus = "folded"
)

type ZhaJinHuaActionType string

const (
	ZhaJinHuaActionRaise     ZhaJinHuaActionType = "raise"
	ZhaJinHuaActionFold      ZhaJinHuaActionType = "fold"
	ZhaJinHuaActionForceOpen ZhaJinHuaActionType = "force_open"
)

type ZhaJinHuaHand struct {
	ID                       string              `json:"id"`
	RoomID                   string              `json:"roomId"`
	Number                   int                 `json:"number"`
	Status                   ZhaJinHuaHandStatus `json:"status"`
	PotPoints                int64               `json:"potPoints"`
	CurrentBetPoints         int64               `json:"currentBetPoints"`
	CurrentTurnParticipantID string              `json:"currentTurnParticipantId,omitempty"`
	ForceOpenThreshold       int                 `json:"forceOpenThreshold"`
	WinnerParticipantID      string              `json:"winnerParticipantId,omitempty"`
	CreatedBy                string              `json:"createdBy"`
	CreatedAt                time.Time           `json:"createdAt"`
	FinishedAt               *time.Time          `json:"finishedAt,omitempty"`
	CancelledAt              *time.Time          `json:"cancelledAt,omitempty"`
	Players                  []ZhaJinHuaPlayer   `json:"players"`
	Actions                  []ZhaJinHuaAction   `json:"actions"`
}

type ZhaJinHuaPlayer struct {
	ParticipantID      string                `json:"participantId"`
	Position           int                   `json:"position"`
	Status             ZhaJinHuaPlayerStatus `json:"status"`
	ContributionPoints int64                 `json:"contributionPoints"`
	IsWinner           bool                  `json:"isWinner"`
}

type ZhaJinHuaAction struct {
	Sequence            int                 `json:"sequence"`
	ActionType          ZhaJinHuaActionType `json:"actionType"`
	ActorParticipantID  string              `json:"actorParticipantId"`
	TargetParticipantID string              `json:"targetParticipantId,omitempty"`
	WinnerParticipantID string              `json:"winnerParticipantId,omitempty"`
	Points              int64               `json:"points"`
	CreatedAt           time.Time           `json:"createdAt"`
}

type Settlement struct {
	Balances  []SettlementBalance `json:"balances"`
	Transfers []Transfer          `json:"transfers"`
	CreatedAt time.Time           `json:"createdAt"`
}

type SettlementBalance struct {
	ParticipantID string `json:"participantId"`
	TotalPoints   int64  `json:"totalPoints"`
	AmountCents   int64  `json:"amountCents"`
}

type Transfer struct {
	FromParticipantID string `json:"fromParticipantId"`
	ToParticipantID   string `json:"toParticipantId"`
	AmountCents       int64  `json:"amountCents"`
}
