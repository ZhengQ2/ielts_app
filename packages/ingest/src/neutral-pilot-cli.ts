#!/usr/bin/env node
import { dataset } from '@ielts-map/core/dataset';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPORT_DIR } from './config.ts';
import {
  distinctiveAddressTokens,
  distinctiveNameTokens,
  rankOvertureCandidates,
  selectNeutralPilotSample,
} from './neutral-pilot.ts';
import { googleSqlString } from './neutral-pilot-sql.ts';
import type {
  NeutralPilotCentre,
  OverturePlaceCandidate,
  PilotCandidateMatch,
  OvertureSourceLineage,
} from './neutral-pilot.ts';

interface RawOvertureRow {
  pilot_centre_id: string;
  candidate_kind: 'place' | 'address';
  id: string;
  name: string;
  alternate_names: string[] | null;
  address: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string | null;
  lng: number;
  lat: number;
  confidence: number | null;
  websites: string[] | null;
  phones: string[] | null;
  emails: string[] | null;
  discovery_paths: Array<'venue_name' | 'address' | 'contact'> | null;
  sources_json: string | null;
}

interface PilotRecord {
  centre: NeutralPilotCentre;
  match: PilotCandidateMatch | null;
  candidates: PilotCandidateMatch[];
  diagnosticOnly: true;
  eligibleForMigration: false;
}

const execFile = promisify(execFileCallback);
const args = parseArgs(process.argv.slice(2));
const requestedRelease = args.release ?? process.env.OVERTURE_RELEASE;
if (
  requestedRelease &&
  !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(requestedRelease)
) {
  throw new Error('--release must use YYYY-MM-DD.N.');
}
const limit = positiveInteger(args.limit ?? '50', '--limit');
if (limit > 50) {
  throw new Error(
    '--limit cannot exceed 50 because the query retains up to 500 candidates per centre and the result cap is 25,000 rows.',
  );
}
const dryRunOnly = args.dryRunOnly === 'true';
if (args.dryRunOnly && !['true', 'false'].includes(args.dryRunOnly)) {
  throw new Error('--dry-run-only must be true or false.');
}
const maximumBytesBilled = positiveInteger(
  args.maximumBytesBilled ?? '110000000000',
  '--maximum-bytes-billed',
);
const output = path.resolve(
  args.output ?? path.join(REPORT_DIR, 'overture-neutral-pilot.json'),
);

const sample = selectNeutralPilotSample(dataset.centres, limit);
if (sample.length !== limit) {
  throw new Error(`Requested ${limit} centres but only selected ${sample.length}.`);
}

