export type MarketCategoryId = 'global' | 'ai' | 'metals';
export type MarketPeriodId = '1d' | '5d' | '20d';

export type MarketCategory = {
  id: MarketCategoryId;
  label: string;
};

export type MarketPeriod = {
  id: MarketPeriodId;
  label: string;
};

export type MarketDriver = {
  label: string;
  tone: 'blue' | 'green' | 'coral';
  value: string;
};

export type MarketConstituent = {
  change: number;
  name: string;
  weight: number;
};

export type MarketSector = {
  anomaly?: string;
  categoryIds: readonly MarketCategoryId[];
  changes: Readonly<Record<MarketPeriodId, number>>;
  constituents: readonly MarketConstituent[];
  drivers: readonly MarketDriver[];
  id: string;
  methodology: string;
  name: string;
  series: readonly number[];
};

export type MarketPulse = {
  advancing: number;
  declining: number;
  score: number;
  state: '强势' | '偏强' | '震荡' | '偏弱';
  strongestSectorId: string;
};

export type MarketChartPoint = {
  x: number;
  y: number;
};

export const MARKET_CATEGORIES: readonly MarketCategory[] = [
  { id: 'global', label: '全球' },
  { id: 'ai', label: 'AI' },
  { id: 'metals', label: '有色' },
];

export const MARKET_PERIODS: readonly MarketPeriod[] = [
  { id: '1d', label: '1日' },
  { id: '5d', label: '5日' },
  { id: '20d', label: '20日' },
];

const DEFAULT_METHODOLOGY = '等权篮子 · 20 日滚动基准 · 汇率统一折算';

