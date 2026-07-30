export type AiCountryId = 'cn' | 'us' | 'fr' | 'ca';
export type AiCategoryId = 'all' | 'general' | 'search' | 'creation' | 'coding';
export type AiProductCategoryId = Exclude<AiCategoryId, 'all'>;

export type AiCountry = {
  accentColor: string;
  code: string;
  description: string;
  id: AiCountryId;
  name: string;
  softColor: string;
};

export type AiCategory = {
  id: AiCategoryId;
  label: string;
};

export type AiProduct = {
  categories: readonly AiProductCategoryId[];
  company: string;
  countryId: AiCountryId;
  description: string;
  domain: string;
  featured?: boolean;
  id: AiProductId;
  logo: string;
  logoBackground: string;
  logoColor: string;
  name: string;
  url: `https://${string}`;
};

export type AiProductId =
  | 'doubao'
  | 'qwen'
  | 'deepseek'
  | 'kimi'
  | 'yuanbao'
  | 'chatglm'
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'copilot'
  | 'grok'
  | 'mistral-le-chat'
  | 'cohere-playground';

export const AI_COUNTRIES: readonly AiCountry[] = [
  {
    accentColor: '#e04f48',
    code: 'CN',
    description: '通用对话、搜索与创作',
    id: 'cn',
    name: '中国',
    softColor: '#fff0ef',
  },
  {
    accentColor: '#4166d5',
    code: 'US',
    description: '通用对话、搜索与办公',
    id: 'us',
    name: '美国',
    softColor: '#e9efff',
  },
  {
    accentColor: '#e27736',
    code: 'FR',
    description: '开源模型与智能助手',
    id: 'fr',
    name: '法国',
    softColor: '#fff3e8',
  },
  {
    accentColor: '#198268',
    code: 'CA',
    description: '企业级语言模型',
    id: 'ca',
    name: '加拿大',
    softColor: '#e9f7f3',
  },
];

export const AI_CATEGORIES: readonly AiCategory[] = [
  { id: 'all', label: '全部' },
  { id: 'general', label: '通用对话' },
  { id: 'search', label: 'AI 搜索' },
  { id: 'creation', label: '创作工具' },
  { id: 'coding', label: '编程辅助' },
];