const release = await bigQueryRelease();
if (requestedRelease && requestedRelease !== release) {
  throw new Error(
    `BigQuery currently mirrors Overture ${release}, not requested ${requestedRelease}.`,
  );
}
process.stderr.write(
  `Querying Overture ${release} in BigQuery for ${sample.length} diagnostic samples...\n`,
);
const queryResult = await queryOverture(
  sample,
  maximumBytesBilled,
  dryRunOnly,
);
if (dryRunOnly) {
  process.stdout.write(
    `${JSON.stringify(
      {
        overtureRelease: release,
        sampleSize: sample.length,
        estimatedBytesProcessed: queryResult.estimatedBytesProcessed,
        executed: false,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}
const candidates = queryResult.candidates;
const records: PilotRecord[] = sample.map((centre) => {
  const ranked = rankOvertureCandidates(centre, candidates, 5);
  const match = ranked.find((candidate) => candidate.decision !== 'reject') ?? null;
  return {
    centre,
    match,
    candidates: ranked,
    // The restricted Google point is retained solely to measure discrepancies
    // after neutral discovery. It is not used for lookup, ranking or acceptance.
    diagnosticOnly: true,
    eligibleForMigration: false,
  };
});

const summary = {
  sampleSize: records.length,
  countries: new Set(records.map((record) => record.centre.country)).size,
  overtureCandidatesRead: candidates.length,
  estimatedBytesProcessed: queryResult.estimatedBytesProcessed,
  acceptedCandidates: records.filter(
    (record) => record.match?.decision === 'accept',
  ).length,
  reviewCandidates: records.filter(
    (record) => record.match?.decision === 'review',
  ).length,
  noCandidates: records.filter((record) => !record.match).length,
  rejectedCandidatesRetained: records.reduce(
    (count, record) =>
      count +
      record.candidates.filter((candidate) => candidate.decision === 'reject')
        .length,
    0,
  ),
};

const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  overtureRelease: release,
  methodology: {
    source:
      'bigquery-public-data.overture_maps.place and overture_maps.address',
    sample:
      'Two deterministic centres from each of the 25 largest Google-coordinate country strata.',
    search:
      'Country-scoped source name, all Overture name variants, address, postcode and contact discovery; Google coordinates do not participate.',
    productionRule:
      'Accept only two independent evidence paths. Retain five candidates and explicit reject/review reasons; distance is diagnostic only.',
  },
  summary,
  records,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stderr.write(`Wrote ${output}\n`);

async function queryOverture(
  centres: NeutralPilotCentre[],
  maxBytes: number,
  estimateOnly: boolean,
): Promise<{
  candidates: OverturePlaceCandidate[];
  estimatedBytesProcessed: number;
}> {
  const query = buildQuery(centres);
  const dryRun = await runBq([
    'query',
    '--quiet',
    '--use_legacy_sql=false',
    '--dry_run',
    '--format=json',
    query,
  ]);
  const dryRunResult = JSON.parse(dryRun) as {
    statistics?: {
      totalBytesProcessed?: string;
      query?: { totalBytesProcessed?: string };
    };
  };
  const estimatedBytesProcessed = Number(
    dryRunResult.statistics?.totalBytesProcessed ??
      dryRunResult.statistics?.query?.totalBytesProcessed ??
      0,
  );
  if (
    !Number.isFinite(estimatedBytesProcessed) ||
    estimatedBytesProcessed <= 0
  ) {
    throw new Error('BigQuery did not return a valid dry-run byte estimate.');
  }
  if (estimatedBytesProcessed > maxBytes) {
    throw new Error(
      `BigQuery estimates ${estimatedBytesProcessed} bytes, above the ${maxBytes} safety cap.`,
    );
  }
  process.stderr.write(
    `BigQuery dry run: ${(estimatedBytesProcessed / 1_000_000_000).toFixed(2)} GB.\n`,
  );
  if (estimateOnly) {
    return { candidates: [], estimatedBytesProcessed };
  }

  const raw = await runBq([
    'query',
    '--quiet',
    '--use_legacy_sql=false',
    '--format=json',
    '--max_rows=25000',
    `--maximum_bytes_billed=${maxBytes}`,
    query,
  ]);
  const rows = JSON.parse(raw) as RawOvertureRow[];
  return {
    estimatedBytesProcessed,
    candidates: rows.map((row) => {
      const lineage = sourceLineage(row.sources_json);
      return {
        pilotCentreId: row.pilot_centre_id,
        kind: row.candidate_kind,
        id: `${row.candidate_kind}:${row.id}`,
        name: row.name,
        alternateNames: row.alternate_names ?? [],
        address: row.address,
        locality: row.locality,
        postcode: row.postcode,
        region: row.region,
        country: row.country,
        lng: Number(row.lng),
        lat: Number(row.lat),
        confidence: row.confidence === null ? null : Number(row.confidence),
        websites: row.websites ?? [],
        phones: row.phones ?? [],
        emails: row.emails ?? [],
        discoveryPaths: row.discovery_paths ?? [],
        sourceLineage: lineage,
        sourceLicenses: [
          ...new Set(
            lineage
              .map((source) => source.license)
              .filter((license): license is string => Boolean(license)),
          ),
        ].sort(),
      };
    }),
  };
}

function buildQuery(centres: NeutralPilotCentre[]): string {
  const sampleRows = centres.map((centre) => {
    const tokens = distinctiveNameTokens(centre.name)
      .map(googleSqlString)
      .join(', ');
    const addressTokens = distinctiveAddressTokens(centre)
      .map(googleSqlString)
      .join(', ');
    const addressNumbers = [
      ...new Set(
        centre.address
          .match(/\p{Number}+/gu)
          ?.filter((value) => value.length <= 6) ?? [],
      ),
    ]
      .map(googleSqlString)
      .join(', ');
    const postcode = centre.postcode
      ? googleSqlString(centre.postcode.toLowerCase().replaceAll(' ', ''))
      : 'NULL';
    const phones = centre.phones
      .map((phone) => phone.replace(/\D/g, '').slice(-8))
      .filter((phone) => phone.length >= 7)
      .map(googleSqlString)
      .join(', ');
    const websiteHosts = centre.websites
      .map(websiteHost)
      .filter(Boolean)
      .map(googleSqlString)
      .join(', ');
    return `STRUCT<centre_id STRING, country STRING, tokens ARRAY<STRING>, address_tokens ARRAY<STRING>, address_numbers ARRAY<STRING>, postcode STRING, phones ARRAY<STRING>, website_hosts ARRAY<STRING>>(
      ${googleSqlString(centre.id)},
      ${googleSqlString(centre.country.toLowerCase())},
      [${tokens}],
      [${addressTokens}],
      [${addressNumbers}],
      ${postcode},
      [${phones}],
      [${websiteHosts}]
    )`;
  });
  return `
    WITH samples AS (
      SELECT *
      FROM UNNEST([
        ${sampleRows.join(',\n')}
      ])
    ),
    place_base AS (
      SELECT
        place.*,
        ARRAY_CONCAT(
          [COALESCE(place.names.primary, '')],
          ARRAY(
            SELECT item.value
            FROM UNNEST(place.names.common.key_value) AS item
            WHERE item.value IS NOT NULL
          ),
          ARRAY(
            SELECT item.element.value
            FROM UNNEST(place.names.rules.list) AS item
            WHERE item.element.value IS NOT NULL
          )
        ) AS searchable_names,
        place.addresses.list[SAFE_OFFSET(0)].element AS first_address
      FROM \`bigquery-public-data.overture_maps.place\` AS place
      WHERE place.names.primary IS NOT NULL
    ),
    places AS (
      SELECT
        place_base.*,
        LOWER(ARRAY_TO_STRING(place_base.searchable_names, ' ')) AS searchable_name_text,
        LOWER(
          ARRAY_TO_STRING(
            ARRAY(
              SELECT item.element
              FROM UNNEST(place_base.websites.list) AS item
            ),
            ' '
          )
        ) AS website_text,
        ARRAY_TO_STRING(
          ARRAY(
            SELECT REGEXP_REPLACE(item.element, r'[^0-9]', '')
            FROM UNNEST(place_base.phones.list) AS item
          ),
          ' '
        ) AS phone_text
      FROM place_base
    ),
    place_matches AS (
      SELECT
        samples.centre_id AS pilot_centre_id,
        'place' AS candidate_kind,
        places.id,
        places.names.primary AS name,
        ARRAY(
          SELECT DISTINCT value
          FROM UNNEST(places.searchable_names) AS value
          WHERE value != places.names.primary AND value != ''
        ) AS alternate_names,
        places.first_address.freeform AS address,
        places.first_address.locality AS locality,
        places.first_address.postcode AS postcode,
        places.first_address.region AS region,
        places.first_address.country AS country,
        ST_X(places.geometry) AS lng,
        ST_Y(places.geometry) AS lat,
        places.confidence,
        ARRAY(
          SELECT item.element
          FROM UNNEST(places.websites.list) AS item
        ) AS websites,
        ARRAY(
          SELECT item.element
          FROM UNNEST(places.phones.list) AS item
        ) AS phones,
        ARRAY(
          SELECT item.element
          FROM UNNEST(places.emails.list) AS item
        ) AS emails,
        ARRAY(
          SELECT evidence
          FROM UNNEST([
            IF(
              (
                SELECT COUNTIF(
                  STRPOS(places.searchable_name_text, token) > 0
                )
                FROM UNNEST(samples.tokens) AS token
              ) > 0,
              'venue_name',
              NULL
            ),
            IF(
              (
                samples.postcode IS NOT NULL
                AND REPLACE(
                  LOWER(COALESCE(places.first_address.postcode, '')),
                  ' ',
                  ''
                ) = samples.postcode
              )
              OR (
                SELECT COUNTIF(
                  STRPOS(LOWER(COALESCE(places.first_address.freeform, '')), token) > 0
                )
                FROM UNNEST(samples.address_tokens) AS token
              ) >= 2,
              'address',
              NULL
            ),
            IF(
              (
                SELECT COUNTIF(STRPOS(places.website_text, host) > 0)
                FROM UNNEST(samples.website_hosts) AS host
              ) > 0
              OR (
                SELECT COUNTIF(STRPOS(places.phone_text, phone) > 0)
                FROM UNNEST(samples.phones) AS phone
              ) > 0,
              'contact',
              NULL
            )
          ]) AS evidence
          WHERE evidence IS NOT NULL
        ) AS discovery_paths,
        TO_JSON_STRING(places.sources.list) AS sources_json,
        (
          SELECT COUNTIF(STRPOS(places.searchable_name_text, token) > 0)
          FROM UNNEST(samples.tokens) AS token
        ) AS token_hits,
        REPLACE(
          LOWER(COALESCE(places.first_address.postcode, '')),
          ' ',
          ''
        ) = samples.postcode AS postcode_matches
      FROM samples
      JOIN places
        ON LOWER(COALESCE(places.first_address.country, '')) = samples.country
      WHERE (
          (
            SELECT COUNTIF(STRPOS(places.searchable_name_text, token) > 0)
            FROM UNNEST(samples.tokens) AS token
          ) > 0
          OR (
            samples.postcode IS NOT NULL
            AND REPLACE(
              LOWER(COALESCE(places.first_address.postcode, '')),
              ' ',
              ''
            ) = samples.postcode
          )
          OR (
            SELECT COUNTIF(STRPOS(places.website_text, host) > 0)
            FROM UNNEST(samples.website_hosts) AS host
          ) > 0
          OR (
            SELECT COUNTIF(STRPOS(places.phone_text, phone) > 0)
            FROM UNNEST(samples.phones) AS phone
          ) > 0
        )
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY samples.centre_id
        ORDER BY postcode_matches DESC, token_hits DESC, places.id
      ) <= 250
    ),
    address_matches AS (
      SELECT
        samples.centre_id AS pilot_centre_id,
        'address' AS candidate_kind,
        addresses.id,
        '' AS name,
        CAST([] AS ARRAY<STRING>) AS alternate_names,
        CONCAT(
          COALESCE(addresses.number, ''),
          IF(addresses.number IS NULL OR addresses.street IS NULL, '', ' '),
          COALESCE(addresses.street, ''),
          IF(addresses.unit IS NULL, '', CONCAT(', ', addresses.unit))
        ) AS address,
        addresses.postal_city AS locality,
        addresses.postcode,
        CAST(NULL AS STRING) AS region,
        addresses.country,
        ST_X(addresses.geometry) AS lng,
        ST_Y(addresses.geometry) AS lat,
        CAST(NULL AS FLOAT64) AS confidence,
        CAST([] AS ARRAY<STRING>) AS websites,
        CAST([] AS ARRAY<STRING>) AS phones,
        CAST([] AS ARRAY<STRING>) AS emails,
        ['address'] AS discovery_paths,
        TO_JSON_STRING(addresses.sources.list) AS sources_json,
        0 AS token_hits,
        REPLACE(LOWER(COALESCE(addresses.postcode, '')), ' ', '') =
          samples.postcode AS postcode_matches
      FROM samples
      JOIN \`bigquery-public-data.overture_maps.address\` AS addresses
        ON LOWER(COALESCE(addresses.country, '')) = samples.country
      WHERE (
          (
            samples.postcode IS NOT NULL
            AND REPLACE(LOWER(COALESCE(addresses.postcode, '')), ' ', '') =
              samples.postcode
            AND (
              (
                SELECT COUNTIF(
                  STRPOS(LOWER(COALESCE(addresses.street, '')), token) > 0
                )
                FROM UNNEST(samples.address_tokens) AS token
              ) > 0
              OR (
                SELECT COUNTIF(
                  REGEXP_REPLACE(
                    COALESCE(addresses.number, ''),
                    r'[^0-9]',
                    ''
                  ) = address_number
                )
                FROM UNNEST(samples.address_numbers) AS address_number
              ) > 0
            )
          )
          OR (
            (
              SELECT COUNTIF(
                REGEXP_REPLACE(
                  COALESCE(addresses.number, ''),
                  r'[^0-9]',
                  ''
                ) = address_number
              )
              FROM UNNEST(samples.address_numbers) AS address_number
            ) > 0
            AND (
              SELECT COUNTIF(
                STRPOS(LOWER(COALESCE(addresses.street, '')), token) > 0
              )
              FROM UNNEST(samples.address_tokens) AS token
            ) > 0
          )
        )
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY samples.centre_id
        ORDER BY postcode_matches DESC, addresses.id
      ) <= 250
    ),
    ranked AS (
      SELECT * FROM place_matches
      UNION ALL
      SELECT * FROM address_matches
    )
    SELECT * EXCEPT(token_hits, postcode_matches)
    FROM ranked
  `;
}

async function bigQueryRelease(): Promise<string> {
  const raw = await runBq([
    'show',
    '--format=json',
    'bigquery-public-data:overture_maps.place',
  ]);
  const table = JSON.parse(raw) as { labels?: { release?: string } };
  const label = table.labels?.release;
  if (!label || !/^\d{4}-\d{2}-\d{2}_\d+$/.test(label)) {
    throw new Error('The Overture BigQuery table has no recognized release label.');
  }
  return label.replace(/_(\d+)$/, '.$1');
}

async function runBq(args: string[]): Promise<string> {
  try {
    const result = await execFile('bq', args, {
      maxBuffer: 64 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const detail =
      error instanceof Error && ('stderr' in error || 'stdout' in error)
        ? [
            String((error as Error & { stderr?: string }).stderr ?? ''),
            String((error as Error & { stdout?: string }).stdout ?? ''),
            error.message,
          ]
            .filter(Boolean)
            .join('\n')
        : String(error);
    throw new Error(`BigQuery command failed: ${detail.trim()}`);
  }
}

function sourceLineage(raw: string | null): OvertureSourceLineage[] {
  if (!raw) return [];
  try {
    const sources = JSON.parse(raw) as Array<{
      property?: string | null;
      dataset?: string | null;
      license?: string | null;
      record_id?: string | null;
      update_time?: string | null;
      confidence?: number | null;
      element?: {
        property?: string | null;
        dataset?: string | null;
        license?: string | null;
        record_id?: string | null;
        update_time?: string | null;
        confidence?: number | null;
      };
    }>;
    return sources.map((source) => {
      const value = source.element ?? source;
      return {
        property: value.property ?? null,
        dataset: value.dataset ?? null,
        license: value.license ?? null,
        recordId: value.record_id ?? null,
        updateTime: value.update_time ?? null,
        confidence:
          value.confidence === null || value.confidence === undefined
            ? null
            : Number(value.confidence),
      };
    });
  } catch {
    return [];
  }
}

function websiteHost(value: string): string {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index++) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Expected --name value, received ${flag ?? '(empty)'}.`);
    }
    parsed[
      flag
        .slice(2)
        .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    ] = value;
    index++;
  }
  return parsed;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}
