# Łapki GO v0.2 — aplikacja gotowa do wgrania na GitHub Pages

**To wersja prywatna / testowa.** Nie jest to publiczna gra społecznościowa. Nie ma kont, serwera, rankingów, zaginionych psów ani niezawodnej moderacji drastycznych treści. Zdjęcia i GPS przechowuje tylko na Twoim urządzeniu (IndexedDB).

## Uruchomienie na GitHubie — bez programowania
1. Rozpakuj ZIP w Windows (prawy przycisk → **Wyodrębnij wszystkie**).
2. GitHub → `https://github.com/new` → nazwa `lapki-go`, Public, bez dodatkowych plików → **Create repository**.
3. W repozytorium wybierz **uploading an existing file** (lub **Add file → Upload files**). PRZECIĄGNIJ ZAWARTOŚĆ rozpakowanego folderu (np. `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, folder `icons`) — nie sam ZIP ani nadrzędny folder. Sprawdź, czy `index.html` jest w katalogu głównym. **Commit changes**.
4. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main → /(root) → Save.**
5. Otwórz adres podany przez GitHub Pages: `https://TWOJ_LOGIN.github.io/lapki-go/`. Uprawnienia do aparatu i GPS działają przez HTTPS.
6. Android: Chrome → menu → **Dodaj do ekranu głównego / Zainstaluj**. iPhone: Safari → Udostępnij → **Do ekranu początkowego**.

## Funkcje
- Zdjęcia z aparatu na żywo, bez wyboru zdjęć z galerii do gry.
- Darmowy COCO-SSD: wykrywanie kategorii `dog`; próba zablokowania osób rozpoznanych w kadrze. **Żaden filtr nie gwarantuje skuteczności.**
- Lokalna kolekcja z imionami i punktami, sprawdzanie identycznych plików oraz bardzo podobnych kadrów.
- Opcjonalny GPS i prywatna mapa spotkań na Leaflet/OSM. Oglądany obszar mapy może być widoczny dla dostawcy kafelków.
- Eksport i przywracanie kopii JSON w zakładce **Opcje**; backup zawiera zdjęcia i potencjalnie dokładne GPS, dlatego nie publikuj go.
- Tryb testowego zapisu zdjęcia bez AI: 0 pkt (gdy AI nie działa).

## Koszty i ograniczenia
Kod działa bez własnego serwera i opłat początkowych. Biblioteki AI i kafelki map pobierają się z zewnętrznych usług. To prototyp do niewielkich testów, nie skalowana usługa publiczna. Dane lokalne mogą zniknąć przy czyszczeniu przeglądarki — zrób kopię zapasową. GitHub Pages na darmowym planie wymaga publicznego repozytorium. Nie używaj Pages jako docelowego hostingu płatnej usługi.

Bezpieczeństwo w terenie: pytaj o zgodę, nie podchodź do obcych psów i nie fotografuj ludzi. Brak możliwości niezawodnego odróżnienia żywego psa od zdjęcia psa na innym ekranie. Wykrywanie drastycznych treści nie jest zaimplementowane, dlatego zdjęcia nie są upubliczniane.
