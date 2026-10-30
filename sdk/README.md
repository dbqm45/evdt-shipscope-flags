# Klient referencyjny ShipScope Flags

`client.ts` to gotowy klient endpointu `GET /api/v1/sdk/flags` (kontrakt: `docs/sdk-api.md`, specyfikacja OpenAPI: `docs/sdk-api.openapi.json`) dla serwisów w Node.js.
To jeden plik TypeScript bez zależności: Node 22.18+ uruchamia go bez kompilacji, a w projekcie z TypeScriptem
wystarczy go skopiować lub zaimportować.

## Użycie

```ts
import { FlagClient } from "./client.ts";

const flags = await FlagClient.start({
  baseUrl: "https://flags.example.com",
  env: "prod", // środowisko, w którym działa to wdrożenie serwisu
  credential: process.env.SHIPSCOPE_FLAGS_TOKEN!, // poświadczenie serwisu z zakładki „Services”
  defaults: { newCheckout: false }, // wartości z kodu
  cacheFile: "/var/cache/my-service/flags.json", // opcjonalnie: ostatni stan na dysku
});

if (flags.isEnabled("newCheckout")) {
  // ...
}

// przy zamykaniu serwisu
flags.stop();
```

## Jak się zachowuje

- Odpytuje serwer co `intervalMs`, domyślnie i najwyżej co 60 sekund, z niewielkim losowym rozrzutem, żeby wiele
  instancji nie pytało jednocześnie. Odpytywanie nie podtrzymuje procesu przy życiu.
- `isEnabled(klucz)` zwraca wartość z ostatniego znanego stanu. Gdy serwer nie zwraca flagi, używa wartości z
  `defaults`, a gdy i tam jej nie ma — `false`.
- Gdy serwer nie odpowiada, odpowiada wolniej niż `timeoutMs` (domyślnie 3 s), zwraca błąd 5xx, odrzuca poświadczenie
  (401) albo ogranicza zapytania (429), klient **dalej używa ostatniego znanego stanu** i zgłasza błąd przez `onError`
  (domyślnie `console.warn`). Po 429 czeka tyle, ile podaje nagłówek `Retry-After`.
- Z `cacheFile` zapisuje każdy poprawny stan na dysk i przy starcie zaczyna od niego, więc restart w czasie awarii
  serwera flag nie cofa serwisu do wartości z kodu. Plik innego środowiska albo uszkodzony jest pomijany.
- `state.source` mówi, skąd pochodzi stan: `server` (ostatnie zapytanie się udało), `cache` (zapytania się nie udają,
  serwis używa poprzedniego stanu) albo `defaults` (nic jeszcze nie wiadomo).

Błędy z `kind: "credential"` (401) i `kind: "config"` (400, 403) wymagają człowieka: poświadczenie zostało wymienione
lub unieważnione albo klient jest źle skonfigurowany. Warto je przekazywać do alertów.

## Testy

`npm run test:sdk` w katalogu głównym (testy `node:test` na symulowanym serwerze). Test
`test/sdk-client.e2e-spec.ts` sprawdza klienta na prawdziwym API, łącznie z jego wyłączeniem.
