import { normalizeClientIdentifier } from './client-data.js';

function configuredNoSalesHandles(value = process.env.NO_SALES_SOCIAL_HANDLES || '') {
  return String(value)
    .split(',')
    .map(normalizeClientIdentifier)
    .filter(Boolean);
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
