export const API_KEY_STORAGE_KEY = 'ux-writing-api-key';

export interface ClientStoragePort {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
  deleteAsync(key: string): Promise<void>;
}

export function normalizeApiKey(value: string): string | null {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export async function getApiKeyConfigured(
  storage: ClientStoragePort,
): Promise<boolean> {
  return (await getApiKey(storage)) !== null;
}

export async function getApiKey(
  storage: ClientStoragePort,
): Promise<string | null> {
  const storedValue = await storage.getAsync(API_KEY_STORAGE_KEY);

  if (typeof storedValue !== 'string') {
    return null;
  }

  return normalizeApiKey(storedValue);
}

export async function saveApiKey(
  storage: ClientStoragePort,
  value: string,
): Promise<boolean> {
  const normalizedValue = normalizeApiKey(value);

  if (normalizedValue === null) {
    return false;
  }

  await storage.setAsync(API_KEY_STORAGE_KEY, normalizedValue);
  return true;
}

export async function deleteApiKey(
  storage: ClientStoragePort,
): Promise<void> {
  await storage.deleteAsync(API_KEY_STORAGE_KEY);
}
