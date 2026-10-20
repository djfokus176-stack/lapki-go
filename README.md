# Łapki GO 0.4 — psy i koty (aktualizacja 0.2/0.3)

Aplikacja PWA na telefon: **psy + koty**, aparat na żywo, lokalne wykrywanie gatunku przez COCO-SSD, nazwy i opisy, prywatna kolekcja, mapa spotkań, punkty i kopie zapasowe. **Brak kont i publikacji zdjęć.**

## Nowości w 0.4

- W zakładce **Złap** wybierz **🐶 Pies** lub **🐱 Kot** przed otwarciem aparatu. Model AI musi wykryć *wybrany* gatunek.
- Każdy zapis otrzymuje gatunek; na karcie kolekcji widać oznaczenie pies/kot, a na mapie odpowiednią ikonkę.
- Osobne liczniki psów i kotów, łączne punkty, filtr **Wszystkie / Psy / Koty** oraz wyszukiwanie.
- Dotychczasowe dane pozostają pod tą samą nazwą bazy **`lapki-go-v1`**, w tym samym magazynie **`dogs`**. Stare rekordy bez gatunku automatycznie traktujemy jako **psy** — nie usuwamy ani nie przepisujemy bazy.
- Działa także aktualizacja **0.2 → 0.4**: zawiera dodatki wersji 0.3 (wpisywanie miejsca, edycja i pinezka na mapie, notatka, kopie danych, utrudnienia duplikatów).
- Plik kopii zapasowej nowej wersji ma format **v2**, a import obsługuje **v1 (stare psy)** i **v2 (psy i koty)**.
- Poprawiona reakcja na przeglądarki bez obsługi aparatu — przycisk nie zostaje na stałe nieaktywny.

## Jak zaktualizować GitHub

1. **W starej aplikacji** otwórz **Opcje → Pobierz kopię**. Schowaj bezpiecznie pobrany plik JSON; może zawierać lokalizacje.
2. Rozpakuj `Lapki_GO_psy_i_koty_v0_4.zip` na komputerze.
3. Wejdź na https://github.com/djfokus176-stack/lapki-go i wybierz **Add file → Upload files**.
4. Przenieś **zawartość** ZIP, a nie ZIP jako jeden plik. Zastąp pliki o tych samych nazwach. Upewnij się, że `index.html` oraz `app.js` są w głównym katalogu repozytorium (obok siebie), a obrazy w `icons/`.
5. Kliknij **Commit changes**, odczekaj na publikację GitHub Pages. Otwórz https://djfokus176-stack.github.io/lapki-go/ i upewnij się, że nagłówek pokazuje **Wersja testowa 0.4**.
6. Nie czyść danych strony ani nie odinstalowuj aplikacji przed pobraniem kopii. Korzystaj z tej samej przeglądarki i adresu, żeby zobaczyć starą kolekcję.

## Ważne ograniczenia

- AI rozpoznaje **kategorię** pies/kot, lecz może pomylić zdjęcie na ekranie lub maskotkę z żywym zwierzęciem. Nie rozpoznaje tożsamości konkretnego psa/kota i nie filtruje wiarygodnie drastycznych treści.
- Zdjęcia pozostają lokalne. Nie publikuj zdjęć ludzi ani lokalizacji cudzych zwierząt. Nigdy nie podchodź do obcych zwierząt tylko po to, by zrobić zdjęcie.
- Model AI i mapa przy pierwszym użyciu wymagają internetu. Mapa korzysta z publicznych kafelków OSM; automatyczna nazwa miejsca z Nominatim — oba publiczne serwisy nadają się tu tylko do małych testów zgodnie z ich zasadami.
- Lokalna baza może zostać wyczyszczona przez telefon lub przeglądarkę, więc zapisuj kopię.
- Moduł zaginionych psów i kotów jest tylko zapowiedzią. Brak rzeczywistej funkcji zgłoszeń.
- Nie jest to wersja publicznej gry społecznościowej; punkty można oszukać, a skuteczność detekcji trzeba ocenić na telefonie.

## Przeprowadzone testy

- `node --check app.js` — składnia JavaScript.
- Test w Chromium na rozmiarze telefonu z przykładowymi rekordami (bez prawdziwej kamery): wybór gatunku, filtry, karty, liczniki i obsługa starszych rekordów bez `species`.
- Test ścieżki zapisu kota z symulowanym wynikiem AI `cat` i nazwą miejscowości.
- Rzeczywisty aparat i detekcja na urządzeniu nie były sprawdzane.
