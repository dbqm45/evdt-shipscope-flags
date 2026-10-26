# TODO — ShipScope Flags

Przegląd projektu z 2026-10-26. Ocena oparta na lekturze kodu (`src/`, `frontend/src/`, `scripts/`), dokumentów w `context/foundation/` (PRD, tech-stack, log bootstrapu) oraz na przebiegu kontroli kondycji projektu (`10x-health-check`): instalacja zależności, testy, typecheck, lint, build.

Priorytety: **P0** — blokuje uruchomienie lub stanowi lukę bezpieczeństwa; **P1** — wymagane przez PRD w MVP albo powoduje błędne działanie; **P2** — jakość, utrzymanie, wygoda.

## Podsumowanie stanu

| Obszar | Stan |
| --- | --- |
| Build backendu (`npm run build`) | ✅ (naprawione — wcześniej `sync:shared` nie znajdował `frontend/src/data/mock.ts`) |
| Build frontendu (`npm run build`) | ✅ (naprawione — wcześniej `TS2307: Cannot find module '../data/mock'`) |
| Testy backendu (`vitest`, unit + e2e) | ✅ przechodzą, ale testują wyłącznie szablonowe „Hello World!” |
| Testy frontendu | ❌ brak test runnera |
| Typecheck backendu (`strict: true`) | ✅ |
| Typecheck frontendu | ✅ `strict: true` (włączone) |
| Lint (oxlint) | ✅ backend i frontend czysto |
| Audyt zależności | ⚠️ `npm audit` nie dał wyniku w tym środowisku (brak dostępu do rejestru). Log bootstrapu odnotował 2 HIGH (`tmp`, `undici`) — oba przechodnie, w narzędziach Nest CLI |
| CI/CD | ✅ GitHub Actions: `.github/workflows/ci.yml` (format, sync, lint, typecheck, testy, build, audyt) |
| Persystencja | ✅ PostgreSQL + Prisma 7 (migracje w `prisma/migrations/`, testy na prawdziwej bazie) |
| Uwierzytelnianie i autoryzacja | ❌ tylko symulacja w UI; API nie ma żadnej kontroli dostępu |

---

## P0 — Blokery i bezpieczeństwo

- [x] **`frontend/src/data/mock.ts` nie jest w repozytorium.** _(Naprawione: reguła zmieniona na `/data/`, plik odtworzony z `src/flags/shared/seed.ts`; oba buildy przechodzą.)_ Reguła `data/` w głównym `.gitignore` (przeznaczona dla `data/state.json`) ignoruje też `frontend/src/data/`. Na świeżym klonie nie budują się ani frontend (3 importy z `../data/mock`), ani backend (`prebuild` uruchamia `scripts/sync-shared.mjs`, który czyta ten plik).
  - Fix: zmienić regułę na `/data/` (zakotwiczoną w katalogu głównym), dodać `frontend/src/data/mock.ts` do repozytorium i sprawdzić build od zera (`git clone` → `npm ci` → `npm run build` w obu pakietach).
- [ ] **Management API nie ma uwierzytelniania ani autoryzacji.** `PATCH /api/flags/:key/environments/:env`, `PUT /api/settings/notifications` i `POST /api/settings/notifications/test` może wywołać każdy, kto ma dostęp sieciowy. Role Viewer/Editor/Admin istnieją tylko w przełączniku w UI (`RoleSwitcher`).
  - Fix: guard NestJS (Passport + OIDC zgodnie z `tech-stack.md`) oraz `RolesGuard` z dekoratorem `@Roles()` na każdym endpoincie zmieniającym stan.
- [ ] **Autor zmiany w audit logu pochodzi z body żądania.** `actor` w `PATCH .../environments/:env` przysyła klient (`body.actor ?? 'api'`), więc audit log (FR-014) można dowolnie sfałszować.
  - Fix: brać tożsamość z uwierzytelnionej sesji lub tokenu, a pole z body ignorować.
