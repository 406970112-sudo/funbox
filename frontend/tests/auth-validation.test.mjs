import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidPassword,
  isValidPhoneAccount,
  isValidSecurityAnswer,
  normalizePhoneInput,
  SECURITY_QUESTIONS,
} from '../lib/auth-validation.ts';

test('normalizes phone input to eleven digits', () => {
  assert.equal(normalizePhoneInput('138-0013-8000 extra'), '13800138000');
});

test('accepts only mainland China mobile account formats', () => {
  assert.equal(isValidPhoneAccount('13800138000'), true);
  assert.equal(isValidPhoneAccount('12800138000'), false);
  assert.equal(isValidPhoneAccount('1380013800'), false);
});

test('requires passwords to contain letters and numbers', () => {
  assert.equal(isValidPassword('password-123'), true);
  assert.equal(isValidPassword('passwordonly'), false);
  assert.equal(isValidPassword('12345678'), false);
  assert.equal(isValidPassword('short1'), false);
});

test('provides a practical set of common security questions', () => {
  assert.equal(SECURITY_QUESTIONS.length, 8);
  assert.equal(new Set(SECURITY_QUESTIONS).size, SECURITY_QUESTIONS.length);
});

test('accepts security answers containing Chinese characters', () => {
  assert.equal(isValidSecurityAnswer('海底两万里'), true);
  assert.equal(isValidSecurityAnswer(' 海 '), true);
  assert.equal(isValidSecurityAnswer('中'.repeat(64)), true);
  assert.equal(isValidSecurityAnswer('中'.repeat(65)), false);
  assert.equal(isValidSecurityAnswer('   '), false);
});
