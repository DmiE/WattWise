# WattWise - MVP

## Główny problem

Amatorski kolarz który chce trenować efektywniej nie wie jak przełożyć swoje dane (FTP, dostępny czas, cel) na konkretny plan treningowy z precyzyjnymi wartościami mocy lub tętna. Istniejące aplikacje jak Strava czy Garmin Connect świetnie śledzą aktywność, ale nie mówią użytkownikowi **co dokładnie ma dziś jechać i z jaką intensywnością**. Drugi problem to serwisowanie rowerów — przy kilku rowerach łatwo zapomnieć kiedy ostatnio wymieniono łańcuch lub co zaczęło skrzypieć podczas ostatniej jazdy.

---

## Najmniejszy zestaw funkcjonalności

### Onboarding i profil użytkownika

- Rejestracja i logowanie (email + hasło)
- Onboarding zbierający dane niezbędne do generowania planu:
  - Dane podstawowe: wiek, płeć, waga
  - Poziom zaawansowania i historia treningowa (jak długo jeździsz, ile godzin tygodniowo ostatnio)
  - Cel treningowy (jeden z trzech: Kondycja i zdrowie / Wytrzymałość / Szybkość i wyścigi)
  - Dostępny sprzęt pomiarowy (miernik mocy / pulsometr / brak)
  - FTP w watach (jeśli znane) lub wartość szacunkowa na start
  - Dostępność w tygodniu: ile dni, które dni, maks czas treningu w dni robocze i weekend

### Moduł treningowy (core)

- Generowanie tygodniowego planu treningowego przez AI na podstawie profilu użytkownika
- Plan zawiera konkretne sesje z:
  - Typem treningu (interwały, wytrzymałość, regeneracja)
  - Czasem trwania
  - Wartościami intensywności dopasowanymi do sprzętu:
    - Miernik mocy → wartości w watach (np. 5x5min @ 280W)
    - Pulsometr → strefy tętna (np. 30min w strefie 3)
    - Brak sprzętu → opisowe RPE (np. "jedź spokojnie, po 20min zwiększ tempo do odczuwalnego wysiłku przez 5 minut")
- Oznaczanie treningu jako: wykonany / przeniesiony / pominięty
- Przy oznaczaniu jako wykonany użytkownik uzupełnia:
  - Rzeczywisty czas trwania
  - Subiektywna ocena realizacji planu (100% / częściowo / nie udało się)
  - Wybór roweru z dropdowna
  - Przejechane kilometry
- Przeniesienie treningu na inny dzień w tym tygodniu
- Historia wykonanych treningów

### Test FTP i aktualizacja planu

- Przypomnienie o teście FTP co 6-8 tygodni
- Po wprowadzeniu nowego wyniku FTP aplikacja automatycznie przelicza wartości mocy/tętna w przyszłych treningach (z molzliwą zmianą celu, liczby dostepnych godzin)

### Moduł garażowy (dodatek)

- Lista rowerów z podstawowymi danymi: nazwa, typ, marka/model, rok, waga, zdjęcie, status aktywny/nieaktywny
- Liczniki komponentów z progami alertów (edytowalnymi przez użytkownika):
  - Łańcuch
  - Kaseta
  - Opony przód/tył
  - Hamulce (klocki lub liny)
- Automatyczna aktualizacja liczników na podstawie kilometrów wpisanych przy oznaczaniu treningu
- Alert w aplikacji gdy licznik zbliża się do progu serwisowego
- Dziennik serwisowy: data, opis wykonanej czynności, przebieg przy serwisie, reset licznika
- Szybkie notatki "coś skrzypi": krótki opis problemu, wybór roweru, status (zgłoszone / naprawione), przypomnienie widoczne przed kolejnym treningiem na tym rowerze

---

## Co NIE wchodzi w zakres MVP

- Integracja ze Stravą lub Garmin Connect (planowana jako kolejny etap)
- Własny algorytm powtórek treningowych (spaced repetition dla sportu)
- Analiza danych z pliku .fit / .gpx
- Planowanie treningów z wyprzedzeniem dłuższym niż dwa tygodnie
- Społecznościowe funkcje (dzielenie planów, porównywanie z innymi)
- Powiadomienia push / email (alerty tylko w aplikacji)
- Aplikacja mobilna (na start tylko web)
- Moduł garażowy

---

## Kryteria sukcesu

- Użytkownik po przejściu onboardingu otrzymuje gotowy plan na pierwsze dwa tygodnie bez żadnej dodatkowej konfiguracji
- Wygenerowany plan zawiera poprawne wartości intensywności dopasowane do posiadanego sprzętu (moc / tętno / RPE)
- Po wprowadzeniu nowego FTP wartości mocy we wszystkich przyszłych treningach aktualizują się automatycznie
- Liczniki komponentów w garażu aktualizują się bez dodatkowych kroków — wystarczy wybrać rower przy oznaczaniu treningu
