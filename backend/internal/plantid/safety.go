package plantid

import (
	"strings"
)

const safetyStateEdible = "edible"
const safetyStatePoisonous = "poisonous"
const safetyStateUnknown = "unknown"

var edibleKeywords = []string{
	"可食", "食用", "可作野菜", "榨油", "蔬菜", "食材", "药食",
}

var poisonousKeywords = []string{
	"有毒", "毒性", "剧毒", "不可食", "勿食", "不能吃", "不宜食用", "含毒",
}

type safetyWarning struct {
	ScientificNames []string
	CommonNames     []string
	Quote           string
	SourceURL       string
}

var safetyWarnings = []safetyWarning{
	{
		ScientificNames: []string{"Nerium oleander"},
		CommonNames:     []string{"夹竹桃"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/夹竹桃",
	},
	{
		ScientificNames: []string{"Datura stramonium"},
		CommonNames:     []string{"曼陀罗"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/曼陀罗",
	},
	{
		ScientificNames: []string{"Convallaria majalis"},
		CommonNames:     []string{"铃兰"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/铃兰",
	},
	{
		ScientificNames: []string{"Aconitum"},
		CommonNames:     []string{"乌头"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/乌头",
	},
	{
		ScientificNames: []string{"Ricinus communis"},
		CommonNames:     []string{"蓖麻"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/蓖麻",
	},
	{
		ScientificNames: []string{"Cicuta"},
		CommonNames:     []string{"毒芹"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/毒芹",
	},
	{
		ScientificNames: []string{"Colchicum autumnale"},
		CommonNames:     []string{"秋水仙"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/秋水仙",
	},
	{
		ScientificNames: []string{"Phytolacca"},
		CommonNames:     []string{"商陆"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/商陆",
	},
	{
		ScientificNames: []string{"Aristolochia"},
		CommonNames:     []string{"马兜铃"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/马兜铃",
	},
	{
		ScientificNames: []string{"Narcissus"},
		CommonNames:     []string{"水仙"},
		Quote:           "该物种被权威词条记录为有毒植物，请勿采食或接触汁液。",
		SourceURL:       "https://zh.wikipedia.org/wiki/水仙",
	},
}

func analyzeSafety(scientificName string, commonNames []string, extract string) SafetyInfo {
	for _, warning := range safetyWarnings {
		if nameMatches(scientificName, warning.ScientificNames) || nameMatchesAny(commonNames, warning.CommonNames) {
			return SafetyInfo{
				State:     safetyStatePoisonous,
				Quote:     warning.Quote,
				Source:    "wikipedia",
				Note:      "该物种列于人工审校警示表，请勿采食或接触汁液。",
				CheckedAt: nowISO(),
			}
		}
	}

	lower := strings.ToLower(extract)
	if containsAny(lower, poisonousKeywords) {
		return SafetyInfo{
			State:     safetyStatePoisonous,
			Quote:     extractQuote(extract, poisonousKeywords),
			Source:    "wikipedia",
			Note:      "词条原文包含毒性相关描述，请勿采食或接触汁液。",
			CheckedAt: nowISO(),
		}
	}
	if containsAny(lower, edibleKeywords) {
		return SafetyInfo{
			State:     safetyStateEdible,
			Quote:     extractQuote(extract, edibleKeywords),
			Source:    "wikipedia",
			Note:      "词条原文包含可食用相关描述，具体部位与食用方式请以权威来源为准。",
			CheckedAt: nowISO(),
		}
	}
	return SafetyInfo{
		State:     safetyStateUnknown,
		Note:      safetyUnknownNote,
		CheckedAt: nowISO(),
	}
}

func nameMatches(name string, candidates []string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(name))
	if trimmed == "" {
		return false
	}
	for _, candidate := range candidates {
		if strings.Contains(trimmed, strings.ToLower(candidate)) {
			return true
		}
	}
	return false
}

func nameMatchesAny(names []string, candidates []string) bool {
	for _, name := range names {
		if nameMatches(name, candidates) {
			return true
		}
	}
	return false
}

func containsAny(text string, keywords []string) bool {
	for _, keyword := range keywords {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}

func extractQuote(extract string, keywords []string) string {
	for _, sentence := range splitSentences(extract) {
		lower := strings.ToLower(sentence)
		for _, keyword := range keywords {
			if strings.Contains(lower, keyword) {
				trimmed := strings.TrimSpace(sentence)
				if len(trimmed) > 220 {
					trimmed = trimmed[:220] + "…"
				}
				return trimmed
			}
		}
	}
	trimmed := strings.TrimSpace(extract)
	if len(trimmed) > 220 {
		trimmed = trimmed[:220] + "…"
	}
	return trimmed
}

func splitSentences(text string) []string {
	replacer := strings.NewReplacer("。", "\n", "！", "\n", "？", "\n", ";", "\n", ";", "\n")
	return strings.FieldsFunc(replacer.Replace(text), func(r rune) bool {
		return r == '\n'
	})
}

const commonPlantsFetchedAt = "2026-08-02T06:00:00Z"

func commonPlantsSnapshot() []CommonPlant {
	return []CommonPlant{
		{
			GBIFKey:        3119195,
			NameZh:         "向日葵",
			ScientificName: "Helianthus annuus",
			FamilyZh:       "菊科",
			ImageURL:       "https://inaturalist-open-data.s3.amazonaws.com/photos/323768723/medium.jpg",
			ImageSource:    "inaturalist",
			ImageCredit:    "Emily Scherer · CC BY-NC",
			FetchedAt:      commonPlantsFetchedAt,
		},
		{
			GBIFKey:        2687885,
			NameZh:         "银杏",
			ScientificName: "Ginkgo biloba",
			FamilyZh:       "银杏科",
			ImageURL:       "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/GINKGOBAUM-2.jpg/960px-GINKGOBAUM-2.jpg",
			ImageSource:    "wikimedia",
			FetchedAt:      commonPlantsFetchedAt,
		},
		{
			GBIFKey:        5394645,
			NameZh:         "蒲公英",
			ScientificName: "Taraxacum mongolicum",
			FamilyZh:       "菊科",
			ImageURL:       "https://upload.wikimedia.org/wikipedia/commons/8/84/Head_to_Head_-_geograph.org.uk_-_409345.jpg",
			ImageSource:    "wikimedia",
			FetchedAt:      commonPlantsFetchedAt,
		},
		{
			GBIFKey:        8395064,
			NameZh:         "蔷薇属",
			ScientificName: "Rosa",
			FamilyZh:       "蔷薇科",
			ImageURL:       "https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Divlja_ruza_cvijet_270508.jpg/960px-Divlja_ruza_cvijet_270508.jpg",
			ImageSource:    "wikimedia",
			FetchedAt:      commonPlantsFetchedAt,
		},
	}
}
