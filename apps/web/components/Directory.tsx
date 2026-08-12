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
  allAvailableCountryOrRegionCodes,
  countryFacets,
  countryName,
  offeringCategory,
  offeringDeliveryMode,
  offeringModule,
  filterCentres,
  geoWithinBounds,
  isDirectoryVisible,
  isOsrDestinationCountryAllowed,
  inPersonCountryOrRegionCodes,
  onlineCountryOrRegionCodes,
  operatorFacets,
  priceFilterCurrencies,
  operatorShape,
  operatorStyle,
  osrDestinationCountry,
  osrEligibilityPolicy,
  sortCentres,
  testAvailabilityForCountryOrRegion,
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
import { CitySearch, type CitySearchSelection } from './CitySearch';

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
type DirectoryMode = 'full_test' | 'osr';
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
  const [directoryMode, setDirectoryMode] = useState<DirectoryMode>('full_test');
  const [originalOperator, setOriginalOperator] = useState<Operator | ''>('');
  const [originalCountry, setOriginalCountry] = useState('');
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [searchLocation, setSearchLocation] = useState<CitySearchSelection | null>(null);
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
  // Null means "use the contextual default": name worldwide, distance once a
  // selected city hint or country supplies an origin. Any explicit menu choice
  // overrides it.
  const [sort, setSort] = useState<SortKey | null>(null);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geolocationStatus, setGeolocationStatus] = useState<
    'idle' | 'requesting' | 'ready' | 'error' | 'update_error'
  >('idle');
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const [lifeSkillsHovered, setLifeSkillsHovered] = useState(false);
  const [lifeSkillsNotePinned, setLifeSkillsNotePinned] = useState(false);
  const pageScrollBeforeFilter = useRef<number | null>(null);
  const geolocationRequestId = useRef(0);

  const requestUserLocation = () => {
    const requestId = ++geolocationRequestId.current;
    const updatingExistingLocation = userLocation !== null;
    if (!navigator.geolocation) {
      setGeolocationStatus(updatingExistingLocation ? 'update_error' : 'error');
      return;
    }

    setGeolocationStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (requestId !== geolocationRequestId.current) return;
        // The coordinate stays in browser memory. It is used only to order the
        // current result set and is never sent to the directory service.
        pageScrollBeforeFilter.current = window.scrollY;
        setQuery('');
        setSearchLocation(null);
        setUserLocation({ lat: coords.latitude, lng: coords.longitude });
        setSelectedId(null);
        setSort(null);
        setGeolocationStatus('ready');
      },
      () => {
        if (requestId !== geolocationRequestId.current) return;
        if (!updatingExistingLocation) setUserLocation(null);
        setGeolocationStatus(updatingExistingLocation ? 'update_error' : 'error');
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 5_000 },
    );
  };

  const clearUserLocation = () => {
    geolocationRequestId.current++;
    pageScrollBeforeFilter.current = window.scrollY;
    setUserLocation(null);
    setSort(null);
    setGeolocationStatus('idle');
  };

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

  const osrPolicy = originalOperator
    ? osrEligibilityPolicy(originalOperator, originalCountry)
    : null;
  const originalCountryOptions = useMemo(
    () => {
      if (!originalOperator || originalOperator === 'IELTS USA') return [];
      const counts = new Map(
        countryFacets(
          centres.filter(
            (centre) =>
              centre.operator === originalOperator && !centre.oneSkillRetakeOnly,
          ),
        ).map(({ country: code, count }) => [code, count]),
      );
      const codes = [
        ...new Set([
          ...inPersonCountryOrRegionCodes(originalOperator),
          ...counts.keys(),
        ]),
      ].sort((a, b) => countryName(a).localeCompare(countryName(b), 'en'));
      return codes.map((code) => ({
        country: code,
        count: counts.get(code) ?? 0,
      }));
    },
    [centres, originalOperator],
  );
  const osrReady = Boolean(
    directoryMode === 'osr' &&
      originalOperator &&
      osrPolicy?.portabilitySupported &&
      originalCountry,
  );
  const directoryCentres = useMemo(() => {
    if (directoryMode === 'full_test') return centres;
    if (!osrReady || !osrPolicy?.destinationOperator) return [];
    return centres.filter(
      (centre) =>
        centre.offersOneSkillRetake &&
        centre.operator === osrPolicy.destinationOperator &&
        isOsrDestinationCountryAllowed(
          originalOperator as Operator,
          originalCountry,
          centre.address.country ?? '',
        ),
    );
  }, [centres, directoryMode, originalCountry, originalOperator, osrPolicy, osrReady]);
  const effectiveCountry =
    directoryMode === 'osr' && originalOperator
      ? osrDestinationCountry(originalOperator, originalCountry, country)
      : country || undefined;
  const countryOptions = useMemo(() => {
    if (directoryMode === 'osr') {
      return countryFacets(directoryCentres).map((option) => ({
        ...option,
        online: false,
      }));
    }

    const countedCentres = operators.length
      ? directoryCentres.filter((centre) => operators.includes(centre.operator))
      : directoryCentres;
    const counts = new Map(
      countryFacets(countedCentres).map(({ country: code, count }) => [code, count]),
    );
    const observedCodes = [...counts.keys()];
    const codes = operators.length
      ? [
          ...new Set(
            [
              ...operators.flatMap((operator) => inPersonCountryOrRegionCodes(operator)),
              ...operators.flatMap((operator) => onlineCountryOrRegionCodes(operator)),
              ...observedCodes,
            ],
          ),
        ].sort((a, b) => countryName(a).localeCompare(countryName(b), 'en'))
      : [...new Set([...allAvailableCountryOrRegionCodes(), ...observedCodes])].sort((a, b) =>
          countryName(a).localeCompare(countryName(b), 'en'),
        );

    return codes
      .map((code) => ({
        country: code,
        count: counts.get(code) ?? 0,
        online: Boolean(
          testAvailabilityForCountryOrRegion(code)?.online.some(
            ({ operator }) => operators.length === 0 || operators.includes(operator),
          ),
        ),
      }))
      .filter(({ count, online }) => count > 0 || online);
  }, [directoryCentres, directoryMode, operators]);

  // Changing the operator can remove the selected country when it has neither
  // a directory centre nor an operator-matching Online option. Do not retain a
  // hidden select value that would leave the directory looking inexplicably
  // empty.
  useEffect(() => {
    if (
      directoryMode === 'full_test' &&
      country &&
      !countryOptions.some((option) => option.country === country)
    ) {
      pageScrollBeforeFilter.current = window.scrollY;
      setCountry('');
    }
  }, [country, countryOptions, directoryMode]);
  // Worldwide vs single-country changes what the page calls itself and
  // whether a country picker is worth showing at all.
  const worldwide = countryOptions.length > 1;
  const selectedAvailability = useMemo(
    () =>
      directoryMode === 'full_test'
        ? testAvailabilityForCountryOrRegion(country)
        : null,
    [country, directoryMode],
  );
  const onlineAvailability = useMemo(() => {
    if (
      !selectedAvailability ||
      !testModules.includes('academic') ||
      !testCategories.includes('standard') ||
      !deliveryModes.includes('computer_delivered')
    ) {
      return [];
    }
    return selectedAvailability.online.filter(
      ({ operator }) => operators.length === 0 || operators.includes(operator),
    );
  }, [deliveryModes, operators, selectedAvailability, testCategories, testModules]);

  const testModuleCounts = useMemo(
    () =>
      new Map(
        TEST_MODULE_OPTIONS.map(({ value }) => [
          value,
          directoryCentres.filter((centre) =>
            centre.offerings.some(
              (offering) => offeringModule(offering) === value,
            ),
          ).length,
        ]),
      ),
    [directoryCentres],
  );
  const testCategoryCounts = useMemo(
    () =>
      new Map(
        TEST_CATEGORY_OPTIONS.map(({ value }) => [
          value,
          directoryCentres.filter((centre) =>
            centre.offerings.some(
              (offering) => offeringCategory(offering) === value,
            ),
          ).length,
        ]),
      ),
    [directoryCentres],
  );
  const deliveryCounts = useMemo(
    () =>
      new Map(
        DELIVERY_OPTIONS.map(({ value }) => [
          value,
          directoryCentres.filter((centre) =>
            centre.offerings.some(
              (offering) => offeringDeliveryMode(offering) === value,
            ),
          ).length,
        ]),
      ),
    [directoryCentres],
  );
  const availableTestModules = TEST_MODULE_OPTIONS.filter(
    ({ value }) => (testModuleCounts.get(value) ?? 0) > 0,
  );
  const ukviSeltSelected = testCategories.includes('ukvi_selt');
  const showLifeSkillsNote =
    lifeSkillsHovered || lifeSkillsNotePinned;

  // A selected Google city is a distance origin, not a string filter. This
  // avoids depending on the source dataset's mixed city languages and
  // administrative levels while ordinary typed text still searches records.
  const baseFilter: CentreFilter = {
    q: searchLocation ? undefined : query || undefined,
    country: effectiveCountry,
    operators:
      directoryMode === 'full_test' && operators.length ? operators : undefined,
    testModules: directoryMode === 'full_test' ? testModules : undefined,
    testCategories: directoryMode === 'full_test' ? testCategories : undefined,
    deliveryModes: directoryMode === 'full_test' ? deliveryModes : undefined,
    oneSkillRetake: directoryMode === 'osr' ? true : undefined,
  };
  const prePriceFilter: CentreFilter = baseFilter;
  // Currencies present in the result set once everything except price is
  // applied. A raw number only means something within one currency — CAD 400
  // and IDR 400 are not remotely comparable — so the price control is only
  // ever shown when exactly one currency is in view (typically because a
  // country has been picked).
  const prePriceResults = useMemo(
    () => filterCentres(directoryCentres, prePriceFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      directoryCentres,
      query,
      searchLocation,
      country,
      operators,
      testModules,
      testCategories,
      deliveryModes,
      directoryMode,
    ],
  );
  // Use the same operator-neutral universe as the operator badges. A slider
  // derived only from the selected operator could otherwise expose (say) RON
  // while its alternative operators are priced in EUR, making their counts
  // numerically incomparable.
  const priceCurrencies = useMemo(
    () =>
      directoryMode === 'full_test'
        ? priceFilterCurrencies(directoryCentres, prePriceFilter)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      directoryCentres,
      query,
      searchLocation,
      country,
      testModules,
      testCategories,
      deliveryModes,
    ],
  );
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
  }, [priceCurrency]);

  const filteredResults = useMemo(() => {
    const filter: CentreFilter = {
      ...prePriceFilter,
      maxPrice: priceCurrency ? (maxPrice ?? undefined) : undefined,
    };
    return filterCentres(directoryCentres, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    directoryCentres,
    query,
    searchLocation,
    country,
    operators,
    testModules,
    testCategories,
    deliveryModes,
    directoryMode,
    maxPrice,
    priceCurrency,
  ]);

  // Facet counts answer "how many would this operator have under the other
  // active filters?" The selected operator buttons are intentionally omitted,
  // otherwise choosing IDP would misleadingly turn every alternative into 0.
  // The helper preserves the global operator order. Zero-count alternatives
  // are hidden because selecting them cannot produce a result; an active
  // choice remains visible so it can always be removed.
  const operatorOptions = useMemo(
    () =>
      operatorFacets(directoryCentres, {
        q: searchLocation ? undefined : query || undefined,
        country: effectiveCountry,
        testModules,
        testCategories,
        deliveryModes,
        maxPrice: priceCurrency ? (maxPrice ?? undefined) : undefined,
      }),
    [
      directoryCentres,
      query,
      searchLocation,
      effectiveCountry,
      testModules,
      testCategories,
      deliveryModes,
      maxPrice,
      priceCurrency,
    ],
  );
  const visibleOperatorOptions = operatorOptions.filter(
    ({ operator, count }) => count > 0 || operators.includes(operator),
  );

  // An explicitly selected city hint beats the map view centred on a chosen
  // country as the more deliberate signal of "distance from where".
  const distanceOrigin =
    searchLocation?.center ?? userLocation ?? (effectiveCountry ? viewport?.center : undefined);
  const distanceOriginLabel = searchLocation
    ? 'Distance from search'
    : userLocation
      ? 'Distance from your location'
      : 'Distance from map centre';
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
  const unlocatedCountryResults = effectiveCountry
    ? results.filter((centre) => !centre.geo)
    : [];
  const listResults = searched
    ? results
    : effectiveCountry
      ? [...mapAreaResults, ...unlocatedCountryResults]
      : mapAreaResults;
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
    operators,
    testModules,
    testCategories,
    deliveryModes,
    directoryMode,
    originalOperator,
    originalCountry,
    maxPrice,
    sort,
    userLocation,
  ]);

  const updateFilter = (update: () => void) => {
    // Keep the directory anchored in the viewport while controls change the
    // result set. Dynamic controls (price and Life Skills guidance) can
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
      setSearchLocation(null);
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
      operators.length ||
      !sameSelection(testModules, DEFAULT_TEST_MODULES) ||
      !sameSelection(testCategories, DEFAULT_TEST_CATEGORIES) ||
      !sameSelection(deliveryModes, DEFAULT_DELIVERY_MODES) ||
      maxPrice !== null,
  );
  const detailFilterSearch = useMemo(
    () =>
      directoryMode === 'full_test'
        ? offeringFilterSearch(
            testModules,
            testCategories,
            deliveryModes,
          )
        : '',
    [directoryMode, testModules, testCategories, deliveryModes],
  );

  const changeMode = (mode: DirectoryMode) => {
    geolocationRequestId.current++;
    setDirectoryMode(mode);
    setOriginalOperator('');
    setOriginalCountry('');
    setQuery('');
    setCountry('');
    setSearchLocation(null);
    setUserLocation(null);
    setGeolocationStatus('idle');
    setViewport(null);
    setOperators([]);
    setTestModules([...DEFAULT_TEST_MODULES]);
    setTestCategories([...DEFAULT_TEST_CATEGORIES]);
    setDeliveryModes([...DEFAULT_DELIVERY_MODES]);
    setMaxPrice(null);
    setSort(null);
    setSelectedId(null);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {directoryMode === 'full_test'
            ? 'IELTS test centres worldwide'
            : 'Find a One Skill Retake centre'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {directoryMode === 'full_test'
            ? `${centres.length} official centres, compiled from IELTS.org and deduplicated. Compare operator, format, price and location.`
            : 'Start with the administrator and country or region of your original full test. We will apply its OSR portability rule before showing destinations.'}
        </p>
      </div>

      <div
        className="mb-6 inline-flex rounded-lg border border-line bg-white p-1"
        role="tablist"
        aria-label="Test search type"
      >
        <button
          type="button"
          role="tab"
          aria-selected={directoryMode === 'full_test'}
          onClick={() => changeMode('full_test')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            directoryMode === 'full_test' ? 'bg-brand text-white' : 'text-muted hover:text-ink'
          }`}
        >
          Full IELTS test
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={directoryMode === 'osr'}
          onClick={() => changeMode('osr')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            directoryMode === 'osr' ? 'bg-brand text-white' : 'text-muted hover:text-ink'
          }`}
        >
          One Skill Retake
        </button>
      </div>

      {directoryMode === 'osr' && (
        <section className="mb-6 rounded-lg border border-line bg-white p-4" aria-labelledby="osr-origin-heading">
          <h2 id="osr-origin-heading" className="font-medium">Your original full IELTS test</h2>
          <p className="mt-1 text-sm text-muted">
            Choose both fields so we can apply the known operator and country or region rules to
            possible OSR destinations.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Full test operator</span>
              <select
                required
                value={originalOperator}
                onChange={(event) => {
                  geolocationRequestId.current++;
                  setOriginalOperator(event.target.value as Operator | '');
                  setOriginalCountry('');
                  setCountry('');
                  setQuery('');
                  setSearchLocation(null);
                  setUserLocation(null);
                  setGeolocationStatus('idle');
                  setViewport(null);
                  setSelectedId(null);
                }}
                className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
              >
                <option value="">Choose operator</option>
                <option value="British Council">British Council</option>
                <option value="IDP">IDP</option>
                <option value="IELTS USA">IELTS USA</option>
              </select>
            </label>
            {originalOperator && originalOperator !== 'IELTS USA' && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Full test country or region</span>
                <select
                  required
                  value={originalCountry}
                  onChange={(event) => {
                    geolocationRequestId.current++;
                    setOriginalCountry(event.target.value);
                    setCountry('');
                    setQuery('');
                    setSearchLocation(null);
                    setUserLocation(null);
                    setGeolocationStatus('idle');
                    setViewport(null);
                    setSelectedId(null);
                  }}
                  className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
                >
                  <option value="">Choose country or region</option>
                  {originalCountryOptions.map((option) => (
                    <option key={option.country} value={option.country}>
                      {countryName(option.country)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {osrPolicy && (
            <div
              className={`mt-4 rounded-md border p-3 text-sm ${
                osrPolicy.portabilitySupported
                  ? 'border-brand/30 bg-brand-soft text-ink'
                  : 'border-amber-300 bg-amber-50 text-amber-950'
              }`}
              role="status"
            >
              <p>{osrPolicy.explanation}</p>
              <p className="mt-1 text-xs">
                This finder does not confirm your eligibility. Your original test must meet the
                operator&apos;s requirements, which can include an eligible computer test at a
                participating centre and completing OSR within 60 days. Actual test centres, dates
                and availability may differ. Confirm the Retake option and current choices in your
                result portal before booking.{' '}
                <a
                  href={osrPolicy.sourceUrl}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="font-medium text-brand underline"
                >
                  Official guidance ↗
                </a>
              </p>
            </div>
          )}
        </section>
      )}

      {(directoryMode === 'full_test' || osrReady) && <>
      <div
        data-testid="directory-filters"
        className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="flex flex-col gap-2">
          <CitySearch
            value={query}
            country={effectiveCountry ?? ''}
            selected={Boolean(searchLocation)}
            onValueChange={(value) =>
              updateFilter(() => {
                // Browser geolocation cannot be cancelled, so invalidate its
                // callbacks before accepting this newer manual search input.
                geolocationRequestId.current++;
                if (geolocationStatus === 'requesting') {
                  setGeolocationStatus(userLocation ? 'ready' : 'idle');
                }
                setQuery(value);
                setSearchLocation(null);
                setSort(null);
              })
            }
            onCitySelect={(selection) =>
              updateFilter(() => {
                geolocationRequestId.current++;
                setQuery(selection.label);
                setSearchLocation(selection);
                setUserLocation(null);
                setGeolocationStatus('idle');
                setSelectedId(null);
                setSort(null);
              })
            }
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <button
              type="button"
              disabled={geolocationStatus === 'requesting'}
              onClick={requestUserLocation}
              className="font-medium text-brand hover:underline disabled:cursor-wait disabled:text-muted"
            >
              {geolocationStatus === 'requesting'
                ? 'Finding your location…'
                : userLocation
                  ? 'Update my location'
                  : 'Use my location'}
            </button>
            {userLocation && (
              <button
                type="button"
                onClick={clearUserLocation}
                className="text-muted hover:text-ink hover:underline"
              >
                Stop using it
              </button>
            )}
            <span className="text-muted" role="status" aria-live="polite">
              {geolocationStatus === 'ready' &&
                'Approximate location ready for distance sorting.'}
              {geolocationStatus === 'error' && 'Location unavailable. Search by city instead.'}
              {geolocationStatus === 'update_error' &&
                'Could not update; continuing to use your previous location.'}
            </span>
          </div>
        </div>

        {(directoryMode === 'full_test'
          ? worldwide
          : (osrPolicy?.destinationCountryRule === 'any_country' ||
              osrPolicy?.destinationCountryRule === 'country_group') &&
            worldwide) && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              {directoryMode === 'osr'
                ? 'OSR destination country or region'
                : 'Country or Region'}
            </span>
            <select
              value={country}
              onChange={(event) =>
                updateFilter(() => {
                  setCountry(event.target.value);
                  if (searchLocation) {
                    setQuery('');
                    setSearchLocation(null);
                  }
                  setSort(null);
                })
              }
              className="rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand"
            >
              <option value="">All countries or regions</option>
              {countryOptions.map((c) => (
                <option key={c.country} value={c.country}>
                  {countryName(c.country)}
                  {c.count > 0 ? ` (${c.count})` : ''}
                  {c.online ? ' · IELTS Online' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {directoryMode === 'full_test' && <label className="flex flex-col gap-1 text-sm">
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
                : 'Pick a country or region to filter by price — currencies vary too much to compare directly'}
            </p>
          )}
        </label>}

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
            {directoryMode === 'full_test' && <option value="price">Price</option>}
            {distanceOrigin && <option value="distance">{distanceOriginLabel}</option>}
          </select>
        </label>

        {directoryMode === 'full_test' && <div className="grid gap-4 border-t border-line pt-3 sm:col-span-2 lg:col-span-4 lg:grid-cols-4">
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

        </div>}

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          {directoryMode === 'full_test' && visibleOperatorOptions.map(({ operator, count }) => {
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
          {directoryMode === 'osr' && (
            <p className="text-sm text-muted">
              Showing centres explicitly listed for One Skill Retake with{' '}
              {osrPolicy?.destinationOperator}.
            </p>
          )}
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

      {directoryMode === 'full_test' && country && onlineAvailability.length > 0 && (
        <section
          className="mb-6 rounded-lg border border-brand/30 bg-brand-soft p-4"
          aria-labelledby="ielts-online-heading"
        >
          <h2 id="ielts-online-heading" className="font-medium">
            IELTS Online is available in {countryName(country)}
          </h2>
          <p className="mt-1 text-sm text-muted">
            IELTS Online is an Academic test taken remotely. It is separate from the in-person
            centres listed below and is not accepted for immigration purposes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onlineAvailability.map(({ operator, url }) => (
              <a
                key={operator}
                href={url}
                target="_blank"
                rel="noreferrer nofollow"
                className="rounded-md border border-brand bg-white px-3 py-2 text-sm font-medium text-brand hover:bg-brand-soft"
              >
                Check IELTS Online with {operator} <span aria-hidden>↗</span>
              </a>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Actual eligibility, test dates and availability may differ. Confirm them on the
            operator&rsquo;s booking site.
          </p>
        </section>
      )}

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
                displayMode={directoryMode}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}

          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {searched
              ? searchLocation
                ? `${results.length} centres sorted from ${searchLocation.label}`
                : `${results.length} ${results.length === 1 ? 'centre' : 'centres'} found`
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
                    displayMode={directoryMode}
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
            focusLocation={searchLocation}
            highlightedId={highlightedId}
            selectedId={selectedId}
            detailFilterSearch={detailFilterSearch}
            displayMode={directoryMode}
            onSelect={(id) => {
              selectionSource.current = 'map';
              setSelectedId(id);
            }}
            onViewportChange={setViewport}
          />
        </div>
      </div>
      </>}
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
