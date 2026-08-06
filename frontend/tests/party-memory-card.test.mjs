import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityActionLabel,
  againVoteLabel,
  centsToYuan,
  dishVoteSummary,
  hostLabel,
  topDishes,
  validateCardBasics,
  venueDimensionLabel,
  yuanToCents,
} from '../lib/party-memory-card.ts';

test('金额在元和分之间正确转换', () => {
  assert.equal(yuanToCents('486'), 48600);
  assert.equal(yuanToCents('0'), 0);
  assert.equal(yuanToCents('abc'), undefined);
  assert.equal(centsToYuan(48600), '486');
  assert.equal(centsToYuan(12150), '121.5');
  assert.equal(centsToYuan(undefined), '暂无账单');
});

test('记忆卡必填校验要求真实参与人和请客关系', () => {
  const base = {
    title: '老友聚餐',
    partyDate: '2026-08-06 20:30',
    venueName: '川香居',
    venueAddress: '',
    hostType: 'member',
    hostParticipantId: '',
    expenseVisibility: 'participants',
    shareMode: 'shared',
    participants: [
      { clientId: 'a', name: '王明' },
      { clientId: 'b', name: '李雷' },
    ],
  };
  assert.equal(validateCardBasics({ ...base, hostParticipantId: 'a' }), null);
  assert.equal(validateCardBasics(base), '请选择本次谁请客。');
  assert.equal(
    validateCardBasics({ ...base, hostParticipantId: 'a', participants: [{ clientId: 'a', name: '王明' }] }),
    '至少需要 2 位真实参与人。',
  );
});

test('菜品按真实好评数排序且展示真实评价摘要', () => {
  const dishes = [
    { id: '1', likeCount: 1, okCount: 0, noCount: 0, sortOrder: 0 },
    { id: '2', likeCount: 3, okCount: 0, noCount: 0, sortOrder: 1 },
    { id: '3', likeCount: 0, okCount: 2, noCount: 0, sortOrder: 2 },
  ];
  const sorted = topDishes(dishes, 2);
  assert.deepEqual(sorted.map((dish) => dish.id), ['2', '1']);
  assert.equal(dishVoteSummary(dishes[1]), '3 人觉得好吃');
  assert.equal(dishVoteSummary(dishes[2]), '2 人觉得一般');
});

test('文案标签保持真实且可读', () => {
  assert.equal(hostLabel({ hostType: 'member', hostParticipantName: '王明' }), '王明');
  assert.equal(hostLabel({ hostType: 'aa', hostParticipantName: '' }), 'AA 分摊');
  assert.equal(venueDimensionLabel('parking'), '停车');
  assert.equal(againVoteLabel('want'), '想去');
  assert.equal(activityActionLabel('photo_added'), '上传照片');
});
