export type ResourceSearchSource = {
  description: string;
  domain: string;
  id: ResourceSearchSourceId;
  logo: string;
  logoBackground: string;
  logoColor: string;
  name: string;
  url: `https://${string}`;
};

export type ResourceSearchSourceId =
  | 'quark-pan-search'
  | 'panyq'
  | 'tvso'
  | 'funletu-pan'
  | 'yunso';

export const RESOURCE_SEARCH_SOURCES: readonly ResourceSearchSource[] = [
  {
    description: '综合网盘资源',
    domain: 'quarkpanso.com',
    id: 'quark-pan-search',
    logo: 'QP',
    logoBackground: '#e7ebff',
    logoColor: '#4b6bff',
    name: '夸克盘搜',
    url: 'https://www.quarkpanso.com/',
  },
  {
    description: '社区分享资源',
    domain: 'panyq.com',
    id: 'panyq',
    logo: 'YQ',
    logoBackground: '#e5f7f1',
    logoColor: '#16896d',
    name: '盘友圈',
    url: 'https://panyq.com/',
  },
  {
    description: '影视内容检索',
    domain: 'tvso.uk',
    id: 'tvso',
    logo: 'TV',
    logoBackground: '#fff0e7',
    logoColor: '#e46c2e',
    name: 'TV 搜',
    url: 'https://www.tvso.uk/',
  },
  {
    description: '网盘资源导航',
    domain: 'pan.funletu.com',
    id: 'funletu-pan',
    logo: 'FL',
    logoBackground: '#ffeaf0',
    logoColor: '#e74c78',
    name: '趣盘搜',
    url: 'https://pan.funletu.com/',
  },
  {
    description: '多网盘搜索',
    domain: 'yunso.net',
    id: 'yunso',
    logo: 'YS',
    logoBackground: '#edf0ff',
    logoColor: '#6b5adb',
    name: '云搜',
    url: 'https://www.yunso.net/',
  },
];

export const DEFAULT_RESOURCE_SEARCH_SOURCE_IDS: readonly ResourceSearchSourceId[] = [
  'quark-pan-search',
  'panyq',
  'tvso',
];

export function normalizeResourceSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function getResourceSearchQueue(sourceIds: readonly ResourceSearchSourceId[]) {
  const selectedIds = new Set(sourceIds);
  return RESOURCE_SEARCH_SOURCES.filter((source) => selectedIds.has(source.id));
}
