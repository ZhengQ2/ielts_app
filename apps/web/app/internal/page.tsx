'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  draftLocationApproval,
  isLocationReviewGeo,
  locationConfirmationToken,
  locationReviewIssues,
  needsLocationReview,
  type ApprovableGeoPrecision,
  type Centre,
} from '@ielts-map/core';
import { NewCentreForm } from '@/components/NewCentreForm';

interface AuthConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  logoutUrl: string;
}

interface Tokens {
  idToken: string;
  accessToken: string;
  expiresAt: number;
}

interface StoredOverride {
  centreId: string;
  patch: Partial<Centre>;
  created?: boolean;
  updatedAt: string;
  updatedBy: string;
}

interface CentreFeed {
  centres: Centre[];
}

const TOKENS_KEY = 'ielts-internal-tokens';
const VERIFIER_KEY = 'ielts-internal-pkce-verifier';
const STATE_KEY = 'ielts-internal-oauth-state';

export default function InternalPage() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [overrides, setOverrides] = useState<Record<string, StoredOverride>>({});
  const [query, setQuery] = useState('');
  const [locationQueueOnly, setLocationQueueOnly] = useState(false);
  const [confirmedCoordinateToken, setConfirmedCoordinateToken] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingCentre, setAddingCentre] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(internalApiUrl('/internal-api/config'), { cache: 'no-store' })
      .then(requireJson<AuthConfig>)
      .then(setConfig)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  useEffect(() => {
    if (!config) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    if (!code) {
      setTokens(readTokens());
      return;
    }

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    const expectedState = sessionStorage.getItem(STATE_KEY);
    if (!verifier || !expectedState || returnedState !== expectedState) {
      setError('The login response could not be verified. Please try again.');
      return;
    }

    const redirectUri = `${window.location.origin}/internal/`;
    fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    })
      .then(requireJson<{
        id_token: string;
        access_token: string;
        expires_in: number;
      }>)
      .then((response) => {
        const next: Tokens = {
          idToken: response.id_token,
          accessToken: response.access_token,
          expiresAt: Date.now() + response.expires_in * 1_000,
        };
        sessionStorage.setItem(TOKENS_KEY, JSON.stringify(next));
        sessionStorage.removeItem(VERIFIER_KEY);
        sessionStorage.removeItem(STATE_KEY);
        window.history.replaceState({}, '', '/internal/');
        setTokens(next);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, [config]);

  const loadAdminData = useCallback(async (activeTokens: Tokens) => {
    const headers = { authorization: `Bearer ${activeTokens.idToken}` };
    const [base, stored] = await Promise.all([
      fetch(internalApiUrl('/internal-api/base-centres'), { headers, cache: 'no-store' }).then(
        requireJson<CentreFeed>,
      ),
      fetch(internalApiUrl('/internal-api/overrides'), { headers, cache: 'no-store' }).then(
        requireJson<{ overrides: StoredOverride[] }>,
      ),
    ]);
    setCentres(base.centres);
    setOverrides(
      Object.fromEntries(stored.overrides.map((entry) => [entry.centreId, entry])),
    );
  }, []);

  useEffect(() => {
    if (!tokens) return;
    setBusy(true);
    loadAdminData(tokens)
      .catch((cause: unknown) => {
        setError(
          `${errorMessage(cause)} Your account may not belong to the administrators group.`,
        );
      })
      .finally(() => setBusy(false));
  }, [loadAdminData, tokens]);

  const effectiveCentres = useMemo(
    () => [
      ...centres.map((centre) => ({
          ...centre,
          ...(overrides[centre.id]?.patch ?? {}),
          id: centre.id,
        })),
      ...Object.values(overrides)
        .filter((entry) => entry.created)
        .map((entry) => ({ ...entry.patch, id: entry.centreId } as Centre)),
    ],
    [centres, overrides],
  );
  const selectedCentre = effectiveCentres.find((centre) => centre.id === selectedId);
  const selectedStored = selectedId ? overrides[selectedId] : undefined;
  const selectedBase = selectedStored?.created
    ? selectedCentre
    : centres.find((centre) => centre.id === selectedId);
  const reviewGeo = useMemo(() => {
    try {
      const parsed = JSON.parse(editorValue) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const draft = parsed as Record<string, unknown>;
      return draft.id === selectedId && isLocationReviewGeo(draft.geo) ? draft.geo : null;
    } catch {
      return null;
    }
  }, [editorValue, selectedId]);
  const reviewCoordinateToken = locationConfirmationToken(reviewGeo);
  const locationConfirmed =
    reviewCoordinateToken !== null && confirmedCoordinateToken === reviewCoordinateToken;
  const locationReviewCentres = useMemo(
    () => effectiveCentres.filter((centre) => needsLocationReview(centre.geo)),
    [effectiveCentres],
  );
  const visibleCentres = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const candidates = locationQueueOnly ? locationReviewCentres : effectiveCentres;
    const matches = needle
      ? candidates.filter((centre) =>
          [
            centre.id,
            centre.name,
            centre.address.raw,
            centre.address.city,
            centre.address.country,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle),
        )
      : candidates;
    return locationQueueOnly ? matches : matches.slice(0, 200);
  }, [effectiveCentres, locationQueueOnly, locationReviewCentres, query]);

  function selectCentre(centre: Centre): void {
    setAddingCentre(false);
    setSelectedId(centre.id);
    setEditorValue(JSON.stringify(centre, null, 2));
    setConfirmedCoordinateToken(null);
    setMessage(null);
    setError(null);
  }

  function stageLocationApproval(precision: ApprovableGeoPrecision): void {
    setMessage(null);
    setError(null);
    try {
      const parsed = JSON.parse(editorValue) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('The centre draft must be a JSON object.');
      }
      const draft = parsed as Record<string, unknown>;
      if (draft.geo === null) throw new Error('This centre has no coordinate to approve.');
      if (!isLocationReviewGeo(draft.geo)) {
        throw new Error('Complete or correct the location fields before approving this coordinate.');
      }
      const edited = parsed as Centre;
      if (
        confirmedCoordinateToken === null ||
        confirmedCoordinateToken !== locationConfirmationToken(draft.geo)
      ) {
        throw new Error('Inspect and confirm the current coordinate before approving it.');
      }
      const approved: Centre = {
        ...edited,
        geo: draftLocationApproval(draft.geo, precision),
      };
      setEditorValue(JSON.stringify(approved, null, 2));
      setConfirmedCoordinateToken(null);
      setMessage(
        `Drafted a ${precision} location approval. Review the JSON, then save the changes.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function save(): Promise<void> {
    if (!tokens || !selectedBase || !selectedId) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const edited = JSON.parse(editorValue) as Centre;
      if (edited.id !== selectedId) throw new Error('A centre id cannot be changed.');
      if (!selectedStored?.created && edited.ieltsOrgSlug !== selectedBase.ieltsOrgSlug) {
        throw new Error('The IELTS.org route slug cannot be changed without a deployment.');
      }
      const body = selectedStored?.created
        ? { centre: edited, expectedUpdatedAt: selectedStored.updatedAt }
        : {
            patch: topLevelPatch(selectedBase, edited),
            expectedUpdatedAt: selectedStored?.updatedAt ?? null,
          };
      const saved = await fetch(internalApiUrl(`/internal-api/centres/${encodeURIComponent(selectedId)}`), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${tokens.idToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }).then(requireJson<StoredOverride>);
      setOverrides((current) => ({ ...current, [selectedId]: saved }));
      setConfirmedCoordinateToken(null);
      setMessage(
        'Saved. The public list, map and centre detail page will refresh within about one minute.',
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reset(): Promise<void> {
    if (!tokens || !selectedId || !selectedBase) return;
    if (
      selectedStored?.created &&
      !window.confirm('Delete this manually added centre? This cannot be restored from the source feed.')
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(
        internalApiUrl(`/internal-api/centres/${encodeURIComponent(selectedId)}`),
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${tokens.idToken}`,
            'if-match': selectedStored?.updatedAt ?? '',
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      setOverrides((current) => {
        const next = { ...current };
        delete next[selectedId];
        return next;
      });
      if (selectedStored?.created) {
        setSelectedId(null);
        setEditorValue('');
      } else {
        setEditorValue(JSON.stringify(selectedBase, null, 2));
      }
      setConfirmedCoordinateToken(null);
      setMessage(
        selectedStored?.created
          ? 'The manually added centre was deleted.'
          : 'Override removed. The source-backed centre record is active again.',
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createCentre(centre: Centre): Promise<void> {
    if (!tokens) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await fetch(internalApiUrl('/internal-api/centres'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.idToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ centre }),
      }).then(requireJson<StoredOverride>);
      setOverrides((current) => ({ ...current, [saved.centreId]: saved }));
      setAddingCentre(false);
      setSelectedId(saved.centreId);
      setEditorValue(JSON.stringify(centre, null, 2));
      setMessage('Centre added. It will appear in the public directory within about one minute.');
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function login(): Promise<void> {
    if (!config) return;
    const verifier = randomUrlSafe(64);
    const state = randomUrlSafe(32);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    const challenge = await sha256UrlSafe(verifier);
    const redirectUri = `${window.location.origin}/internal/`;
    const url = new URL(config.authorizeUrl);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }).toString();
    window.location.assign(url);
  }

  function logout(): void {
    sessionStorage.removeItem(TOKENS_KEY);
    setTokens(null);
    if (!config) return;
    const url = new URL(config.logoutUrl);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: `${window.location.origin}/internal/`,
    }).toString();
    window.location.assign(url);
  }

  if (!tokens) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold">Internal centre editor</h1>
        <p className="mt-3 text-muted">
          Sign in with an administrator account to view or edit centre records.
        </p>
        {error && <ErrorNotice message={error} />}
        <button
          type="button"
          onClick={() => void login()}
          disabled={!config}
          className="mt-6 rounded-md bg-brand px-4 py-2.5 font-medium text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[96rem] px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Internal centre editor</h1>
          <p className="mt-1 text-sm text-muted">
            {centres.length.toLocaleString()} source records ·{' '}
            {Object.keys(overrides).length.toLocaleString()} edited ·{' '}
            {locationReviewCentres.length.toLocaleString()} location approvals pending
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setAddingCentre(true);
              setSelectedId(null);
              setMessage(null);
              setError(null);
            }}
            className="rounded bg-brand px-3 py-2 text-sm font-medium text-white"
          >
            Add centre
          </button>
          <button type="button" onClick={logout} className="rounded border border-line px-3 py-2 text-sm">
            Sign out
          </button>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}
      {message && <p className="mt-4 rounded border border-brand/30 bg-brand-soft p-3 text-sm">{message}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <section className="rounded-lg border border-line bg-white p-3">
          <div className="grid grid-cols-2 gap-2" aria-label="Centre queue">
            <button
              type="button"
              onClick={() => setLocationQueueOnly(false)}
              className={`rounded border px-3 py-2 text-sm ${
                !locationQueueOnly
                  ? 'border-brand bg-brand-soft font-medium text-brand'
                  : 'border-line'
              }`}
            >
              All centres
            </button>
            <button
              type="button"
              onClick={() => setLocationQueueOnly(true)}
              className={`rounded border px-3 py-2 text-sm ${
                locationQueueOnly
                  ? 'border-brand bg-brand-soft font-medium text-brand'
                  : 'border-line'
              }`}
            >
              Location review ({locationReviewCentres.length.toLocaleString()})
            </button>
          </div>
          <label className="mt-4 block text-sm font-medium" htmlFor="internal-search">
            Search {locationQueueOnly ? 'location tasks' : 'all entries'}
          </label>
          <input
            id="internal-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, city, country or region, id…"
            className="mt-2 w-full rounded-md border border-line px-3 py-2"
          />
          <p className="mt-2 text-xs text-muted">
            {locationQueueOnly
              ? `Showing all ${visibleCentres.length.toLocaleString()} matching pending tasks.`
              : 'Showing up to 200 matches.'}
          </p>
          <ul className="mt-3 max-h-[70vh] space-y-1 overflow-y-auto">
            {visibleCentres.map((centre) => (
              <li key={centre.id}>
                <button
                  type="button"
                  onClick={() => selectCentre(centre)}
                  className={`w-full rounded p-2 text-left text-sm ${
                    centre.id === selectedId ? 'bg-brand-soft text-brand' : 'hover:bg-surface'
                  }`}
                >
                  <span className="block font-medium">{centre.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {centre.address.country} · {centre.address.raw}
                    {overrides[centre.id]?.created
                      ? ' · added manually'
                      : overrides[centre.id]
                        ? ' · edited'
                        : ''}
                  </span>
                  {locationQueueOnly && (
                    <span className="mt-1 block text-xs text-amber-700">
                      {locationReviewIssues(centre.geo).join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-line bg-white p-4">
          {addingCentre ? (
            <NewCentreForm
              busy={busy}
              onCancel={() => setAddingCentre(false)}
              onCreate={createCentre}
            />
          ) : selectedCentre ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-medium">{selectedCentre.name}</h2>
                  <p className="text-xs text-muted">{selectedCentre.id}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void reset()}
                    disabled={busy || !overrides[selectedCentre.id]}
                    className="rounded border border-line px-3 py-2 text-sm disabled:opacity-40"
                  >
                    {selectedStored?.created ? 'Delete centre' : 'Remove override'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy}
                    className="rounded bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">
                {selectedStored?.created
                  ? 'Edit the complete generated record. Its stable id and reserved live route are read-only.'
                  : 'Edit the complete JSON record. The stable id and IELTS.org route slug are read-only. Changed top-level fields become durable overrides; untouched fields continue following the source crawl.'}{' '}
                <a
                  href="https://github.com/ZhengQ2/ielts_app/blob/main/docs/INTERNAL_ADMIN.md"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand underline"
                >
                  Editing guide ↗
                </a>
              </p>
              {reviewGeo && reviewCoordinateToken && needsLocationReview(reviewGeo) && (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
                  <h3 className="font-medium text-amber-950">Location approval required</h3>
                  <p className="mt-1 text-amber-900">
                    {locationReviewIssues(reviewGeo).join(' · ')}. Inspect the candidate
                    point and source evidence before approving it.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <a
                      href={`https://www.google.com/maps?q=${reviewGeo.lat},${reviewGeo.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brand underline"
                    >
                      Inspect coordinate on Google Maps ↗
                    </a>
                    <a
                      href={selectedStored?.created
                        ? `/centres/added/?id=${encodeURIComponent(selectedCentre.id)}`
                        : `/centres/${selectedCentre.ieltsOrgSlug}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brand underline"
                    >
                      Open public centre page ↗
                    </a>
                  </div>
                  <label className="mt-4 flex items-start gap-2 text-amber-950">
                    <input
                      type="checkbox"
                      checked={locationConfirmed}
                      onChange={(event) =>
                        setConfirmedCoordinateToken(
                          event.target.checked ? reviewCoordinateToken : null,
                        )
                      }
                      className="mt-0.5"
                    />
                    I have independently confirmed that this coordinate identifies the centre.
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!locationConfirmed}
                      onClick={() => stageLocationApproval('street')}
                      className="rounded border border-amber-500 bg-white px-3 py-2 font-medium disabled:opacity-40"
                    >
                      Draft street approval
                    </button>
                    <button
                      type="button"
                      disabled={!locationConfirmed}
                      onClick={() => stageLocationApproval('rooftop')}
                      className="rounded border border-amber-500 bg-white px-3 py-2 font-medium disabled:opacity-40"
                    >
                      Draft rooftop approval
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-amber-800">
                    Approval adds administrator evidence and preserves the coordinate provider’s
                    licensing provenance. It does not save until you press “Save changes”.
                  </p>
                </div>
              )}
              <textarea
                value={editorValue}
                onChange={(event) => setEditorValue(event.target.value)}
                spellCheck={false}
                className="mt-3 min-h-[65vh] w-full rounded-md border border-line bg-surface p-3 font-mono text-xs leading-5"
              />
            </>
          ) : (
            <p className="py-24 text-center text-muted">
              {busy ? 'Loading centre records…' : 'Choose a centre to edit.'}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function topLevelPatch(base: Centre, edited: Centre): Partial<Centre> {
  return Object.fromEntries(
    Object.entries(edited).filter(([key, value]) => {
      if (key === 'id') return false;
      return JSON.stringify(value) !== JSON.stringify(base[key as keyof Centre]);
    }),
  ) as Partial<Centre>;
}

function internalApiUrl(path: string): string {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return `https://ielts.zhengqiu.net${path}`;
  }
  return path;
}

function readTokens(): Tokens | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? 'null') as Tokens | null;
    if (!parsed || parsed.expiresAt <= Date.now() + 30_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function randomUrlSafe(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(value);
}

async function sha256UrlSafe(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function requireJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ErrorNotice({ message }: { message: string }) {
  return <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{message}</p>;
}