export const MARKET_SECTORS: readonly MarketSector[] = [
  {
    categoryIds: ['global', 'ai'],
    changes: { '1d': 3.39, '5d': 8.74, '20d': 24.6 },
    constituents: [
      { change: 4.8, name: '英伟达', weight: 23 },
      { change: 2.1, name: '台积电', weight: 18 },
      { change: 3.6, name: '博通', weight: 14 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '云厂商资本开支预期上修' },
      { label: '产业端', tone: 'green', value: '高速互连与算力设备交付改善' },
      { label: '市场端', tone: 'coral', value: '板块成交额较 20 日均值放大 31%' },
    ],
    id: 'ai-compute',
    methodology: DEFAULT_METHODOLOGY,
    name: 'AI 算力',
    series: [8, 13, 11, 17, 16, 24, 22, 31, 29, 41, 47, 44, 56],
  },
  {
    anomaly: '近 5 日加速，强度进入前 10%',
    categoryIds: ['global', 'ai'],
    changes: { '1d': 6.08, '5d': 11.42, '20d': 21.8 },
    constituents: [
      { change: 6.7, name: '中际旭创', weight: 21 },
      { change: 5.4, name: '新易盛', weight: 18 },
      { change: 4.9, name: '光迅科技', weight: 13 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '800G 与 1.6T 光模块需求继续扩张' },
      { label: '产业端', tone: 'green', value: '核心器件交付节奏改善' },
      { label: '市场端', tone: 'coral', value: '5 日动量升至近一年高位区间' },
    ],
    id: 'cpo',
    methodology: DEFAULT_METHODOLOGY,
    name: 'CPO',
    series: [6, 8, 10, 9, 14, 13, 18, 22, 24, 29, 33, 40, 49],
  },
  {
    categoryIds: ['global', 'ai'],
    changes: { '1d': 3.8, '5d': 7.16, '20d': 18.9 },
    constituents: [
      { change: 3.8, name: '台积电', weight: 24 },
      { change: 4.1, name: '阿斯麦', weight: 16 },
      { change: 2.9, name: '北方华创', weight: 12 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '先进制程与高端封装订单保持强劲' },
      { label: '产业端', tone: 'green', value: '设备与材料环节景气度回升' },
      { label: '市场端', tone: 'coral', value: '板块宽度连续三日改善' },
    ],
    id: 'semiconductor',
    methodology: DEFAULT_METHODOLOGY,
    name: '半导体',
    series: [9, 11, 10, 14, 16, 15, 20, 22, 25, 24, 30, 34, 39],
  },
  {
    categoryIds: ['global', 'ai'],
    changes: { '1d': 4.95, '5d': 9.6, '20d': 16.4 },
    constituents: [
      { change: 5.2, name: '美光科技', weight: 22 },
      { change: 4.6, name: '海力士', weight: 20 },
      { change: 3.7, name: '三星电子', weight: 15 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: 'HBM 与企业级存储需求上调' },
      { label: '产业端', tone: 'green', value: '库存周期进入健康区间' },
      { label: '市场端', tone: 'coral', value: '存储价格预期推动估值修复' },
    ],
    id: 'storage',
    methodology: DEFAULT_METHODOLOGY,
    name: '存储',
    series: [7, 9, 8, 12, 14, 13, 17, 19, 23, 22, 27, 31, 35],
  },
  {
    categoryIds: ['global', 'ai'],
    changes: { '1d': 0.75, '5d': 3.26, '20d': 8.7 },
    constituents: [
      { change: 1.4, name: '微软', weight: 22 },
      { change: 0.9, name: '亚马逊', weight: 20 },
      { change: 0.4, name: '谷歌', weight: 18 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '企业云迁移需求保持韧性' },
      { label: '产业端', tone: 'green', value: 'AI 服务带动单位客户价值提升' },
      { label: '市场端', tone: 'coral', value: '涨幅温和，波动率处于中低区间' },
    ],
    id: 'cloud',
    methodology: DEFAULT_METHODOLOGY,
    name: '云计算',
    series: [12, 11, 13, 14, 13, 15, 17, 16, 19, 18, 21, 22, 24],
  },
  {
    categoryIds: ['global', 'metals'],
    changes: { '1d': 4.36, '5d': 6.44, '20d': 12.3 },
    constituents: [
      { change: 4.1, name: '山东黄金', weight: 19 },
      { change: 3.8, name: '紫金矿业', weight: 17 },
      { change: 4.6, name: '纽蒙特', weight: 14 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '避险配置与央行购金需求支撑' },
      { label: '产业端', tone: 'green', value: '矿端供给增速保持有限' },
      { label: '市场端', tone: 'coral', value: '实际利率回落改善贵金属估值' },
    ],
    id: 'gold',
    methodology: DEFAULT_METHODOLOGY,
    name: '黄金',
    series: [14, 13, 15, 18, 17, 21, 20, 24, 27, 26, 31, 34, 38],
  },
  {
    categoryIds: ['global', 'metals'],
    changes: { '1d': 2.95, '5d': 5.38, '20d': 10.6 },
    constituents: [
      { change: 3.1, name: '紫金矿业', weight: 21 },
      { change: 2.7, name: '江西铜业', weight: 18 },
      { change: 2.5, name: '自由港', weight: 15 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '电网与数据中心投资拉动需求' },
      { label: '产业端', tone: 'green', value: '矿山扰动压低短期供应预期' },
      { label: '市场端', tone: 'coral', value: '库存变化强化价格弹性' },
    ],
    id: 'copper',
    methodology: DEFAULT_METHODOLOGY,
    name: '铜',
    series: [10, 12, 11, 14, 17, 16, 19, 21, 20, 24, 27, 29, 33],
  },
  {
    categoryIds: ['global', 'metals'],
    changes: { '1d': -0.85, '5d': 1.42, '20d': 4.9 },
    constituents: [
      { change: -0.7, name: '中国铝业', weight: 20 },
      { change: -1.1, name: '云铝股份', weight: 17 },
      { change: -0.4, name: '美国铝业', weight: 14 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '交通与包装需求表现平稳' },
      { label: '产业端', tone: 'green', value: '电力成本限制部分供给弹性' },
      { label: '市场端', tone: 'coral', value: '短期获利回吐压制价格表现' },
    ],
    id: 'aluminum',
    methodology: DEFAULT_METHODOLOGY,
    name: '铝',
    series: [15, 14, 16, 17, 18, 17, 20, 22, 21, 24, 23, 25, 24],
  },
  {
    categoryIds: ['global', 'metals'],
    changes: { '1d': 2.41, '5d': 4.92, '20d': 9.8 },
    constituents: [
      { change: 2.8, name: '北方稀土', weight: 21 },
      { change: 2.2, name: '盛和资源', weight: 17 },
      { change: 1.9, name: '中国稀土', weight: 15 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '新能源与机器人需求预期改善' },
      { label: '产业端', tone: 'green', value: '供给约束稳定中游价格' },
      { label: '市场端', tone: 'coral', value: '主题资金活跃度明显回升' },
    ],
    id: 'rare-earth',
    methodology: DEFAULT_METHODOLOGY,
    name: '稀土',
    series: [8, 10, 9, 13, 12, 16, 18, 17, 22, 24, 23, 28, 31],
  },
  {
    categoryIds: ['global', 'metals'],
    changes: { '1d': -0.46, '5d': -1.12, '20d': 1.8 },
    constituents: [
      { change: -0.4, name: '宝钢股份', weight: 20 },
      { change: -0.7, name: '华菱钢铁', weight: 17 },
      { change: -0.2, name: '河钢股份', weight: 14 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '基建需求温和，地产端仍偏弱' },
      { label: '产业端', tone: 'green', value: '产量调节缓解库存压力' },
      { label: '市场端', tone: 'coral', value: '板块仍处于低波动整理区间' },
    ],
    id: 'steel',
    methodology: DEFAULT_METHODOLOGY,
    name: '钢铁',
    series: [17, 16, 15, 16, 15, 14, 16, 15, 17, 16, 18, 17, 18],
  },
  {
    categoryIds: ['global'],
    changes: { '1d': -1.49, '5d': -0.32, '20d': 3.4 },
    constituents: [
      { change: -1.2, name: '恒瑞医药', weight: 18 },
      { change: -1.7, name: '百济神州', weight: 16 },
      { change: -1.1, name: '药明康德', weight: 13 },
    ],
    drivers: [
      { label: '需求端', tone: 'blue', value: '创新药需求保持长期增长' },
      { label: '产业端', tone: 'green', value: '短期催化进入相对平静窗口' },
      { label: '市场端', tone: 'coral', value: '资金偏好暂时转向高景气科技' },
    ],
    id: 'biomed',
    methodology: DEFAULT_METHODOLOGY,
    name: '生物医药',
    series: [22, 21, 23, 22, 20, 19, 20, 18, 17, 19, 18, 16, 15],
  },
];

