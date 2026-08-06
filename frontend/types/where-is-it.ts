export const WHERE_IS_IT_CATEGORIES = [
  '钥匙',
  '证件票据',
  '工具',
  '数码',
  '药品',
  '衣物',
  '其他',
] as const;

export type WhereIsItCategory = (typeof WHERE_IS_IT_CATEGORIES)[number] | '';

export type WhereIsItRoom = {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  itemCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WhereIsItItem = {
  id: string;
  userId: string;
  roomId: string;
  roomName: string;
  roomIcon: string;
  roomColor: string;
  name: string;
  category: string;
  locationDetail: string;
  nearbyHint: string;
  note: string;
  tags: string[];
  coverPhotoId?: string;
  coverPhotoUrl?: string;
  photoCount: number;
  lastSeenAt?: string;
  unconfirmedDays: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WhereIsItPhoto = {
  id: string;
  itemId: string;
  userId: string;
  fileUrl: string;
  kind: string;
  takenAt?: string;
  sortOrder: number;
  createdAt: string;
};

export type WhereIsItItemDetail = WhereIsItItem & {
  photos: WhereIsItPhoto[];
};

export type WhereIsItMoveEvent = {
  id: string;
  itemId: string;
  userId: string;
  action: string;
  fromRoomId: string;
  fromRoomName: string;
  fromLocationDetail: string;
  toRoomId: string;
  toRoomName: string;
  toLocationDetail: string;
  note: string;
  photoId?: string;
  movedAt: string;
  createdAt: string;
};

export type WhereIsItSummary = {
  totalItems: number;
  roomCount: number;
  unconfirmedCount: number;
  recentAdded: WhereIsItItem[];
  recentMoved: WhereIsItItem[];
  rooms: WhereIsItRoom[];
};

export type WhereIsItItemInput = {
  roomId: string;
  name: string;
  category?: string;
  locationDetail: string;
  nearbyHint?: string;
  note?: string;
  tags?: string[];
  coverPhotoId?: string | null;
};

export type WhereIsItRoomInput = {
  name: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
};

export type WhereIsItMoveInput = {
  roomId: string;
  locationDetail: string;
  note?: string;
  photoId?: string;
};
