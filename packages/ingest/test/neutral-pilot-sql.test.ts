import assert from 'node:assert/strict';
import test from 'node:test';
import { googleSqlString } from '../src/neutral-pilot-sql.ts';

test('scraped strings are represented without source SQL syntax', () => {
  const hostile = "centre\\'; DROP TABLE dataset.centres; --";
  const expression = googleSqlString(hostile);

  assert.match(expression, /^CAST\(FROM_HEX\('[0-9a-f]+'\) AS STRING\)$/);
  assert.equal(expression.includes('DROP TABLE'), false);
  assert.equal(
    Buffer.from(expression.match(/'([0-9a-f]+)'/)![1]!, 'hex').toString('utf8'),
    hostile,
  );
});
