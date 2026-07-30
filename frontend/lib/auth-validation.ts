export const SECURITY_QUESTIONS = [
  '你小时候最喜欢的书是什么？',
  '你的第一个昵称是什么？',
  '你的第一只宠物叫什么名字？',
  '你小学班主任的名字是什么？',
  '你小时候最喜欢的动画角色是谁？',
  '你最喜欢的一道家常菜是什么？',
  '你儿时最好的朋友叫什么名字？',
  '你印象最深的一座城市是哪里？',
] as const;

export const SECURITY_ANSWER_MAX_LENGTH = 64;

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
  const length = Array.from(normalized).length;
  return length >= 1 && length <= SECURITY_ANSWER_MAX_LENGTH;
}
