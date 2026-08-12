'use client';

import { useState, type FormEvent } from 'react';
import type {
  Centre,
  GeoPrecision,
  Operator,
  TestCategory,
  TestFormat,
  TestKind,
  TestModule,
} from '@ielts-map/core';
import {
  isKnownCountryOrRegionCode,
  manualCentreId,
  parsePublishedPrice,
} from '@ielts-map/core';

export function NewCentreForm({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (centre: Centre) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [operator, setOperator] = useState<Exclude<Operator, 'unknown'>>('British Council');
  const [country, setCountry] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postcode, setPostcode] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [website, setWebsite] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [osrOnly, setOsrOnly] = useState(false);
  const [offersOsr, setOffersOsr] = useState(false);
  const [testModule, setTestModule] = useState<TestModule>('academic');
  const [testCategory, setTestCategory] = useState<TestCategory>('standard');
  const [format, setFormat] = useState<TestFormat>('computer_delivered');
  const [priceText, setPriceText] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [precision, setPrecision] = useState<Extract<GeoPrecision, 'street' | 'rooftop'>>('street');
  const [coordinateConfirmed, setCoordinateConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    try {
      await onCreate(
        buildManualCentre({
          name,
          operator,
          country,
          address,
          city,
          region,
          postcode,
          sourceUrl,
          bookingUrl,
          website,
          email,
          phone,
          osrOnly,
          offersOsr,
          testModule,
          testCategory,
          format,
          priceText,
          latitude,
          longitude,
          precision,
          coordinateConfirmed,
        }),
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Add a new centre</h2>
          <p className="mt-1 text-sm text-muted">
            Required fields are marked. The complete record is generated and validated for you.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="rounded border border-line px-3 py-2 text-sm">
          Cancel
        </button>
      </div>

      {formError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {formError}
        </p>
      )}

      <fieldset className="mt-6 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
        <legend className="px-2 font-medium">Identity and address</legend>
        <Field label="Centre name *">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Operator *">
          <select value={operator} onChange={(e) => setOperator(e.target.value as Exclude<Operator, 'unknown'>)} className={inputClass}>
            <option>British Council</option>
            <option>IDP</option>
            <option>IELTS USA</option>
          </select>
        </Field>
        <Field label="Country or region code *" hint="ISO two-letter code, for example CA or CN.">
          <input required minLength={2} maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} className={inputClass} />
        </Field>
        <Field label="City *">
          <input required value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Published address *" wide hint="Keep the official source wording.">
          <textarea required value={address} onChange={(e) => setAddress(e.target.value)} rows={3} className={inputClass} />
        </Field>
        <Field label="Region / province">
          <input value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Postcode">
          <input value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
        </Field>
      </fieldset>

      <fieldset className="mt-6 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
        <legend className="px-2 font-medium">Official evidence and contact</legend>
        <Field label="Official source URL *" hint="The operator or IELTS page that confirms this centre.">
          <input required type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Booking URL">
          <input type="url" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Website">
          <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
      </fieldset>

      <fieldset className="mt-6 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
        <legend className="px-2 font-medium">Test availability</legend>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={osrOnly} onChange={(e) => { setOsrOnly(e.target.checked); if (e.target.checked) setOffersOsr(true); }} className="mt-0.5" />
          This is an OSR-only centre and does not offer a full IELTS test.
        </label>
        {!osrOnly && <>
          <Field label="Module *">
            <select value={testModule} onChange={(e) => {
              const selectedModule = e.target.value as TestModule;
              setTestModule(selectedModule);
              if (selectedModule === 'life_skills') setTestCategory('ukvi_selt');
            }} className={inputClass}>
              <option value="academic">Academic</option>
              <option value="general_training">General Training</option>
              <option value="life_skills">Life Skills</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Category *">
            <select disabled={testModule === 'life_skills'} value={testCategory} onChange={(e) => setTestCategory(e.target.value as TestCategory)} className={inputClass}>
              <option value="standard">Standard IELTS</option>
              <option value="ukvi_selt">UKVI / SELT</option>
            </select>
          </Field>
          <Field label="Delivery *">
            <select value={format} onChange={(e) => setFormat(e.target.value as TestFormat)} className={inputClass}>
              <option value="computer_delivered">Computer-delivered</option>
              <option value="paper_based">Paper-based</option>
            </select>
          </Field>
          <Field label="Published price *" hint="Stored exactly as entered, for example CAD 379.">
            <input required value={priceText} onChange={(e) => setPriceText(e.target.value)} className={inputClass} />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={offersOsr} onChange={(e) => setOffersOsr(e.target.checked)} className="mt-0.5" />
            The official source explicitly lists One Skill Retake at this centre.
          </label>
        </>}
      </fieldset>

      <fieldset className="mt-6 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
        <legend className="px-2 font-medium">Verified map point (optional)</legend>
        <Field label="Latitude">
          <input inputMode="decimal" value={latitude} onChange={(e) => {
            setLatitude(e.target.value);
            setCoordinateConfirmed(false);
          }} className={inputClass} />
        </Field>
        <Field label="Longitude">
          <input inputMode="decimal" value={longitude} onChange={(e) => {
            setLongitude(e.target.value);
            setCoordinateConfirmed(false);
          }} className={inputClass} />
        </Field>
        <Field label="Precision">
          <select value={precision} onChange={(e) => {
            setPrecision(e.target.value as 'street' | 'rooftop');
            setCoordinateConfirmed(false);
          }} className={inputClass}>
            <option value="street">Street</option>
            <option value="rooftop">Rooftop / exact venue</option>
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm sm:self-end">
          <input type="checkbox" checked={coordinateConfirmed} onChange={(e) => setCoordinateConfirmed(e.target.checked)} className="mt-0.5" />
          I independently verified this coordinate and have the right to publish it on any map.
        </label>
      </fieldset>

      <button type="submit" disabled={busy} className="mt-6 rounded-md bg-brand px-4 py-2.5 font-medium text-white disabled:opacity-50">
        {busy ? 'Adding centre…' : 'Add centre'}
      </button>
    </form>
  );
}

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-white px-3 py-2 outline-none focus:border-brand';

