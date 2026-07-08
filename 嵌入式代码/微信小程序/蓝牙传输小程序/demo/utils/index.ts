export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function trimAll(str: string): string {
  return str.replace(/\s+/g, '');
}

export function isValidSSID(ssid: string): boolean {
  return ssid.length > 0 && ssid.length <= 32;
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 64;
}