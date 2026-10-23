import crypto from 'node:crypto';
import { normalizeClientIdentifier } from './client-data.js';

const SENSITIVE_REPLY_HASH_SALT = 'chaya-sensitive-v1:';
const DEFAULT_SENSITIVE_REPLY_HASHES = new Set([
  '9ef09fb5dca65f55341333f48ed4e8414c1228842696178c4218140c3aa1e6d6',
  'f671d2954bb6b034b6bb986486c90f6bb5348745665947bf9ab519878bafc2f9',
]);

function configuredNoSalesHandles(value = process.env.NO_SALES_SOCIAL_HANDLES || '') {
  return String(value)
    .split(',')
    .map(normalizeClientIdentifier)
    .filter(Boolean);
}

function configuredSensitiveReplyHandles(
  value = process.env.SENSITIVE_PERSONAL_REPLY_HANDLES || ''
) {
  return String(value)
    .split(',')
    .map(normalizeClientIdentifier)
    .filter(Boolean);
}

function sensitiveReplyHandleHash(username) {
  const normalized = normalizeClientIdentifier(username);
  return normalized
    ? crypto.createHash('sha256').update(`${SENSITIVE_REPLY_HASH_SALT}${normalized}`).digest('hex')
    : '';
}

export function noSalesSocialHandles(value) {
  return new Set(configuredNoSalesHandles(value));
}

export function isNoSalesSocialHandle(username, value) {
  const normalized = normalizeClientIdentifier(username);
  return Boolean(normalized && noSalesSocialHandles(value).has(normalized));
}

export function noSalesOverrideCount(value) {
  return noSalesSocialHandles(value).size;
}

export function sensitiveReplyHandles(value) {
  return new Set(configuredSensitiveReplyHandles(value));
}

export function isSensitiveReplyHandle(username, value) {
  const normalized = normalizeClientIdentifier(username);
  if (!normalized) return false;
  if (value !== undefined || process.env.SENSITIVE_PERSONAL_REPLY_HANDLES) {
    return sensitiveReplyHandles(value).has(normalized);
  }
  return DEFAULT_SENSITIVE_REPLY_HASHES.has(sensitiveReplyHandleHash(normalized));
}

export function sensitiveReplyOverrideCount(value) {
  if (value !== undefined || process.env.SENSITIVE_PERSONAL_REPLY_HANDLES) {
    return sensitiveReplyHandles(value).size;
  }
  return DEFAULT_SENSITIVE_REPLY_HASHES.size;
}
