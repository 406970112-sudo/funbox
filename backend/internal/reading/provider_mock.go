package reading

import (
	"context"
	"fmt"
	"sort"
	"time"
)

type mockBook struct {
	book     ProviderBook
	chapters []ChapterContent
}

type MockProvider struct {
	books map[string]mockBook
}

func NewMockProvider() *MockProvider {
	return &MockProvider{books: map[string]mockBook{
		"observatory": {
			book: ProviderBook{ExternalID: "observatory", Title: "星河观测站", Author: "顾远舟", Intro: "年轻天文学家在高原观测站发现一组不属于任何已知天体的信号，也重新理解了父亲留下的沉默。", Category: "科幻", Tags: []string{"治愈", "宇宙", "成长"}, SerialStatus: "completed", WordCount: 186000},
			chapters: []ChapterContent{
				{ChapterID: "signal", Title: "第一章 未知信号", SortOrder: 1, WordCount: 2180, Content: "凌晨两点十七分，观测站的警报第一次响起。\n\n程砚推开控制室的门，屏幕上那条细而稳定的光谱像一封迟到了许多年的信。它不是脉冲星，也不像任何人造卫星留下的噪声。\n\n风从山口越过，穹顶缓慢旋转。他忽然想起父亲曾说，真正重要的发现，总会先让人感到孤独。"},
				{ChapterID: "notebook", Title: "第二章 父亲的笔记", SortOrder: 2, WordCount: 2450, Content: "旧柜最底层藏着一本蓝布封面的笔记。\n\n泛黄的纸页记录着相同频率的信号，日期却是二十年前。父亲在最后一页写下：不要急着回答，先学会倾听。\n\n程砚把笔记摊在星图旁，第一次意识到，父亲离开前并没有放弃这座观测站。"},
				{ChapterID: "reply", Title: "第三章 来自群星的回信", SortOrder: 3, WordCount: 2680, Content: "天亮前，信号完成了第三次重复。\n\n序列被译成一组坐标，指向银河边缘一颗暗淡的恒星。程砚没有立刻上报，他先按下记录键，把山谷的风声和自己的心跳一同留在数据里。\n\n他终于明白，那不是对某个人的回答，而是宇宙邀请所有仍愿意抬头的人继续发问。"},
			},
		},
		"corridor": {
			book: ProviderBook{ExternalID: "corridor", Title: "长街灯火", Author: "苏弥", Intro: "一条老街、三代店主与十二封从未寄出的信，共同拼出城市缓慢改变的模样。", Category: "都市", Tags: []string{"群像", "温情", "生活"}, SerialStatus: "serializing", WordCount: 223000},
			chapters: []ChapterContent{
				{ChapterID: "return", Title: "第一章 归来", SortOrder: 1, WordCount: 1900, Content: "雨停时，长街的灯一盏接一盏亮了起来。\n\n许知遥拖着箱子站在旧照相馆门口，玻璃上还贴着十年前的营业时间。钥匙转动得很慢，像一段生锈的记忆。"},
				{ChapterID: "letters", Title: "第二章 未寄出的信", SortOrder: 2, WordCount: 2050, Content: "抽屉里有十二封没有地址的信。\n\n每一封都写给同一个人，每一封的落款却属于不同年份。许知遥把它们按时间排好，长街的旧事便从纸面一点点醒来。"},
				{ChapterID: "lamps", Title: "第三章 灯火如常", SortOrder: 3, WordCount: 2260, Content: "新招牌挂上的那天，街坊们都来帮忙。\n\n天色暗下来，照相馆的灯重新亮起。许知遥隔着橱窗看见每个人的倒影，终于知道，有些归来不是回到从前，而是愿意从这里重新开始。"},
			},
		},
		"mountain": {
			book: ProviderBook{ExternalID: "mountain", Title: "山海之间", Author: "闻栖", Intro: "地质队员与海岛医生沿着断裂带寻找失踪村落，也找到各自不敢面对的答案。", Category: "现实", Tags: []string{"冒险", "自然", "情感"}, SerialStatus: "completed", WordCount: 168000},
			chapters: []ChapterContent{
				{ChapterID: "tide", Title: "第一章 潮汐线", SortOrder: 1, WordCount: 2100, Content: "海水退去后，黑色礁石露出一道新鲜的裂痕。\n\n沈岚蹲在潮汐线上记录走向，远处诊所的白旗被风吹得猎猎作响。岛上的老人说，昨夜山里传来了一声闷雷。"},
				{ChapterID: "village", Title: "第二章 地图上的空白", SortOrder: 2, WordCount: 2310, Content: "旧地图把村落画在两条等高线之间，新地图上却只剩一块没有名字的灰。\n\n沈岚和周医生沿着废弃山路前进，路边每隔一段就有一盏坏掉的太阳能灯，像有人曾经认真等待他们回来。"},
				{ChapterID: "between", Title: "第三章 山海之间", SortOrder: 3, WordCount: 2490, Content: "断裂带在海崖前结束，村落的遗址就在另一侧。\n\n他们没有找到想象中的奇迹，却找到了完整的迁居名单。海风翻动纸页，山与海之间终于不再只有空白。"},
			},
		},
	}}
}

