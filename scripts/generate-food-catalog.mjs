import fs from 'node:fs';
import path from 'node:path';

const catalogPath = path.resolve('backend/internal/foodrecommendation/catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const images = {
  hotpot: catalog.find((d) => d.id === 'cd-hotpot-jiugongge').image,
  mapo: catalog.find((d) => d.id === 'cd-mapo-tofu').image,
  dandan: catalog.find((d) => d.id === 'cd-dandan-noodles').image,
  zhong: catalog.find((d) => d.id === 'cd-zhong-dumpling').image,
  bobo: catalog.find((d) => d.id === 'cd-bobo-chicken').image,
  bingfen: catalog.find((d) => d.id === 'cd-bingfen').image,
  wanza: catalog.find((d) => d.id === 'cq-wanza-noodles').image,
  suanlafen: catalog.find((d) => d.id === 'cq-suanlafen').image,
  maoxuewang: catalog.find((d) => d.id === 'cq-maoxuewang').image,
  tangyuan: catalog.find((d) => d.id === 'cq-tangyuan').image,
};

const streets = [
  '玉林西路 12 号',
  '武侯祠大街 8 号',
  '春熙路 66 号',
  '下东大街 2 号',
  '人民南路四段 20 号',
  '望平街 9 号',
  '建设路 43 号',
  '科华北路 58 号',
  '少城路 17 号',
  '宽窄巷子 25 号',
  '解放碑步行街 10 号',
  '八一路 176 号',
  '较场口 90 号',
  '观音桥好吃街 3 号',
  '南坪西路 88 号',
  '杨家坪正街 6 号',
  '磁器口正街 15 号',
  '龙湖时代天街 C 馆',
];

const districts = {
  成都: ['武侯区', '锦江区', '青羊区', '成华区', '金牛区', '高新区'],
  重庆: ['渝中区', '江北区', '南岸区', '九龙坡区', '沙坪坝区', '渝北区'],
};

