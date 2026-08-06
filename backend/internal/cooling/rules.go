package cooling

import (
	"fmt"
	"math"
	"strings"
)

const (
	StatusCooling         = "cooling"
	StatusPendingDecision = "pending_decision"
	StatusBought          = "bought"
	StatusDropped         = "dropped"

	RiskLow    = "low"
	RiskMedium = "medium"
	RiskHigh   = "high"

	SourceManual     = "manual"
	SourceScreenshot = "screenshot"
	SourceLink       = "link"

	WageMonthly = "monthly"
	WageHourly  = "hourly"

	WhyNeed    = "need"
	WhyReward  = "reward"
	WhyPromo   = "promo"
	WhyFOMO    = "fomo"
	WhyEmotion = "emotion"
	WhyOther   = "other"

	SimilarNone = "none"
	SimilarOne  = "one"
	SimilarMany = "many"

	UseDaily   = "daily"
	UseWeekly  = "weekly"
	UseMonthly = "monthly"
	UseRarely  = "rarely"
	UseNever   = "never"

	WantsYes    = "yes"
	WantsNo     = "no"
	WantsUnsure = "unsure"

	MaxItemNameRunes = 60
	MaxPriceCents    = 100_000_000_00
	MaxExtendCount   = 3
)

func ValidateItemInput(input ItemInput) error {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > MaxItemNameRunes {
		return fmt.Errorf("%w: invalid item name", ErrInvalidInput)
	}
	if input.PriceCents <= 0 || input.PriceCents > MaxPriceCents {
		return fmt.Errorf("%w: invalid price", ErrInvalidInput)
	}
	if strings.TrimSpace(input.Currency) == "" {
		return fmt.Errorf("%w: currency required", ErrInvalidInput)
	}
	switch input.SourceType {
	case "", SourceManual, SourceScreenshot, SourceLink:
	default:
		return fmt.Errorf("%w: invalid source type", ErrInvalidInput)
	}
	if err := ValidateAnswers(input.Answers); err != nil {
		return err
	}
	return nil
}

func ValidateAnswers(answers Answers) error {
	switch answers.WhyBuy {
	case WhyNeed, WhyReward, WhyPromo, WhyFOMO, WhyEmotion, WhyOther:
	default:
		return fmt.Errorf("%w: invalid why buy", ErrInvalidInput)
	}
	if answers.WhyBuy == WhyOther && strings.TrimSpace(answers.OtherReason) == "" {
		return fmt.Errorf("%w: other reason required", ErrInvalidInput)
	}
	switch answers.SimilarCount {
	case SimilarNone, SimilarOne, SimilarMany:
	default:
		return fmt.Errorf("%w: invalid similar count", ErrInvalidInput)
	}
	if answers.SimilarCount != SimilarNone {
		switch answers.SimilarInUse {
		case "yes", "no":
		default:
			return fmt.Errorf("%w: similar in use required", ErrInvalidInput)
		}
	}
	switch answers.UsageFrequency {
	case UseDaily, UseWeekly, UseMonthly, UseRarely, UseNever:
	default:
		return fmt.Errorf("%w: invalid usage frequency", ErrInvalidInput)
	}
	switch answers.WantsAfter24h {
	case WantsYes, WantsNo, WantsUnsure:
	default:
		return fmt.Errorf("%w: invalid wants after 24h", ErrInvalidInput)
	}
	if len([]rune(answers.Note)) > 200 {
		return fmt.Errorf("%w: note too long", ErrInvalidInput)
	}
	if len([]rune(answers.OtherReason)) > 60 {
		return fmt.Errorf("%w: other reason too long", ErrInvalidInput)
	}
	return nil
}

func EffectiveHourlyWage(settings Settings) (int64, bool) {
	if settings.HourlyWageCents > 0 {
		return settings.HourlyWageCents, true
	}
	if settings.MonthlySalaryCents > 0 && settings.MonthlyWorkHours > 0 {
		return int64(math.Round(float64(settings.MonthlySalaryCents) / settings.MonthlyWorkHours)), true
	}
	return 0, false
}

func ComputeMetrics(input ItemInput, settings Settings) (hourlyWageCents int64, monthlySalaryCents int64, equivalentHours *float64, incomeRatio *float64, risk string, reasons []string) {
	hourlyWageCents, hasWage := EffectiveHourlyWage(settings)
	monthlySalaryCents = settings.MonthlySalaryCents
	if hasWage {
		value := float64(input.PriceCents) / float64(hourlyWageCents)
		equivalentHours = &value
	}
	if monthlySalaryCents > 0 {
		value := float64(input.PriceCents) / float64(monthlySalaryCents) * 100
		incomeRatio = &value
	}
	risk, reasons = RiskLevel(input.Answers, equivalentHours, incomeRatio)
	return hourlyWageCents, monthlySalaryCents, equivalentHours, incomeRatio, risk, reasons
}

func RiskLevel(answers Answers, equivalentHours *float64, incomeRatio *float64) (string, []string) {
	var reasons []string
	high := false
	medium := false

	if answers.SimilarCount != SimilarNone && answers.SimilarInUse == "no" {
		high = true
		reasons = append(reasons, "已有类似物品且不经常使用")
	}
	if equivalentHours != nil && *equivalentHours >= 20 {
		high = true
		reasons = append(reasons, "等价工时达到 20 小时及以上")
	}
	if answers.WantsAfter24h == WantsNo || answers.WantsAfter24h == WantsUnsure {
		high = true
		reasons = append(reasons, "24 小时后答案是“否”或“不确定”")
	}
	if answers.UsageFrequency == UseRarely || answers.UsageFrequency == UseNever {
		medium = true
		reasons = append(reasons, "预计使用频率偏低")
	}
	if answers.WhyBuy == WhyPromo || answers.WhyBuy == WhyFOMO || answers.WhyBuy == WhyEmotion {
		medium = true
		reasons = append(reasons, "购买原因更偏向情绪或促销")
	}
	if incomeRatio != nil && *incomeRatio >= 20 {
		medium = true
		reasons = append(reasons, "价格占月收入比例偏高")
	}
	if high {
		return RiskHigh, reasons
	}
	if medium {
		return RiskMedium, reasons
	}
	return RiskLow, reasons
}
