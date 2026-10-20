# Łapki GO 0.6 — szybki start

**Z GitHuba nadal może być wyświetlana wersja 0.4.** Żeby uruchomić 0.6, wyślij ROZPAKOWANE pliki do repozytorium `djfokus176-stack/lapki-go`, NIE sam ZIP. Zrób kopię danych w starym programie **Opcje → Pobierz kopię**.

1. Wgraj na GitHub: `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md`, `INSTRUKCJA_START.md` oraz folder `icons/`. Folder `supabase/` jest opcjonalny i nie uruchamia serwera.
2. GitHub → repo `lapki-go` → Add file → Upload files → Commit changes. Nie tworzymy drugiego katalogu `lapki_go_v06` w repo.
3. Poczekaj na zielony status GitHub Actions → pages build and deployment, potem otwórz https://djfokus176-stack.github.io/lapki-go/
4. Jeżeli widzisz 0.4, odśwież/ponownie otwórz PWA. Nie usuwaj danych witryny — stracisz zdjęcia bez kopii zapasowej.
5. W menu **🎯 Misje** wybierz Spacer swobodny albo misję 15, 30 lub 45 min, zezwól na GPS, a następnie podczas spaceru obserwuj orientacyjne KM i czas. **Przy zablokowanym ekranie śledzenie km może stanąć** — przeglądarka nie jest GPS trackerem w tle. Nie używaj telefonu podczas przechodzenia przez drogę.
6. Przy zdjęciu możesz wybrać **⚑ Zgłoś**, ale obecnie zapisuje to TYLKO LOKALNY raport i zasłania fotografię w twojej kolekcji. Żadne zgłoszenie nie trafia do zewnętrznego moderatora.

## Android / iOS
- Android: Chrome → otwórz adres → menu ⋮ → **Zainstaluj aplikację** / **Dodaj do ekranu głównego**.
- iPhone: Safari → otwórz adres → Udostępnij → **Do ekranu początkowego**.
- Nie trzeba tworzyć APK/IPA do użytkowania w ten sposób. Publikacja w sklepach jest osobnym etapem.

## Supabase (NIE PODŁĄCZONE)
- Zarejestruj konto na https://supabase.com i utwórz projekt Free w regionie UE.
- `supabase/schema.sql` to przygotowany szkic tabel, ale NIE tworzy kont ani nie synchronizuje zdjęć.
- Przed podłączeniem klientów trzeba wdrożyć Auth, prywatny bucket, Storage RLS, regulamin, politykę prywatności i realny system moderacji.
- **NIGDY** nie wklejaj do publicznego repo klucza `service_role`, `sb_secret_` ani haseł DB. Klucz publiczny anon/publishable i URL można umieścić w aplikacji dopiero z prawidłowym RLS i ograniczeniami.

## Znane ograniczenia
- Odległość GPS jest orientacyjna; wykrywamy duże skoki i niedokładne pomiary, ale nie wszystko.
- Tylko czas od startu misji nie dowodzi marszu. Wspólne rankingi nie są wiarygodne, dopóki nie ma kontroli po stronie serwera.
- Zdjęcia i odznaki są lokalne na konkretnym urządzeniu. Brak wspólnej bazy, publikacji zdjęć ani możliwości naprawdę przesłania zgłoszenia moderatorowi.