function slug(value) {
  return value
    .replace(/[（()）]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')
    .replace(/-+/g, '-');
}

function imageFor(name, cuisine) {
  const text = name + cuisine;
  if (/火锅|串串|烧烤|冒菜|烤|把把/.test(text)) return images.hotpot;
  if (/甜品|冰粉|汤圆|糍粑|凉糕|凉虾|豆花|醪糟|糖油|蛋烘|三大炮|桃片|米花|三角粑/.test(text)) {
    return /汤圆|醪糟/.test(text) ? images.tangyuan : images.bingfen;
  }
  if (/面|粉|抄手|水饺|馄饨/.test(text)) {
    if (/豌|杂/.test(text)) return images.wanza;
    if (/酸辣/.test(text)) return images.suanlafen;
    return images.dandan;
  }
  if (/血旺|鱼|鸡|肉|回锅|宫保|水煮|蒜泥|夫妻|肺片|兔头|脑花/.test(text)) {
    if (/血旺/.test(text)) return images.maoxuewang;
    if (/钵|串/.test(text)) return images.bobo;
    return images.mapo;
  }
  if (/水饺|抄手/.test(text)) return images.zhong;
  return images.bobo;
}

function reasonFor(name, price, distanceKm) {
  return [
    { label: '本地味', text: `${name}是本地人常点的代表味道，口味有辨识度` },
    { label: '距离', text: `距你 ${distanceKm.toFixed(1)}km，步行或短途即可到达` },
    { label: '人均', text: `人均约 ¥${price}，性价比适合日常尝试` },
  ];
}

const chengduTemplates = [
  { name: '回锅肉', cuisine: '川菜', spiciness: '中辣', avgPrice: 38, rating: 4.6, bestTime: '中午', suitableFor: ['一人食', '家常'], ingredients: ['五花肉', '蒜苗', '郫县豆瓣', '甜面酱'], flavorProfile: ['咸鲜', '微辣', '油润'] },
  { name: '宫保鸡丁', cuisine: '川菜', spiciness: '中辣', avgPrice: 36, rating: 4.5, bestTime: '中午', suitableFor: ['一人食', '家常'], ingredients: ['鸡腿肉', '花生米', '干辣椒', '葱段'], flavorProfile: ['酸甜', '微辣', '干香'] },
  { name: '夫妻肺片', cuisine: '川菜', spiciness: '中辣', avgPrice: 42, rating: 4.7, bestTime: '中午', suitableFor: ['朋友聚餐', '下酒'], ingredients: ['牛肉', '牛杂', '红油', '花生碎'], flavorProfile: ['麻辣', '鲜香', '红油'] },
  { name: '水煮鱼', cuisine: '川菜', spiciness: '重辣', avgPrice: 78, rating: 4.6, bestTime: '晚上', suitableFor: ['朋友聚餐'], ingredients: ['草鱼', '豆芽', '干辣椒', '花椒'], flavorProfile: ['麻辣', '鲜嫩', '重油'] },
  { name: '鱼香肉丝', cuisine: '川菜', spiciness: '微辣', avgPrice: 30, rating: 4.5, bestTime: '中午', suitableFor: ['一人食', '家常'], ingredients: ['里脊肉', '木耳', '笋丝', '泡椒'], flavorProfile: ['鱼香', '微辣', '酸甜'] },
  { name: '蒜泥白肉', cuisine: '川菜', spiciness: '微辣', avgPrice: 34, rating: 4.5, bestTime: '中午', suitableFor: ['家常', '下酒'], ingredients: ['五花肉', '蒜泥', '红油', '黄瓜'], flavorProfile: ['蒜香', '微辣', '咸鲜'] },
  { name: '龙抄手', cuisine: '小吃', spiciness: '微辣', avgPrice: 22, rating: 4.6, bestTime: '早上', suitableFor: ['一人食', '早餐'], ingredients: ['面皮', '猪肉馅', '清汤', '胡椒'], flavorProfile: ['清鲜', '微辣', '皮滑'] },
  { name: '甜水面', cuisine: '面食', spiciness: '中辣', avgPrice: 16, rating: 4.5, bestTime: '中午', suitableFor: ['一人食', '小吃'], ingredients: ['手工面', '复制酱油', '红油', '芝麻酱'], flavorProfile: ['甜辣', '干香', '筋道'] },
  { name: '红糖糍粑', cuisine: '甜品', spiciness: '不辣', avgPrice: 12, rating: 4.5, bestTime: '下午', suitableFor: ['一人食', '解辣'], ingredients: ['糯米', '红糖', '黄豆粉'], flavorProfile: ['甜糯', '红糖香', '软糯'] },
  { name: '蛋烘糕', cuisine: '小吃', spiciness: '不辣', avgPrice: 8, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['鸡蛋', '面粉', '红糖', '芝麻'], flavorProfile: ['甜香', '绵软', '蛋香'] },
  { name: '糖油果子', cuisine: '小吃', spiciness: '不辣', avgPrice: 8, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['糯米粉', '红糖', '芝麻'], flavorProfile: ['甜脆', '红糖香', '酥糯'] },
  { name: '三大炮', cuisine: '小吃', spiciness: '不辣', avgPrice: 10, rating: 4.5, bestTime: '下午', suitableFor: ['游客', '一人食'], ingredients: ['糯米', '黄豆粉', '红糖'], flavorProfile: ['甜糯', '黄豆香', '有嚼劲'] },
  { name: '烤脑花', cuisine: '烧烤', spiciness: '重辣', avgPrice: 20, rating: 4.6, bestTime: '夜宵', suitableFor: ['夜宵', '重口味'], ingredients: ['猪脑', '红油', '蒜蓉', '香菜'], flavorProfile: ['麻辣', '滑嫩', '蒜香'] },
  { name: '烤苕皮', cuisine: '烧烤', spiciness: '中辣', avgPrice: 12, rating: 4.5, bestTime: '夜宵', suitableFor: ['夜宵', '一人食'], ingredients: ['红薯粉皮', '酸豆角', '辣椒面', '葱花'], flavorProfile: ['香辣', '软糯', '酸香'] },
  { name: '冷锅串串', cuisine: '小吃', spiciness: '中辣', avgPrice: 35, rating: 4.6, bestTime: '晚上', suitableFor: ['朋友聚餐', '夜宵'], ingredients: ['牛肉', '郡肝', '藕片', '红油'], flavorProfile: ['香辣', '麻香', '回甜'] },
  { name: '串串香', cuisine: '火锅', spiciness: '重辣', avgPrice: 55, rating: 4.5, bestTime: '夜宵', suitableFor: ['朋友聚餐', '夜宵'], ingredients: ['牛肉', '郡肝', '土豆', '牛油锅底'], flavorProfile: ['麻辣', '牛油香', '重口'] },
  { name: '冒菜', cuisine: '川菜', spiciness: '中辣', avgPrice: 26, rating: 4.4, bestTime: '中午', suitableFor: ['一人食', '工作餐'], ingredients: ['午餐肉', '藕片', '豆皮', '红油汤'], flavorProfile: ['麻辣', '香浓', '下饭'] },
  { name: '兔头', cuisine: '小吃', spiciness: '重辣', avgPrice: 16, rating: 4.7, bestTime: '晚上', suitableFor: ['下酒', '夜宵'], ingredients: ['兔头', '辣椒', '花椒', '香料'], flavorProfile: ['麻辣', '干香', '入味'] },
  { name: '肥肠粉', cuisine: '面食', spiciness: '中辣', avgPrice: 18, rating: 4.6, bestTime: '早上', suitableFor: ['一人食', '早餐'], ingredients: ['红薯粉', '肥肠', '红油', '榨菜'], flavorProfile: ['麻辣', '肠香', '爽滑'] },
  { name: '牛肉焦饼', cuisine: '小吃', spiciness: '微辣', avgPrice: 10, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['面粉', '牛肉馅', '花椒面', '芝麻'], flavorProfile: ['咸香', '酥脆', '微麻'] },
  { name: '叶儿粑', cuisine: '小吃', spiciness: '不辣', avgPrice: 10, rating: 4.4, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['糯米粉', '猪肉馅', '芽菜', '粽叶'], flavorProfile: ['咸香', '软糯', '叶香'] },
  { name: '凉糕', cuisine: '甜品', spiciness: '不辣', avgPrice: 8, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '解辣'], ingredients: ['大米', '红糖', '黄豆粉'], flavorProfile: ['清甜', '凉滑', '米香'] },
  { name: '豆花', cuisine: '小吃', spiciness: '不辣', avgPrice: 9, rating: 4.4, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['黄豆', '石膏', '辣椒油', '葱花'], flavorProfile: ['嫩滑', '豆香', '咸鲜'] },
  { name: '跷脚牛肉', cuisine: '川菜', spiciness: '不辣', avgPrice: 45, rating: 4.6, bestTime: '中午', suitableFor: ['朋友聚餐', '带家人'], ingredients: ['牛腱', '牛杂', '芹菜', '药材汤'], flavorProfile: ['清鲜', '牛肉香', '暖胃'] },
  { name: '宜宾燃面', cuisine: '面食', spiciness: '中辣', avgPrice: 16, rating: 4.5, bestTime: '中午', suitableFor: ['一人食', '早餐'], ingredients: ['水面', '碎米芽菜', '花生碎', '红油'], flavorProfile: ['干香', '麻辣', '油润'] },
  { name: '军屯锅盔', cuisine: '小吃', spiciness: '微辣', avgPrice: 9, rating: 4.5, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['面粉', '猪肉馅', '花椒面', '猪油'], flavorProfile: ['酥脆', '咸香', '微麻'] },
  { name: '醪糟蛋', cuisine: '甜品', spiciness: '不辣', avgPrice: 10, rating: 4.4, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['醪糟', '鸡蛋', '小汤圆', '枸杞'], flavorProfile: ['甜润', '酒香', '暖胃'] },
];

