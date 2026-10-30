# Kontrakt API dla serwisów (SDK)

Ten dokument opisuje, jak serwis (aplikacja korzystająca z flag) pobiera stan flag z ShipScope Flags. To kontrakt
w wersji **v1**: jego pola i znaczenie nie zmienią się w sposób niezgodny wstecz bez nowej wersji (`/api/v2/…`)
i wpisu „Breaking” w `CHANGELOG.md`. Mogą natomiast dojść nowe pola, więc klient powinien ignorować pola, których
nie zna.

Ten sam kontrakt w formie maszynowej: `docs/sdk-api.openapi.json` (OpenAPI 3.1) — do generowania klientów i do
narzędzi typu Swagger UI. Test `test/sdk-openapi.e2e-spec.ts` sprawdza prawdziwe odpowiedzi API z tą specyfikacją,
więc oba opisy nie rozjadą się z kodem niezauważenie.

## Zapytanie

```
GET /api/v1/sdk/flags?env=prod
Authorization: Bearer <poświadczenie serwisu>
```

| Parametr  | Wymagany | Znaczenie                                                                                       |
| --------- | -------- | ----------------------------------------------------------------------------------------------- |
| `env`     | tak      | Środowisko: `test`, `qa` albo `prod`.                                                            |
| `service` | nie      | Klucz serwisu. Gdy go podano, musi być kluczem serwisu, do którego należy poświadczenie (inaczej 403). |

`GET /api/sdk/flags` (bez `v1`) to ten sam endpoint pod adresem sprzed wersjonowania; działa dla istniejących
integracji, ale nowe powinny używać `/api/v1/sdk/flags`.

## Odpowiedź 200

```json
{ "env": "prod", "flags": { "allowEvseNameEdit": true, "b2cCustomersEnabled": false } }
```

- `flags` zawiera **tylko flagi przypisane do serwisu**, który wysłał zapytanie, z ich stanem w danym środowisku.
- Brak flagi w odpowiedzi oznacza, że flaga nie jest (już) przypisana do serwisu albo została usunięta. Serwis
  używa wtedy wartości domyślnej ze swojego kodu.
- Każde udane zapytanie jest zapisywane jako **check-in** serwisu dla danego środowiska (zakładka „Services”,
  kolumna „Last check-in”), najwyżej raz na 30 sekund. Dashboard porównuje go z ostatnią zmianą flagi w tym
  środowisku: serwis, który nie pobrał flag po zmianie, jest oznaczany jako możliwy rozjazd („drift”). Dlatego każde
  wdrożenie serwisu powinno odpytywać tylko swoje środowisko.

## Błędy

Treść błędu ma postać `{ "statusCode": 401, "message": "…" }` (czasem z polem `error`, nazwą statusu HTTP).

| Kod     | Kiedy                                                                                   | Co robi klient                                                     |
| ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 400     | Brak `env` albo nieznane środowisko.                                                    | Błąd konfiguracji serwisu — do poprawienia, nie ponawiać.          |
| 401     | Brak nagłówka `Authorization`, nieznane, unieważnione lub wygasłe poświadczenie.        | Dalej używa ostatniego znanego stanu i alarmuje (poświadczenie do wymiany). |
| 403     | Parametr `service` wskazuje inny serwis niż właściciel poświadczenia.                   | Błąd konfiguracji — usunąć `service` albo poprawić jego wartość.   |
| 404     | Tylko przy przestarzałym wspólnym `SDK_TOKEN`: `service` nie jest zarejestrowanym serwisem. | Błąd konfiguracji — poprawić `service`.                         |
| 429     | Przekroczony limit zapytań z jednego adresu (domyślnie 600 na minutę).                  | Dalej używa ostatniego znanego stanu; ponawia po liczbie sekund z nagłówka `Retry-After`. |
| 5xx, brak odpowiedzi, przekroczony czas | Serwer flag jest niedostępny.                               | Dalej używa ostatniego znanego stanu i ponawia przy kolejnym odpytaniu. |

## Zalecane zachowanie klienta

Dla serwisów w Node.js jest gotowy klient, który robi wszystko poniżej: `sdk/client.ts` (opis w `sdk/README.md`).

Serwer flag nie może być pojedynczym punktem awarii (PRD, FR-012). Klient serwisu powinien:

1. Odpytywać endpoint co **najwyżej 60 sekund** (zmiana flagi dociera do serwisu w ciągu jednego odstępu).
2. Trzymać **ostatni poprawny stan** (w pamięci, a najlepiej także na dysku, żeby przetrwał restart) i używać go,
   gdy serwer nie odpowiada, odpowiada błędem 5xx albo 401.
3. Przy starcie bez żadnego zapisanego stanu używać **wartości domyślnych z kodu**.
4. Ustawić krótki limit czasu zapytania (np. 2–5 s), żeby niedostępny serwer flag nie spowalniał serwisu.

Przykład (`curl`):

```bash
curl -fsS -H "Authorization: Bearer $SHIPSCOPE_FLAGS_TOKEN" "https://flags.example.com/api/v1/sdk/flags?env=prod"
```

## Poświadczenia

- Admin rejestruje serwis w zakładce „Services” („Register service”) albo przez `POST /api/services`
  z `{ "key": "…", "name": "…" }`. Odpowiedź zawiera poświadczenie (`ssf_…`) — **pokazywane tylko raz**; serwer
  przechowuje wyłącznie jego skrót SHA-256. Poświadczenie trafia do magazynu sekretów serwisu.
- **Wymiana** („Rotate credential”, `POST /api/services/:id/credential`): serwer wydaje nowe poświadczenie, a
  poprzednie działa jeszcze **24 godziny**, żeby serwis zdążył się przełączyć. Kolejna wymiana w tym czasie od razu
  kończy ważność najstarszego poświadczenia.
- **Unieważnienie** („Revoke & reissue”, to samo z `{ "revokePrevious": true }`): poprzednie poświadczenie przestaje
  działać natychmiast — na wypadek wycieku.
- Serwisy zarejestrowane przed wersją z poświadczeniami nie mają żadnego, dopóki Admin go nie wyda („Issue
  credential”).
- Każda rejestracja i wymiana trafia do dziennika zmian.

### Wspólny token `SDK_TOKEN` (przestarzały)

Wersja 0.3 używała jednego tokenu dla wszystkich serwisów, ustawianego zmienną `SDK_TOKEN` na serwerze. Nadal działa,
jeśli zmienna jest ustawiona: daje dostęp do wszystkich flag (albo do flag jednego serwisu z `?service=`) i nie
zapisuje check-inów. Zostanie usunięty w jednej z kolejnych wersji (zmiana niezgodna wstecz); po przełączeniu
wszystkich serwisów na własne poświadczenia należy usunąć `SDK_TOKEN` z konfiguracji serwera.
