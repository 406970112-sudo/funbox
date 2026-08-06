package gooutchecklist

var TemplateLibrary = []Template{
	{
		ID:   "work",
		Name: "上班模式",
		Icon: "briefcase",
		Items: []TemplateItem{
			{Name: "手机", Icon: "smartphone"},
			{Name: "钥匙", Icon: "key"},
			{Name: "工牌", Icon: "id-card"},
			{Name: "耳机", Icon: "headphones"},
		},
	},
	{
		ID:   "travel",
		Name: "旅行模式",
		Icon: "luggage",
		Items: []TemplateItem{
			{Name: "身份证", Icon: "id-card"},
			{Name: "充电器", Icon: "battery-charging"},
			{Name: "药品", Icon: "pill"},
			{Name: "换洗衣物", Icon: "shirt"},
		},
	},
	{
		ID:   "sport",
		Name: "运动模式",
		Icon: "dumbbell",
		Items: []TemplateItem{
			{Name: "水杯", Icon: "cup", WeatherRuleIDs: []string{"heat-water"}},
			{Name: "毛巾", Icon: "shirt"},
			{Name: "耳机", Icon: "headphones"},
			{Name: "门禁卡", Icon: "credit-card"},
		},
	},
}

func findTemplate(id string) *Template {
	for index := range TemplateLibrary {
		if TemplateLibrary[index].ID == id {
			return &TemplateLibrary[index]
		}
	}
	return nil
}
