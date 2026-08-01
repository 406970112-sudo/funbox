export type ReadingSourceType = 'provider' | 'admin' | 'local';

export type ReadingProgress = {
  bookId?: string;
  chapterId: string;
  chapterProgress: number;
  updatedAt: string;
};

export type ReadingChapter = {
  bookId?: string;
  content?: string;
  contentHash?: string;
  externalId?: string;
  id: string;
  sortOrder: number;
  status?: string;
  title: string;
  wordCount: number;
};

export type ContentRights = {
  bookId?: string;
  licensor: string;
  proofNote: string;
  reviewedAt?: string;
  reviewedBy?: string;
  scope: string;
  validFrom: string;
  validUntil: string;
};

export type ReadingBook = {
  allowOffline: boolean;
  author: string;
  category: string;
  chapterCount: number;
  coverUrl: string;
  createdAt?: string;
  externalId?: string;
  format?: 'txt' | 'epub';
  id: string;
  inBookshelf?: boolean;
  intro: string;
  local?: boolean;
  progress?: ReadingProgress;
  providerKey?: string;
  publishStatus?: 'draft' | 'published' | 'hidden' | 'removed';
  rights?: ContentRights;
  serialStatus: string;
  sourceType: ReadingSourceType;
  tags: string[];
  title: string;
  updatedAt?: string;
  wordCount: number;
};

export type ReadingBookmark = {
  bookId: string;
  chapterId: string;
  createdAt: string;
  id: string;
  note: string;
  position: number;
};

export type LocalReadingBook = ReadingBook & {
  chapters: ReadingChapter[];
  importedAt: string;
  local: true;
  sourceType: 'local';
};