const chongqingTemplates = [
  { name: '重庆小面', cuisine: '面食', spiciness: '中辣', avgPrice: 14, rating: 4.6, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['水面', '辣椒油', '花椒面', '榨菜'], flavorProfile: ['麻辣', '干香', '筋道'] },
  { name: '老麻抄手', cuisine: '面食', spiciness: '重辣', avgPrice: 16, rating: 4.6, bestTime: '早上', suitableFor: ['一人食', '早餐'], ingredients: ['面皮', '猪肉馅', '花椒', '红油'], flavorProfile: ['麻香', '鲜辣', '皮薄'] },
  { name: '口水鸡', cuisine: '川菜', spiciness: '中辣', avgPrice: 48, rating: 4.6, bestTime: '中午', suitableFor: ['朋友聚餐', '下酒'], ingredients: ['土鸡', '红油', '花生', '芝麻'], flavorProfile: ['麻辣', '鲜香', '红油'] },
  { name: '辣子鸡', cuisine: '川菜', spiciness: '重辣', avgPrice: 52, rating: 4.6, bestTime: '晚上', suitableFor: ['朋友聚餐', '下酒'], ingredients: ['鸡丁', '干辣椒', '花椒', '花生'], flavorProfile: ['麻辣', '干香', '酥脆'] },
  { name: '来凤鱼', cuisine: '川菜', spiciness: '重辣', avgPrice: 68, rating: 4.5, bestTime: '晚上', suitableFor: ['朋友聚餐'], ingredients: ['江团', '泡椒', '辣椒', '豆瓣'], flavorProfile: ['酸辣', '鲜嫩', '重口'] },
  { name: '黔江鸡杂', cuisine: '川菜', spiciness: '重辣', avgPrice: 42, rating: 4.6, bestTime: '晚上', suitableFor: ['朋友聚餐', '下饭'], ingredients: ['鸡杂', '泡椒', '洋葱', '土豆'], flavorProfile: ['酸辣', '脆爽', '下饭'] },
  { name: '泉水鸡', cuisine: '川菜', spiciness: '中辣', avgPrice: 58, rating: 4.5, bestTime: '晚上', suitableFor: ['朋友聚餐', '带家人'], ingredients: ['土鸡', '泉水', '花椒', '辣椒'], flavorProfile: ['麻辣', '鸡肉鲜', '汤汁浓'] },
  { name: '重庆烤鱼', cuisine: '烧烤', spiciness: '重辣', avgPrice: 72, rating: 4.6, bestTime: '晚上', suitableFor: ['朋友聚餐', '夜宵'], ingredients: ['草鱼', '豆芽', '干辣椒', '花椒'], flavorProfile: ['麻辣', '焦香', '重油'] },
  { name: '重庆火锅', cuisine: '火锅', spiciness: '重辣', avgPrice: 85, rating: 4.7, bestTime: '晚上', suitableFor: ['朋友聚餐', '夜宵'], ingredients: ['牛油', '花椒', '辣椒', '毛肚'], flavorProfile: ['麻辣', '牛油香', '重口'] },
  { name: '串串香', cuisine: '火锅', spiciness: '中辣', avgPrice: 50, rating: 4.5, bestTime: '晚上', suitableFor: ['朋友聚餐', '夜宵'], ingredients: ['牛肉', '郡肝', '土豆', '红油'], flavorProfile: ['香辣', '麻香', '回甜'] },
  { name: '冰汤圆', cuisine: '甜品', spiciness: '不辣', avgPrice: 12, rating: 4.5, bestTime: '下午', suitableFor: ['一人食', '解辣'], ingredients: ['小汤圆', '红糖冰沙', '醪糟', '山楂'], flavorProfile: ['清甜', '冰凉', '软糯'] },
  { name: '凉虾', cuisine: '甜品', spiciness: '不辣', avgPrice: 8, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '解辣'], ingredients: ['米浆', '红糖', '柠檬'], flavorProfile: ['清甜', '凉滑', '果酸'] },
  { name: '重庆冰粉', cuisine: '甜品', spiciness: '不辣', avgPrice: 9, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '解辣'], ingredients: ['冰粉籽', '红糖', '山楂', '葡萄干'], flavorProfile: ['清甜', '冰凉', '果香'] },
  { name: '担担面', cuisine: '面食', spiciness: '中辣', avgPrice: 15, rating: 4.5, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['水面', '杂酱', '芝麻酱', '红油'], flavorProfile: ['麻辣', '干香', '酱香'] },
  { name: '牛肉面', cuisine: '面食', spiciness: '中辣', avgPrice: 18, rating: 4.5, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['碱水面', '牛腩', '辣椒油', '香菜'], flavorProfile: ['麻辣', '牛肉香', '浓郁'] },
  { name: '豆花饭', cuisine: '小吃', spiciness: '不辣', avgPrice: 12, rating: 4.4, bestTime: '中午', suitableFor: ['一人食', '工作餐'], ingredients: ['豆花', '米饭', '辣椒蘸水', '葱花'], flavorProfile: ['嫩滑', '豆香', '家常'] },
  { name: '油茶', cuisine: '小吃', spiciness: '微辣', avgPrice: 10, rating: 4.5, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['米糊', '馓子', '辣椒油', '花生'], flavorProfile: ['咸香', '微辣', '酥脆'] },
  { name: '熨斗糕', cuisine: '小吃', spiciness: '不辣', avgPrice: 8, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['米浆', '鸡蛋', '红糖', '猪油'], flavorProfile: ['甜香', '软糯', '米香'] },
  { name: '冲冲糕', cuisine: '小吃', spiciness: '不辣', avgPrice: 8, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['米粉', '红糖', '芝麻'], flavorProfile: ['甜糯', '松软', '米香'] },
  { name: '鸡丝凉面', cuisine: '面食', spiciness: '中辣', avgPrice: 16, rating: 4.5, bestTime: '中午', suitableFor: ['一人食', '夏日'], ingredients: ['水面', '鸡丝', '红油', '花生'], flavorProfile: ['麻辣', '鲜香', '爽口'] },
  { name: '灯影牛肉', cuisine: '小吃', spiciness: '中辣', avgPrice: 22, rating: 4.6, bestTime: '下午', suitableFor: ['下酒', '伴手礼'], ingredients: ['黄牛肉', '辣椒面', '花椒', '芝麻'], flavorProfile: ['麻辣', '薄脆', '干香'] },
  { name: '合川桃片', cuisine: '甜品', spiciness: '不辣', avgPrice: 15, rating: 4.4, bestTime: '下午', suitableFor: ['伴手礼', '一人食'], ingredients: ['糯米', '核桃仁', '白糖', '蜜玫瑰'], flavorProfile: ['甜糯', '桃仁香', '绵软'] },
  { name: '米花糖', cuisine: '甜品', spiciness: '不辣', avgPrice: 12, rating: 4.4, bestTime: '下午', suitableFor: ['伴手礼', '一人食'], ingredients: ['糯米', '白糖', '麦芽糖', '花生'], flavorProfile: ['甜脆', '米香', '酥松'] },
  { name: '三角粑', cuisine: '小吃', spiciness: '不辣', avgPrice: 7, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '逛街'], ingredients: ['大米浆', '白糖', '芝麻'], flavorProfile: ['甜香', '外壳脆', '内软'] },
  { name: '陈麻花', cuisine: '小吃', spiciness: '不辣', avgPrice: 10, rating: 4.5, bestTime: '下午', suitableFor: ['伴手礼', '一人食'], ingredients: ['面粉', '鸡蛋', '芝麻', '糖'], flavorProfile: ['甜酥', '香脆', '芝麻香'] },
  { name: '山城小汤圆', cuisine: '甜品', spiciness: '不辣', avgPrice: 12, rating: 4.4, bestTime: '下午', suitableFor: ['一人食', '解辣'], ingredients: ['糯米粉', '芝麻馅', '红糖', '醪糟'], flavorProfile: ['清甜', '软糯', '酒香'] },
  { name: '万州烤鱼', cuisine: '烧烤', spiciness: '重辣', avgPrice: 68, rating: 4.6, bestTime: '晚上', suitableFor: ['朋友聚餐', '夜宵'], ingredients: ['草鱼', '豆芽', '泡椒', '干辣椒'], flavorProfile: ['麻辣', '焦香', '重油'] },
  { name: '涪陵油醪糟', cuisine: '甜品', spiciness: '不辣', avgPrice: 11, rating: 4.4, bestTime: '早上', suitableFor: ['早餐', '一人食'], ingredients: ['糯米', '醪糟', '猪油', '芝麻'], flavorProfile: ['甜润', '酒香', '油香'] },
  { name: '万州格格', cuisine: '小吃', spiciness: '中辣', avgPrice: 18, rating: 4.5, bestTime: '中午', suitableFor: ['一人食', '家常'], ingredients: ['羊肉', '米粉', '花椒', '辣椒面'], flavorProfile: ['咸鲜', '微辣', '粉糯'] },
];

