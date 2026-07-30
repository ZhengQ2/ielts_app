'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import {
  cityFacets,
  countryFacets,
  countryName,
  currenciesIn,
  offeringCategory,
  offeringDeliveryMode,
  offeringModule,
  filterCentres,
  geoWithinBounds,
  isDirectoryVisible,
  operatorFacets,
  operatorShape,
  operatorStyle,
  sortCentres,
  type Centre,
  type CentreFilter,
  type GeoBounds,
  type OfferingDeliveryMode,
  type Operator,
  type SortKey,
  type TestCategory,
  type TestModule,
} from '@ielts-map/core';
import { CentreCard } from './CentreCard';
import { SelectedCentrePanel } from './SelectedCentrePanel';
import {
  DEFAULT_TEST_CATEGORIES,
  DEFAULT_DELIVERY_MODES,
  DEFAULT_TEST_MODULES,
  DELIVERY_OPTIONS,
  offeringFilterSearch,
  TEST_CATEGORY_OPTIONS,
  TEST_MODULE_OPTIONS,
} from '@/lib/offering-filter';

// Google Maps touches `window` on load, so it stays out of the server render.
const CentreMap = dynamic(() => import('./CentreMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-line" />,
});

interface DirectoryDataset {
  version: number;
  generatedAt: string;
  centres: Centre[];
}

type MapViewport = GeoBounds & {
  zoom: number;
  center: { lat: number; lng: number };
};

const LIST_PAGE_SIZE = 40;
const WORLD_LIST_ZOOM = 2.5;
/**
 * Load the directory after the static page shell is visible. Previously the
 * complete dataset was serialized into the home page's React payload, making
 * index.html almost 4 MB and forcing every card to render during hydration.
 */
