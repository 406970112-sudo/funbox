export type PartyHostType = 'member' | 'aa' | 'other';
export type PartyExpenseVisibility = 'owner' | 'participants';
export type PartyShareMode = 'private' | 'shared';
export type PartyCardStatus = 'recording' | 'completed' | 'archived';
export type PartyParticipantKind = 'friend' | 'manual';
export type PartyInviteStatus = 'joined' | 'pending' | 'declined';
export type PartyDishRating = 'like' | 'ok' | 'no';
export type PartyAgainVoteValue = 'want' | 'neutral' | 'not';
export type PartyVenueDimension =
  | 'parking'
  | 'taste'
  | 'ambience'
  | 'service'
  | 'location'
  | 'other';

export type PartyAgainVoteSummary = {
  want: number;
  neutral: number;
  not: number;
};

export type PartyCard = {
  id: string;
  ownerUserId: string;
  title: string;
  partyDate: string;
  venueName: string;
  venueAddress: string;
  hostType: PartyHostType;
  hostParticipantId?: string;
  hostParticipantName: string;
  totalAmountCents?: number;
  expenseVisibility: PartyExpenseVisibility;
  cardStatus: PartyCardStatus;
  shareMode: PartyShareMode;
  participantCount: number;
  photoCount: number;
  dishCount: number;
  againVotes: PartyAgainVoteSummary;
  coverPhotoId?: string;
  coverPhotoUrl?: string;
  archived: boolean;
  canEdit: boolean;
  canCollaborate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PartyParticipant = {
  id: string;
  cardId: string;
  userId?: string;
  name: string;
  kind: PartyParticipantKind;
  inviteStatus: PartyInviteStatus;
  canEdit: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PartyPhoto = {
  id: string;
  cardId: string;
  userId: string;
  fileUrl: string;
  kind: string;
  takenAt?: string;
  sortOrder: number;
  createdAt: string;
};

export type PartyDish = {
  id: string;
  cardId: string;
  createdByUserId: string;
  name: string;
  priceCents?: number;
  likeCount: number;
  okCount: number;
  noCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PartyDishVote = {
  id: string;
  dishId: string;
  participantId: string;
  rating: PartyDishRating;
  createdAt: string;
  updatedAt: string;
};

export type PartyVenueNote = {
  id: string;
  cardId: string;
  participantId: string;
  participantName: string;
  dimension: PartyVenueDimension;
  content: string;
  createdAt: string;
};

export type PartyAgainVote = {
  id: string;
  cardId: string;
  participantId: string;
  participantName: string;
  vote: PartyAgainVoteValue;
  createdAt: string;
  updatedAt: string;
};

export type PartyActivityEvent = {
  id: string;
  cardId: string;
  userId: string;
  action: string;
  payload?: unknown;
  createdAt: string;
};

export type PartyCardDetail = PartyCard & {
  participants: PartyParticipant[];
  photos: PartyPhoto[];
  dishes: PartyDish[];
  venueNotes: PartyVenueNote[];
  againVotes: PartyAgainVote[];
  activities: PartyActivityEvent[];
};

export type PartySummary = {
  totalCards: number;
  totalPhotos: number;
  totalAmountCents: number;
  recentCards: PartyCard[];
};

export type PartyParticipantInput = {
  clientId?: string;
  userId?: string;
  name: string;
};

export type PartyCardInput = {
  title: string;
  partyDate: string;
  venueName: string;
  venueAddress: string;
  hostType: PartyHostType;
  hostParticipantId?: string;
  totalAmountCents?: number;
  expenseVisibility: PartyExpenseVisibility;
  shareMode: PartyShareMode;
  participants: PartyParticipantInput[];
};

export type PartyParticipantUpdateInput = {
  inviteStatus?: PartyInviteStatus;
  canEdit?: boolean;
};

export type PartyDishInput = {
  name: string;
  priceCents?: number;
};

export type PartyDishVoteInput = {
  rating: PartyDishRating;
};

export type PartyVenueNoteInput = {
  dimension: PartyVenueDimension;
  content: string;
};

export type PartyAgainVoteInput = {
  vote: PartyAgainVoteValue;
};

export type PartyNextPrep = {
  hasPrevious: boolean;
  card?: PartyCard;
  participants?: PartyParticipant[];
  dishes?: PartyDish[];
  venueNotes?: PartyVenueNote[];
  againVotes?: PartyAgainVote[];
  canSeeExpense: boolean;
};

export type PartyCardsResponse = {
  cards: PartyCard[];
};

export type PartyExportSnapshot = {
  exportedAt: string;
  cards: PartyCardDetail[];
};
