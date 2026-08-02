import AsyncStorage from '@react-native-async-storage/async-storage';

export type WorkbenchSessionKind = 'compare' | 'convert';

export type WorkbenchSession = {
  createdAt: number;
  id: string;
  inputText: string;
  inputBText?: string;
  kind: WorkbenchSessionKind;
  options: Record<string, unknown>;
  outputFormat?: string;
  outputText?: string;
  title: string;
};

export type WorkbenchTemplate = {
  createdAt: number;
  id: string;
  kind: WorkbenchSessionKind;
  name: string;
  options: Record<string, unknown>;
};

const SESSION_KEY = '@funbox/json-workbench/sessions';
const TEMPLATE_KEY = '@funbox/json-workbench/templates';
const MAX_SESSIONS = 200;
const MAX_TEMPLATES = 50;

function parseStoredList<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function readList<T>(key: string): Promise<T[]> {
  try {
    return parseStoredList<T>(await AsyncStorage.getItem(key));
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, items: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(items));
  } catch {
    // 本地存储失败时保持内存可用的降级路径，不让功能中断。
  }
}

export function getWorkbenchSessions(): Promise<WorkbenchSession[]> {
  return readList<WorkbenchSession>(SESSION_KEY);
}

export async function addWorkbenchSession(session: WorkbenchSession): Promise<WorkbenchSession[]> {
  const items = await readList<WorkbenchSession>(SESSION_KEY);
  const next = [session, ...items.filter((item) => item.id !== session.id)].slice(0, MAX_SESSIONS);
  await writeList(SESSION_KEY, next);
  return next;
}

export async function deleteWorkbenchSession(id: string): Promise<WorkbenchSession[]> {
  const items = await readList<WorkbenchSession>(SESSION_KEY);
  const next = items.filter((item) => item.id !== id);
  await writeList(SESSION_KEY, next);
  return next;
}

export async function clearWorkbenchSessions(): Promise<void> {
  await writeList(SESSION_KEY, []);
}

export function getWorkbenchTemplates(): Promise<WorkbenchTemplate[]> {
  return readList<WorkbenchTemplate>(TEMPLATE_KEY);
}

export async function saveWorkbenchTemplate(template: WorkbenchTemplate): Promise<WorkbenchTemplate[]> {
  const items = await readList<WorkbenchTemplate>(TEMPLATE_KEY);
  const next = [template, ...items.filter((item) => item.id !== template.id)].slice(0, MAX_TEMPLATES);
  await writeList(TEMPLATE_KEY, next);
  return next;
}

export async function deleteWorkbenchTemplate(id: string): Promise<WorkbenchTemplate[]> {
  const items = await readList<WorkbenchTemplate>(TEMPLATE_KEY);
  const next = items.filter((item) => item.id !== id);
  await writeList(TEMPLATE_KEY, next);
  return next;
}