export function Directory() {
  const [dataset, setDataset] = useState<DirectoryDataset | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/centres.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Directory request failed: ${response.status}`);
        return response.json() as Promise<DirectoryDataset>;
      })
      .then((next) => {
        if (!Array.isArray(next.centres)) throw new Error('Directory response has no centres');
        setDataset(next);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(true);
      });

    return () => controller.abort();
  }, []);

  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">The centre directory could not be loaded.</h1>
        <p className="mt-2 text-sm text-muted">Please refresh the page and try again.</p>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8" aria-busy="true" aria-live="polite">
        <div className="h-8 w-80 max-w-full animate-pulse rounded bg-line" />
        <div className="mt-2 h-5 w-[32rem] max-w-full animate-pulse rounded bg-line" />
        <div className="mt-6 h-32 animate-pulse rounded-lg border border-line bg-white" />
        <div className="mt-6 h-[32rem] animate-pulse rounded-lg border border-line bg-line" />
        <span className="sr-only">Loading test centres</span>
      </div>
    );
  }

  return (
    <DirectoryView
      centres={dataset.centres.filter(isDirectoryVisible)}
    />
  );
}

function DirectoryView({ centres }: { centres: Centre[] }) {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState<string>('');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [testModules, setTestModules] = useState<TestModule[]>([
    ...DEFAULT_TEST_MODULES,
  ]);
  const [testCategories, setTestCategories] = useState<TestCategory[]>([
    ...DEFAULT_TEST_CATEGORIES,
  ]);
  const [deliveryModes, setDeliveryModes] = useState<OfferingDeliveryMode[]>([
    ...DEFAULT_DELIVERY_MODES,
  ]);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  // Null means "use the contextual default": name worldwide, distance after
  // choosing a country or city. Any explicit menu choice overrides it.
  const [sort, setSort] = useState<SortKey | null>(null);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const [lifeSkillsHovered, setLifeSkillsHovered] = useState(false);
  const [lifeSkillsNotePinned, setLifeSkillsNotePinned] = useState(false);
  const pageScrollBeforeFilter = useRef<number | null>(null);

  /**
   * Hover and selection are tracked separately. Hovering a card only highlights
   * its marker; clicking selects. Folding the two together would make the
   * summary panel flicker as the pointer swept the list.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const highlightedId = selectedId ?? hoveredId;

  /**
   * The summary panel always renders at the top of the list column. Selecting
   * a card scrolled deep into a 142-centre list can leave it off-screen with
   * no visible change to show for the click — scrolling the independent
   * results pane to its top fixes that without moving the page. A map-marker
   * click doesn't need this: the map opens its own popup at the marker.
   * `selectionSource` is a ref rather than state because it only gates this
   * effect and never itself needs to trigger a render.
   */
  const selectionSource = useRef<'list' | 'map'>('list');
  const listPaneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId && selectionSource.current === 'list') {
      listPaneRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [selectedId]);

  const countryOptions = useMemo(() => countryFacets(centres), [centres]);
  // Worldwide vs single-country changes what the page calls itself and
  // whether a country picker is worth showing at all.
  const worldwide = countryOptions.length > 1;

  const operatorOptions = useMemo(() => operatorFacets(centres), [centres]);
  const testModuleCounts = useMemo(
    () =>
      new Map(
        TEST_MODULE_OPTIONS.map(({ value }) => [
          value,
          centres.filter((centre) =>
            centre.offerings.some(
              (offering) => offeringModule(offering) === value,
            ),
          ).length,
        ]),
      ),
    [centres],
  );
  const testCategoryCounts = useMemo(
    () =>
      new Map(
        TEST_CATEGORY_OPTIONS.map(({ value }) => [
          value,
          centres.filter((centre) =>
            centre.offerings.some(
              (offering) => offeringCategory(offering) === value,
            ),
          ).length,
        ]),
      ),
    [centres],
  );
  const deliveryCounts = useMemo(
    () =>
      new Map(
        DELIVERY_OPTIONS.map(({ value }) => [
          value,
          centres.filter((centre) =>
            centre.offerings.some(
              (offering) => offeringDeliveryMode(offering) === value,
            ),
          ).length,
        ]),
      ),
    [centres],
  );
  const availableTestModules = TEST_MODULE_OPTIONS.filter(
    ({ value }) => (testModuleCounts.get(value) ?? 0) > 0,
  );
  const ukviSeltSelected = testCategories.includes('ukvi_selt');
  const showLifeSkillsNote =
    lifeSkillsHovered || lifeSkillsNotePinned;

  // City choices are scoped to country + operators + search — not to city
  // itself, obviously, and not to price (see below). Without this, picking a
  // country wouldn't narrow the City dropdown at all, and a worldwide list
  // would offer all ~300 city names from every country at once.
  const preCityFilter: CentreFilter = {
    q: query || undefined,
    country: country || undefined,
    operators: operators.length ? operators : undefined,
    testModules,
    testCategories,
    deliveryModes,
  };
  const preCityResults = useMemo(
    () => filterCentres(centres, preCityFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      centres,
      query,
      country,
      operators,
      testModules,
      testCategories,
      deliveryModes,
    ],
  );
  const cities = useMemo(() => cityFacets(preCityResults), [preCityResults]);

  // Currencies present in the result set once everything except price is
  // applied. A raw number only means something within one currency — CAD 400
  // and IDR 400 are not remotely comparable — so the price control is only
  // ever shown when exactly one currency is in view (typically because a
  // country, or a city, has been picked).
  const prePriceFilter: CentreFilter = { ...preCityFilter, city: city || undefined };
  const prePriceResults = useMemo(
    () => filterCentres(centres, prePriceFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      centres,
      query,
      country,
      city,
      operators,
      testModules,
      testCategories,
      deliveryModes,
    ],
  );
  const priceCurrencies = useMemo(() => currenciesIn(prePriceResults), [prePriceResults]);
  const priceCurrency = priceCurrencies.length === 1 ? priceCurrencies[0]! : null;
  const priceCeiling = useMemo(() => {
    if (!priceCurrency) return null;
    const prices = prePriceResults
      .filter((c) => c.parsedCurrency === priceCurrency)
      .map((c) => c.parsedPriceFrom)
      .filter((p): p is number => p !== null);
    return prices.length ? Math.ceil(Math.max(...prices)) : null;
  }, [prePriceResults, priceCurrency]);

  // A max price set while browsing one currency is meaningless once the
  // currency context turns ambiguous again (e.g. the country filter is
  // cleared) — reset it rather than silently keep an unusable value around.
  useEffect(() => {
    if (!priceCurrency) setMaxPrice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceCurrency]);

  const filteredResults = useMemo(() => {
    const filter: CentreFilter = {
      ...prePriceFilter,
      maxPrice: priceCurrency ? (maxPrice ?? undefined) : undefined,
    };
    return filterCentres(centres, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    centres,
    query,
    country,
    city,
    operators,
    testModules,
    testCategories,
    deliveryModes,
    maxPrice,
    priceCurrency,
  ]);

  const distanceOrigin = country || city ? viewport?.center : undefined;
  const effectiveSort: SortKey = sort ?? (distanceOrigin ? 'distance' : 'name');
  const results = useMemo(() => {
    const ranked = distanceOrigin
      ? filterCentres(filteredResults, { near: distanceOrigin })
      : filteredResults;
    return sortCentres(ranked, effectiveSort);
  }, [filteredResults, distanceOrigin, effectiveSort]);

  const mapAreaResults = useMemo(() => {
    if (!viewport) return [];
    return results.filter((centre) => centre.geo && geoWithinBounds(centre.geo, viewport));
  }, [results, viewport]);

  // A deliberate text search is a list operation and may find an unlocated
  // centre anywhere in the world. Normal browsing stays tied to the map area.
  const searched = query.trim().length > 0;
  const worldwideOverview =
    worldwide && !searched && !country && !city && Boolean(viewport) &&
    viewport!.zoom < WORLD_LIST_ZOOM;
  const listResults = searched ? results : worldwideOverview ? [] : mapAreaResults;
  const visibleListResults = listResults.slice(0, listLimit);

  useLayoutEffect(() => {
    setListLimit(LIST_PAGE_SIZE);
    listPaneRef.current?.scrollTo({ top: 0 });
    const pageScroll = pageScrollBeforeFilter.current;
    if (pageScroll !== null) {
      pageScrollBeforeFilter.current = null;
      window.scrollTo({ top: pageScroll, behavior: 'instant' });
    }
  }, [
    query,
    country,
    city,
    operators,
    testModules,
    testCategories,
    deliveryModes,
    maxPrice,
    sort,
  ]);

  const updateFilter = (update: () => void) => {
    // Keep the directory anchored in the viewport while controls change the
    // result set. Dynamic controls (price, city and Life Skills guidance) can
    // otherwise make the browser move the outer page during the same render.
    pageScrollBeforeFilter.current = window.scrollY;
    update();
  };

  // Clear a selection when filters exclude it. This also removes its popup,
  // without asking the map to focus anything else.
  useEffect(() => {
    if (selectedId && !results.some((centre) => centre.id === selectedId)) {
      setSelectedId(null);
    }
  }, [results, selectedId]);

  const selectedCentre = useMemo(
    () => results.find((c) => c.id === selectedId) ?? null,
    [results, selectedId],
  );

  const toggleOperator = (op: Operator) => {
    updateFilter(() => {
      setOperators((prev) =>
        prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op],
      );
    });
  };
  const toggleTestModule = (module: TestModule) => {
    if (module === 'life_skills' && !ukviSeltSelected) {
      setLifeSkillsNotePinned(true);
      return;
    }
    updateFilter(() => {
      setTestModules((previous) =>
        previous.includes(module)
          ? previous.filter((value) => value !== module)
          : [...previous, module],
      );
    });
  };
  const toggleTestCategory = (category: TestCategory) => {
    const removing = testCategories.includes(category);
    updateFilter(() => {
      setTestCategories((previous) =>
        removing
          ? previous.filter((value) => value !== category)
          : [...previous, category],
      );
      if (category === 'ukvi_selt' && removing) {
        setTestModules((previous) =>
          previous.filter((value) => value !== 'life_skills'),
        );
      }
    });
  };
  const toggleDeliveryMode = (mode: OfferingDeliveryMode) => {
    updateFilter(() => {
      setDeliveryModes((previous) =>
        previous.includes(mode)
          ? previous.filter((value) => value !== mode)
          : [...previous, mode],
      );
    });
  };

  const reset = () => {
    updateFilter(() => {
      setQuery('');
      setCountry('');
      setCity('');
      setOperators([]);
      setTestModules([...DEFAULT_TEST_MODULES]);
      setTestCategories([...DEFAULT_TEST_CATEGORIES]);
      setDeliveryModes([...DEFAULT_DELIVERY_MODES]);
      setLifeSkillsHovered(false);
      setLifeSkillsNotePinned(false);
      setMaxPrice(null);
      setSort(null);
    });
  };

  const hasFilters = Boolean(
    query ||
      country ||
      city ||
      operators.length ||
      !sameSelection(testModules, DEFAULT_TEST_MODULES) ||
      !sameSelection(testCategories, DEFAULT_TEST_CATEGORIES) ||
      !sameSelection(deliveryModes, DEFAULT_DELIVERY_MODES) ||
      maxPrice !== null,
  );
  const detailFilterSearch = useMemo(
    () =>
      offeringFilterSearch(
        testModules,
        testCategories,
        deliveryModes,
      ),
    [testModules, testCategories, deliveryModes],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          IELTS test centres {worldwide ? 'worldwide' : `in ${countryName(centres[0]?.address.country)}`}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {centres.length} official centres
          {worldwide && ` across ${countryOptions.length} countries`}, compiled from IELTS.org and
          deduplicated. Compare operator, format, price and location.
        </p>
      </div>

      <div
        data-testid="directory-filters"
        className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) =>
              updateFilter(() => setQuery(event.target.value))
            }
            placeholder="Centre, city or postal code"
            className="rounded-md border border-line px-3 py-2 outline-none focus:border-brand"
          />
        </label>

        {worldwide && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Country</span>
            <select
              value={country}
              onChange={(event) =>
                updateFilter(() => {
                  // A city from the old country will not exist in the new one.
                  setCountry(event.target.value);
                  setCity('');
                  setSort(null);
                })
              }
              className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
            >
              <option value="">All countries</option>
              {countryOptions.map((c) => (
                <option key={c.country} value={c.country}>
                  {countryName(c.country)} ({c.count})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">City</span>
          <select
            value={city}
            onChange={(event) =>
              updateFilter(() => {
                setCity(event.target.value);
                setSort(null);
              })
            }
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
            Max price
            {priceCurrency && maxPrice !== null && (
              <span className="text-muted"> · {priceCurrency} {maxPrice}</span>
            )}
          </span>
          {priceCurrency ? (
            <input
              type="range"
              min={0}
              max={priceCeiling ?? 600}
              step={5}
              value={maxPrice ?? priceCeiling ?? 600}
              onChange={(event) =>
                updateFilter(() => setMaxPrice(Number(event.target.value)))
              }
              className="mt-3 accent-brand"
            />
          ) : (
            <p className="mt-2 text-xs italic text-muted">
              {priceCurrencies.length === 0
                ? 'No published prices in view'
                : 'Pick a country to filter by price — currencies vary too much to compare directly'}
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Sort by</span>
          <select
            value={effectiveSort}
            onChange={(event) =>
              updateFilter(() => setSort(event.target.value as SortKey))
            }
            className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
          >
            <option value="name">Name</option>
            <option value="price">Price</option>
            <option value="city">City</option>
            {distanceOrigin && <option value="distance">Distance from map centre</option>}
          </select>
        </label>

        <div className="grid gap-4 border-t border-line pt-3 sm:col-span-2 lg:col-span-5 lg:grid-cols-3">
          <fieldset>
            <legend className="text-sm font-medium">Module</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {availableTestModules.map(({ value, label }) => {
                const lifeSkills = value === 'life_skills';
                const checkbox = (
                  <FilterCheckbox
                    checked={testModules.includes(value)}
                    disabled={lifeSkills && !ukviSeltSelected}
                    label={label}
                    count={testModuleCounts.get(value) ?? 0}
                    ariaDescribedBy={
                      lifeSkills ? 'life-skills-filter-note' : undefined
                    }
                    onChange={() => toggleTestModule(value)}
                  />
                );
                return lifeSkills ? (
                  <span
                    key={value}
                    className="inline-flex"
                    tabIndex={ukviSeltSelected ? undefined : 0}
                    onMouseEnter={() => setLifeSkillsHovered(true)}
                    onMouseLeave={() => setLifeSkillsHovered(false)}
                    onFocus={() => setLifeSkillsHovered(true)}
                    onBlur={() => setLifeSkillsHovered(false)}
                    onClick={() => setLifeSkillsNotePinned(true)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' ||
                        event.key === ' '
                      ) {
                        setLifeSkillsNotePinned(true);
                      }
                    }}
                  >
                    {checkbox}
                  </span>
                ) : (
                  <span key={value}>{checkbox}</span>
                );
              })}
            </div>
            {showLifeSkillsNote && (
              <p
                id="life-skills-filter-note"
                role="status"
                className="mt-2 text-xs text-muted"
              >
                Life Skills is a UKVI Secure English Language Test
                (SELT).{' '}
                {ukviSeltSelected
                  ? 'It is excluded by default.'
                  : 'Turn on UKVI / SELT to select it.'}
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Category</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {TEST_CATEGORY_OPTIONS.map(({ value, label }) => (
                <FilterCheckbox
                  key={value}
                  checked={testCategories.includes(value)}
                  label={label}
                  count={testCategoryCounts.get(value) ?? 0}
                  onChange={() => toggleTestCategory(value)}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              UKVI / SELT includes explicit UKVI products and
              IELTS.org offerings labelled SELT Online.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Delivery</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DELIVERY_OPTIONS.map(({ value, label }) => (
                <FilterCheckbox
                  key={value}
                  checked={deliveryModes.includes(value)}
                  label={label}
                  count={deliveryCounts.get(value) ?? 0}
                  onChange={() => toggleDeliveryMode(value)}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Module, category and delivery must match the same
              offering. Life Skills appears only when all delivery
              options are on because IELTS.org publishes no mode.
            </p>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
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
        <div
          ref={listPaneRef}
          data-testid="centre-list-pane"
          aria-label="Test centre results"
          className="h-[32rem] min-h-0 overflow-y-auto overscroll-y-auto pr-1 lg:h-[calc(100vh-8rem)] lg:pr-2"
        >
          {selectedCentre && (
            <div>
              <SelectedCentrePanel
                centre={selectedCentre}
                detailFilterSearch={detailFilterSearch}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}

          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {searched
              ? `${results.length} ${results.length === 1 ? 'centre' : 'centres'} found`
              : worldwideOverview
                ? `${results.length} centres available worldwide`
                : `${listResults.length} of ${results.length} ${
                    listResults.length === 1 ? 'centre is' : 'centres are'
                  } in this map area`}
          </p>

          {results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-8 text-center">
              <p className="font-medium">No centres match those filters.</p>
              <button type="button" onClick={reset} className="mt-2 text-sm text-brand underline">
                Clear filters
              </button>
            </div>
          ) : worldwideOverview ? (
            <div className="rounded-lg border border-dashed border-line p-8 text-center">
              <p className="font-medium">Choose a country or zoom in to browse the list.</p>
              <p className="mt-2 text-sm text-muted">
                The worldwide map stays useful without mounting more than a thousand list cards.
              </p>
            </div>
          ) : !viewport && !searched ? (
            <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
              Finding centres in the visible map area…
            </div>
          ) : listResults.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-8 text-center">
              <p className="font-medium">No mapped centres are visible in this area.</p>
              <p className="mt-2 text-sm text-muted">Pan or zoom out to continue browsing.</p>
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-3" onMouseLeave={() => setHoveredId(null)}>
                {visibleListResults.map((centre) => (
                  <CentreCard
                    key={centre.id}
                    centre={centre}
                    selected={centre.id === selectedId}
                    detailFilterSearch={detailFilterSearch}
                    onHover={() => setHoveredId(centre.id)}
                    // Clicking the already-selected card clears it.
                    onSelect={() => {
                      selectionSource.current = 'list';
                      setSelectedId((prev) => (prev === centre.id ? null : centre.id));
                    }}
                  />
                ))}
              </ul>
              {visibleListResults.length < listResults.length && (
                <button
                  type="button"
                  onClick={() => setListLimit((limit) => limit + LIST_PAGE_SIZE)}
                  className="mt-4 w-full rounded-lg border border-line bg-white px-4 py-3 text-sm font-medium hover:border-muted"
                >
                  Show {Math.min(LIST_PAGE_SIZE, listResults.length - visibleListResults.length)} more
                </button>
              )}
            </>
          )}
        </div>

        <div className="h-[24rem] overflow-hidden rounded-lg border border-line lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)]">
          <CentreMap
            centres={filteredResults}
            highlightedId={highlightedId}
            selectedId={selectedId}
            detailFilterSearch={detailFilterSearch}
            onSelect={(id) => {
              selectionSource.current = 'map';
              setSelectedId(id);
            }}
            onViewportChange={setViewport}
          />
        </div>
      </div>
    </div>
  );
}

function FilterCheckbox({
  checked,
  disabled = false,
  label,
  count,
  ariaDescribedBy,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  count: number;
  ariaDescribedBy?: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
        disabled
          ? 'cursor-not-allowed border-line bg-slate-50 text-muted opacity-60'
          : checked
          ? 'border-brand bg-brand-soft text-brand'
          : 'cursor-pointer border-line text-muted hover:border-muted'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-brand"
      />
      <span>{label}</span>
      <span className="text-xs opacity-70">({count})</span>
    </label>
  );
}

function sameSelection<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}
