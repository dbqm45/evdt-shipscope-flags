# ShipScope Flags

## 1. Czym jest ta aplikacja

ShipScope Flags jest narzędziem do zarządzania tzw. flagami funkcjonalności (ang. *feature flags*). Flaga jest prostym przełącznikiem typu „włączone / wyłączone”, który decyduje, czy dana funkcja aplikacji jest w danym momencie widoczna i działa dla użytkowników.

Aplikacja gromadzi wszystkie takie przełączniki w jednym miejscu. Pozwala sprawdzić, w jakim stanie znajduje się każda flaga, kto ją utworzył, kto i kiedy ją włączył lub wyłączył oraz w którym środowisku. Dzięki temu zespół nie musi przeszukiwać kodu wielu aplikacji, aby ustalić, czy dana funkcja jest aktywna.

## 2. Jaki problem rozwiązuje

W organizacjach, w których jedna funkcja obejmuje kilka aplikacji (np. część widoczną dla użytkownika, zwaną frontendem, oraz część serwerową, zwaną backendem), stan flag bywa rozproszony. Jedna aplikacja może mieć flagę włączoną, a druga wyłączoną. Skutek jest trudny do zauważenia: funkcja przestaje być dostępna dla użytkowników, mimo że „z punktu widzenia jednej aplikacji flaga jest włączona”.

ShipScope Flags ogranicza to ryzyko na trzy sposoby:

1. Wszystkie flagi i ich stany są widoczne w jednym miejscu.
2. Aplikacja pilnuje kolejności włączania flag i zależności między nimi.
3. Aplikacja ostrzega, zanim flaga zostanie usunięta w sposób, który mógłby niezauważenie wyłączyć jakąś funkcję.

## 3. Podstawowe pojęcia

**Flaga.** Nazwany przełącznik, np. `b2cCustomersEnabled`. Każda flaga ma opis, twórcę oraz stan w każdym ze środowisk.

**Środowisko.** Osobna kopia systemu, w której funkcja jest sprawdzana na kolejnych etapach. W aplikacji występują trzy środowiska, ułożone od najmniej do najbardziej krytycznego:

- **Test** – pierwsze sprawdzenie przez zespół techniczny,
- **QA** – kontrola jakości,
- **Prod** (produkcja) – środowisko, z którego korzystają prawdziwi użytkownicy.

Ta sama flaga może być włączona na teście, a jednocześnie wyłączona na produkcji. Dzięki temu funkcję można bezpiecznie sprawdzić, zanim zobaczą ją użytkownicy.

**Serwis.** Pojedyncza aplikacja lub usługa (np. frontend sklepu, interfejs API zamówień), która korzysta z flag. Flagę można przypisać do jednego lub kilku serwisów.

**Typ flagi.** Każda flaga jest jednego z dwóch typów:

- **Release (wydaniowa)** – krótkotrwała, związana z konkretnym wdrożeniem nowej funkcji. Po pełnym wdrożeniu powinna zostać usunięta.
- **Feature (funkcjonalna)** – może istnieć dłużej, np. do stałego sterowania zachowaniem produktu.

Różnica ma znaczenie praktyczne: aplikacja wskazuje jako „kandydata do usunięcia” wyłącznie flagi wydaniowe (patrz punkt 5).

**Właściciel, tagi i termin przeglądu.** Każda flaga ma osobę odpowiedzialną („Owner”), dowolne etykiety („Tags”, np. nazwę obszaru: `charger`, `b2c`) oraz opcjonalną datę przeglądu („Review by”). Po przekroczeniu tej daty flaga otrzymuje ostrzeżenie „review overdue”. Dzięki temu każda flaga ma opiekuna i nie zostaje zapomniana.

**Etap życia flagi (Stage).** Aplikacja sama określa, na jakim etapie jest flaga, na podstawie jej stanu w środowiskach:

- **new** – wyłączona wszędzie,
- **in testing** – włączona na teście lub QA, ale wyłączona na produkcji,
- **live** – włączona na produkcji,
- **to clean up** – flaga wydaniowa włączona wszędzie dłużej niż próg z ustawień (domyślnie 30 dni); należy ją usunąć.

## 4. Jak działa flaga – przykład

Załóżmy, że zespół wdraża obsługę klientów prywatnych, którą steruje flaga `b2cCustomersEnabled`.

1. Programista tworzy flagę w aplikacji. Na początku jest wyłączona we wszystkich środowiskach.
2. Po wdrożeniu nowego kodu na środowisko testowe flaga zostaje włączona na **Test**. Zespół sprawdza działanie.
3. Jeżeli wszystko działa poprawnie, flaga zostaje włączona na **QA**, gdzie funkcję ocenia dział jakości.
4. Gdy zespół upewni się, że wszystkie elementy (najpierw backend, potem frontend) są wdrożone, flaga zostaje włączona na **Prod**. Od tego momentu funkcję widzą użytkownicy.
5. Po pewnym czasie, gdy funkcja jest stabilna, flaga staje się zbędna i zostaje usunięta razem ze wszystkimi odwołaniami do niej w kodzie.

Każda zmiana stanu jest zapisywana w dzienniku zmian (kto, kiedy, co zmienił).

## 5. Zasady i zabezpieczenia

Aplikacja nie ogranicza się do wyświetlania stanu flag. Egzekwuje też kilka reguł, które chronią przed typowymi błędami.

### 5.1. Kolejność środowisk

Flagi nie można włączyć na wyższym środowisku, jeżeli nie jest włączona na niższym. Kolejność jest stała: **Test → QA → Prod**. Próba włączenia flagi na produkcji, gdy na QA jest wyłączona, kończy się komunikatem wyjaśniającym, co należy zrobić najpierw.

Wyłącza się w odwrotnej kolejności, od góry: **Prod → QA → Test**. Flagi nie można wyłączyć na teście, dopóki jest włączona na QA, ani na QA, dopóki jest włączona na produkcji. Dzięki temu flaga nigdy nie jest włączona na wyższym środowisku, a wyłączona na niższym, a nikt nie wyłączy produkcji przypadkiem, klikając niższe środowisko. Zablokowany przełącznik ma kłódkę i podpowiedź, a każda zablokowana próba trafia do dziennika zmian.

### 5.2. Zależności między flagami

Przy tworzeniu flagi można wskazać inną flagę, którą trzeba włączyć wcześniej (pole „Requires flag”). Typowy przykład: flaga frontendu wymaga flagi backendu. Skutki:

- flagi zależnej nie można włączyć w środowisku, w którym flaga, od której zależy, jest wyłączona,
- flagi nie można wyłączyć, dopóki włączona jest w tym środowisku flaga od niej zależna.

Usługi bez frontendu po prostu nie mają zależności i nie podlegają tej regule.

### 5.3. Kandydat do usunięcia

Flaga wydaniowa, która jest włączona we wszystkich środowiskach dłużej niż 30 dni, zostaje oznaczona jako „candidate for removal” (kandydat do usunięcia). Oznacza to, że jest prawdopodobnie zbędna i zalega w kodzie. To wyłącznie podpowiedź, a nie polecenie usunięcia. Próg 30 dni Admin może zmienić w zakładce „Settings” (sekcja „Removal candidates”); każda zmiana trafia do dziennika zmian.

### 5.4. Wartość z kodu a wartość z serwera

Flaga może być odczytywana przez aplikację na dwa sposoby:

- **runtime** – aplikacja pyta serwer o aktualny stan flagi. Zmiana stanu nie wymaga ponownego wdrożenia aplikacji.
- **build-time** – wartość jest „wpisana na stałe” w kodzie i zmiana wymaga nowego wdrożenia.

