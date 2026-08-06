import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOAL_BONUS_XP,
  eventTypeLabel,
  formatActualSeconds,
  goalExpectedXP,
  levelFromXP,
  stepXP,
} from '../lib/procrastination-crusher.ts';

test('step XP follows the documented formula', () => {
  assert.equal(stepXP(3), 8);
  assert.equal(stepXP(5), 10);
  assert.equal(stepXP(25), 30);
  assert.equal(stepXP(120), 30);
});

test('goal expected XP includes the completion bonus', () => {
  assert.equal(
    goalExpectedXP([
      { title: '只把桌上的垃圾扔掉', estimatedMinutes: 3 },
      { title: '桌面物品放回原位', estimatedMinutes: 5 },
      { title: '脏衣服放进洗衣机', estimatedMinutes: 4 },
      { title: '擦一遍桌面', estimatedMinutes: 6 },
      { title: '扫地并拖地', estimatedMinutes: 12 },
    ]),
    8 + 10 + 9 + 11 + 17 + GOAL_BONUS_XP,
  );
});

test('level and progress are derived from real XP totals', () => {
  assert.deepEqual(levelFromXP(0), { level: 1, progress: 0, next: 50 });
  assert.deepEqual(levelFromXP(84), { level: 2, progress: 34, next: 16 });
  assert.deepEqual(levelFromXP(100), { level: 3, progress: 0, next: 50 });
});

test('event labels stay stable for the ledger', () => {
  assert.equal(eventTypeLabel('step_completed'), '步骤完成');
  assert.equal(eventTypeLabel('step_undone'), '步骤撤销');
  assert.equal(eventTypeLabel('goal_completed'), '目标完成奖励');
  assert.equal(eventTypeLabel('goal_completed_undo'), '目标奖励冲正');
});

test('actual duration formatting is human readable', () => {
  assert.equal(formatActualSeconds(0), '');
  assert.equal(formatActualSeconds(45), '45 秒');
  assert.equal(formatActualSeconds(125), '2 分 5 秒');
  assert.equal(formatActualSeconds(120), '2 分钟');
});
