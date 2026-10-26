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

**Flaga.** Nazwany przełącznik, np. `new-checkout-flow`. Każda flaga ma opis, twórcę oraz stan w każdym ze środowisk.

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

## 4. Jak działa flaga – przykład

Załóżmy, że zespół wdraża nowy proces zakupowy o nazwie `new-checkout-flow`.

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

### 5.2. Zależności między flagami

Przy tworzeniu flagi można wskazać inną flagę, którą trzeba włączyć wcześniej (pole „Requires flag”). Typowy przykład: flaga frontendu wymaga flagi backendu. Skutki:

- flagi zależnej nie można włączyć w środowisku, w którym flaga, od której zależy, jest wyłączona,
- flagi nie można wyłączyć, dopóki włączona jest w tym środowisku flaga od niej zależna.

Usługi bez frontendu po prostu nie mają zależności i nie podlegają tej regule.

### 5.3. Kandydat do usunięcia

Flaga wydaniowa, która jest włączona we wszystkich środowiskach dłużej niż 30 dni, zostaje oznaczona jako „candidate for removal” (kandydat do usunięcia). Oznacza to, że jest prawdopodobnie zbędna i zalega w kodzie. To wyłącznie podpowiedź, a nie polecenie usunięcia.

### 5.4. Wartość z kodu a wartość z serwera

Flaga może być odczytywana przez aplikację na dwa sposoby:

- **runtime** – aplikacja pyta serwer o aktualny stan flagi. Zmiana stanu nie wymaga ponownego wdrożenia aplikacji.
- **build-time** – wartość jest „wpisana na stałe” w kodzie i zmiana wymaga nowego wdrożenia.

Możliwe jest połączenie obu sposobów. Wtedy pierwszeństwo ma wartość z serwera, a wartość z kodu jest zapasową. Powstaje z tego ryzyko: jeżeli flaga zostanie usunięta z serwera, aplikacja zacznie korzystać z wartości z kodu. Gdy ta jest inna niż dotychczasowa (np. wyłączona), funkcja niezauważenie zniknie z aplikacji.

Aby temu zapobiec, dla każdego serwisu w panelu flagi można wskazać sposób odczytu oraz zapisać wartość z kodu dla każdego środowiska. Jeżeli wartość z kodu różni się od stanu na serwerze, flaga otrzymuje ostrzeżenie „build-time ≠ runtime”.

### 5.5. Bezpieczne usuwanie flagi

W panelu flagi znajduje się sekcja „Removing this flag”. Przycisk „Retire flag” jest nieaktywny, dopóki usunięcie flagi mogłoby zmienić zachowanie którejkolwiek aplikacji. Aplikacja wyświetla konkretne powody, np. „w środowisku prod funkcja przełączyłaby się z włączonej na wyłączoną” albo „serwis nadal odczytuje tę flagę z serwera”. Usunięcie jest dozwolone, gdy każdy serwis spełnia jeden z warunków:

- flaga została usunięta z jego kodu (zaznacza się to w polu „Flag has been removed from this service's code”),
- po usunięciu flagi serwis wróci do wartości z kodu, która jest taka sama jak obecnie.

Dodatkowo żadna inna flaga nie może od usuwanej zależeć.

## 6. Co można robić w aplikacji

**Lista flag (zakładka „Flags”).** Tabela wszystkich flag z następującymi informacjami: nazwa i opis, typ, stan w każdym środowisku (ON / OFF), kto i kiedy dodał flagę, kto i kiedy ostatnio zmienił jej stan. Listę można przeszukiwać i filtrować według typu.

**Panel szczegółów flagi.** Po kliknięciu wiersza otwiera się panel boczny, w którym można:

- włączać i wyłączać flagę w poszczególnych środowiskach (o ile pozwalają na to reguły z punktu 5),
- zobaczyć przypisane serwisy, sposób odczytu flagi i ewentualne rozbieżności wartości,
- sprawdzić, czy flagę można bezpiecznie usunąć,
- przejrzeć ostatnie zmiany tej flagi.

**Tworzenie flag.** Przycisk „Create flag” otwiera formularz z polami: nazwa (klucz), opis, typ, ewentualna flaga wymagana oraz przypisane serwisy.

**Dziennik zmian (zakładka „Audit log”).** Pełna historia zmian: kto, kiedy, jaką flagę i w jakim środowisku zmienił. Dziennik można przeszukiwać i filtrować według rodzaju działania. Wpisuje się do niego także zablokowane próby, np. próbę włączenia flagi na produkcji z pominięciem QA.

**Motyw jasny i ciemny.** Przycisk z ikoną księżyca lub słońca w nagłówku przełącza wygląd aplikacji. Wybór jest zapamiętywany w przeglądarce.

## 7. Role użytkowników

W prawym górnym rogu widoczny jest przełącznik roli. W wersji demonstracyjnej służy on do pokazania, jak aplikacja wygląda dla poszczególnych osób.

| Rola | Uprawnienia |
| --- | --- |
| Viewer | Wyłącznie podgląd flag i ich stanu. Nie może niczego zmieniać. |
| Editor | Może tworzyć flagi, zmieniać ich stan, zmieniać sposób odczytu przez serwisy i usuwać flagi. |
| Admin | W obecnej wersji uprawnienia takie same jak Editor. |

## 8. Uruchomienie aplikacji

Wymagane jest zainstalowane środowisko Node.js. Aplikacja znajduje się w katalogu `frontend`.

```bash
cd frontend
npm install        # tylko przy pierwszym uruchomieniu
npm run dev        # uruchomienie w trybie deweloperskim
```

Po uruchomieniu w terminalu pojawi się adres, zwykle `http://localhost:5173`. Po jego otwarciu należy wybrać przycisk „Continue with single sign-on”. W wersji demonstracyjnej logowanie jest symulowane i nie wymaga żadnych danych.

Wersję produkcyjną buduje się poleceniem `npm run build`, a jej podgląd uruchamia `npm run preview`.

## 9. Ograniczenia obecnej wersji

- Aplikacja korzysta z **danych przykładowych** (plik `frontend/src/data/mock.ts`). Próbuje połączyć się z serwerem pod adresem `/api`, a gdy ten nie odpowiada, używa danych przykładowych. Zmiany wykonywane w interfejsie nie są zapisywane trwale i znikają po odświeżeniu strony.
- **Usunięcie flagi** („Retire flag”) usuwa ją tylko z aplikacji. Usunięcie odwołań w kodzie oraz flagi z serwera pozostaje po stronie zespołu.
- **Wartości z kodu** (build-time) są wprowadzane ręcznie, ponieważ aplikacja nie ma wglądu w kod serwisów. Wymagają one aktualizacji przy zmianach w kodzie.
- Logowanie jednokrotne (SSO) jest w tej wersji tylko odwzorowane wizualnie.

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