export const AI_PRODUCTS: readonly AiProduct[] = [
  {
    categories: ['general', 'search', 'creation'],
    company: '字节跳动',
    countryId: 'cn',
    description: '通用对话',
    domain: 'doubao.com',
    featured: true,
    id: 'doubao',
    logo: '豆',
    logoBackground: '#f0ebff',
    logoColor: '#7048d5',
    name: '豆包',
    url: 'https://www.doubao.com/',
  },
  {
    categories: ['general', 'search', 'creation', 'coding'],
    company: '阿里巴巴',
    countryId: 'cn',
    description: '通用对话',
    domain: 'tongyi.aliyun.com',
    id: 'qwen',
    logo: 'QW',
    logoBackground: '#fff0e9',
    logoColor: '#f07445',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen/',
  },
  {
    categories: ['general', 'search', 'coding'],
    company: '深度求索',
    countryId: 'cn',
    description: '推理与编程',
    domain: 'chat.deepseek.com',
    id: 'deepseek',
    logo: 'DS',
    logoBackground: '#eaf0ff',
    logoColor: '#3268c8',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
  },
  {
    categories: ['general', 'search', 'creation'],
    company: '月之暗面',
    countryId: 'cn',
    description: '长文本处理',
    domain: 'kimi.com',
    id: 'kimi',
    logo: 'K',
    logoBackground: '#eaf4ff',
    logoColor: '#2480d6',
    name: 'Kimi',
    url: 'https://www.kimi.com/',
  },
  {
    categories: ['general', 'search', 'creation'],
    company: '腾讯',
    countryId: 'cn',
    description: '对话与搜索',
    domain: 'yuanbao.tencent.com',
    id: 'yuanbao',
    logo: '元',
    logoBackground: '#e7f8f1',
    logoColor: '#149365',
    name: '腾讯元宝',
    url: 'https://yuanbao.tencent.com/',
  },
  {
    categories: ['general', 'search', 'creation', 'coding'],
    company: '智谱 AI',
    countryId: 'cn',
    description: '通用对话',
    domain: 'chatglm.cn',
    id: 'chatglm',
    logo: '智',
    logoBackground: '#edf1ff',
    logoColor: '#5368e8',
    name: '智谱清言',
    url: 'https://chatglm.cn/',
  },
  {
    categories: ['general', 'search', 'creation', 'coding'],
    company: 'OpenAI',
    countryId: 'us',
    description: '通用对话与创作',
    domain: 'chatgpt.com',
    featured: true,
    id: 'chatgpt',
    logo: 'GPT',
    logoBackground: '#c9f36a',
    logoColor: '#151b3b',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
  },
  {
    categories: ['general', 'creation', 'coding'],
    company: 'Anthropic',
    countryId: 'us',
    description: '对话与编程',
    domain: 'claude.ai',
    id: 'claude',
    logo: 'C',
    logoBackground: '#fff0e8',
    logoColor: '#c96335',
    name: 'Claude',
    url: 'https://claude.ai/',
  },
  {
    categories: ['general', 'search', 'creation', 'coding'],
    company: 'Google',
    countryId: 'us',
    description: '多模态助手',
    domain: 'gemini.google.com',
    id: 'gemini',
    logo: 'GE',
    logoBackground: '#eef2ff',
    logoColor: '#4d70dd',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
  },
  {
    categories: ['general', 'search'],
    company: 'Perplexity AI',
    countryId: 'us',
    description: 'AI 搜索',
    domain: 'perplexity.ai',
    id: 'perplexity',
    logo: 'P',
    logoBackground: '#e6f7f4',
    logoColor: '#197d75',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
  },
  {
    categories: ['general', 'search', 'creation'],
    company: 'Microsoft',
    countryId: 'us',
    description: '办公与搜索',
    domain: 'copilot.microsoft.com',
    id: 'copilot',
    logo: 'CP',
    logoBackground: '#eaf3ff',
    logoColor: '#2775ce',
    name: 'Microsoft Copilot',
    url: 'https://copilot.microsoft.com/',
  },
  {
    categories: ['general', 'search', 'creation'],
    company: 'xAI',
    countryId: 'us',
    description: '实时信息与对话',
    domain: 'grok.com',
    id: 'grok',
    logo: 'G',
    logoBackground: '#edf0f4',
    logoColor: '#20252d',
    name: 'Grok',
    url: 'https://grok.com/',
  },
  {
    categories: ['general', 'search', 'creation', 'coding'],
    company: 'Mistral AI',
    countryId: 'fr',
    description: '对话与开源模型',
    domain: 'chat.mistral.ai',
    featured: true,
    id: 'mistral-le-chat',
    logo: 'M',
    logoBackground: '#fff0e5',
    logoColor: '#e36d2f',
    name: 'Le Chat',
    url: 'https://chat.mistral.ai/chat',
  },
  {
    categories: ['general', 'creation', 'coding'],
    company: 'Cohere',
    countryId: 'ca',
    description: '企业级语言模型',
    domain: 'dashboard.cohere.com',
    featured: true,
    id: 'cohere-playground',
    logo: 'CO',
    logoBackground: '#e8f7f1',
    logoColor: '#147f67',
    name: 'Cohere Playground',
    url: 'https://dashboard.cohere.com/playground/chat',
  },
];

export function getAiCountry(countryId: AiCountryId) {
  return AI_COUNTRIES.find((country) => country.id === countryId);
}

export function getAiProductsByCountry(countryId: AiCountryId) {
  return AI_PRODUCTS.filter((product) => product.countryId === countryId);
}

export function getAiCountryProductCount(countryId: AiCountryId) {
  return getAiProductsByCountry(countryId).length;
}

export function filterAiProducts({
  categoryId,
  countryId,
  favoriteIds = [],
  favoritesOnly = false,
  query = '',
}: {
  categoryId: AiCategoryId;
  countryId?: AiCountryId;
  favoriteIds?: readonly AiProductId[];
  favoritesOnly?: boolean;
  query?: string;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const favoriteIdSet = favoritesOnly ? new Set(favoriteIds) : null;

  return AI_PRODUCTS.filter((product) => {
    if (countryId && product.countryId !== countryId) return false;
    if (categoryId !== 'all' && !product.categories.includes(categoryId)) return false;
    if (favoriteIdSet && !favoriteIdSet.has(product.id)) return false;
    if (!normalizedQuery) return true;

    return [product.name, product.company, product.domain, product.description]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}
