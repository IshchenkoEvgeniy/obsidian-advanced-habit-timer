interface TelegramWebUser { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; }

export interface TelegramWebSession {
  user: TelegramWebUser;
  authDate: number;
  queryId: string;
}

export async function validateTelegramInitData(
  initData: string, botToken: string, expectedChatId: string, now = Date.now()
): Promise<TelegramWebSession | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  const authDate = Number(params.get('auth_date'));
  if (!hash || !Number.isFinite(authDate) || Math.abs(now / 1000 - authDate) > 86400) return null;
  params.delete('hash');
  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => entries.push([key, value]));
  const check = entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const encoder = new TextEncoder();
  const secret = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  ), encoder.encode(botToken));
  const signature = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  ), encoder.encode(check));
  if (!constantTimeEqual(hash.toLocaleLowerCase(), hex(signature))) return null;
  try {
    const user = JSON.parse(params.get('user') || '') as TelegramWebUser;
    if (!Number.isFinite(user.id) || (expectedChatId && String(user.id) !== expectedChatId)) return null;
    return { user, authDate, queryId: params.get('query_id') || '' };
  } catch { return null; }
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}
