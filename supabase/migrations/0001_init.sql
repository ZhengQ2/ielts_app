-- Initial schema for the IELTS test centre directory (DEV_PLAN §3).
--
-- Phase 1 ships the dataset as a committed JSON file; this migration is the
-- target shape for when it moves to Postgres. The column names deliberately
-- mirror the TypeScript types in packages/core/src/types.ts so the swap is a
-- loader change rather than a remodel.

create extension if not exists "uuid-ossp";

-- Operators are a lookup table so a new provider is a row, not a migration.
create table operators (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  test_type  text not null default 'IELTS',
  region     text,
  website    text,
  unique (name, region)
);

-- Registry of where facts came from. Provenance is first-class.
create table sources (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null unique,
  authority       numeric not null default 0.5 check (authority between 0 and 1),
  last_crawled_at timestamptz
);

create table centres (
  id               text primary key,           -- 'bc-13163' or the slug base
  name             text not null,
  operator_id      uuid references operators (id),

  -- British Council only: the booking link's location= id. IDP links are
  -- generic, so IDP centres have no operator-side id and key on the slug.
  external_id      text,
  ielts_org_slug   text not null unique,
  merged_slugs     text[] not null default '{}',

  -- How the operator was derived; 'booking_domain' is the only reliable one.
  operator_source  text not null default 'unknown'
    check (operator_source in ('booking_domain', 'slug', 'name', 'unknown')),

  formats          text[] not null default '{}',
  test_frequency   text check (test_frequency in ('daily', 'weekly', 'monthly')),
  sessions_per_day smallint,

  -- The address block is the source of truth and is always displayed.
  address          text not null,
  address_lines    text[] not null default '{}',
  city             text,                        -- derived from the address
  region           text,
  postcode         text,
  country          text not null,

  lat              numeric,                     -- nullable: never drop a centre
  lng              numeric,                     -- for a missing coordinate
  geo_precision    text check (geo_precision in
    ('rooftop', 'street', 'postcode', 'city', 'country', 'approximate')),
  geo_source       text,
  geo_confidence   numeric check (geo_confidence between 0 and 1),

  -- Only ever the place_id: Google ratings and photos are fetched live at
  -- render time and never persisted (DEV_PLAN §7).
  google_place_id  text,

  price_from       numeric,
  currency         text,
  price_updated_at date,
  phone            text,
  transit_note     text,
  hero_image_url   text,
  booking_url      text,

  is_active        boolean not null default true,  -- derived, not hand-set
  confidence       numeric not null default 0.5 check (confidence between 0 and 1),

  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index centres_city_idx     on centres (country, city);
create index centres_active_idx   on centres (is_active) where is_active;
create index centres_operator_idx on centres (operator_id);

-- One row per bookable product listed on the centre's page.
create table centre_offerings (
  id         uuid primary key default uuid_generate_v4(),
  centre_id  text not null references centres (id) on delete cascade,
  label      text not null,
  kind       text not null,
  format     text not null,
  currency   text,
  price      numeric,
  unique (centre_id, label)
);

-- Which sources currently list a centre, and how fresh that is. Driving
-- is_active off this table is what makes the directory self-maintaining.
create table centre_sources (
  centre_id     text not null references centres (id) on delete cascade,
  source_id     uuid not null references sources (id),
  external_slug text not null,
  url           text,
  seen_at       timestamptz not null default now(),
  still_present boolean not null default true,
  raw           jsonb,
  primary key (centre_id, source_id, external_slug)
);

-- Paid, rubric-scored field assessments. Always labelled as such in the UI.
create table assessments (
  id            uuid primary key default uuid_generate_v4(),
  centre_id     text not null references centres (id) on delete cascade,
  reviewer_id   uuid,
  noise         smallint check (noise between 1 and 5),
  staff         smallint check (staff between 1 and 5),
  checkin_speed smallint check (checkin_speed between 1 and 5),
  equipment     smallint check (equipment between 1 and 5),
  facilities    smallint check (facilities between 1 and 5),
  comment       text,
  visited_on    date,
  verified      boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Organic first-party reviews.
create table reviews (
  id         uuid primary key default uuid_generate_v4(),
  centre_id  text not null references centres (id) on delete cascade,
  user_id    uuid,
  rating     smallint not null check (rating between 1 and 5),
  body       text,
  taken_on   date,
  status     text not null default 'pending'
    check (status in ('pending', 'approved', 'removed')),
  created_at timestamptz not null default now()
);

create index reviews_centre_idx on reviews (centre_id) where status = 'approved';

-- Derived composite score, recomputed on write.
create table centre_scores (
  centre_id  text primary key references centres (id) on delete cascade,
  composite  numeric not null,
  breakdown  jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Row-level security: the directory is public, user content is not.
alter table centres         enable row level security;
alter table centre_offerings enable row level security;
alter table reviews         enable row level security;
alter table assessments     enable row level security;

create policy centres_public_read on centres
  for select using (is_active);

create policy offerings_public_read on centre_offerings
  for select using (true);

create policy reviews_public_read on reviews
  for select using (status = 'approved');

create policy assessments_public_read on assessments
  for select using (verified);
