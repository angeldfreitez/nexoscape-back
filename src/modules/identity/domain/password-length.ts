export const MIN_NEW_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;
export const PASSWORD_INPUT_LIMIT = 1024;

// Count Unicode code points, not UTF-16 code units or rendered mask dots.
export function passwordLength(password: string): number {
  return Array.from(password).length;
}