function Field({ label, hint, wide = false, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

interface ManualCentreInput {
  name: string;
  operator: Exclude<Operator, 'unknown'>;
  country: string;
  address: string;
  city: string;
  region: string;
  postcode: string;
  sourceUrl: string;
  bookingUrl: string;
  website: string;
  email: string;
  phone: string;
  osrOnly: boolean;
  offersOsr: boolean;
  testModule: TestModule;
  testCategory: TestCategory;
  format: TestFormat;
  priceText: string;
  latitude: string;
  longitude: string;
  precision: 'street' | 'rooftop';
  coordinateConfirmed: boolean;
}

export function buildManualCentre(input: ManualCentreInput): Centre {
  if (!input.name.trim()) throw new Error('Centre name is required.');
  if (!input.city.trim()) throw new Error('City is required.');
  if (!input.address.trim()) throw new Error('Published address is required.');
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error('Country or region must be an ISO two-letter code.');
  }
  if (!isKnownCountryOrRegionCode(country)) {
    throw new Error('Country or region code is not supported by this directory.');
  }
  const sourceUrl = requireHttpsUrl(input.sourceUrl, 'Official source URL');
  const bookingUrl = input.bookingUrl.trim()
    ? requireHttpsUrl(input.bookingUrl, 'Booking URL')
    : null;
  const website = input.website.trim()
    ? requireHttpsUrl(input.website, 'Website')
    : null;
  if (!input.osrOnly && !input.priceText.trim()) {
    throw new Error('A full-test centre requires its published price.');
  }
  const id = manualCentreId({
    countryOrRegion: country,
    operator: input.operator,
    city: input.city,
    name: input.name,
    address: input.address,
    postcode: input.postcode,
  });
  const now = new Date().toISOString();
  const rawAddress = input.address.trim().replace(/\s*\n+\s*/g, ', ');
  const lines = input.address
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasLatitude = Boolean(input.latitude.trim());
  const hasLongitude = Boolean(input.longitude.trim());
  if (hasLatitude !== hasLongitude) {
    throw new Error('Enter both latitude and longitude, or leave both blank.');
  }
  const hasCoordinate = hasLatitude && hasLongitude;
  if (hasCoordinate && !input.coordinateConfirmed) {
    throw new Error('Confirm the coordinate before adding it, or leave both coordinate fields blank.');
  }
  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  if (hasCoordinate && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) {
    throw new Error('Latitude or longitude is outside its valid range.');
  }
  const kind: TestKind = input.testCategory === 'ukvi_selt'
    ? 'ukvi'
    : input.testModule === 'academic' || input.testModule === 'general_training' || input.testModule === 'life_skills'
      ? input.testModule
      : 'other';
  const label = `${input.testCategory === 'ukvi_selt' ? 'UKVI / SELT ' : ''}${moduleLabel(input.testModule)} ${input.format === 'computer_delivered' ? 'on computer' : 'paper-based'}`;
  const publishedPrice = parsePublishedPrice(input.osrOnly ? null : input.priceText);
  const offerings = input.osrOnly ? [] : [{
    label,
    kind,
    module: input.testModule,
    category: input.testCategory,
    format: input.format,
    ...publishedPrice,
  }];
  const websites = [...new Set([website, bookingUrl].filter((value): value is string => Boolean(value)))];
  const phone = input.phone.trim() || null;

  return {
    id,
    name: input.name.trim(),
    operator: input.operator,
    operatorSource: 'name',
    externalId: null,
    ieltsOrgSlug: 'added',
    mergedSlugs: [],
    address: {
      raw: rawAddress,
      lines: lines.length ? lines : [rawAddress],
      city: input.city.trim(),
      citySource: 'admin',
      region: input.region.trim() || null,
      postcode: input.postcode.trim() || null,
      country,
    },
    contact: {
      phones: phone ? [phone] : [],
      emails: input.email.trim() ? [input.email.trim()] : [],
      websites,
    },
    phone,
    geo: hasCoordinate ? {
      lat,
      lng,
      precision: input.precision,
      source: 'admin',
      coordinateSystem: 'WGS84',
      verification: 'verified',
      evidencePaths: ['admin'],
      agreementKm: null,
      confidence: 1,
      provenance: {
        origin: 'administrator',
        displayRights: 'any_basemap',
        license: null,
        attribution: null,
        sourceRecordId: null,
      },
    } : null,
    googlePlaceId: null,
    formats: input.osrOnly ? [] : [input.format],
    offerings,
    priceFromText: publishedPrice.priceText,
    parsedPriceFrom: publishedPrice.parsedPrice,
    parsedCurrency: publishedPrice.parsedCurrency,
    bookingUrl,
    offersOneSkillRetake: input.osrOnly || input.offersOsr,
    oneSkillRetakeOnly: input.osrOnly,
    isPublishable: true,
    confidence: hasCoordinate ? 1 : 0.7,
    sources: [{
      source: 'Administrator',
      externalSlug: id,
      url: sourceUrl,
      seenAt: now,
      stillPresent: true,
    }],
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

function requireHttpsUrl(value: string, label: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label} must be a normal HTTPS URL.`);
  }
  return url.toString();
}

function moduleLabel(module: TestModule): string {
  if (module === 'general_training') return 'General Training';
  if (module === 'life_skills') return 'Life Skills';
  if (module === 'academic') return 'Academic';
  return 'Other';
}
