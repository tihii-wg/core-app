# B2B Auth + Onboarding + Starter Dashboard Design

Date: 2026-04-25
Status: Draft approved in conversation, pending final file review

## 1. Goal

Build a Russian-first B2B web app for business owners, service providers, and companies.

The first version should include:

- a custom-designed auth experience inspired by the product flow of `web.roapp.io/login`, but not visually copied
- `Supabase` authentication and persistence
- onboarding that asks what the company does
- a personalized starter dashboard based on the chosen business category
- demo widgets and starter data instead of real operational data

The product should feel `tech/startup`, modern, and confident, with room for future multilingual support.

## 2. Product Direction

### Chosen product structure

The approved product direction is `Auth-first MVP`.

This means:

- users first see a polished authentication screen
- registration is separated from business setup logic
- business category selection happens only after successful sign-up
- returning users skip onboarding and go directly to their dashboard

This approach was chosen because it gives the best balance of:

- implementation speed
- product clarity
- scalable onboarding architecture
- strong B2B presentation without overloading the auth screen

## 3. Visual Direction

### Layout concept

The approved layout direction is `Split SaaS`.

The auth screen is split into two major areas:

- left side: product pitch, visual identity, value framing, and abstract dashboard signals
- right side: authentication card with the active auth flow

### Style concept

The approved style direction is `Signal Grid`.

This means:

- dark tech-forward gradient surfaces
- subtle data-grid overlays
- electric blue / cyan startup accents
- strong contrast between brand panel and form panel
- a modern SaaS look that feels analytic, capable, and product-led

The design should avoid:

- template-like admin panel visuals
- generic purple AI gradients
- overly playful consumer-product styling
- copying the visual identity of the reference site

## 4. User Flows

### 4.1 New user flow

1. User opens the auth page.
2. User can choose:
   - log in
   - sign up
   - recover password
   - continue with `Google`
   - continue with `Apple`
3. If the user signs up successfully, the app creates a user profile.
4. The user is redirected to onboarding.
5. The user selects the company industry from a structured list of major business categories.
6. The user may optionally enter a company name.
7. The app creates the company record and stores the selected industry.
8. The user is redirected to a personalized starter dashboard.

### 4.2 Returning user flow

1. User logs in.
2. If onboarding is already complete, the user goes directly to `/dashboard`.
3. If onboarding is incomplete, the user goes to `/onboarding`.

### 4.3 Password recovery flow

1. User opens `Forgot password`.
2. User submits email.
3. `Supabase` sends a reset link.
4. User completes password reset and returns to the app.

## 5. Screen Structure

### 5.1 Auth screen

The auth experience is presented as one visual shell with multiple modes:

- `login`
- `register`
- `forgot password`

Core UI elements:

- product value headline for business owners
- supporting copy about operations, sales, bookings, and growth
- auth card with fields and action buttons
- `Google` and `Apple` social auth buttons
- secondary links to switch flow states

The auth screen should feel credible for:

- restaurants
- salons and beauty businesses
- fitness studios
- medical practices
- auto services
- electronics repair workshops
- retail and other service businesses

### 5.2 Onboarding screen

The onboarding screen is short and focused.

Required field:

- business category / industry

Optional field:

- company name

The industry selection should use a structured, scannable list of major business sectors.

Initial categories should include at minimum:

- restaurant
- beauty salon
- fitness
- medical
- retail
- professional services
- auto service
- electronics repair

The implementation should support easy expansion of this list.

### 5.3 Starter dashboard

The dashboard should not be empty after onboarding.

Instead, it should load a starter template with demo widgets based on the selected industry.

The dashboard should include:

- a page heading with company context
- KPI cards
- one or more status widgets
- one or more activity or queue widgets
- a short starter checklist

## 6. Industry Personalization

The first version uses template-driven personalization, not real business data.

Each industry gets its own widget set, labels, and demo content.

Examples:

- `Restaurant`: reservations, table occupancy, top dishes, average ticket
- `Beauty`: appointments, specialists, services, daily workload
- `Fitness`: coaches, memberships, class schedule, occupancy
- `Medical`: patients, appointments, rooms, queues
- `Auto Service`: repair jobs, vehicle statuses, bay workload, service revenue
- `Electronics Repair`: device intake, repair queue, repair statuses, common issues

These starter dashboards should feel relevant and useful, even though they are powered by static starter data.

## 7. Technical Architecture

### 7.1 Frontend stack

The current project stack remains unchanged:

- `React 19`
- `Vite`
- `TypeScript`
- `React Router`

No platform migration is needed for this phase.

### 7.2 Route structure

Public routes:

- `/login`
- `/register`
- `/forgot-password`

Protected routes:

- `/onboarding`
- `/dashboard`

Implementation note:
the public auth flows may share one visual page component while still mapping to separate routes for clarity and future extensibility.

### 7.3 App state

Use lightweight application state through `context + hooks`.

Required state domains:

- current auth session
- current authenticated user
- profile
- company
- onboarding completion status

No heavy global state library is needed for MVP.

### 7.4 Industry presets

Industry dashboard configurations should live in typed frontend config, not in database-authored content.

This config should define:

- industry label
- dashboard title
- KPI cards
- widget structure
- starter checklist
- demo data

This approach was chosen because it is:

- faster to implement
- easier to test
- simpler to maintain
- safer for MVP iteration

## 8. Supabase Design

### 8.1 Authentication

Use `Supabase Auth` for:

- email / password login
- sign-up
- password reset
- `Google` OAuth
- `Apple` OAuth

### 8.2 Data model

The MVP data model should include:

#### `profiles`

Stores user-level application metadata.

Suggested fields:

- `id` (matches auth user id)
- `email`
- `full_name` or display name
- `preferred_language`
- `created_at`

#### `companies`

Stores company-level onboarding information.

Suggested fields:

- `id`
- `owner_user_id`
- `name`
- `industry`
- `slug`
- `created_at`

#### `company_settings`

Stores initial company preferences.

Suggested fields:

- `company_id`
- `language`
- `currency`
- `timezone`

Future operational tables can be added later, but they are not required for this MVP.

### 8.3 Bootstrap logic

After successful registration:

1. create or confirm the `profile`
2. check whether a company exists
3. if no company exists, route to onboarding
4. after onboarding, create the company and default settings
5. route to the industry-based dashboard

## 9. Localization Strategy

Version 1 should ship with Russian UI text by default.

However, the implementation should be structured for future multilingual support.

This means:

- avoid hard-coding copy deep inside components when possible
- centralize visible strings where practical
- store language preference at profile or company level

Immediate target:

- Russian only in UI

Future target:

- multilingual interface, starting with Romanian and potentially other languages

## 10. UX Principles

The interface should feel:

- modern
- B2B-focused
- trustworthy
- fast
- clear to non-technical business owners

Important UX rules:

- auth should feel simple, not intimidating
- onboarding should be short and focused
- dashboard should feel alive on first load
- each industry dashboard should immediately communicate relevance
- the design should remain visually distinct from the reference app

## 11. Out of Scope for MVP

The following are explicitly out of scope for this implementation phase:

- real operational business data ingestion
- dashboard customization by end users
- advanced role-based permissions
- full company staff management
- billing and subscriptions
- admin back office
- complete multilingual shipping in v1

## 12. Implementation Success Criteria

The MVP is successful when:

- a user can sign up and log in with `Supabase`
- social auth buttons are present and integrated where configured
- a new user is routed into onboarding after sign-up
- onboarding stores the company industry
- returning users bypass onboarding
- the dashboard loads an industry-specific starter template
- Russian is the default interface language
- the experience feels like a polished custom product, not a boilerplate auth scaffold

## 13. Recommended Implementation Shape

Keep the codebase separated into three product areas:

- auth
- onboarding
- dashboard

Do not combine these into a single oversized component tree.

The implementation should favor:

- small route-level screens
- shared UI primitives
- typed preset configuration
- clear auth guards and redirect logic

This separation reduces complexity and makes future expansion safer.