Możliwe jest połączenie obu sposobów. Wtedy pierwszeństwo ma wartość z serwera, a wartość z kodu jest zapasową. Powstaje z tego ryzyko: jeżeli flaga zostanie usunięta z serwera, aplikacja zacznie korzystać z wartości z kodu. Gdy ta jest inna niż dotychczasowa (np. wyłączona), funkcja niezauważenie zniknie z aplikacji.

Aby temu zapobiec, dla każdego serwisu w panelu flagi można wskazać sposób odczytu oraz zapisać wartość z kodu dla każdego środowiska. Jeżeli wartość z kodu różni się od stanu na serwerze, flaga otrzymuje ostrzeżenie „build-time ≠ runtime”.

### 5.5. Bezpieczne usuwanie flagi

W panelu flagi znajduje się sekcja „Removing this flag”. Przycisk „Retire flag” jest nieaktywny, dopóki usunięcie flagi mogłoby zmienić zachowanie którejkolwiek aplikacji. Aplikacja wyświetla konkretne powody, np. „w środowisku prod funkcja przełączyłaby się z włączonej na wyłączoną” albo „serwis nadal odczytuje tę flagę z serwera”. Usunięcie jest dozwolone, gdy każdy serwis spełnia jeden z warunków:

- flaga została usunięta z jego kodu (zaznacza się to pola „Flag has been removed from this service's code”),
- po usunięciu flagi serwis wróci do wartości z kodu, która jest taka sama jak obecnie.

Dodatkowo żadna inna flaga nie może od usuwanej zależeć.

### 5.6. Rozjazd między serwisami i flagi wymagające uwagi

Serwis, który pobiera flagi własnym poświadczeniem (punkt 8a), zostawia przy każdym zapytaniu „check-in” dla danego środowiska. Na tej podstawie aplikacja oznacza flagę znaczkiem „drift”, gdy któryś z jej serwisów może używać innej wartości niż ta ustawiona na serwerze:

- serwis czyta flagę z serwera, ale od jej ostatniej zmiany w danym środowisku nie pobrał flag z tego środowiska (zmiana sprzed ponad 5 minut, bo serwisy pobierają flagi co najwyżej co minutę),
- serwis czyta tylko wartość z kodu, a ta różni się od stanu na serwerze.

Środowisko, z którego serwis nigdy nie pobierał flag, nie jest brane pod uwagę, bo serwis może w nim nie działać.

Lista flag jest domyślnie ułożona według tego, co wymaga uwagi („Needs attention first”): najpierw flagi z rozjazdem, potem flagi z wartością z kodu różną od serwera (u serwisów czytających oba źródła), na końcu flagi po terminie przeglądu i kandydaci do usunięcia. Panel flagi wymienia konkretne powody w ramce „Needs attention”. Kolejność „Newest first” przywraca układ od najnowszych.

## 6. Co można robić w aplikacji

**Lista flag (zakładka „Flags”).** Tabela wszystkich flag z następującymi informacjami: nazwa, opis i tagi, typ, etap życia, właściciel, stan w każdym środowisku (ON / OFF), kto i kiedy dodał flagę, kto i kiedy ostatnio zmienił jej stan. Listę można przeszukiwać i filtrować według typu, etapu życia oraz tagu. Przełącznik „By service” pokazuje te same flagi pogrupowane według serwisów: dla każdego serwisu jego flagi, sposób odczytu i stan w środowiskach, ze znaczkiem „drift” tam, gdzie serwis może używać innej wartości.

**Panel szczegółów flagi.** Po kliknięciu wiersza otwiera się panel boczny, w którym można:

- zmienić właściciela, termin przeglądu i tagi (sekcja „Details”),
- włączać i wyłączać flagę w poszczególnych środowiskach (o ile pozwalają na to reguły z punktu 5),
- zobaczyć przypisane serwisy, sposób odczytu flagi i ewentualne rozbieżności wartości,
- sprawdzić, czy flagę można bezpiecznie usunąć,
- przejrzeć ostatnie zmiany tej flagi.

**Tworzenie flag.** Przycisk „Create flag” otwiera formularz z polami: nazwa (klucz), opis, typ, ewentualna flaga wymagana oraz przypisane serwisy.

**Serwisy (zakładka „Services”).** Lista serwisów, które odczytują flagi: liczba przypisanych flag, stan poświadczenia (aktywne, w trakcie wymiany, brak), data ostatniej wymiany i ostatni check-in, czyli kiedy serwis ostatnio pobrał swoje flagi. Admin rejestruje tu nowe serwisy oraz wydaje i wymienia poświadczenia (punkt 8a). Nowe poświadczenie jest pokazywane tylko raz, bo serwer przechowuje wyłącznie jego skrót.

**Dziennik zmian (zakładka „Audit log”).** Pełna historia zmian: kto, kiedy, jaką flagę i w jakim środowisku zmienił. Dziennik można przeszukiwać i filtrować według rodzaju działania; z serwerem wyszukiwanie obejmuje całą historię, a starsze wpisy doczytuje przycisk „Load older entries” (po 50). Wpisy są przechowywane przez 2 lata (zmienna `AUDIT_RETENTION_DAYS`, 0 oznacza bez limitu); starsze serwer usuwa raz na dobę i odnotowuje w dzienniku, ile ich usunął. Wpisuje się do niego także zablokowane próby, np. próbę włączenia flagi na produkcji z pominięciem QA.

**Powiadomienia (zakładka „Settings”).** Można podać adres webhooka (zgodny ze Slackiem). Gdy powiadomienia są włączone, każda zmiana dowolnej flagi na produkcji powoduje wysłanie wiadomości, np. „b2cCustomersEnabled was turned ON in PROD by m.chen”. Wiadomość wysyła serwer, więc dotyczy także zmian wykonanych poza ekranem aplikacji. Przycisk „Send test message” pozwala sprawdzić połączenie. Adres musi zaczynać się od `https://` i nie może wskazywać na adres w sieci wewnętrznej (serwer to sprawdza przy zapisie i przed każdą wysyłką; zmienna `NOTIFY_WEBHOOK_HOSTS` pozwala zawęzić listę dozwolonych hostów lub dopuścić wewnętrzny serwer czatu). Zapisany adres jest poufny, więc aplikacja pokazuje tylko jego początek i koniec. Admin może też włączyć powiadomienia tylko dla wybranej flagi (pole „Notify about prod changes of this flag” w jej panelu); działają one także wtedy, gdy powiadomienia dla wszystkich flag są wyłączone. Nieudaną wysyłkę serwer ponawia dwa razy (po 2 i 10 sekundach), a gdy i to zawiedzie, zapisuje w dzienniku zmian wpis „notification failed” z powodem.

**Motyw jasny i ciemny.** Przycisk z ikoną księżyca lub słońca w nagłówku przełącza wygląd aplikacji. Wybór jest zapamiętywany w przeglądarce.

## 7. Role użytkowników

W prawym górnym rogu widoczny jest przełącznik roli. Do czasu wdrożenia logowania (punkt 9) służy on do pokazania, jak aplikacja wygląda dla poszczególnych osób; uprawnienia ról sprawdza na razie tylko interfejs.

| Rola | Uprawnienia |
| --- | --- |
| Viewer | Wyłącznie podgląd flag i ich stanu. Nie może niczego zmieniać. |
| Editor | Może tworzyć flagi, zmieniać ich stan, zmieniać sposób odczytu przez serwisy i usuwać flagi. |
| Admin | Uprawnienia jak Editor. Dodatkowo rejestruje serwisy i wydaje lub wymienia ich poświadczenia (zakładka „Services”). |

## 8. Uruchomienie aplikacji

Wymagane jest zainstalowane środowisko Node.js. Aplikacja składa się z trzech części w jednym repozytorium (npm workspaces): interfejsu (katalog `frontend`), serwera (katalog główny projektu, NestJS) i wspólnego pakietu z typami, zasadami i danymi przykładowymi (`packages/shared`). Jedno `npm install` w katalogu głównym instaluje wszystko.

**Sam interfejs (tryb demonstracyjny, dane przykładowe):**

```bash
npm install            # tylko przy pierwszym uruchomieniu, w katalogu głównym
npm run dev -w frontend
```

**Interfejs wraz z serwerem (dane zapisywane trwale w PostgreSQL):**

```bash
# terminal 1 – baza danych i serwer, w katalogu głównym projektu (wymaga Dockera)
cp .env.example .env      # tylko przy pierwszym uruchomieniu
docker compose up -d db   # PostgreSQL
npm install               # tylko przy pierwszym uruchomieniu
npm run db:deploy         # tworzy tabele (migracje)
npm run build && npm run db:seed   # opcjonalnie: dane przykładowe, tylko do pustej bazy
npm run start:dev         # nasłuchuje na porcie 3000

# terminal 2 – interfejs
npm run dev -w frontend   # zapytania /api są automatycznie kierowane do serwera
```

**Całość w Dockerze (baza, migracje z danymi przykładowymi, serwer i interfejs):**

```bash
docker compose up --build -d   # interfejs pod http://localhost:8080
docker compose down            # zatrzymanie; z opcją -v usuwa też bazę
```

Bez Dockera, po uruchomieniu w terminalu pojawi się adres interfejsu, zwykle `http://localhost:5173`. Po jego otwarciu należy wybrać przycisk „Open the dashboard”. Logowania jeszcze nie ma, więc ekran niczego nie sprawdza i mówi o tym wprost (punkt 9).

Wersję produkcyjną interfejsu buduje się poleceniem `npm run build` w katalogu `frontend`, a serwer poleceniem `npm run build` w katalogu głównym.

## 8a. Odczyt flag przez inne aplikacje (API)

Serwer udostępnia adres, z którego aplikacje (serwisy) mogą pobierać aktualny stan flag:

```
GET /api/v1/sdk/flags?env=prod
Authorization: Bearer <poświadczenie serwisu>
```

Odpowiedź ma postać: `{ "env": "prod", "flags": { "allowEvseNameEdit": true, "b2cCustomersEnabled": false } }` i zawiera tylko flagi przypisane do serwisu, który wysłał zapytanie. Każdy serwis ma własne poświadczenie. Admin rejestruje serwis i wydaje lub wymienia jego poświadczenie w zakładce „Services”; poświadczenie jest pokazywane tylko raz. Po wymianie stare poświadczenie działa jeszcze przez 24 godziny, a „Revoke & reissue” unieważnia je od razu (np. po wycieku). Każde zapytanie serwisu jest zapisywane jako jego „check-in”, widoczny w tej samej zakładce.

Pełny opis kontraktu, kodów błędów i zalecanego zachowania klienta (pamięć podręczna, praca przy niedostępnym serwerze) jest w pliku `docs/sdk-api.md`, a jego specyfikacja OpenAPI 3.1 w `docs/sdk-api.openapi.json`. Serwisy w Node.js mogą użyć gotowego klienta z katalogu `sdk/` (opis w `sdk/README.md`). Wspólny token `SDK_TOKEN` z wersji 0.3 nadal działa, ale jest przestarzały.

Serwer przechowuje dane w bazie PostgreSQL wskazanej zmienną `DATABASE_URL`. Dane z pliku `data/state.json` używanego przez wersje przed 0.2.0 można przenieść do pustej bazy poleceniem `npm run db:import -- data/state.json`. Zasady opisane w punkcie 5 są egzekwowane także po stronie serwera, więc nie da się ich ominąć wywołaniem API. Domyślny adres webhooka powiadomień można podać zmienną `NOTIFY_WEBHOOK_URL`.

Adres `GET /api/health` pozwala sprawdzić, czy serwer działa i ma połączenie z bazą (odpowiedź 200, a przy niedostępnej bazie 503). Serwer ogranicza liczbę zapytań z jednego adresu: domyślnie 300 na minutę do API zarządzania i 600 na minutę do odczytu flag przez serwisy (zmienne `RATE_LIMIT_PER_MINUTE` i `RATE_LIMIT_SDK_PER_MINUTE`). Po przekroczeniu limitu odpowiada kodem 429 z nagłówkiem `Retry-After`. Gdy serwer stoi za serwerem pośredniczącym (np. nginx), zmienna `TRUST_PROXY` wskazuje, któremu ufać przy ustalaniu adresu klienta.

## 9. Ograniczenia obecnej wersji

- Bez uruchomionego serwera aplikacja korzysta z **danych przykładowych** (plik `packages/shared/src/seed.ts`), a zmiany znikają po odświeżeniu strony. Z serwerem zapisywane są wszystkie zmiany: stan flag na środowiskach, tworzenie, edycja szczegółów i sposobu odczytu, usuwanie flag, ustawienia powiadomień i dziennik zmian. Gdy serwer odrzuci zmianę (np. z powodu zasad z punktu 5), aplikacja pokazuje powód i nie zmienia stanu.
- Serwer nie ma jeszcze uwierzytelniania użytkowników (uwierzytelniane są tylko serwisy odczytujące flagi); nie należy wystawiać go poza zaufaną sieć.
- Typy, zasady z punktu 5 i dane przykładowe są we wspólnym pakiecie `packages/shared`, z którego korzystają i interfejs, i serwer. Interfejs czyta jego źródła wprost; serwer korzysta z wersji skompilowanej, którą `npm install` i polecenia `npm run build`/`npm test` budują same. Przy pracy nad serwerem z `npm run start:dev` zmiany w pakiecie kompiluje na bieżąco `npm run dev -w @shipscope/shared`.
- Role (Viewer, Editor, Admin) wybiera się przełącznikiem w interfejsie, a autora zmiany w dzienniku podaje interfejs. Serwer nie sprawdza jeszcze, kto wywołuje API zarządzania.
- Poświadczeń serwisów nie da się wydać w trybie demonstracyjnym, bo wydaje je serwer.
- **Usunięcie flagi** („Retire flag”) usuwa ją z ShipScope Flags, także z odpowiedzi `GET /api/v1/sdk/flags`. Usunięcie odwołań w kodzie serwisów pozostaje po stronie zespołu.
- **Wartości z kodu** (build-time) są wprowadzane ręcznie, ponieważ aplikacja nie ma wglądu w kod serwisów. Wymagają one aktualizacji przy zmianach w kodzie.
- Logowania jednokrotnego (SSO) i dostępu awaryjnego (break-glass) jeszcze nie ma: ekran startowy niczego nie sprawdza i informuje o tym. Każdy, kto otworzy aplikację, może jej używać i wybrać dowolną rolę.

## 10. Słowniczek

| Pojęcie | Znaczenie |
| --- | --- |
| Flaga (feature flag) | Przełącznik włączający lub wyłączający funkcję aplikacji. |
| Środowisko | Osobna instancja systemu: test, QA lub produkcja. |
| Produkcja (prod) | Środowisko używane przez prawdziwych użytkowników. |
| Frontend | Część aplikacji widoczna dla użytkownika. |
| Backend | Część serwerowa, wykonująca operacje w tle. |
| Wdrożenie (deploy) | Wgranie nowej wersji aplikacji na środowisko. |
| Runtime | Odczyt wartości flagi z serwera w trakcie działania aplikacji. |
| Build-time | Wartość flagi zapisana w kodzie w chwili budowania aplikacji. |
| Dziennik zmian (audit log) | Rejestr wszystkich zmian wraz z autorem i datą. |
| Webhook | Adres, pod który aplikacja wysyła wiadomość, np. do Slacka, gdy zdarzy się zmiana. |
| API | Sposób, w jaki jedna aplikacja komputerowo pobiera dane z innej. |
