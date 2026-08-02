export type PlantMatch = {
  rank: number;
  score: number;
  gbifKey: number;
  scientificName: string;
  commonNameZh?: string;
  family: string;
  familyZh?: string;
  genus: string;
  source: string;
  fetchedAt: string;
};

export type IdentificationResult = {
  identificationId: string;
  photo: {
    uploadedAt: string;
  };
  matches: PlantMatch[];
  disclaimer: string;
};

export type PlantImage = {
  url: string;
  source: string;
  credit?: string;
  license?: string;
  checkedAt?: string;
};

export type PlantSummary = {
  text: string;
  url: string;
  source: string;
  fetchedAt: string;
};

export type PlantObservations = {
  count: number;
  source: string;
  fetchedAt: string;
};

export type PlantSafety = {
  state: 'edible' | 'poisonous' | 'unknown';
  quote?: string;
  source?: string;
  note: string;
  checkedAt: string;
};

export type SpeciesDetail = {
  gbifKey: number;
  scientificName: string;
  commonNames: string[];
  classification: {
    family: string;
    familyZh?: string;
    genus: string;
    order?: string;
    class?: string;
  };
  summary?: PlantSummary;
  images: PlantImage[];
  observations?: PlantObservations;
  safety: PlantSafety;
  disclaimer: string;
  fetchedAt: string;
};

export type CommonPlant = {
  gbifKey: number;
  nameZh: string;
  scientificName: string;
  familyZh: string;
  imageUrl: string;
  imageSource: string;
  imageCredit?: string;
  fetchedAt: string;
};

export type PlantSourceEntry = {
  id: string;
  name: string;
  purpose: string;
  needsKey: boolean;
  updatedAt: string;
  documentUrl: string;
};

export type PlantSourcesResponse = {
  items: PlantSourceEntry[];
  fetchedAt: string;
};

export type PlantHistoryItem = {
  id: string;
  scientificName: string;
  commonNameZh?: string;
  familyZh?: string;
  gbifKey: number;
  score: number;
  imageUrl?: string;
  createdAt: string;
};

export type PlantFeedbackInput = {
  identificationId: string;
  kind: 'wrong_match' | 'wrong_info' | 'image_issue';
  note?: string;
};
