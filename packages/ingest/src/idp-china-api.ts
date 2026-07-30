import { createDecipheriv } from 'node:crypto';

const IDP_CHINA_SM4_KEY = Buffer.from(
  '065574e7ef3d92c579ffba093797b4f2',
  'hex',
);
const IDP_CHINA_SM4_IV = Buffer.from(
  '7a6b964619a05e5ce5423608b7bf4e95',
  'hex',
);

/**
 * Decode the anonymous public API payload using the same protocol material
 * shipped in IDP China's public website JavaScript.
 */
export function decryptIdpChinaPayload(value: string): unknown {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error('IDP China payload is not even-length hexadecimal');
  }
  try {
    const decipher = createDecipheriv(
      'sm4-cbc',
      IDP_CHINA_SM4_KEY,
      IDP_CHINA_SM4_IV,
    );
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as unknown;
  } catch (cause) {
    throw new Error(
      `IDP China payload could not be decrypted: ${errorMessage(cause)}`,
      { cause },
    );
  }
}

export function decryptIdpChinaEnvelope(value: unknown): unknown {
  const envelope = record(value, 'IDP China response');
  if (envelope.code !== 200) {
    throw new Error(
      `IDP China response code was ${String(envelope.code ?? 'missing')}`,
    );
  }
  if (typeof envelope.data !== 'string') {
    throw new Error('IDP China encrypted response data is missing');
  }
  return decryptIdpChinaPayload(envelope.data);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