- [x] _(zrobione: tylko https, bez adresów prywatnych/lokalnych, sprawdzane przy zapisie i przed każdą wysyłką, bez przekierowań; `NOTIFY_WEBHOOK_HOSTS`. Ograniczenie do roli Admin czeka na uwierzytelnianie)_ **SSRF przez webhook powiadomień.** `PUT /settings/notifications` przyjmuje dowolny URL `http(s)://`, a `POST /settings/notifications/test` wysyła na niego żądanie z serwera. W połączeniu z brakiem auth pozwala to odpytywać sieć wewnętrzną (np. metadata endpoint chmury).
  - Fix: ograniczyć dostęp do roli Admin, walidować hosta (allowlista, np. `hooks.slack.com`, albo blokada adresów prywatnych i link-local) i nie zwracać treści odpowiedzi.
- [x] _(zrobione: API zwraca tylko zamaskowany URL)_ **URL webhooka jest ujawniany.** `GET /settings/notifications` zwraca pełny `webhookUrl`, a URL Slack webhooka działa jak sekret. Fix: maskować go w odpowiedzi (np. `https://hooks.slack.com/…/abcd`).
- [x] _(zrobione: każdy serwis ma własne poświadczenie przechowywane jako skrót SHA-256, serwis jest wyznaczany z poświadczenia i widzi tylko swoje flagi, rotacja z oknem 24 h i natychmiastowe unieważnienie. Do zrobienia po przełączeniu serwisów: usunąć przestarzały wspólny `SDK_TOKEN` — zmiana niezgodna wstecz)_ **SDK API jest domyślnie publiczne i ma jeden współdzielony token.** Bez ustawionej zmiennej `SDK_TOKEN` endpoint `GET /api/sdk/flags` działa bez autoryzacji. PRD (FR-003, FR-005, FR-011) wymaga osobnego poświadczenia dla każdego serwisu, rotacji z okresem przejściowym i dostępu wyłącznie do flag przypisanych do serwisu. Dziś parametr `?service=` jest tylko filtrem, który podaje sam klient.
  - Fix: tryb fail-closed (bez skonfigurowanych poświadczeń endpoint zwraca 401), poświadczenia per serwis przechowywane jako hash, serwis wyznaczany na podstawie poświadczenia, a nie parametru zapytania. Porównanie tokenu przez `crypto.timingSafeEqual`.
- [ ] **Logowanie jest atrapą.** `LoginPage` ustawia `authenticated = true` po 650 ms. Pole break-glass niczego nie sprawdza, a komunikat „This attempt is logged” jest nieprawdziwy. Do czasu wdrożenia SSO (FR-001, FR-002) usunąć ten komunikat i wyraźnie oznaczyć tryb demo.
- [x] _(zrobione: `npm audit` w CI blokuje podatności HIGH w zależnościach runtime; poprawione w 0.1.0 i 0.2.0)_ **Audyt zależności.** Uruchomić lokalnie `npm audit` w katalogu głównym i w `frontend/`. Zgodnie z logiem bootstrapu `npm audit fix` (bez `--force`) powinien usunąć `tmp` i `undici` (HIGH, przechodnie przez `@nestjs/mau` / `inquirer`). Rozważyć usunięcie `@nestjs/mau` z `devDependencies`, jeśli nie jest używany.

## P1 — Poprawność i zgodność z PRD

### Niespójność stanu frontend ↔ backend

- [x] _(zrobione: tryb demo tylko przy braku połączenia, błędy API pokazywane w UI, stan z odpowiedzi serwera)_ **Odrzucenia z API są połykane.** `request()` w `frontend/src/api/client.ts` przy *każdym* błędzie (także `409 Conflict` z reguł promocji i `400`) zwraca fallback. `setEnvironmentState` zwraca wtedy `{ ok: true }`, a store aktualizuje stan optymistycznie i nie robi rollbacku, więc UI pokazuje stan, którego serwer nie zapisał.
  - Fix: fallback do danych demo tylko przy braku połączenia (błąd sieci lub timeout). Odpowiedzi 4xx/5xx propagować do UI, a przy błędzie wycofać zmianę optymistyczną albo czekać na odpowiedź serwera.
