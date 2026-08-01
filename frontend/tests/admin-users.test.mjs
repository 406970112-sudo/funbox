import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminUsersQuery,
  maskUsername,
  rolePresentation,
} from '../lib/admin-users.ts';

test('masks a mainland mobile number for list display', () => {
  assert.equal(maskUsername('13812345678'), '138****5678');
});

test('builds a stable encoded admin user query', () => {
  assert.equal(
    buildAdminUsersQuery({ limit: 20, offset: 40, query: '张 三', role: 'vip' }),
    '?q=%E5%BC%A0+%E4%B8%89&role=vip&limit=20&offset=40',
  );
});

test('presents SVIP with the premium crown treatment', () => {
  assert.deepEqual(rolePresentation('svip'), {
    color: '#e8667a',
    icon: 'crown-outline',
    label: 'SVIP',
  });
});

test('keeps the administrator badge readable in dark mode', () => {
  assert.equal(rolePresentation('admin', 'dark').color, '#c9f36a');
});
