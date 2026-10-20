# Łapki GO v0.6 — psy, koty, galerie, GPS i misje spacerowe

**Darmowa, prywatna aplikacja PWA — bez własnego serwera i logowania.** Repozytorium użytkownika: https://github.com/djfokus176-stack/lapki-go

## Funkcje w 0.5 (zawarte też w 0.6)

- **Misje spacerowe:** 15 min (+15 XP), 30 min (+35 XP) i 45 min (+60 XP). Jedna misja dziennie może przyznać XP. Pozostałe można wykonywać dla zabawy. Wirtualne poziomy, odznaki, osobisty rekord i możliwość udostępnienia **samego wyniku tekstem**.
- **Spacer bez zwierząt:** nie trzeba fotografować psa ani kota, żeby uruchomić misję.
- **Zdjęcia z galerii:** JPG / PNG / WebP do 12 MB; normalizowane do JPEG 1024 px (bez EXIF). Rozpoznawanie psa/kota jak przy zdjęciu z aparatu, ale **0 XP za zdjęcie z galerii**. W galerii wyłączamy aktualny GPS, żeby starej fotografii nie przypisać miejsca dzisiejszego pobytu; nazwę miejscowości można wpisać ręcznie lub dodać punkt na mapie.
- **Test GPS bez zwierzęcia:** Opcje → „Sprawdź mój GPS”. Wynik testu nie jest zapisywany ani wysyłany.
- **Kopia zapasowa v3:** zawiera również historię misji. Import akceptuje starsze kopie v1 i v2.
- **Zgodność:** baza `lapki-go-v1` i magazyn `dogs` nie zostały zmienione. Wcześniejsze zdjęcia (np. Borys) powinny pozostać w pamięci przeglądarki. Serwis worker przechodzi na v5, a pliki JS i CSS dostały numer wersji w URL dla łatwiejszej aktualizacji.
- **Brak chmury i publicznej galerii:** zdjęcia pozostają na telefonie. Udostępnianie wyniku nie przesyła fotografii ani GPS.

**Uwaga:** minutnik liczy upływ czasu od rozpoczęcia, a nie udowadnia, że ktoś spacerował. Po zablokowaniu telefonu można wrócić do rozpoczętej misji; nie działa jednak monitorowanie ruchu w tle. Punkty i odznaki są lokalne, więc NIE nadają się jeszcze do uczciwych rankingów z nagrodami.

## Aktualizacja na GitHub Pages — bez programowania

1. **Przed aktualizacją:** otwórz obecną aplikację na telefonie w tej samej przeglądarce i wybierz **Opcje → Pobierz kopię**. Zachowaj plik JSON prywatnie (zawiera zdjęcia i potencjalnie GPS).
2. Rozpakuj ZIP z v0.5 i skopiuj **wszystkie pliki i folder `icons` z wnętrza archiwum**.
3. Wejdź na https://github.com/djfokus176-stack/lapki-go → **Add file → Upload files**. Nie wysyłaj ZIP jako jednego pliku. Przenieś zawartość archiwum, zastąp stare pliki o tych samych nazwach, a na dole zatwierdź **Commit changes**.
4. W https://github.com/djfokus176-stack/lapki-go/actions poczekaj, aż `pages build and deployment` ma zielony status.
5. Otwórz https://djfokus176-stack.github.io/lapki-go/ w Chrome/Safari i poszukaj napisu **Wersja testowa 0.6**. Jeśli widzisz starą, odśwież/otwórz stronę na nowej karcie, ale **nie czyść danych strony**, zanim nie masz kopii.

## Instalacja jak aplikacja

- **Android:** otwórz link bezpośrednio w Chrome, a nie tylko w przeglądarce wewnątrz komunikatora. Menu ⋮ → **Zainstaluj aplikację** lub **Dodaj do ekranu głównego**.
- **iPhone:** Safari → Udostępnij → **Do ekranu początkowego**.
- PWA korzysta z funkcji telefonu, bez opłaty za Google Play czy App Store. Nie jest jeszcze aplikacją w sklepie.

## Co jest NIEgotowe?

- **Nie ma serwera ani wspólnych rankingów**, brak kont i synchronizacji między telefonami.
- **Nie ma moderacji drastycznych zdjęć** ani publicznej galerii. Nie uruchamiać publicznych uploadów, zanim nie powstanie niezależna moderacja i procedury obsługi zgłoszeń.
- **Rozpoznawanie AI może się mylić.** Potrafi zaakceptować zdjęcie zwierzęcia na ekranie. Wykrywanie gatunku lokalnie wymaga załadowania bibliotek i modelu z sieci (CDN).
- **Nie ma pewnego wykrywania oszustw ani zweryfikowanego spaceru.** Nie wprowadzać nagród materialnych ani konkursów na tym systemie punktów.
- Lokalne dane mogą zostać usunięte przy czyszczeniu pamięci przeglądarki lub przez system. **Regularnie eksportuj kopię.**
- Mapa używa kafelków OSM, a nazwa miejscowości może być pobrana z Nominatim **tylko po zaznaczeniu zgody GPS**. Darmowe serwisy mapowe mają ograniczenia użytkowania.

## Co dalej: bezpieczny serwer

1. Supabase Free: konta (Auth), Postgres z RLS i *prywatne* zdjęcia w Storage. Wymaga podłączenia konta przez właściciela projektu; **nie dołączać kluczy administratora do JS**.
2. Najpierw prywatne kopie w chmurze dla zalogowanych użytkowników. Upload ograniczony wielkością i liczbą plików, z walidacją na serwerze oraz bez publicznych adresów plików.
3. Dopiero potem publiczne funkcje: **kwarantanna przed publikacją, skanowanie typów plików i treści, moderacja, zgłoszenia, blokady, odwołania, usuwanie danych, ochrona wizerunku, ograniczenie lokalizacji**. Żaden filtr nie gwarantuje 100% ochrony.
4. Rankingi tylko po serwerowej walidacji punktów; i tak brak pewnej atestacji spacerów w samej PWA.

## Testy techniczne

Sprawdzono składnię JS (`node --check`), spójność plików, przeglądarkowy test interfejsu z symulowanymi danymi (misje i XP, wybór zdjęcia, brak punktów za galerię, brak błędów JS w teście). **Nie przetestowano faktycznego GPS, aparatu ani COCO-SSD na prawdziwym Androidzie/iPhonie.**

## Aktualizacja 0.6
- Licznik dystansu GPS, czas marszu, przeciętna prędkość i przybliżona suma KM w historii misji. Suma jest przechowywana bez mapy trasy. W tle pomiar GPS może stanąć.
- Lokalny formularz zgłoszenia zdjęcia + jego zasłonięcie. Dopóki nie ma backendu, raport **nie trafia do moderatora**.
- `supabase/schema.sql` to propozycja zabezpieczonego schematu, jeszcze bez integracji aplikacji.
- Czytaj `INSTRUKCJA_START.md`.