func (p *MockProvider) Key() string { return "mock-yuewen" }

func (p *MockProvider) ListBooks(_ context.Context, _ string) (BookPage, error) {
	ids := make([]string, 0, len(p.books))
	for id := range p.books {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	books := make([]ProviderBook, 0, len(ids))
	for _, id := range ids {
		books = append(books, p.books[id].book)
	}
	return BookPage{Books: books}, nil
}

func (p *MockProvider) GetBook(_ context.Context, externalID string) (ProviderBook, error) {
	book, ok := p.books[externalID]
	if !ok {
		return ProviderBook{}, fmt.Errorf("%w: mock book %s", ErrNotFound, externalID)
	}
	return book.book, nil
}

func (p *MockProvider) ListChapters(_ context.Context, externalID string, _ string) (ChapterPage, error) {
	book, ok := p.books[externalID]
	if !ok {
		return ChapterPage{}, fmt.Errorf("%w: mock book %s", ErrNotFound, externalID)
	}
	chapters := make([]ProviderChapter, 0, len(book.chapters))
	for _, chapter := range book.chapters {
		chapters = append(chapters, ProviderChapter{ExternalID: chapter.ChapterID, Title: chapter.Title, SortOrder: chapter.SortOrder, WordCount: chapter.WordCount})
	}
	return ChapterPage{Chapters: chapters}, nil
}

func (p *MockProvider) GetChapter(_ context.Context, externalBookID, externalChapterID, _ string) (ChapterContent, error) {
	book, ok := p.books[externalBookID]
	if !ok {
		return ChapterContent{}, fmt.Errorf("%w: mock book %s", ErrNotFound, externalBookID)
	}
	for index, chapter := range book.chapters {
		if chapter.ChapterID != externalChapterID {
			continue
		}
		if index > 0 {
			chapter.PreviousID = book.chapters[index-1].ChapterID
		}
		if index+1 < len(book.chapters) {
			chapter.NextID = book.chapters[index+1].ChapterID
		}
		return chapter, nil
	}
	return ChapterContent{}, fmt.Errorf("%w: mock chapter %s", ErrNotFound, externalChapterID)
}

func (p *MockProvider) ListUpdatedBooks(_ context.Context, _, _ time.Time) ([]string, error) {
	page, _ := p.ListBooks(context.Background(), "")
	ids := make([]string, 0, len(page.Books))
	for _, book := range page.Books {
		ids = append(ids, book.ExternalID)
	}
	return ids, nil
}

func (p *MockProvider) ListRemovedBooks(context.Context, time.Time, time.Time) ([]string, error) {
	return []string{}, nil
}
