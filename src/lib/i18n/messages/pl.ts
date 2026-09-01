import type En from './en'
import type { TranslationOf } from '../types'

/**
 * The Polish catalogue.
 *
 * `satisfies TranslationOf<typeof En>` makes the key set a compile-time
 * obligation: a key English has and this file does not is a type error, and so
 * is a key invented here. What the type cannot see — a renamed placeholder, a
 * missing plural branch, an English sentence left in place — is what
 * `__tests__/parity.test.ts` is for.
 *
 * **Four plural branches, not two.** Polish counts in `one` / `few` / `many` /
 * `other`, and the `other` branch is the one a fractional count falls into
 * (`1,5 transakcji`), so it is not a copy of `many`. Every plural message below
 * carries all four.
 *
 * **Financial vocabulary, not a literal translation.** `Saldo`, not
 * `Bilans`; `Kontrahent` for a payee, which is what an accountant and a bank
 * statement both call it; `Rachunek bieżący` for a current account;
 * `Zlecenie stałe` and `Polecenie zapłaty` for the two standing payment types,
 * which are the terms printed on a Polish statement.
 *
 * Second person is `Ty`-form and capitalised in direct address (`Cię`, `Twoje`),
 * which is the register a Polish product uses with an individual user.
 */
const messages = {
  /* -- The shell ---------------------------------------------------------- */
  'app.name': 'Money Tracker',
  'app.tagline': 'Wiedz, dokąd trafiają Twoje pieniądze.',
  'app.loading': 'Wczytywanie…',
  'app.skipToContent': 'Przejdź do treści głównej',
  'app.menu.open': 'Otwórz menu',
  'app.menu.close': 'Zamknij menu',
  'app.sidebar.collapse': 'Zwiń panel boczny',
  'app.sidebar.expand': 'Rozwiń panel boczny',
  'app.theme.label': 'Wygląd',
  'app.theme.light': 'Jasny',
  'app.theme.dark': 'Ciemny',
  'app.theme.system': 'Jak w systemie',
  'app.language.label': 'Język',
  'app.language.change': 'Zmień język',
  'app.workspace.label': 'Przestrzeń',
  'app.workspace.switch': 'Przełącz przestrzeń',
  'app.workspace.create': 'Nowa przestrzeń',
  'app.account.menu': 'Twoje konto',
  'app.signOut': 'Wyloguj się',

  /* -- Navigation --------------------------------------------------------- */
  'nav.primary': 'Nawigacja główna',
  'nav.dashboard': 'Pulpit',
  'nav.accounts': 'Konta',
  'nav.transactions': 'Transakcje',
  'nav.budgets': 'Budżety',
  'nav.categories': 'Kategorie',
  'nav.tags': 'Tagi',
  'nav.payees': 'Kontrahenci',
  'nav.recurring': 'Płatności cykliczne',
  'nav.goals': 'Cele oszczędnościowe',
  'nav.reports': 'Raporty',
  'nav.rules': 'Reguły',
  'nav.import': 'Import',
  'nav.export': 'Eksport',
  'nav.settings': 'Ustawienia',
  'nav.notifications': 'Powiadomienia',
  'nav.search': 'Szukaj',
  'nav.help': 'Pomoc',

  /* -- Actions ------------------------------------------------------------ */
  'action.save': 'Zapisz',
  'action.saveChanges': 'Zapisz zmiany',
  'action.cancel': 'Anuluj',
  'action.delete': 'Usuń',
  'action.edit': 'Edytuj',
  'action.create': 'Utwórz',
  'action.add': 'Dodaj',
  'action.remove': 'Usuń z listy',
  'action.close': 'Zamknij',
  'action.confirm': 'Potwierdź',
  'action.back': 'Wstecz',
  'action.next': 'Dalej',
  'action.previous': 'Poprzedni',
  'action.continue': 'Kontynuuj',
  'action.retry': 'Spróbuj ponownie',
  'action.refresh': 'Odśwież',
  'action.search': 'Szukaj',
  'action.filter': 'Filtruj',
  'action.clear': 'Wyczyść',
  'action.clearAll': 'Wyczyść wszystko',
  'action.apply': 'Zastosuj',
  'action.reset': 'Przywróć domyślne',
  'action.duplicate': 'Duplikuj',
  'action.archive': 'Archiwizuj',
  'action.unarchive': 'Przywróć z archiwum',
  'action.export': 'Eksportuj',
  'action.import': 'Importuj',
  'action.download': 'Pobierz',
  'action.upload': 'Wyślij plik',
  'action.copy': 'Kopiuj',
  'action.copied': 'Skopiowano',
  'action.selectAll': 'Zaznacz wszystko',
  'action.deselectAll': 'Odznacz wszystko',
  'action.showMore': 'Pokaż więcej',
  'action.showLess': 'Pokaż mniej',
  'action.viewAll': 'Zobacz wszystkie',
  'action.sortAscending': 'Sortuj rosnąco',
  'action.sortDescending': 'Sortuj malejąco',
  'action.moveUp': 'Przenieś wyżej',
  'action.moveDown': 'Przenieś niżej',
  'action.moveTo': 'Przenieś do…',
  'action.undo': 'Cofnij',
  'action.done': 'Gotowe',
  'action.skip': 'Pomiń',
  'action.learnMore': 'Dowiedz się więcej',

  /* -- Shared vocabulary -------------------------------------------------- */
  'common.yes': 'Tak',
  'common.no': 'Nie',
  'common.optional': 'Opcjonalne',
  'common.required': 'Wymagane',
  'common.none': 'Brak',
  'common.all': 'Wszystkie',
  'common.other': 'Inne',
  'common.unknown': 'Nieznane',
  'common.name': 'Nazwa',
  'common.description': 'Opis',
  'common.note': 'Notatka',
  'common.date': 'Data',
  'common.amount': 'Kwota',
  'common.currency': 'Waluta',
  'common.colour': 'Kolor',
  'common.icon': 'Ikona',
  'common.state': 'Stan',
  'common.active': 'Aktywne',
  'common.archived': 'Zarchiwizowane',
  'common.createdAt': 'Utworzono',
  'common.updatedAt': 'Ostatnia zmiana',
  'common.total': 'Razem',
  'common.subtotal': 'Suma częściowa',
  'common.average': 'Średnia',
  'common.from': 'Od',
  'common.to': 'Do',
  'common.range': '{from} – {to}',
  'common.today': 'Dzisiaj',
  'common.yesterday': 'Wczoraj',
  'common.tomorrow': 'Jutro',
  'common.thisWeek': 'Ten tydzień',
  'common.thisMonth': 'Ten miesiąc',
  'common.thisYear': 'Ten rok',
  'common.lastMonth': 'Poprzedni miesiąc',
  'common.customRange': 'Własny zakres',
  'common.never': 'Nigdy',
  'common.justNow': 'Przed chwilą',

  /* -- Status ------------------------------------------------------------- */
  'status.saving': 'Zapisywanie…',
  'status.saved': 'Zapisano',
  'status.saveFailed': 'Nie udało się zapisać',
  'status.offline': 'Jesteś offline. Zmiany czekają w kolejce.',
  'status.backOnline': 'Połączenie wróciło. Synchronizujemy zmiany.',
  'status.loadFailed': 'Nie udało się wczytać danych.',

  /* -- Authentication ----------------------------------------------------- */
  'auth.signIn.title': 'Zaloguj się',
  'auth.signIn.subtitle': 'Wróć do swoich finansów.',
  'auth.signIn.submit': 'Zaloguj się',
  'auth.signIn.noAccount': 'Nie masz jeszcze konta?',
  'auth.signIn.createAccount': 'Załóż konto',
  'auth.signUp.title': 'Załóż konto',
  'auth.signUp.subtitle': 'Zacznij śledzić swoje finanse w kilka minut.',
  'auth.signUp.submit': 'Utwórz konto',
  'auth.signUp.haveAccount': 'Masz już konto?',
  'auth.signUp.terms':
    'Zakładając konto, akceptujesz regulamin i politykę prywatności.',
  'auth.field.name': 'Imię i nazwisko',
  'auth.field.email': 'Adres e-mail',
  'auth.field.password': 'Hasło',
  'auth.field.passwordConfirm': 'Powtórz hasło',
  'auth.field.currentPassword': 'Obecne hasło',
  'auth.field.newPassword': 'Nowe hasło',
  'auth.password.show': 'Pokaż hasło',
  'auth.password.hide': 'Ukryj hasło',
  'auth.password.strength.weak': 'Słabe hasło',
  'auth.password.strength.fair': 'Przeciętne hasło',
  'auth.password.strength.strong': 'Silne hasło',
  'auth.forgot.link': 'Nie pamiętasz hasła?',
  'auth.forgot.title': 'Zresetuj hasło',
  'auth.forgot.subtitle': 'Wyślemy Ci link do ustawienia nowego hasła.',
  'auth.forgot.submit': 'Wyślij link',
  'auth.forgot.sent':
    'Jeśli konto o tym adresie istnieje, link jest już w drodze.',
  'auth.reset.title': 'Ustaw nowe hasło',
  'auth.reset.submit': 'Zapisz nowe hasło',
  'auth.reset.success': 'Hasło zostało zmienione.',
  'auth.verify.title': 'Potwierdź adres e-mail',
  'auth.verify.subtitle': 'Link potwierdzający wysłaliśmy na adres {email}.',
  'auth.verify.resend': 'Wyślij ponownie',
  'auth.verify.sent': 'Link potwierdzający został wysłany.',
  'auth.twoFactor.title': 'Weryfikacja dwuetapowa',
  'auth.twoFactor.subtitle': 'Wpisz kod z aplikacji uwierzytelniającej.',
  'auth.twoFactor.code': 'Kod weryfikacyjny',
  'auth.twoFactor.submit': 'Zweryfikuj',
  'auth.twoFactor.useBackupCode': 'Użyj kodu zapasowego',
  'auth.twoFactor.backupCode': 'Kod zapasowy',
  'auth.passkey.title': 'Klucze dostępu',
  'auth.passkey.subtitle':
    'Zaloguj się odciskiem palca, twarzą lub kodem PIN urządzenia zamiast hasłem.',
  'auth.passkey.create': 'Dodaj klucz dostępu',
  'auth.passkey.use': 'Zaloguj się kluczem dostępu',
  'auth.passkey.none': 'To konto nie ma jeszcze kluczy dostępu.',
  'auth.sessions.title': 'Zalogowane urządzenia',
  'auth.sessions.current': 'To urządzenie',
  'auth.sessions.revoke': 'Wyloguj to urządzenie',
  'auth.sessions.revokeOthers': 'Wyloguj wszystkie pozostałe',
  'auth.sessions.count': {
    one: '{count} zalogowane urządzenie',
    few: '{count} zalogowane urządzenia',
    many: '{count} zalogowanych urządzeń',
    other: '{count} zalogowanego urządzenia',
  },
  'auth.signOut.confirm': 'Wylogować to urządzenie?',
  'auth.error.invalidCredentials':
    'Ten adres e-mail i hasło do siebie nie pasują.',
  'auth.error.emailTaken': 'Konto z tym adresem e-mail już istnieje.',
  'auth.error.rateLimited': 'Zbyt wiele prób. Spróbuj ponownie za kilka minut.',
  'auth.error.sessionExpired': 'Sesja wygasła. Zaloguj się ponownie.',
  'auth.error.forbidden': 'Nie masz do tego dostępu.',

  /* -- Accounts ----------------------------------------------------------- */
  'accounts.title': 'Konta',
  'accounts.subtitle': 'Wszystko, co posiadasz, w jednym miejscu.',
  'accounts.create': 'Nowe konto',
  'accounts.edit': 'Edytuj konto',
  'accounts.delete.confirm':
    'Usunąć konto {name}? Razem z nim znikną jego transakcje, a tego nie da się cofnąć.',
  'accounts.field.name': 'Nazwa konta',
  'accounts.field.category': 'Rodzaj konta',
  'accounts.field.currency': 'Waluta',
  'accounts.field.initialBalance': 'Saldo początkowe',
  'accounts.field.initialBalance.help':
    'Ile było na koncie dzień przed pierwszą transakcją.',
  'accounts.field.creditLimit': 'Limit kredytowy',
  'accounts.field.note': 'Notatka',
  'accounts.field.excludeFromStats': 'Pomijaj w raportach',
  'accounts.field.excludeFromStats.help':
    'Konto działa normalnie, ale nie wlicza się do sum ani wykresów.',
  'accounts.category.general': 'Ogólne',
  'accounts.category.cash': 'Gotówka',
  'accounts.category.current': 'Rachunek bieżący',
  'accounts.category.creditCard': 'Karta kredytowa',
  'accounts.category.savings': 'Oszczędności',
  'accounts.category.investment': 'Inwestycje',
  'accounts.category.loan': 'Kredyt',
  'accounts.category.other': 'Inne',
  'accounts.balance': 'Saldo',
  'accounts.balance.available': 'Dostępne środki',
  'accounts.balance.adjust': 'Skoryguj saldo',
  'accounts.balance.adjust.help':
    'Korekta zapisuje się jako osobna transakcja, więc historia pozostaje wiarygodna.',
  'accounts.totalBalance': 'Saldo łączne',
  'accounts.netWorth': 'Wartość netto',
  'accounts.hideZeroBalance': 'Ukryj konta z zerowym saldem',
  'accounts.group.title': 'Grupy',
  'accounts.group.create': 'Nowa grupa',
  'accounts.group.ungrouped': 'Poza grupami',
  'accounts.count': {
    one: '{count} konto',
    few: '{count} konta',
    many: '{count} kont',
    other: '{count} konta',
  },
  'accounts.empty.title': 'Nie masz jeszcze kont',
  'accounts.empty.body':
    'Dodaj pierwsze konto, które chcesz śledzić — rachunek, portfel albo kartę.',
  'accounts.empty.action': 'Dodaj pierwsze konto',
  'accounts.archived.empty.title': 'Archiwum jest puste',
  'accounts.archived.empty.body':
    'Zarchiwizowane konta trafiają tutaj razem ze swoją historią.',

  /* -- Accounts: the list surface ----------------------------------------- */
  'accounts.overview.assets': 'Co posiadasz',
  'accounts.overview.liabilities': 'Ile jesteś winien',
  'accounts.overview.basis': {
    one: 'Z {count} konta uwzględnianego w raportach.',
    few: 'Z {count} kont uwzględnianych w raportach.',
    many: 'Z {count} kont uwzględnianych w raportach.',
    other: 'Z {count} konta uwzględnianego w raportach.',
  },
  'accounts.overview.excluded':
    'Konta zarchiwizowane oraz pomijane w raportach nie wchodzą do tych kwot.',
  'accounts.byCurrency.title': 'Środki według waluty',
  'accounts.byCurrency.help':
    'Każda waluta sumuje się we własnych jednostkach. Nic nie jest tu przeliczane.',
  'accounts.filter.label': 'Pokaż',
  'accounts.filter.active': 'Konta otwarte',
  'accounts.filter.archived': 'Konta zarchiwizowane',
  'accounts.filter.all': 'Otwarte i zarchiwizowane',
  'accounts.status.excluded': 'Poza raportami',
  'accounts.list.label': 'Twoje konta',
  'accounts.list.loading': 'Wczytujemy Twoje konta…',
  'accounts.error.title': 'Nie udało się wczytać kont',
  'accounts.error.body':
    'Nic nie zostało zmienione. Spróbuj ponownie — a jeśli błąd się powtarza, przestrzeń jest chwilowo niedostępna.',
  'accounts.balance.missing': 'Saldo niedostępne',
  'accounts.balance.inBase': 'W walucie {currency}',
  'accounts.empty.pick.title': 'Albo zacznij od jednego z tych',
  'accounts.empty.pick.body':
    'Każdy otwiera formularz z wybranym już rodzajem konta. Nic nie powstaje, dopóki nie zapiszesz.',
  'accounts.active.empty.title': 'Wszystkie konta są zarchiwizowane',
  'accounts.active.empty.body':
    'Przywróć któreś z widoku archiwum albo dodaj nowe konto.',

  /* -- Accounts: one account ---------------------------------------------- */
  'accounts.detail.tab.overview': 'Przegląd',
  'accounts.detail.tab.settings': 'Ustawienia',
  'accounts.detail.balanceToday': 'Saldo na dziś',
  'accounts.detail.transactions': {
    one: '{count} transakcja na tym koncie',
    few: '{count} transakcje na tym koncie',
    many: '{count} transakcji na tym koncie',
    other: '{count} transakcji na tym koncie',
  },
  'accounts.detail.note.empty': 'To konto nie ma jeszcze notatki.',
  'accounts.detail.error.title': 'Nie udało się wczytać tego konta',
  'accounts.detail.danger': 'Archiwizacja i usuwanie',
  'accounts.credit.title': 'Wykorzystany limit',
  'accounts.credit.valueText': 'wykorzystano {used} z {limit}, czyli {percent}',
  'accounts.credit.within': 'W granicach limitu',
  'accounts.credit.approaching': 'Limit na wyczerpaniu',
  'accounts.credit.over': 'Limit przekroczony',
  'accounts.credit.available': 'Pozostało {amount}',
  'accounts.credit.none': 'To konto nie ma limitu kredytowego.',

  /* -- Accounts: the lifecycle -------------------------------------------- */
  'accounts.archive.title': 'Zarchiwizować konto {name}?',
  'accounts.archive.body':
    'Zniknie z sum i z list wyboru, ale zachowa wszystkie transakcje. Możesz je przywrócić w każdej chwili.',
  'accounts.archive.action': 'Zarchiwizuj konto',
  'accounts.restore.action': 'Przywróć konto',
  'accounts.delete.title': 'Usunąć konto {name}?',
  'accounts.delete.action': 'Usuń bezpowrotnie',
  'accounts.delete.blocked': {
    one: 'Na tym koncie jest {count} transakcja, więc nie można go usunąć. Zarchiwizuj je — historia zostanie zachowana.',
    few: 'Na tym koncie są {count} transakcje, więc nie można go usunąć. Zarchiwizuj je — historia zostanie zachowana.',
    many: 'Na tym koncie jest {count} transakcji, więc nie można go usunąć. Zarchiwizuj je — historia zostanie zachowana.',
    other:
      'Na tym koncie jest {count} transakcji, więc nie można go usunąć. Zarchiwizuj je — historia zostanie zachowana.',
  },
  'accounts.actions.label': 'Działania dla konta {name}',
  'accounts.toast.created': 'Konto {name} zostało dodane.',
  'accounts.toast.updated': 'Konto {name} zostało zapisane.',
  'accounts.toast.archived': 'Konto {name} zostało zarchiwizowane.',
  'accounts.toast.restored': 'Konto {name} jest znowu otwarte.',
  'accounts.toast.deleted': 'Konto {name} zostało usunięte.',

  /* -- Accounts: the form -------------------------------------------------- */
  'accounts.form.create.body':
    'Wymagana jest tylko nazwa i waluta. Resztę możesz uzupełnić później.',
  'accounts.form.edit.body':
    'Zmiana waluty albo salda początkowego przelicza całą historię tego konta.',
  'accounts.form.error.title': 'Nie udało się zapisać konta',
  'accounts.field.openedOn': 'Data otwarcia',
  'accounts.field.openedOn.help':
    'Dzień, którego dotyczy saldo początkowe. To z tego dnia zapisujemy kurs wymiany.',
  'accounts.field.creditLimit.help':
    'Kwota dodatnia. Zostaw puste, jeśli konto nie ma limitu.',
  'accounts.field.currency.help':
    'Proponujemy tylko waluty, które ma Twoja przestrzeń.',

  /* -- Accounts: correcting a balance ------------------------------------- */
  'accounts.adjust.body':
    'Podaj, ile powinno być na koncie. Różnicę zapiszemy jako transakcję, którą znajdziesz, poprawisz i wyeksportujesz.',
  'accounts.adjust.field.target': 'Ile powinno być na koncie',
  'accounts.adjust.field.date': 'Na koniec dnia',
  'accounts.adjust.field.note': 'Powód',
  'accounts.adjust.field.note.help':
    'Zapisujemy go przy transakcji, więc powód zostaje razem z korektą.',
  'accounts.adjust.preview.title': 'Co zostanie zapisane',
  'accounts.adjust.preview.income': 'Wpływ {amount} z datą księgowania {date}.',
  'accounts.adjust.preview.expense':
    'Wydatek {amount} z datą księgowania {date}.',
  'accounts.adjust.preview.none':
    'Nic. Saldo na dzień {date} już wynosi {amount}.',
  'accounts.adjust.preview.past':
    'Różnicę liczymy wobec salda na koniec dnia {date}, które odczytujemy przy zapisie. Pokażemy dokładnie to, co zostało zapisane.',
  'accounts.adjust.action': 'Zapisz korektę',
  'accounts.adjust.result.title': 'Zapisano',
  'accounts.adjust.result.income':
    'Zapisaliśmy wpływ {amount} z datą księgowania {date}.',
  'accounts.adjust.result.expense':
    'Zapisaliśmy wydatek {amount} z datą księgowania {date}.',
  'accounts.adjust.result.unchanged':
    'Nic nie zapisaliśmy — saldo na dzień {date} już wynosiło {amount}.',
  'accounts.adjust.error.title': 'Nie udało się zapisać korekty',

  /* -- Transactions ------------------------------------------------------- */
  'transactions.title': 'Transakcje',
  'transactions.create': 'Nowa transakcja',
  'transactions.createIncome': 'Zapisz wpływ',
  'transactions.createExpense': 'Zapisz wydatek',
  'transactions.createTransfer': 'Zapisz przelew',
  'transactions.edit': 'Edytuj transakcję',
  'transactions.delete.confirm':
    'Usunąć tę transakcję? Tego nie da się cofnąć.',
  'transactions.direction.income': 'Wpływ',
  'transactions.direction.expense': 'Wydatek',
  'transactions.field.amount': 'Kwota',
  'transactions.field.date': 'Data',
  'transactions.field.account': 'Konto',
  'transactions.field.category': 'Kategoria',
  'transactions.field.payee': 'Kontrahent',
  'transactions.field.note': 'Notatka',
  'transactions.field.tags': 'Tagi',
  'transactions.field.paymentMethod': 'Forma płatności',
  'transactions.method.cash': 'Gotówka',
  'transactions.method.card': 'Karta',
  'transactions.method.transfer': 'Przelew',
  'transactions.method.directDebit': 'Polecenie zapłaty',
  'transactions.method.standingOrder': 'Zlecenie stałe',
  'transactions.method.other': 'Inna',
  'transactions.planned': 'Planowana',
  'transactions.planned.help':
    'Nie wpływa na saldo, dopóki nie potwierdzisz, że doszła do skutku.',
  'transactions.balanceAdjustment': 'Korekta salda',
  'transactions.transfer.from': 'Konto źródłowe',
  'transactions.transfer.to': 'Konto docelowe',
  'transactions.transfer.rate': 'Kurs wymiany',
  'transactions.transfer.unlinkFirst':
    'Najpierw rozłącz obie strony, zanim zmienisz charakter tego przelewu.',
  'transactions.splits.title': 'Podział na kategorie',
  'transactions.splits.add': 'Dodaj pozycję',
  'transactions.splits.remainder': 'Do rozdzielenia: {amount}',
  'transactions.splits.balanced': 'Cała kwota transakcji jest rozdzielona.',
  'transactions.refund.title': 'Zwroty',
  'transactions.refund.link': 'Powiąż zwrot',
  'transactions.refund.unlink': 'Rozłącz zwrot',
  'transactions.refund.external': 'Zwrot za coś spoza Money Tracker',
  'transactions.attachment.add': 'Dołącz paragon',
  'transactions.attachment.remove': 'Usuń załącznik',
  'transactions.search.placeholder':
    'Szukaj w notatkach, kontrahentach i kwotach',
  'transactions.filter.title': 'Filtry',
  'transactions.filter.reset': 'Wyczyść filtry',
  'transactions.count': {
    one: '{count} transakcja',
    few: '{count} transakcje',
    many: '{count} transakcji',
    other: '{count} transakcji',
  },
  'transactions.selected': {
    one: 'zaznaczono {count}',
    few: 'zaznaczono {count}',
    many: 'zaznaczono {count}',
    other: 'zaznaczono {count}',
  },
  'transactions.empty.title': 'Nic jeszcze nie zapisano',
  'transactions.empty.body':
    'Zapisz pierwszą transakcję albo zaimportuj wyciąg, który już masz.',
  'transactions.empty.action': 'Zapisz transakcję',
  'transactions.noResults.title': 'Brak pasujących transakcji',
  'transactions.noResults.body':
    'Spróbuj szerszego zakresu dat albo mniejszej liczby filtrów.',

  /* -- Transactions: the ledger surface ----------------------------------- */
  'transactions.list.label': 'Rejestr transakcji',
  'transactions.list.caption.all': 'Wszystkie transakcje ({count}), {sort}.',
  'transactions.list.caption.filtered':
    'Transakcje pasujące do filtrów {filters} ({count}), {sort}.',
  'transactions.list.caption.sort': 'sortowanie według: {field}, {order}',
  'transactions.sort.label': 'Sortuj według',
  'transactions.sort.ascending': 'od najstarszych',
  'transactions.sort.descending': 'od najnowszych',
  'transactions.column.description': 'Opis',
  'transactions.column.actions': 'Działania',
  'transactions.day.net': 'Saldo dnia',
  'transactions.loading': 'Wczytywanie transakcji…',
  'transactions.loadMore': 'Wczytaj więcej',
  'transactions.loadingMore': 'Wczytywanie kolejnych transakcji…',
  'transactions.loadedOf': 'Wczytano {loaded} z {total}',
  'transactions.selectAllLoaded': 'Zaznacz wszystkie wczytane transakcje',
  'transactions.excludedFromTotals': 'Poza sumami',
  'transactions.amount.income': 'Wpływ {amount}',
  'transactions.amount.expense': 'Wydatek {amount}',
  'transactions.row.select': 'Zaznacz transakcję {amount} z dnia {date}',
  'transactions.row.actions': 'Działania dla: {name}',
  'transactions.row.open': 'Otwórz',
  'transactions.totals.label': 'Sumy dla wybranych filtrów',
  'transactions.totals.currency': 'Sumy w walucie {currency}',
  'transactions.bulk.label': 'Działania na zaznaczonych transakcjach',
  'transactions.bulk.delete': 'Usuń zaznaczone',
  'transactions.bulk.confirm': {
    one: 'Usunąć {count} transakcję? Tej operacji nie można cofnąć.',
    few: 'Usunąć {count} transakcje? Tej operacji nie można cofnąć.',
    many: 'Usunąć {count} transakcji? Tej operacji nie można cofnąć.',
    other: 'Usunąć {count} transakcji? Tej operacji nie można cofnąć.',
  },
  'transactions.keyboard.hint':
    'Strzałki przenoszą między komórkami. E edytuje, D duplikuje, Delete usuwa, spacja zaznacza, Enter otwiera.',

  /* -- Transactions: filters ---------------------------------------------- */
  'transactions.filter.description':
    'Zawęź rejestr. Wszystko, co tu ustawisz, zapisuje się w adresie, więc widok można udostępnić.',
  'transactions.filter.activeLabel': 'Aktywne filtry',
  'transactions.filter.remove': 'Usuń filtr: {name}',
  'transactions.filter.direction': 'Wpływy czy wydatki',
  'transactions.filter.accountGroup': 'Grupa kont',
  'transactions.filter.dateRange': 'Zakres dat',
  'transactions.filter.openCalendar': 'Otwórz kalendarz',
  'transactions.filter.amountRange': 'Zakres kwot',
  'transactions.filter.amountMin': 'Co najmniej',
  'transactions.filter.amountMax': 'Nie więcej niż',
  'transactions.filter.receipt': 'Paragon',
  'transactions.filter.noMatches': 'Brak dopasowań',
  'transactions.filter.categoryPlaceholder': 'Znajdź kategorię',
  'transactions.filter.payeePlaceholder': 'Znajdź kontrahenta',
  'transactions.filter.tagPlaceholder': 'Znajdź etykietę',
  'transactions.chip.text': 'Tekst: {value}',
  'transactions.chip.dates': 'Daty: od {from} do {to}',
  'transactions.chip.anyDate': 'dowolna',
  'transactions.chip.accounts': 'Konto: {value}',
  'transactions.chip.accountGroups': 'Grupa: {value}',
  'transactions.chip.categories': 'Kategoria: {value}',
  'transactions.chip.payees': 'Kontrahent: {value}',
  'transactions.chip.tags': 'Etykieta: {value}',
  'transactions.chip.direction': 'Kierunek: {value}',
  'transactions.chip.paymentMethods': 'Forma płatności: {value}',
  'transactions.chip.amount': 'Kwota: od {from} do {to}',
  'transactions.chip.anyAmount': 'dowolna',
  'transactions.chip.withReceipt': 'Z paragonem',
  'transactions.chip.withoutReceipt': 'Bez paragonu',

  /* -- Transactions: the entry form --------------------------------------- */
  'transactions.form.newTitle': 'Nowa transakcja',
  'transactions.form.newSubtitle':
    'Zaczynamy od kwoty. Poza kontem i datą reszta pól jest opcjonalna.',
  'transactions.form.editTitle': 'Edycja transakcji',
  'transactions.form.details': 'Szczegóły',
  'transactions.form.moreDetails': 'Więcej',
  'transactions.form.saveAndNew': 'Zapisz i dodaj kolejną',
  'transactions.form.saveAndNewHint':
    'Zostawia datę, konto i kategorię, więc do następnego wpisu wystarczy kwota.',
  'transactions.form.notePlaceholder': 'Czego dotyczyła ta transakcja?',
  'transactions.form.payeePlaceholder': 'Komu zapłacono albo kto zapłacił',
  'transactions.form.categoryPlaceholder': 'Wybierz kategorię',
  'transactions.form.noPayees': 'Nie ma jeszcze kontrahentów',
  'transactions.form.noCategories': 'Nie ma jeszcze kategorii',
  'transactions.form.conversionNote':
    'Zapisujemy w walucie {currency} i przeliczamy na {base} po kursie z daty księgowania.',
  'transactions.form.error.title': 'Transakcja nie została zapisana',
  'transactions.form.error.amount': 'Podaj kwotę większą od zera.',
  'transactions.form.error.account': 'Wybierz konto, którego dotyczy wpis.',
  'transactions.form.error.date': 'Podaj datę w formacie {example}.',
  'transactions.form.error.note': 'Notatka może mieć najwyżej {max} znaków.',
  'transactions.form.noAccounts.title': 'Najpierw konto',
  'transactions.form.noAccounts.body':
    'Transakcja musi należeć do konta. Załóż konto i wróć tutaj.',
  'transactions.form.noAccounts.action': 'Załóż konto',
  'transactions.saved': 'Transakcja zapisana.',
  'transactions.deleted': 'Transakcja usunięta.',
  'transactions.deletedMany': {
    one: 'Usunięto {count} transakcję.',
    few: 'Usunięto {count} transakcje.',
    many: 'Usunięto {count} transakcji.',
    other: 'Usunięto {count} transakcji.',
  },
  'transactions.duplicated':
    'Skopiowano do nowego wpisu. Nic nie zostało jeszcze zapisane.',

  /* -- Transactions: the detail screen ------------------------------------ */
  'transactions.detail.title': 'Transakcja',
  'transactions.detail.back': 'Wróć do transakcji',
  'transactions.detail.summary': 'Podsumowanie',
  'transactions.detail.recordedAt': 'Zapisano {datetime}',
  'transactions.detail.rate': 'Przeliczono po kursie {rate} z dnia {date}.',
  'transactions.detail.identityRate':
    'Zapisano w walucie raportowania, więc przeliczenie nie było potrzebne.',
  'transactions.detail.noTags': 'Ta transakcja nie ma etykiet.',
  'transactions.detail.noAttachments': 'Nie dołączono paragonu.',
  'transactions.detail.noRefunds': 'Nie powiązano zwrotu.',
  'transactions.detail.notFound.title': 'Nie ma takiej transakcji',
  'transactions.detail.notFound.body':
    'Mogła zostać usunięta albo adres jest nieprawidłowy.',
  'transactions.planned.title': 'Transakcje planowane',
  'transactions.planned.subtitle':
    'Wpisy zaksięgowane na datę, która jeszcze nie nadeszła. Nie wchodzą do sald, dopóki ich nie potwierdzisz.',
  'transactions.planned.empty.title': 'Nic nie jest zaplanowane',
  'transactions.planned.empty.body':
    'Zapisz transakcję z przyszłą datą i oznacz ją jako planowaną, aby zobaczyć ją tutaj.',
  /* -- Dashboard ---------------------------------------------------------- */
  'dashboard.title': 'Pulpit',
  'dashboard.greeting': 'Dobrze Cię widzieć, {name}.',
  'dashboard.period.label': 'Okres',
  'dashboard.income': 'Wpływy',
  'dashboard.expenses': 'Wydatki',
  'dashboard.net': 'Różnica',
  'dashboard.comparedToPrevious': '{change} względem poprzedniego okresu',
  'dashboard.widget.netWorth': 'Wartość netto',
  'dashboard.widget.cashFlow': 'Przepływy pieniężne',
  'dashboard.widget.spendingByCategory': 'Wydatki według kategorii',
  'dashboard.widget.recentTransactions': 'Ostatnie transakcje',
  'dashboard.widget.upcomingBills': 'Nadchodzące płatności',
  'dashboard.widget.budgetProgress': 'Budżety',
  'dashboard.widget.savingsGoals': 'Cele oszczędnościowe',
  'dashboard.widget.accountsOverview': 'Konta',
  'dashboard.widget.monthlySummary': 'Ten miesiąc w skrócie',
  'dashboard.edit': 'Ułóż pulpit',
  'dashboard.editDone': 'Zakończ układanie',
  'dashboard.widget.add': 'Dodaj panel',
  'dashboard.widget.remove': 'Usuń ten panel',
  'dashboard.widget.move': 'Przenieś ten panel',
  'dashboard.empty.title': 'Pulpit jest pusty',
  'dashboard.empty.body': 'Dodaj panele, które chcesz widzieć codziennie.',
  'dashboard.empty.action': 'Dodaj panel',
  'dashboard.chart.tableLabel': 'Te same dane w formie tabeli',

  /* -- Dashboard: the slice ----------------------------------------------- */
  'dashboard.period.last3Months': 'Ostatnie 3 miesiące',
  'dashboard.period.last12Months': 'Ostatnie 12 miesięcy',
  'dashboard.period.showing': 'Zakres: {range}',
  'dashboard.panels.label': 'Panele pulpitu',
  'dashboard.summary.label': 'Ten okres w skrócie',
  'dashboard.chart.noData': 'Brak danych',
  'dashboard.netWorth.help':
    'Liczone w walucie {currency}, po kursie zapisanym przy każdym koncie.',
  'dashboard.netWorth.empty.title': 'Nie ma jeszcze czego sumować',
  'dashboard.netWorth.empty.body':
    'Dodaj konto — jego saldo będzie pierwszą kwotą w tym miejscu.',
  'dashboard.cashFlow.month': 'Miesiąc',
  'dashboard.cashFlow.surplus': 'Zostało Ci {amount}',
  'dashboard.cashFlow.deficit': 'Wydatki przewyższyły wpływy o {amount}',
  'dashboard.cashFlow.balanced': 'Wpływy i wydatki wyszły dokładnie na zero',
  'dashboard.cashFlow.empty.title': 'W tym okresie nic się nie wydarzyło',
  'dashboard.cashFlow.empty.body':
    'Zapisz transakcję albo wybierz dłuższy okres.',
  'dashboard.spending.other': 'Pozostałe',
  'dashboard.spending.showOther': 'Pokaż mniejsze kategorie',
  'dashboard.spending.hideOther': 'Ukryj mniejsze kategorie',
  'dashboard.spending.share': 'Udział',
  'dashboard.spending.empty.title': 'Brak wydatków z kategorią',
  'dashboard.spending.empty.body':
    'Przypisz wydatkowi kategorię, a jego udział w okresie pojawi się tutaj.',
  'dashboard.accounts.viewAll': 'Wszystkie konta',
  'dashboard.accounts.owed': 'Zobowiązanie',
  'dashboard.recent.viewAll': 'Wszystkie transakcje',
  'dashboard.firstRun.title': 'Witamy. Trzy kroki i liczby zaczną pracować.',
  'dashboard.firstRun.body':
    'Nie ma tu przykładowych kwot. Wszystko, co zobaczysz, będzie Twoje.',
  'dashboard.firstRun.steps.label': 'Pierwsze kroki',
  'dashboard.firstRun.step.account.title': 'Dodaj konto',
  'dashboard.firstRun.step.account.body':
    'Rachunek osobisty, portfel, karta — cokolwiek chcesz śledzić.',
  'dashboard.firstRun.step.transaction.title': 'Zapisz transakcję',
  'dashboard.firstRun.step.transaction.body':
    'Jedna wystarczy, żeby wykres przepływów miał co narysować.',
  'dashboard.firstRun.step.review.title': 'Wróć tutaj',
  'dashboard.firstRun.step.review.body':
    'Panele poniżej wypełnią się, gdy tylko będzie co pokazać.',

  /* -- Budgets (shared with the dashboard) -------------------------------- */
  'budgets.title': 'Budżety',
  'budgets.spentOf': '{spent} z {limit}',
  'budgets.remaining': 'Zostało {amount}',
  'budgets.overspent': 'Przekroczono o {amount}',
  'budgets.daysLeft': {
    one: 'Został {count} dzień do końca okresu',
    few: 'Zostały {count} dni do końca okresu',
    many: 'Zostało {count} dni do końca okresu',
    other: 'Zostało {count} dnia do końca okresu',
  },

  /* -- Money and currency ------------------------------------------------- */
  'money.baseCurrency.label': 'Waluta raportowania',
  'money.baseCurrency.help':
    'Wszystkie sumy i wykresy przeliczamy na tę walutę po kursie z danego dnia.',
  'money.exchangeRate.label': 'Kurs wymiany',
  'money.exchangeRate.manual': 'Ustawiony przez Ciebie',
  'money.exchangeRate.automatic': 'Aktualizowany codziennie',
  'money.convertedAt': 'Przeliczono po kursie {rate}',
  'money.amountIn': 'Kwota w walucie {currency}',
  'money.currency.search': 'Szukaj waluty',
  'money.currency.zeroDecimal': 'Ta waluta nie ma jednostki podrzędnej.',

  /* -- Validation --------------------------------------------------------- */
  'validation.required': 'To pole jest wymagane.',
  'validation.email.invalid': 'To nie wygląda na adres e-mail.',
  'validation.password.tooShort': {
    one: 'Użyj co najmniej {count} znaku.',
    few: 'Użyj co najmniej {count} znaków.',
    many: 'Użyj co najmniej {count} znaków.',
    other: 'Użyj co najmniej {count} znaku.',
  },
  'validation.password.mismatch': 'Hasła nie są takie same.',
  'validation.amount.required': 'Podaj kwotę.',
  'validation.amount.invalid': 'Nie potrafimy odczytać tej kwoty.',
  'validation.amount.positive': 'Kwota musi być większa od zera.',
  'validation.amount.tooLarge':
    'Ta kwota jest większa, niż aplikacja potrafi zapisać.',
  'validation.date.invalid': 'Nie potrafimy odczytać tej daty.',
  'validation.date.future': 'Ta data jeszcze nie nadeszła.',
  'validation.name.required': 'Podaj nazwę.',
  'validation.tooLong': {
    one: 'Użyj najwyżej {count} znaku.',
    few: 'Użyj najwyżej {count} znaków.',
    many: 'Użyj najwyżej {count} znaków.',
    other: 'Użyj najwyżej {count} znaku.',
  },
  'validation.unique': 'Ta nazwa jest już zajęta.',
  'validation.currency.unknown': 'Nie znamy takiego kodu waluty.',
  'validation.currency.mismatch': 'Obie strony muszą być w tej samej walucie.',
  'validation.splits.sum': 'Pozycje różnią się od sumy o {difference}.',
  'validation.transfer.sameAccount': 'Wybierz dwa różne konta.',
  'validation.number.invalid': 'Podaj liczbę.',
  'validation.generic': 'Sprawdź to pole.',

  /* -- Empty and failure states ------------------------------------------ */
  'empty.search.title': 'Nic nie znaleziono',
  'empty.search.body': 'Nic nie pasuje do {query}. Spróbuj krótszej frazy.',
  'empty.filter.title': 'Nic nie pasuje do tych filtrów',
  'empty.filter.body': 'Poluzuj filtr albo poszerz zakres dat.',
  'empty.error.title': 'Coś poszło nie tak',
  'empty.error.body': 'Zgłosiliśmy ten problem. Spróbuj ponownie za chwilę.',
  'empty.error.reference': 'Numer zgłoszenia: {reference}',
  'empty.notFound.title': 'Nie ma tu nic',
  'empty.notFound.body':
    'Ta strona nie istnieje albo nie jest już Tobie udostępniona.',
  'empty.notFound.action': 'Wróć na pulpit',
  'empty.forbidden.title': 'Brak dostępu',
  'empty.forbidden.body':
    'Poproś właściciela przestrzeni o nadanie Ci dostępu.',
  'empty.offline.title': 'Jesteś offline',
  'empty.offline.body':
    'To, co teraz zapiszesz, wyślemy, gdy wrócisz do sieci.',

  /* -- Notifications ------------------------------------------------------ */
  'notifications.title': 'Powiadomienia',
  'notifications.markAllRead': 'Oznacz wszystkie jako przeczytane',
  'notifications.empty.title': 'Nic nowego',
  'notifications.empty.body':
    'Alerty o budżetach, rachunkach i wspólnych przestrzeniach pojawią się tutaj.',
  'notifications.unread': {
    one: '{count} nieprzeczytane powiadomienie',
    few: '{count} nieprzeczytane powiadomienia',
    many: '{count} nieprzeczytanych powiadomień',
    other: '{count} nieprzeczytanego powiadomienia',
  },
  'notifications.badge': '{count}+',

  /* -- Accessibility ------------------------------------------------------ */
  'a11y.skipToContent': 'Przejdź do treści głównej',

  /* -- Marketing (public pages) ------------------------------------------- */
  'marketing.nav.features': 'Funkcje',
  'marketing.nav.security': 'Bezpieczeństwo',
  'marketing.nav.signIn': 'Zaloguj się',
  'marketing.nav.getStarted': 'Zacznij za darmo',
  'marketing.hero.title':
    'Jedna księga dla wszystkich kont i każdej waluty, którą trzymasz.',
  'marketing.hero.body':
    'Money Tracker zapisuje Twoje wydatki i zobowiązania z tego, co wpiszesz, albo z pliku, który sam wyeksportujesz. Bez logowania do banku, bez pobierania danych z ekranu, bez powierzania komukolwiek haseł.',
  'marketing.hero.cta.primary': 'Zacznij zapisywać za darmo',
  'marketing.hero.cta.secondary': 'Zobacz, co jest w środku',
  'marketing.hero.note':
    'Plan darmowy, bez karty. Wszystko, co wpiszesz, pobierzesz w dowolnej chwili.',
  'marketing.features.title': 'Co dostajesz',
  'marketing.feature.multiCurrency.title': 'Wiele walut, które się zgadzają',
  'marketing.feature.multiCurrency.body':
    'Kwoty trzymamy jako całkowite jednostki podrzędne w skali właściwej dla danej waluty i przeliczamy po kursie z dnia księgowania, więc marcowy wydatek zostaje wyceniony po marcowym kursie.',
  'marketing.feature.manual.title': 'Ręczny wpis i import pliku',
  'marketing.feature.manual.body':
    'Zapisz transakcję w kilka sekund albo wczytaj eksport CSV, OFX lub QIF. Nic tutaj nigdy nie poprosi o hasło do banku.',
  'marketing.feature.budgets.title': 'Budżety z przeniesieniem nadwyżki',
  'marketing.feature.budgets.body':
    'Ustaw limit dla kategorii albo koperty i zdecyduj, co dzieje się z nadwyżką po zamknięciu okresu.',
  'marketing.feature.recurring.title': 'Rachunki, zanim nadejdą',
  'marketing.feature.recurring.body':
    'Subskrypcje, raty i wypłaty prowadzimy jako serie, z przypomnieniem przed każdym terminem.',
  'marketing.feature.reports.title': 'Raporty, które da się drążyć',
  'marketing.feature.reports.body':
    'Przepływy, wartość netto, wydatki według kategorii i tabela przestawna, którą sam układasz — z każdej liczby zejdziesz do transakcji, które za nią stoją.',
  'marketing.feature.household.title': 'Wspólne z domownikami',
  'marketing.feature.household.body':
    'Zaproś osoby, z którymi naprawdę dzielisz pieniądze, i miej jeden zestaw liczb zamiast dwóch arkuszy.',
  'marketing.privacy.title': 'Twoje zapisy zostają Twoje',
  'marketing.privacy.body':
    'Nie ma tu integracji z bankami i nigdy nie będzie. Wszystko w przestrzeni wpisał ktoś, kto do niej należy, a całość pobierzesz jako JSON lub CSV, kiedy zechcesz.',
  'marketing.cta.title': 'Zacznij od tego miesiąca',
  'marketing.cta.body':
    'Dodaj jedno konto, wczytaj wyciąg i zobacz, dokąd naprawdę poszły pieniądze.',
  'marketing.cta.action': 'Załóż darmową przestrzeń',
  'marketing.footer.legal': 'Wszelkie prawa zastrzeżone.',

  /* -- The authenticated shell -------------------------------------------- */
  'app.nav.more': 'Więcej',
  'app.nav.moreLabel': 'Pozostałe sekcje',
  'app.nav.section.money': 'Pieniądze',
  'app.nav.section.plan': 'Planowanie',
  'app.nav.section.insight': 'Analizy',
  'app.signedInAs': 'Zalogowano jako {email}',
  'app.workspace.current': 'Bieżąca przestrzeń',
  'app.workspace.role.owner': 'Właściciel',
  'app.workspace.role.admin': 'Administrator',
  'app.workspace.role.member': 'Uczestnik',
  'app.shell.pending': 'Wczytujemy tę stronę…',
  'app.shell.error.body':
    'Tej części aplikacji nie udało się wczytać. Reszta działa dalej.',

  /* -- The auth screens --------------------------------------------------- */
  'auth.aside.title': 'Każda kwota co do grosza.',
  'auth.aside.body':
    'Kwoty trzymamy jako całkowite jednostki podrzędne i przeliczamy po kursie z dnia księgowania, więc zeszły marzec nadal zgadza się tak, jak zgadzał się w marcu.',
  'auth.aside.point.privacy':
    'Żadnych integracji z bankami. Czytamy tylko to, co sam wpiszesz lub zaimportujesz.',
  'auth.aside.point.currency':
    'Konta w kilku walutach raportowane w jednej walucie bazowej.',
  'auth.aside.point.export':
    'Całą przestrzeń pobierzesz jako CSV lub JSON, kiedy tylko zechcesz.',
  'auth.continueWith': 'lub',
  'auth.provider.google': 'Kontynuuj z Google',
  'auth.provider.apple': 'Kontynuuj z Apple',
  'auth.backToSignIn': 'Wróć do logowania',
  'auth.password.help': {
    one: 'Co najmniej {count} znak. Wklejenie z menedżera haseł jest jak najbardziej w porządku.',
    few: 'Co najmniej {count} znaki. Wklejenie z menedżera haseł jest jak najbardziej w porządku.',
    many: 'Co najmniej {count} znaków. Wklejenie z menedżera haseł jest jak najbardziej w porządku.',
    other:
      'Co najmniej {count} znaku. Wklejenie z menedżera haseł jest jak najbardziej w porządku.',
  },
  'auth.forgot.sentTitle': 'Sprawdź skrzynkę',
  'auth.forgot.tryAnother': 'Użyj innego adresu',
  'auth.reset.subtitle':
    'Wybierz hasło, którego nie używasz jeszcze na tym koncie.',
  'auth.reset.invalid.title': 'Ten link nie zadziała',
  'auth.reset.invalid.body':
    'Link do resetu działa raz i wygasa po godzinie. Poproś o nowy — przyjdzie w chwilę.',
  'auth.reset.requestNew': 'Wyślij nowy link',
  'auth.reset.continue': 'Przejdź do logowania',
  'auth.error.title': 'Nie udało się',
  'auth.error.generic':
    'Nie udało się tego teraz wykonać. Spróbuj jeszcze raz.',
  'auth.error.network':
    'Nie mogliśmy połączyć się z serwerem. Sprawdź połączenie i spróbuj ponownie.',
  'auth.error.invalidToken': 'Ten link wygasł albo został już użyty.',
  'auth.error.weakPassword':
    'To hasło jest zbyt łatwe do odgadnięcia. Wybierz dłuższe.',
} satisfies TranslationOf<typeof En>

export default messages
