import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import test from 'node:test';
import {
  decryptIdpChinaEnvelope,
  decryptIdpChinaPayload,
} from '../src/idp-china-api.ts';

const KEY = Buffer.from('065574e7ef3d92c579ffba093797b4f2', 'hex');
const IV = Buffer.from('7a6b964619a05e5ce5423608b7bf4e95', 'hex');

test('decrypts an IDP China SM4-CBC JSON payload', () => {
  const expected = {
    list: [
      {
        centerId: '42',
        centerEnName: 'IDP IELTS Example',
        state: 0,
      },
    ],
    total: 1,
  };
  const cipher = createCipheriv('sm4-cbc', KEY, IV);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(expected), 'utf8'),
    cipher.final(),
  ]).toString('hex');

  assert.deepEqual(decryptIdpChinaPayload(encrypted), expected);
  assert.deepEqual(
    decryptIdpChinaEnvelope({ code: 200, data: encrypted }),
    expected,
  );
});

test('rejects malformed or unsuccessful IDP China envelopes', () => {
  assert.throws(
    () => decryptIdpChinaPayload('not-hex'),
    /even-length hexadecimal/,
  );
  assert.throws(
    () => decryptIdpChinaEnvelope({ code: 402, data: '' }),
    /response code was 402/,
  );
});