- [x] _(zrobione: `POST /flags`, `PATCH /flags/:key`, `PATCH /flags/:key/services/:serviceId`, `DELETE /flags/:key` z `canRetire` na serwerze)_ **Większość operacji działa tylko lokalnie w przeglądarce.** Tworzenie flagi, przypisanie serwisów, edycja bindingu (read mode, build-time values, `removedFromCode`), edycja metadanych (owner, tags, reviewBy) i „Retire flag” nie mają endpointów w API i znikają po odświeżeniu. Wpisy audit logu z tych akcji też istnieją tylko lokalnie.
  - Fix: dodać `POST /flags`, `PATCH /flags/:key`, `PATCH /flags/:key/services/:serviceId`, `DELETE /flags/:key` (z walidacją `canRetire` po stronie serwera) i audytować je na serwerze.
- [x] _(zrobione: z API store pokazuje dziennik z serwera; lokalne wpisy tylko w trybie demo)_ **Audit log z UI i z serwera się rozjeżdża.** Store dopisuje lokalne wpisy (`local-…`), a serwer swoje (`srv-…`), bez ponownego pobrania. Po wdrożeniu powyższego punktu dane audytu powinny pochodzić wyłącznie z serwera.
- [x] _(zrobione)_ **`flagKey` nie jest kodowany w URL** (`client.ts`: `` `/flags/${flagKey}/...` ``). Użyć `encodeURIComponent`.

### Reguły biznesowe

- [ ] **Brak kontroli kolejności przy wyłączaniu.** `canDisable` sprawdza tylko zależne flagi. Można wyłączyć flagę na `test`, gdy jest włączona na `qa`/`prod`, co odwraca niezmiennik test → qa → prod. Do decyzji: blokować to albo wymagać kaskady (prod → qa → test). Regułę i jej uzasadnienie opisać w README.
- [x] _(nieaktualne: `dependsOn` ustawia się tylko przy tworzeniu flagi i serwer wymaga istniejącej flagi, więc cykl nie może powstać; flagi, od której inna zależy, nie da się usunąć — `canRetire`. Wrócić do tego, gdy zależność będzie edytowalna)_ **`dependsOn` nie jest walidowane.** Nie ma kontroli cykli (A → B → A) ani istnienia flagi docelowej. Gdy zależność nie istnieje (np. po retire), `canEnable` po cichu przepuszcza (`if (dependency && ...)`). Fix: walidacja przy tworzeniu i edycji; brak zależności traktować jako blokadę albo wyraźne ostrzeżenie.
- [x] _(zrobione: check-in per serwis i środowisko; reguły 6 i 7 w `businessLogic.ts` — `driftRisks`, `attentionItems`, `byAttention` — znaczek „drift”, ramka „Needs attention” i domyślne sortowanie. Bez hasha otrzymanego stanu: wystarcza porównanie czasu odczytu z czasem zmiany)_ **„Attention prioritization” (PRD → Business Logic, pkt 3) nie jest zaimplementowane.** `driftSuspected` i `lastCheckInAt` to statyczne dane z seeda. Endpoint SDK nie zapisuje check-inów serwisów, więc nie ma z czego wyliczyć ryzyka dryfu ani posortować listy według „needs attention”.
  - Fix: rejestrować check-in serwisu (serwis, środowisko, czas, ewentualnie hash otrzymanego stanu) przy każdym `GET /sdk/flags` i na tej podstawie wyliczać `driftSuspected` oraz domyślne sortowanie.
