import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectOperatorInjection } from './sanitize';

function run(req: any) {
  let status = 0;
  let nexted = false;
  const res: any = { status(code: number) { status = code; return this; }, json() { return this; } };
  rejectOperatorInjection(req, res, () => { nexted = true; });
  return { status, nexted };
}

test('plain queries pass', () => {
  assert.equal(run({ query: { category: 'Telegram', page: '2' }, body: {}, params: {} }).nexted, true);
});

test('operator keys in query are rejected', () => {
  const out = run({ query: { category: { $ne: 'x' } }, body: {}, params: {} });
  assert.equal(out.nexted, false);
  assert.equal(out.status, 400);
});

test('operator keys nested in the body are rejected', () => {
  assert.equal(run({ query: {}, body: { a: { b: [{ '$gt': '' }] } }, params: {} }).nexted, false);
  assert.equal(run({ query: {}, body: { 'a.b': 1 }, params: {} }).nexted, false);
});

test('raw image buffers are not walked', () => {
  assert.equal(run({ query: {}, body: Buffer.alloc(1024), params: {} }).nexted, true);
});
