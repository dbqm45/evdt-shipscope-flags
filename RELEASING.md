# Wersjonowanie i wydania

ShipScope Flags ma jeden numer wersji zgodny z [Semantic Versioning 2.0.0](https://semver.org/lang/pl/)
(`MAJOR.MINOR.PATCH`). Numer jest zapisany w `package.json`, `frontend/package.json` i `packages/shared/package.json`
oraz we wspólnym `package-lock.json`: API, dashboard i pakiet wspólny wydaje się razem. Wydana wersja ma tag git `vX.Y.Z` i
[GitHub Release](https://github.com/dbqm45/evdt-shipscope-flags/releases) z wpisem z `CHANGELOG.md`.

Mechanizm jest taki sam jak w `dbqm45/evdt-service-shipscope`. Różnice opisuje ostatnia sekcja.

## Commity: Conventional Commits

Commity i **tytuły PR** stosują [Conventional Commits 1.0.0](https://www.conventionalcommits.org/pl/v1.0.0/). PR-y
łączy się przez squash, więc tytuł PR staje się commitem na `main` i decyduje o następnej wersji.

```
<typ>(<zakres>)!: <opis>

[treść: dlaczego, a nie co]

[stopki, np. Refs: #21  albo  BREAKING CHANGE: <co i jak migrować>]
```

- **Opis**: tryb rozkazujący, bez kropki na końcu, maksymalnie 72 znaki.
- **Zakres** (opcjonalny), jedno słowo: klucz projektu `SHPFL` jak w dotychczasowej historii albo np. `api`,
  `frontend`, `deps`, `release`.

| Typ                                                                     | Kiedy                                              | Wpływ na wersję |
| ----------------------------------------------------------------------- | -------------------------------------------------- | --------------- |
| `feat`                                                                  | nowa funkcja dla użytkowników                      | MINOR           |
| `fix`                                                                   | poprawka błędu                                     | PATCH           |
| `perf`                                                                  | szybciej, to samo zachowanie                       | PATCH           |
| `refactor`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`   | brak zmian widocznych dla użytkownika              | brak            |
| `!` po typie/zakresie albo stopka `BREAKING CHANGE:`                    | zmiana niezgodna wstecz (dowolny typ)              | MAJOR           |

Kontrola:

- **CI**: job `PR title` w workflow `CI` (`.github/workflows/ci.yml`) odrzuca niezgodny tytuł PR, także po jego
  edycji.
- **Lokalnie** (opcjonalnie, raz na klon): `npm run hooks:install` włącza hook `commit-msg` z `.githooks/`.
  Pojedynczą wiadomość sprawdza `npm run lint:commit -- "feat(SHPFL): …"`.

## Który numer podbić (SemVer)

Decyduje **najpoważniejsza** zmiana od ostatniego tagu.

| Zmiana publicznego API                                                                 | Od 1.0.0 | W 0.y.z (teraz) |
| -------------------------------------------------------------------------------------- | -------- | --------------- |
| niezgodna wstecz (usunięte lub zmienione pole albo trasa, zmienione znaczenie, nowe wymagane pole) | MAJOR    | MINOR           |
| zgodna wstecz funkcja, nowe pole w odpowiedzi, oznaczenie czegoś jako przestarzałe     | MINOR    | PATCH           |
| zgodna wstecz poprawka, łatka bezpieczeństwa, aktualizacja zależności                  | PATCH    | PATCH           |
| tylko dokumentacja, testy, CI, refaktoryzacja                                          | brak     | brak            |

**0.y.z** oznacza, że publiczne API nie jest jeszcze stabilne (reguła 4 SemVer). **1.0.0** wydaje się świadomie, ręcznie
(`npm run release -- 1.0.0`), gdy pierwsze serwisy zaczną korzystać z API. To decyzja człowieka; CI nigdy jej nie
podejmuje.

Publiczne API to to, na czym polegają użytkownicy i integracje: trasy HTTP pod `/api` (ścieżki, metody, pola żądań
i odpowiedzi, kody statusu), zwłaszcza endpoint dla serwisów `GET /api/v1/sdk/flags` (kontrakt w `docs/sdk-api.md`), oraz zmienne środowiskowe
(`.env.example`). Szczegóły wewnętrzne (układ kodu, treść logów, wygląd UI) się nie liczą.

## Jak wersja jest podbijana (automatycznie)

Po każdym pushu na `main` workflow `Release` (`.github/workflows/release.yml`):

1. **Wylicza wersję** (`node scripts/release.mjs --ci`) z commitów od ostatniego tagu `vX.Y.Z`, według tabel powyżej.
   - Brak `feat`, `fix`, `perf` i zmian niezgodnych (np. tylko `docs`, `test`, `ci`, `chore`, `build`, `refactor`):
     nie ma nowej wersji i nic więcej się nie dzieje.
   - W przeciwnym razie ustawia nową wersję we wszystkich `package.json` i w lockfile’u i dopisuje na górze `CHANGELOG.md`
     wpis (sekcje _Breaking_, _Added_, _Fixed_) z tytułów commitów.
2. **Commituje** to na `main` jako `github-actions[bot]` z wiadomością `chore(release): X.Y.Z`. Push wykonany przez
   `GITHUB_TOKEN` nie uruchamia innych workflow, więc commit wydania nie wywołuje kolejnego wydania.
3. **Weryfikuje** ten commit: uruchamia cały workflow `CI` (format, lint, typecheck, testy, build, audyt). Dzieje się
   to przy każdym pushu na `main`, z nową wersją lub bez: to jedyne uruchomienie testów na `main` (na PR-ach `CI`
   działa samodzielnie).
4. **Taguje** `vX.Y.Z` (tag z adnotacją) na commicie wydania, tylko jeśli weryfikacja przeszła.
5. **Tworzy GitHub Release** `vX.Y.Z` z wpisem z changeloga (`node scripts/release-notes.mjs X.Y.Z`) w tym samym jobie
   co tag. Istniejące wydanie zostaje bez zmian; brakujące (np. gdy przebieg padł po otagowaniu) tworzy ręczne
   _Run workflow_.

Kilka pushy w krótkim czasie: przebiegi czekają w kolejce (`concurrency: release`), więc nigdy nie wyliczą tej samej
wersji dwa razy. Jeśli w trakcie wydania na `main` pojawi się nowy commit, push commita wydania zostanie odrzucony,
a przebieg dla nowszego commita wyda wszystko naraz.

**Po wydaniu `main` ma commit, którego nie ma lokalnie.** Przed kolejną pracą zrób `git pull` (albo
`git fetch && git merge origin/main` na swojej gałęzi), inaczej następny push na `main` zostanie odrzucony.

### Wydanie ręczne

Tylko gdy wyliczony wynik trzeba nadpisać: źle otypowany commit, przeredagowany changelog albo **1.0.0**.

1. Na aktualnym `main` (lub świeżej gałęzi): `npm run release -- --dry-run`, potem `npm run release -- minor` (albo
   `major` / `patch` / `X.Y.Z`).
2. Przejrzyj i przeredaguj wpis w `CHANGELOG.md`.
3. Zacommituj `chore(release): X.Y.Z` i wypchnij na `main` (albo otwórz PR o tym tytule).
4. Workflow widzi wersję w `package.json` bez tagu i wydaje ją bez zmian: sprawdza, czy `CHANGELOG.md` ma wpis
   `## [X.Y.Z]` (bez niego nic nie zostanie otagowane), a potem wykonuje kroki 3–5.

Tak ustawiono pierwszą wersję, **0.1.0**: po jej wypchnięciu workflow taguje `v0.1.0` i tworzy jej wydanie.

Zasady:

- **Wydanej wersji nigdy się nie zmienia.** Tagów się nie przesuwa ani nie usuwa; zepsute wydanie naprawia następne.
- **Usuwanie funkcji**: najpierw MINOR, który oznacza ją jako przestarzałą i wskazuje zamiennik; usunięcie dopiero
  w późniejszym MAJOR.

## Wymagania po stronie GitHuba

- _Settings → Actions → General → Workflow permissions_: workflow deklaruje `contents: write` dla jobów, które pushują;
  polityka organizacji ograniczająca `GITHUB_TOKEN` do odczytu blokuje wydanie.
- Reguła ochrony gałęzi `main`, która zabrania bezpośrednich pushy, blokuje też commit `chore(release)`. Trzeba wtedy
  pozwolić `github-actions[bot]` ją omijać, inaczej wydanie zatrzyma się na kroku 2 z ostrzeżeniem.

## Narzędzia

| Plik                                                              | Rola                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `scripts/lib/conventional.mjs`                                    | reguły Conventional Commits i SemVer, budowanie wpisów changeloga           |
| `scripts/release.mjs` (`npm run release`)                         | wylicza i ustawia wersję, dopisuje changelog                                |
| `scripts/release-notes.mjs`                                       | wypisuje wpis jednej wersji (treść GitHub Release)                          |
| `scripts/check-commit-message.mjs` (`npm run lint:commit`)        | sprawdza wiadomość commita lub tytuł PR                                     |
| `.githooks/commit-msg` (`npm run hooks:install`)                  | lokalny hook commit-msg                                                     |
| `scripts/**/*.test.mjs` (`npm run test:scripts`)                  | testy powyższych (`node --test`), uruchamiane w CI                          |
| `.github/dependabot.yml`                                          | comiesięczne aktualizacje akcji i zależności npm, z tytułami w tym formacie |

## Różnice względem evdt-service-shipscope

- Jeden `CHANGELOG.md` (po angielsku, z tytułów commitów) zamiast wersji EN i PL.
- Weryfikacja na `main` to cały workflow `CI` wywołany przez `workflow_call` (backend, frontend, audyt), a nie
  osobne kroki z testami na Postgresie.
- Skrypty to moduły ESM (`.mjs`), bo repo ma `"type": "module"`; testy są obok skryptów w `scripts/`.
- Dependabot aktualizuje też zależności npm: runtime jako `fix(deps)` (wydanie PATCH), deweloperskie jako
  `build(deps-dev)` (bez wydania).
