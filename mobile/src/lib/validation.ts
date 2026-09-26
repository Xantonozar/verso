import { ApiError } from './api/client';

export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/** Mirrors the server's loginSchema (§3.1) so first-submit errors match API errors. */
export function validateLogin(input: { identifier: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.identifier.trim()) errors.identifier = 'is required';
  if (!input.password) errors.password = 'is required';
  return errors;
}

/** Mirrors the server's registerSchema (§3.1) — first failing rule wins per field. */
export function validateRegister(input: {
  username: string;
  displayName: string;
  email: string;
  password: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  const username = input.username.trim();
  if (!username) errors.username = 'is required';
  else if (username.length < 3) errors.username = 'must be at least 3 characters';
  else if (username.length > 30) errors.username = 'must be at most 30 characters';
  else if (!USERNAME_RE.test(username))
    errors.username = 'can only contain letters, numbers and underscores';

  const displayName = input.displayName.trim();
  if (!displayName) errors.displayName = 'is required';
  else if (displayName.length > 50) errors.displayName = 'must be at most 50 characters';

  const email = input.email.trim();
  if (!email) errors.email = 'is required';
  else if (email.length > 254) errors.email = 'must be at most 254 characters';
  else if (!EMAIL_RE.test(email)) errors.email = 'must be a valid email';

  const password = input.password;
  if (!password) errors.password = 'is required';
  else if (password.length < 8) errors.password = 'must be at least 8 characters';
  else if (!/[a-zA-Z]/.test(password)) errors.password = 'must contain at least one letter';
  else if (!/[0-9]/.test(password)) errors.password = 'must contain at least one number';

  return errors;
}

/**
 * Turn an ApiError into per-field messages.
 *
 * The server sends two shapes (server errorHandler/validate.js):
 *   - VALIDATION_ERROR: details = [{ field, message, code }, ...]
 *   - AUTH_EMAIL_TAKEN / AUTH_USERNAME_TAKEN: details = { field }
 * Returns null when the error carries nothing field-specific.
 */
export function mapApiFieldErrors(err: unknown): FieldErrors | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details;

  if (Array.isArray(details)) {
    const out: FieldErrors = {};
    for (const issue of details) {
      const field = issue?.field;
      const message = issue?.message;
      if (typeof field === 'string' && typeof message === 'string' && !(field in out)) {
        out[field] = message;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  if (details && typeof details === 'object' && typeof (details as { field?: unknown }).field === 'string') {
    const field = (details as { field: string }).field;
    return { [field]: err.message };
  }

  return null;
}

/** '(root)' issues are form-level, not tied to one input. */
export function splitFieldErrors(errors: FieldErrors): {
  fields: FieldErrors;
  formMessage?: string;
} {
  const { '(root)': root, ...fields } = errors;
  return { fields, formMessage: root };
}

export function isConnectivityError(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'NETWORK' || err.code === 'TIMEOUT');
}

export const CONNECTIVITY_TOAST =
  "Can't reach the server. Check your connection and try again.";
