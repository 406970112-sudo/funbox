export type PriceRadarProduct = {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  code: string;
  unit: string;
};

export type PriceRadarOfficialPrice = {
  marketId: string;
  marketName: string;
  enterpriseName: string;
  price: number;
  unit: string;
  capturedAt: string;
  source: string;
  sourceUrl: string;
};

export type PriceRadarSourceStatus = {
  id: string;
  name: string;
  kind: string;
  status: string;
  updatedAt: string;
  detail: string;
};

export type PriceRadarUserSummary = {
  id: string;
  username: string;
  displayName: string;
};

export type PriceRadarEvidence = {
  id: string;
  reportId: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  visibility: string;
  sortOrder: number;
};

export type PriceRadarReport = {
  id: string;
  productId: string;
  productName: string;
  storeName: string;
  storeType: string;
  address: string;
  price: number;
  unit: string;
  purchaseDate: string;
  latitude: number;
  longitude: number;
  status: string;
  images: PriceRadarEvidence[];
  user: PriceRadarUserSummary;
  createdAt: string;
  verifiedAt?: string;
  decisionNote?: string;
};

export type PriceRadarObjection = {
  id: string;
  reportId: string;
  user: PriceRadarUserSummary;
  reason: string;
  body: string;
  status: string;
  images: PriceRadarEvidence[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
};

export type PriceRadarComment = {
  id: string;
  reportId: string;
  user: PriceRadarUserSummary;
  body: string;
  status: string;
  createdAt: string;
};

export type PriceRadarSearchResult = {
  product: PriceRadarProduct;
  officialReference: PriceRadarOfficialPrice[];
  nearbyReports: PriceRadarReport[];
  sources: PriceRadarSourceStatus[];
  fetchedAt: string;
  stale: boolean;
};

export type PriceRadarAsset = {
  uri: string;
  fileName: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};
