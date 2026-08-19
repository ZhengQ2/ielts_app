import assert from 'node:assert/strict';
import test from 'node:test';
import { ParseError } from '../src/parse.ts';
import { classifySourcePageFailure } from '../src/source-page-failure.ts';

test('410 is a confirmed removal while 404 remains retryable', () => {
  const gone = Object.assign(new Error('HTTP 410'), { status: 410 });
  assert.equal(classifySourcePageFailure('gone', gone).disposition, 'removed');

  const notFound = Object.assign(new Error('HTTP 404'), { status: 404 });
  assert.equal(classifySourcePageFailure('not-found', notFound).disposition, 'retryable');
});

test('rate limits and transport failures remain retryable', () => {
  const rateLimit = Object.assign(new Error('HTTP 429'), { status: 429 });
  assert.equal(classifySourcePageFailure('limited', rateLimit).disposition, 'retryable');
  assert.equal(
    classifySourcePageFailure('transport', new Error('socket closed')).disposition,
    'retryable',
  );
});

test('parser and permanent HTTP failures are not treated as removals', () => {
  assert.equal(
    classifySourcePageFailure('invalid-page', new ParseError('missing address')).disposition,
    'failed',
  );
  const forbidden = Object.assign(new Error('HTTP 403'), { status: 403 });
  assert.equal(classifySourcePageFailure('forbidden', forbidden).disposition, 'failed');
});
