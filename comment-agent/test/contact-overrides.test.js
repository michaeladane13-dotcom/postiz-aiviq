import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNoSalesSocialHandle,
  noSalesOverrideCount,
} from '../src/contact-overrides.js';

test('configured no-sales handles match exactly and case-insensitively', () => {
  assert.equal(isNoSalesSocialHandle('protected_client', 'protected_client'), true);
  assert.equal(isNoSalesSocialHandle('@PROTECTED_CLIENT', 'protected_client'), true);
  assert.equal(isNoSalesSocialHandle('protected', 'protected_client'), false);
  assert.equal(isNoSalesSocialHandle('protected_client_fake', 'protected_client'), false);
  assert.equal(noSalesOverrideCount('protected_client'), 1);
});

test('multiple configured no-sales handles remain distinct', () => {
  const configured = 'protected_client, another_client';
  assert.equal(isNoSalesSocialHandle('another_client', configured), true);
  assert.equal(isNoSalesSocialHandle('protected_client', configured), true);
  assert.equal(noSalesOverrideCount(configured), 2);
});