const MARKET_BREADTH: Readonly<
  Record<MarketCategoryId, Record<MarketPeriodId, Omit<MarketPulse, 'strongestSectorId'>>>
> = {
  ai: {
    '1d': { advancing: 5, declining: 0, score: 86, state: '强势' },
    '5d': { advancing: 5, declining: 0, score: 82, state: '强势' },
    '20d': { advancing: 5, declining: 0, score: 84, state: '强势' },
  },
  global: {
    '1d': { advancing: 18, declining: 6, score: 68, state: '偏强' },
    '5d': { advancing: 16, declining: 8, score: 64, state: '偏强' },
    '20d': { advancing: 15, declining: 9, score: 61, state: '偏强' },
  },
  metals: {
    '1d': { advancing: 4, declining: 2, score: 62, state: '偏强' },
    '5d': { advancing: 5, declining: 1, score: 70, state: '偏强' },
    '20d': { advancing: 4, declining: 2, score: 66, state: '偏强' },
  },
};

export function getRankedMarketSectors(
  categoryId: MarketCategoryId,
  periodId: MarketPeriodId,
) {
  return MARKET_SECTORS.filter((sector) => sector.categoryIds.includes(categoryId)).sort(
    (left, right) => right.changes[periodId] - left.changes[periodId],
  );
}

export function getMarketPulse(
  categoryId: MarketCategoryId,
  periodId: MarketPeriodId,
): MarketPulse {
  const strongestSector = getRankedMarketSectors(categoryId, periodId)[0];

  return {
    ...MARKET_BREADTH[categoryId][periodId],
    strongestSectorId: strongestSector.id,
  };
}

export function getMarketSector(sectorId: string) {
  return MARKET_SECTORS.find((sector) => sector.id === sectorId);
}

export function buildMarketChartPoints(
  values: readonly number[],
  width: number,
  height: number,
): MarketChartPoint[] {
  if (values.length === 0) return [];

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const horizontalStep = values.length === 1 ? 0 : width / (values.length - 1);

  return values.map((value, index) => ({
    x: horizontalStep * index,
    y: range === 0 ? height / 2 : height - ((value - minimum) / range) * height,
  }));
}
