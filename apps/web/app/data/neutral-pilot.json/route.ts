interface PilotReport {
  version: number;
  generatedAt: string;
  overtureRelease: string;
  methodology: Record<string, string>;
  summary: Record<string, number>;
  records: unknown[];
}

const unavailable = {
  localOnly: true,
  available: false,
  message: 'Neutral coordinate diagnostics are available in local development only.',
  records: [],
};

/**
 * The pilot contains restricted comparison coordinates, so this endpoint must
 * fail closed in every production/export build. The development branch reads
 * the ignored artifact on demand and is never linked from the production UI.
 */
export const dynamic = 'force-static';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(unavailable);
  }

  try {
    const [{ readFile }, path] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    const candidates = [
      path.resolve(process.cwd(), '.artifacts/overture-neutral-pilot.json'),
      path.resolve(
        process.cwd(),
        '../..',
        '.artifacts/overture-neutral-pilot.json',
      ),
    ];

    let source: string | null = null;
    for (const candidate of candidates) {
      try {
        source = await readFile(candidate, 'utf8');
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        ) {
          throw error;
        }
      }
    }

    if (!source) {
      return Response.json(
        {
          ...unavailable,
          message:
            'Run `npm run neutral-pilot -- --limit 50` to create the local comparison artifact.',
        },
        { status: 404 },
      );
    }

    const report = JSON.parse(source) as PilotReport;
    if (
      ![1, 2].includes(report.version) ||
      !Array.isArray(report.records) ||
      typeof report.summary !== 'object'
    ) {
      throw new Error('Unsupported neutral pilot report');
    }

    return Response.json({
      localOnly: true,
      available: true,
      ...report,
    });
  } catch (error) {
    return Response.json(
      {
        ...unavailable,
        message:
          error instanceof Error
            ? `The neutral pilot report could not be read: ${error.message}`
            : 'The neutral pilot report could not be read.',
      },
      { status: 500 },
    );
  }
}
