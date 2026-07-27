'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  cityFacets,
  filterCentres,
  operatorFacets,
  operatorShape,
  operatorStyle,
  sortCentres,
  type Centre,
  type CentreFilter,
  type Operator,
  type SortKey,
} from '@ielts-map/core';
import { CentreCard } from './CentreCard';

// MapLibre touches `window` on load, so it stays out of the server render.
const CentreMap = dynamic(() => import('./CentreMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-line" />,
});

export function Directory({ centres }: { centres: Centre[] }) {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<string>('');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cities = useMemo(() => cityFacets(centres), [centres]);
  const operatorOptions = useMemo(() => operatorFacets(centres), [centres]);
  const priceCeiling = useMemo(() => {
    const prices = centres.map((c) => c.priceFrom).filter((p): p is number => p !== null);
    return prices.length ? Math.ceil(Math.max(...prices)) : null;
  }, [centres]);

  const results = useMemo(() => {
    const filter: CentreFilter = {
      q: query || undefined,
      city: city || undefined,
      operators: operators.length ? operators : undefined,
      maxPrice: maxPrice ?? undefined,
    };
    return sortCentres(filterCentres(centres, filter), sort);
  }, [centres, query, city, operators, maxPrice, sort]);

  const toggleOperator = (op: Operator) => {
    setOperators((prev) => (prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]));
  };

  const reset = () => {
    setQuery('');
    setCity('');
    setOperators([]);
    setMaxPrice(null);
  };

  const hasFilters = Boolean(query || city || operators.length || maxPrice !== null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">IELTS test centres in Canada</h1>
        <p className="mt-1 text-sm text-muted">
          {centres.length} official centres, compiled from IELTS.org and deduplicated. Compare
          operator, format, price and location.
        </p>
      </div>

      <div className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Centre, city or postal code"
            className="rounded-md border border-line px-3 py-2 outline-none focus:border-brand"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">City</span>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.city} value={c.city}>
                {c.city} ({c.count})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Max price {maxPrice !== null && <span className="text-muted">· CAD {maxPrice}</span>}
          </span>
          <input
            type="range"
            min={0}
            max={priceCeiling ?? 600}
            step={5}
            value={maxPrice ?? priceCeiling ?? 600}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="mt-3 accent-brand"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
          >
            <option value="name">Name</option>
            <option value="price">Price</option>
            <option value="city">City</option>
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          {operatorOptions.map(({ operator, count }) => {
            const active = operators.includes(operator);
            const style = operatorStyle(operator);
            return (
              <button
                key={operator}
                type="button"
                onClick={() => toggleOperator(operator)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                  active ? '' : 'border-line text-muted hover:border-muted'
                }`}
                style={
                  active
                    ? { borderColor: style.base, background: style.soft, color: style.text }
                    : undefined
                }
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0"
                  style={{
                    background: style.base,
                    borderRadius: operatorShape(operator) === 'circle' ? '9999px' : '1px',
                    transform: operatorShape(operator) === 'diamond' ? 'rotate(45deg)' : undefined,
                  }}
                />
                {operator} ({count})
              </button>
            );
          })}
          {hasFilters && (
            <button
              type="button"
              onClick={reset}
              className="ml-auto text-sm text-muted underline hover:text-ink"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {results.length} {results.length === 1 ? 'centre' : 'centres'}
          </p>

          {results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-8 text-center">
              <p className="font-medium">No centres match those filters.</p>
              <button type="button" onClick={reset} className="mt-2 text-sm text-brand underline">
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {results.map((centre) => (
                <CentreCard
                  key={centre.id}
                  centre={centre}
                  selected={centre.id === selectedId}
                  onHover={() => setSelectedId(centre.id)}
                  onSelect={() => setSelectedId(centre.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="h-[24rem] overflow-hidden rounded-lg border border-line lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)]">
          <CentreMap centres={results} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
    </div>
  );
}
