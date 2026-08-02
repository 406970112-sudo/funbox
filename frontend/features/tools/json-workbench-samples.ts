import openMeteoJson from './json-workbench-samples/open-meteo-shanghai.json';
import typescriptPackage545Json from './json-workbench-samples/typescript-package-5.4.5.json';
import typescriptPackage563Json from './json-workbench-samples/typescript-package-5.6.3.json';
import typescriptPackageJson from './json-workbench-samples/typescript-package.json';

export type WorkbenchSample = {
  fetchedAt: string;
  label: string;
  source: string;
  text: string;
};

export const CONVERT_SAMPLE: WorkbenchSample = {
  fetchedAt: '2026-08-02',
  label: 'microsoft/TypeScript package.json (main)',
  source: 'https://raw.githubusercontent.com/microsoft/TypeScript/main/package.json',
  text: JSON.stringify(typescriptPackageJson, null, 2),
};

export const COMPARE_A_SAMPLE: WorkbenchSample = {
  fetchedAt: '2026-08-02',
  label: 'microsoft/TypeScript v5.4.5',
  source: 'https://raw.githubusercontent.com/microsoft/TypeScript/v5.4.5/package.json',
  text: JSON.stringify(typescriptPackage545Json, null, 2),
};

export const COMPARE_B_SAMPLE: WorkbenchSample = {
  fetchedAt: '2026-08-02',
  label: 'microsoft/TypeScript v5.6.3',
  source: 'https://raw.githubusercontent.com/microsoft/TypeScript/v5.6.3/package.json',
  text: JSON.stringify(typescriptPackage563Json, null, 2),
};

export const CSV_SAMPLE: WorkbenchSample = {
  fetchedAt: '2026-08-02',
  label: 'Open-Meteo 上海每小时预报',
  source: 'https://api.open-meteo.com/v1/forecast?latitude=31.2304&longitude=121.4737',
  text: JSON.stringify(openMeteoJson, null, 2),
};

export const REAL_DATA_NOTE =
  '内置示例均为真实数据快照，来源与抓取时间见样例下方标注；产品内禁止假数据与 mock 数据。';