function generateCity(city, existingIds, templates) {
  const existing = catalog.filter((dish) => dish.city === city);
  const result = [...existing];
  const usedNames = new Set(existing.map((dish) => dish.name));
  for (let i = 0; i < templates.length; i += 1) {
    const base = templates[i];
    const variants = base.name === '山城小汤圆' || existingIds.has(city + ':' + base.name) ? [1] : [1, 2];
    for (const variant of variants) {
      const district = districts[city][i % districts[city].length];
      const street = streets[(i + variant) % streets.length];
      const price = base.avgPrice + (variant === 2 ? 8 : 0);
      const rating = Math.min(5, base.rating + (variant === 2 ? 0.1 : 0));
      const distanceKm = Number((0.4 + ((i * 3 + variant) % 8) * 0.7).toFixed(1));
      const name = variant === 1 ? base.name : `${base.name}（商圈店）`;
      const id = `${city === '成都' ? 'cd' : 'cq'}-${slug(base.name)}-${variant}`;
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      result.push({
        id,
        name,
        city,
        district,
        cuisine: base.cuisine,
        image: imageFor(base.name, base.cuisine),
        ingredients: base.ingredients,
        flavorProfile: base.flavorProfile,
        spiciness: base.spiciness,
        avgPrice: price,
        rating,
        restaurant: {
          name: `${name}${variant === 1 ? '老店' : '商圈店'}`,
          address: `${district}${street}`,
          openHours: base.bestTime.includes('夜') ? '17:00-02:00' : base.bestTime.includes('早') ? '06:30-14:00' : '09:00-21:30',
          distanceKm,
          rating,
        },
        bestTime: base.bestTime,
        suitableFor: base.suitableFor,
        reasons: reasonFor(base.name, price, distanceKm),
        fitTags: [base.cuisine, base.spiciness, ...base.suitableFor],
        source: 'curated:2026-08-02',
        updatedAt: '2026-08-02T10:00:00+08:00',
      });
    }
  }
  return result.slice(0, 60);
}

const existingChengdu = new Set(catalog.filter((d) => d.city === '成都').map((d) => `成都:${d.name}`));
const existingChongqing = new Set(catalog.filter((d) => d.city === '重庆').map((d) => `重庆:${d.name}`));
const chengdu = generateCity('成都', existingChengdu, chengduTemplates);
const chongqing = generateCity('重庆', existingChongqing, chongqingTemplates);

const seen = new Set();
const merged = [];
for (const dish of [...chengdu, ...chongqing]) {
  if (seen.has(dish.id)) continue;
  seen.add(dish.id);
  merged.push(dish);
}

fs.writeFileSync(catalogPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`chengdu=${chengdu.length} chongqing=${chongqing.length} total=${merged.length}`);
