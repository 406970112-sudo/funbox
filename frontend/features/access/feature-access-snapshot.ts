export type FeatureAccessSnapshot = {
  error: boolean;
  ids: string[];
  token: string | null;
};

type SessionStatus = 'anonymous' | 'authenticated' | 'loading';

export function getApplicableFeatureSnapshot(
  snapshot: FeatureAccessSnapshot | null,
  authStatus: SessionStatus,
  accessToken: string | null,
) {
  if (!snapshot || authStatus === 'loading') return null;
  if (authStatus === 'authenticated') {
    return snapshot.token === accessToken ? snapshot : null;
  }
  return snapshot.token === null ? snapshot : null;
}
