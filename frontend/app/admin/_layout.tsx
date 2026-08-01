import { Stack } from 'expo-router';

import { AdminShell } from '@/features/admin/admin-shell';

export default function AdminLayout() {
  return (
    <AdminShell>
      <Stack screenOptions={{ headerShown: false }} />
    </AdminShell>
  );
}
