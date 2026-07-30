export const SECURITY_QUESTIONS = [
  '你小时候最喜欢的书是什么？',
  '你的第一个昵称是什么？',
  '你印象最深的一座城市是哪里？',
] as const;

const phoneAccountPattern = /^1[3-9][0-9]{9}$/;

export function normalizePhoneInput(value: string) {
  return value.replace(/[^0-9]/g, '').slice(0, 11);
}

export function isValidPhoneAccount(value: string) {
  return phoneAccountPattern.test(value);
}

export function isValidPassword(value: string) {
  return value.length >= 8 && value.length <= 72 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

export function isValidSecurityAnswer(value: string) {
  const normalized = value.trim();
  return normalized.length >= 2 && normalized.length <= 32;
}
