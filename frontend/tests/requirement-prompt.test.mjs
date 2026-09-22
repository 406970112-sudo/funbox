import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIREMENT_PROMPT_PLACEHOLDER,
  REQUIREMENT_PROMPT_TEMPLATE,
  buildRequirementPrompt,
} from '../lib/requirement-prompt.ts';

test('empty input returns the complete template with its placeholder', () => {
  assert.equal(buildRequirementPrompt(''), REQUIREMENT_PROMPT_TEMPLATE);
  assert.equal(REQUIREMENT_PROMPT_TEMPLATE.includes(REQUIREMENT_PROMPT_PLACEHOLDER), true);
});

test('replaces only the template placeholder and keeps the rest unchanged', () => {
  const requirement = '新增一个支持换行的需求\n并保留「特殊符号」';
  const result = buildRequirementPrompt(requirement);

  assert.equal(result.includes(requirement), true);
  assert.equal(result.includes(REQUIREMENT_PROMPT_PLACEHOLDER), false);
  assert.equal(
    result.replace(requirement, REQUIREMENT_PROMPT_PLACEHOLDER),
    REQUIREMENT_PROMPT_TEMPLATE,
  );
});

test('preserves leading spaces, trailing spaces, and placeholder-like user content', () => {
  const requirement = '  输入内容【在这里填写具体需求】\n第二行  ';
  const result = buildRequirementPrompt(requirement);

  assert.equal(result.includes(requirement), true);
  assert.equal(result.indexOf(requirement), REQUIREMENT_PROMPT_TEMPLATE.indexOf(REQUIREMENT_PROMPT_PLACEHOLDER));
  assert.equal(result.split(REQUIREMENT_PROMPT_PLACEHOLDER).length, 2);
});