- [ ] **Próg „stale” jest zahardkodowany** (`STALE_THRESHOLD_DAYS = 30`). PRD (FR-006) wymaga wartości konfigurowalnej.
- [x] _(zrobione: `src/flags/flags.input.ts`)_ **Walidacja klucza flagi istnieje tylko w UI** (`CreateFlagModal` filtruje znaki). Po dodaniu `POST /flags` walidować po stronie serwera (DTO + `ValidationPipe`).

### Brakujące funkcje MVP z PRD

- [ ] FR-001/002: SSO (OIDC) + break-glass (sekret w vaulcie, audyt użycia).
- [x] _(zrobione: zakładka „Services”, `POST /services`, `POST /services/:id/credential`)_ FR-003/005: rejestracja serwisów, wydawanie poświadczeń, rotacja z oknem przejściowym (24 h). W UI i API nie ma zarządzania serwisami.
- [x] _(zrobione: kontrakt w `docs/sdk-api.md` i referencyjny klient dla Node.js w `sdk/client.ts` — pamięć podręczna w pamięci i na dysku, wartości domyślne z kodu, limit czasu, `Retry-After`. Klientów dla innych języków brak; to, czy pilotowe serwisy go użyją, zostaje do sprawdzenia — PRD, Open Question #2)_ FR-012: klient lub SDK z lokalnym cache i fallbackiem przy niedostępności API (gwarancja „nigdy single point of failure”). Na razie istnieje tylko endpoint; trzeba przynajmniej udokumentować kontrakt i dostarczyć referencyjnego klienta.
- [ ] _(częściowo: `GET /api/v1/sdk/flags` z kontraktem w `docs/sdk-api.md`; specyfikacji OpenAPI brak)_ FR-011: zamrozić i udokumentować kontrakt `GET /api/sdk/flags` (wersjonowanie, np. `/api/v1/sdk/flags`; OpenAPI przez `@nestjs/swagger`). PRD wskazuje go jako najważniejsze wymaganie do zablokowania.
- [ ] _(częściowo: `GET /audit-log` zwraca strony po 50 wpisów — kursor `before`, filtry `flagKey`, `serviceKey`, `action`, `actor`, `q` — i dashboard doczytuje kolejne; polityka retencji nadal do decyzji)_ FR-014: polityka retencji audit logu (Open Question #1). Teraz `GET /audit-log` zwraca całą historię bez paginacji.
- [ ] _(częściowo: rejestracja serwisów i poświadczenia tylko dla Admina — na razie w UI, bo API nie ma uwierzytelniania)_ Rola Admin nie różni się od Editor (README §7). Po dodaniu zarządzania serwisami i ustawień przypisać je do roli Admin.

### Backend — persystencja i odporność

- [x] _(zrobione: PostgreSQL + Prisma, zmiany stanu w transakcji z blokadą doradczą; import starego pliku: `npm run db:import`)_ **Stan w pliku JSON zamiast bazy danych.** `FlagsService` czyta `data/state.json` raz przy starcie i nadpisuje cały plik synchronicznie przy każdej zmianie. Brakuje transakcji, zapisu atomowego (write-to-temp + rename) i obsługi wielu instancji, a zapis pliku nie jest możliwy przy NFR 99,9% / skalowaniu poziomym. `tech-stack.md` zakłada PostgreSQL + Prisma.
  - Fix: wprowadzić Prisma i modele `Flag`, `FlagEnvironmentState`, `Service`, `FlagServiceBinding`, `AuditLogEntry`, `ServiceCredential`.
- [x] _(zrobione: błąd bazy kończy żądanie kodem 5xx)_ **Błąd zapisu jest tylko logowany** (`save()` → `logger.warn`). API zwraca `{ ok: true }`, choć zmiana nie została utrwalona. Błąd persystencji powinien kończyć żądanie kodem 5xx.
- [x] _(zrobione: dane demo tylko na żądanie, `npm run db:seed` / `SEED_DEMO_DATA`, i tylko do pustej bazy)_ **Uszkodzony plik stanu po cichu wraca do danych seedowych.** Ryzyko utraty produkcyjnego stanu flag. Seed powinien ładować się tylko w trybie dev/demo albo jawnym poleceniem.
- [x] _(nie dotyczy produkcji: dane demo ładuje się jawnie, raz)_ **Seed zawiera daty względne** (`daysAgo()`), więc każdy start bez pliku stanu daje inne dane. Akceptowalne w demo, ale nie w produkcji.
- [x] _(zrobione: wszystkie body management API walidowane w `flags.input.ts`, bez nowych zależności)_ **Brak walidacji wejścia.** Body opisano typami inline (`{ enabled?: boolean; actor?: string }`). Dodać DTO z `class-validator` i globalny `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.
- [x] _(zrobione: `GET /api/health` sprawdza też bazę, 503 gdy jest niedostępna; używa go healthcheck Dockera)_ **Brak endpointu health/readiness** (np. `@nestjs/terminus`, `GET /api/health`), potrzebnego do deploymentu w kontenerze.
- [x] _(zrobione: `helmet`, limity zapytań na adres klienta — `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_SDK_PER_MINUTE`, `TRUST_PROXY` — i `enableShutdownHooks`. CORS pozostaje wyłączony, bo dashboard jest serwowany z tego samego adresu co API. Limity są liczone w pamięci jednej instancji; przy kilku instancjach potrzebny wspólny magazyn, np. Redis. Nagłówki bezpieczeństwa dashboardu, w tym ścisłe CSP, ustawia nginx — `docker/security-headers.conf`; HSTS tam, gdzie kończy się TLS)_ **Brak hardeningu HTTP:** `helmet`, polityka CORS, rate limiting (`@nestjs/throttler`), szczególnie dla endpointu SDK; do tego `app.enableShutdownHooks()`.
- [ ] **Powiadomienia:** wysyłane fire-and-forget, bez retry, tylko dla `prod`. FR-016 przewiduje włączanie per flaga lub globalnie; dziś działa tylko przełącznik globalny.

## P2 — Jakość, testy, utrzymanie

### Testy

- [x] _(zrobione: reguły w testach frontendu, `FlagsService` i e2e na PostgreSQL; brak jeszcze e2e z ustawionym `SDK_TOKEN`)_ **Testy nie pokrywają logiki biznesowej.** Istnieją tylko szablonowe `app.controller.spec.ts` i `test/app.e2e-spec.ts` (`GET /` → „Hello World!”). Do dodania:
  - unit testy `rules.ts` / `businessLogic.ts`: `canEnable`, `canDisable`, `canRetire`, `buildTimeIssues`, `isStaleCandidate`, `lifecycleStage` (z `vi.useFakeTimers()` dla dat);
  - unit testy `FlagsService` (blokada promocji zapisuje `promotion-blocked` w audycie, idempotentny toggle, `evaluate` z nieznanym serwisem → 404);
  - e2e dla `/api/flags`, `/api/sdk/flags` (z tokenem i bez), `PATCH` (409 przy naruszeniu kolejności);
  - test SDK z `FLAGS_DATA_FILE` wskazującym na katalog tymczasowy (dziś testy mogłyby nadpisać `data/state.json`).
- [x] _(zrobione: `configureApp` w `src/app.setup.ts`)_ **E2E nie odwzorowuje produkcyjnej konfiguracji.** `setGlobalPrefix('api')` jest tylko w `main.ts`, więc w testach routy działają bez `/api`. Wydzielić `configureApp(app)` i wywoływać go w `main.ts` i w e2e.
- [x] _(zrobione: Vitest + RTL, testy `businessLogic.ts`, `client.ts`, `store.tsx`; brak testów rollbacku, bo store go jeszcze nie ma)_ **Frontend nie ma testów.** Dodać Vitest + React Testing Library (`npm i -D vitest @testing-library/react jsdom`) i skrypt `test`. Zacząć od `store.tsx` (toggle, rollback, uprawnienia) i `client.ts` (fallback tylko przy błędzie sieci).
- [x] _(zrobione: zastąpione przez `GET /api/health`)_ Usunąć szablonowe `AppController` i `AppService` („Hello World!”) albo zastąpić je endpointem health.

### Architektura i struktura kodu

- [ ] **Współdzielenie kodu przez kopiowanie plików** (`scripts/sync-shared.mjs`). Wygenerowane pliki w `src/flags/shared/` są commitowane i mogą się rozjechać ze źródłem (dziś są zgodne). Seed demo trafia do kodu produkcyjnego backendu. Lepiej wydzielić pakiet współdzielony (npm workspaces: `packages/shared`) albo przynajmniej sprawdzać w CI, że `sync:shared` nie zmienia plików.
- [ ] **Monorepo bez workspaces:** dwa niezależne `package.json` i lockfile’y, osobne `npm install`. Rozważyć `workspaces` w głównym `package.json` i wspólne skrypty (`dev`, `build`, `test`, `lint`) dla obu pakietów.
- [x] _(zrobione: jeden typ ze `shared/types.ts`)_ `NotificationSettings` jest zdefiniowany dwa razy (`flags.service.ts` i `shared/types.ts`). Używać typu współdzielonego.
- [x] _(zrobione: `FlagsController`, `ServicesController`, `AuditLogController`, `SettingsController`, `SdkController`)_ `FlagsController` łączy Management API i Consumer (SDK) API. Rozdzielić na `FlagsController`, `SettingsController` i `SdkController` (różne guardy i różni konsumenci).
- [ ] `store.tsx`: cała logika w jednym `useMemo` (~200 linii) z mieszaniem stanu i wywołań API. Po przeniesieniu operacji na serwer rozważyć TanStack Query (cache, invalidacja, stany błędów).
- [x] _(zrobione: baner trybu demo i błędu ładowania)_ Frontend nie pokazuje stanu błędu ani informacji o trybie demo. Po fallbacku do danych mock użytkownik nie wie, że pracuje na danych przykładowych; wystarczy baner „offline / demo data”.
- [ ] Sesja nie przetrwa odświeżenia strony (`authenticated` w `useState`), a `currentUser` jest mapowany z roli (`CURRENT_USER_BY_ROLE`). Po wdrożeniu SSO pobierać użytkownika z `/api/me`.

### Konfiguracja i higiena repozytorium

- [x] Włączyć `"strict": true` w `frontend/tsconfig.app.json` _(zrobione)_ (sprawdzone: kod przechodzi z `--strict` bez nowych błędów).
- [x] _(zrobione)_ Usunąć z repozytorium artefakty i pliki IDE: `tsconfig.build.tsbuildinfo` (zmienia się przy każdym `tsc`), `.idea/`. Dodać je do głównego `.gitignore`.
- [x] _(zrobione)_ Usunąć pozostałości po placeholderze: `index.js` (`console.log('Happy developing ✨')`), szablonowy `frontend/README.md` (Vite).
- [x] _(zrobione: usunięty)_ Sprawdzić skrypt `"deploy": "nest deploy"` w `package.json`: nie wiadomo, czy Nest CLI ma taką komendę. Usunąć go albo zastąpić realnym procesem.
- [x] _(zrobione: `.env.example` i `frontend/.env.example`)_ Dodać `.env.example` z obsługiwanymi zmiennymi: `PORT`, `SDK_TOKEN`, `FLAGS_DATA_FILE`, `NOTIFY_WEBHOOK_URL`, `VITE_API_BASE_URL`.
- [x] _(zrobione; `.prettierrc` dopasowany do stylu kodu: double quotes, `printWidth` 160)_ Dodać `.editorconfig`. Dopisać `format:check` (`prettier --check`) i objąć formatowaniem także `frontend/` (dziś `format` dotyczy tylko `src/` i `test/`).
- [x] _(zrobione: `lib/tags.ts`, `state/useStore.ts`)_ Naprawić ostrzeżenia oxlint `only-export-components`: wydzielić `parseTags` z `CreateFlagModal.tsx` i `useStore` z `store.tsx` do osobnych plików.
- [x] _(zrobione: `lib/labels.ts`; nazwy serwisów ze store)_ Konfiguracja `ENV_LABEL` jest importowana z `data/mock` w kodzie produkcyjnym (`FlagDrawer.tsx`), a `serviceById` z danych mock w `BindingCard.tsx`. Przenieść je do `lib/` i brać serwisy ze store, nie z fixture’ów.

### CI/CD i deployment

- [x] _(zrobione; `npm audit` blokuje tylko na zależnościach runtime, narzędzia dev są raportowane)_ Workflow GitHub Actions (`.github/workflows/ci.yml`): `npm ci` (oba pakiety) → lint → typecheck → test → build → `npm audit --audit-level=high`, plus kontrola, że `sync:shared` nie zostawia diffu. Sam build na czystym klonie wychwyciłby problem z `mock.ts`.
- [x] _(zrobione: `.github/dependabot.yml` dla akcji i obu pakietów npm)_ Dependabot lub Renovate dla obu `package.json`.
- [x] _(zrobione, zob. `RELEASING.md`)_ Automatyczne wersjonowanie: Conventional Commits, SemVer, `CHANGELOG.md`, tagi i GitHub Releases z workflow `Release`.
- [x] _(zrobione: obrazy `api` i `web` z nginx; PostgreSQL w compose czeka na migrację z pliku JSON)_ `Dockerfile` (multi-stage: build backendu i frontendu, serwowanie statycznego frontendu przez Nest lub osobny kontener) i `docker-compose.yml` z PostgreSQL. `tech-stack.md` zakłada deployment kontenerowy i ręczną promocję na produkcję.

### Dokumentacja

- [ ] `README.md` i `README.pl.md` są oba po polsku i już się różnią (inne przykłady, sekcja o owner/tags/review tylko w `.pl.md`). Zostawić jedno źródło prawdy albo zrobić z `README.md` wersję angielską.
- [ ] README (§8–9) opisuje uruchomienie tylko frontendu i twierdzi, że zmiany „nie są zapisywane trwale”. Nie wspomina backendu (`npm run start:dev` w katalogu głównym, proxy `/api` w Vite), pliku `data/state.json`, endpointu SDK ani zmiennych środowiskowych. Do zaktualizowania.
- [x] _(zrobione: `docs/sdk-api.md`)_ Opisać kontrakt Consumer API dla zespołów serwisów: format odpowiedzi, uwierzytelnianie, zalecany interwał odpytywania ≤ 60 s (FR-013), zachowanie przy błędzie (cache).
- [x] _(zrobione: `CLAUDE.md`)_ Brak `CLAUDE.md` / `AGENTS.md` z instrukcjami dla agentów: komendy build/test/lint, zasada „nie edytuj `src/flags/shared/*` ręcznie, uruchom `npm run sync:shared`”, struktura monorepo.
- [ ] `context/foundation/` zawiera dwa warianty PRD (`prd.md` i `shape-notes.md` z innym nazewnictwem: Okta, Slack, „poll”). Oznaczyć, który jest aktualny, i wpisać stan implementacji względem FR (np. tabela FR → status).
- [ ] `tech-stack.md` deklaruje PostgreSQL + Prisma + Passport/OIDC; PostgreSQL i Prisma już są, OIDC nadal brak. Zaktualizować dokument albo dodać ADR opisujący, że plik JSON to rozwiązanie tymczasowe.
