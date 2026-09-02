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
  /* -- Dokument ----------------------------------------------------------- */
  'meta.title': 'Money Tracker — wiedz, dokąd trafiają Twoje pieniądze',
  'meta.description':
    'Osobisty menedżer finansów: konta, transakcje, budżety, płatności cykliczne i raportowanie wielowalutowe. Wyłącznie ręczne wprowadzanie danych i import plików — nigdy integracje bankowe.',

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
  'accounts.overview.excluded.label': 'Co obejmują te kwoty',
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
  'accounts.credit.ofLimit': '{used} z {limit}',
  'accounts.credit.percentUsed': 'wykorzystano {percent}',
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
  'transactions.keyboard.title': 'Skróty klawiszowe',
  'transactions.keyboard.column.key': 'Klawisz',
  'transactions.keyboard.column.action': 'Działanie',
  'transactions.keyboard.keys.arrows': 'Strzałki',
  'transactions.keyboard.keys.enter': 'Enter',
  'transactions.keyboard.keys.space': 'Spacja',
  'transactions.keyboard.keys.edit': 'E',
  'transactions.keyboard.keys.duplicate': 'D',
  'transactions.keyboard.keys.delete': 'Delete',
  'transactions.keyboard.keys.help': '?',
  'transactions.keyboard.move': 'Przechodzenie między komórkami',
  'transactions.keyboard.open': 'Otwarcie transakcji',
  'transactions.keyboard.select': 'Zaznaczenie wiersza',
  'transactions.keyboard.edit': 'Edycja transakcji',
  'transactions.keyboard.duplicate': 'Skopiowanie do nowego wpisu',
  'transactions.keyboard.remove': 'Usunięcie transakcji',
  'transactions.keyboard.help': 'Wyświetlenie tej listy',

  /* -- Transactions: filters ---------------------------------------------- */
  'transactions.filter.description':
    'Zawęź rejestr. Wszystko, co tu ustawisz, zapisuje się w adresie, więc widok można udostępnić.',
  'transactions.filter.activeLabel': 'Aktywne filtry',
  'transactions.filter.remove': 'Usuń filtr: {name}',
  'transactions.filter.direction': 'Wpływy czy wydatki',
  'transactions.filter.accountGroup': 'Grupa kont',
  'transactions.filter.dateRange': 'Zakres dat',
  'transactions.filter.anyDate': 'Dowolna data',
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
  /* -- Transakcje: podział transakcji -------------------------------------- */
  'splits.title': 'Podziel tę transakcję',
  'splits.description':
    'Rozdziel jedną płatność na kilka kategorii. Zanim zapiszemy podział, wiersze muszą sumować się do kwoty transakcji.',
  'splits.lines.label': 'Wiersze podziału',
  'splits.row.legend': 'Wiersz {position}',
  'splits.row.category': 'Kategoria',
  'splits.row.category.none': 'Bez kategorii',
  'splits.row.amount': 'Kwota',
  'splits.row.note': 'Notatka',
  'splits.row.remove': 'Usuń wiersz {position}',
  'splits.row.moveUp': 'Przenieś wiersz {position} w górę',
  'splits.row.moveDown': 'Przenieś wiersz {position} w dół',
  'splits.add': 'Dodaj wiersz',
  'splits.assigned': 'Przypisano {assigned} z {total}.',
  'splits.remaining': 'Do przypisania zostało {amount}.',
  'splits.over': '{amount} ponad kwotę transakcji.',
  'splits.balanced': 'Cała kwota jest przypisana.',
  'splits.assignRemainder': 'Przypisz resztę',
  'splits.save': 'Zapisz podział',
  'splits.clear': 'Usuń podział',
  'splits.saved': 'Zapisaliśmy podział.',
  'splits.cleared': 'Usunęliśmy podział.',
  'splits.error.title': 'Nie zapisaliśmy podziału',
  'splits.error.amounts': 'Każdy wiersz potrzebuje kwoty większej od zera.',
  'splits.transfer.title': 'Nogi transferu nie da się podzielić',
  'splits.transfer.body':
    'Jej kwota należy do przepływu między dwoma kontami, a nie do podziału na kategorie.',

  'transactions.planned.title': 'Transakcje planowane',
  'transactions.planned.subtitle':
    'Wpisy zaksięgowane na datę, która jeszcze nie nadeszła. Nie wchodzą do sald, dopóki ich nie potwierdzisz.',
  'transactions.planned.empty.title': 'Nic nie jest zaplanowane',
  'transactions.planned.empty.body':
    'Zapisz transakcję z przyszłą datą i oznacz ją jako planowaną, aby zobaczyć ją tutaj.',
  /* -- Kolory (osiem zmierzonych barw kategorii) -------------------------- */
  'colour.blue': 'Niebieski',
  'colour.teal': 'Morski',
  'colour.green': 'Zielony',
  'colour.olive': 'Oliwkowy',
  'colour.gold': 'Złoty',
  'colour.orange': 'Pomarańczowy',
  'colour.crimson': 'Karmazynowy',
  'colour.violet': 'Fioletowy',

  /* -- Kategorie ---------------------------------------------------------- */
  'categories.title': 'Kategorie',
  'categories.subtitle':
    'Słownik, według którego grupujemy Twoje wydatki. Dwa poziomy i dowolna kolejność.',
  'categories.create': 'Dodaj kategorię',
  'categories.createChild': 'Dodaj podkategorię',
  'categories.edit': 'Edytuj kategorię',
  'categories.loading': 'Wczytujemy kategorie',
  'categories.tree.label': 'Kategorie w kolejności wyświetlania',
  'categories.tree.childOf': '{name}, wewnątrz {parent}',
  'categories.actions.label': 'Działania dla: {name}',
  'categories.drag.label': 'Zmień kolejność: {name}',
  'categories.badge.system': 'Wbudowana',
  'categories.kind.expense': 'Wydatki',
  'categories.kind.income': 'Wpływy',
  'categories.kind.both': 'Wpływy i wydatki',
  'categories.parent.none': 'Poziom główny',
  'categories.move.top': 'Przenieś na początek',
  'categories.move.bottom': 'Przenieś na koniec',
  'categories.move.refused': 'Nie udało się przenieść kategorii',
  'categories.move.refused.body':
    'Kategorie mają dwa poziomy. Kategorii, która ma już podkategorie, nie można umieścić wewnątrz innej.',
  'categories.filter.showArchived': 'Pokaż zarchiwizowane kategorie',
  'categories.field.kind': 'Stosowana do',
  'categories.field.kind.help':
    'Po której stronie księgi ta kategoria będzie proponowana.',
  'categories.field.parent': 'Wewnątrz',
  'categories.field.parent.help':
    'Zostaw na poziomie głównym albo umieść wewnątrz istniejącej kategorii.',
  'categories.field.colour.help':
    'Pokazujemy go jako kropkę obok nazwy, nigdy jako tło wiersza.',
  'categories.form.create.body':
    'Wystarczy nazwa. Resztę możesz zmienić później.',
  'categories.form.edit.body':
    'Zmiana nazwy kategorii zmienia ją wszędzie tam, gdzie była użyta.',
  'categories.form.error.title': 'Nie zapisaliśmy kategorii',
  'categories.error.title': 'Nie udało się wczytać kategorii',
  'categories.empty.title': 'Nie masz jeszcze kategorii',
  'categories.empty.body':
    'Kategoria to odpowiedź transakcji na pytanie „na co to było”. Dodaj pierwszą, a raporty będą miały według czego grupować.',
  'categories.archive.title': 'Zarchiwizować kategorię {name}?',
  'categories.archive.body':
    'Przestaniemy ją proponować przy nowych transakcjach, a wszystko, co już do niej przypisano, zachowa swoją etykietę. Podkategorie archiwizują się razem z nią. Możesz ją przywrócić w każdej chwili.',
  'categories.delete.title': 'Usunąć kategorię {name}?',
  'categories.delete.body':
    'Tej operacji nie da się cofnąć. Kategorii, która była kiedykolwiek użyta, nie można usunąć - zarchiwizuj ją zamiast tego.',
  'categories.delete.refused': 'Tej kategorii nie można usunąć',
  'categories.delete.refused.body':
    'Jest już przypisana do transakcji, a usunięcie zostawiłoby je bez etykiety. Zarchiwizuj ją: zniknie z list wyboru i zachowa historię.',
  'categories.toast.created': 'Dodaliśmy kategorię {name}.',
  'categories.toast.updated': 'Zapisaliśmy kategorię {name}.',
  'categories.toast.archived': 'Zarchiwizowaliśmy kategorię {name}.',
  'categories.toast.restored': 'Przywróciliśmy kategorię.',
  'categories.toast.deleted': 'Usunęliśmy kategorię {name}.',

  /* -- Kontrahenci -------------------------------------------------------- */
  'payees.title': 'Kontrahenci',
  'payees.subtitle':
    'Komu płacisz i kto płaci Tobie - oraz opisy z wyciągu, które mają się z nimi zgadzać.',
  'payees.create': 'Dodaj kontrahenta',
  'payees.edit': 'Edytuj kontrahenta',
  'payees.loading': 'Wczytujemy kontrahentów',
  'payees.list.label': 'Kontrahenci',
  'payees.actions.label': 'Działania dla: {name}',
  'payees.search.label': 'Szukaj kontrahentów',
  'payees.search.placeholder': 'Fragment nazwy',
  'payees.error.title': 'Nie udało się wczytać kontrahentów',
  'payees.empty.title': 'Nie masz jeszcze kontrahentów',
  'payees.empty.body':
    'Kontrahent zamienia „ZABKA NANO 4471” z wyciągu w nazwę, którą rozpoznajesz. Dodaj pierwszego albo pozwól, żeby import utworzył ich za Ciebie.',
  'payees.noMatches.title': 'Nic nie pasuje',
  'payees.noMatches.body': 'Spróbuj krótszego fragmentu nazwy.',
  'payees.defaultCategory.summary': 'Podpowiada: {name}',
  'payees.detail.back': 'Wróć do kontrahentów',
  'payees.detail.noCategory': 'Nie podpowiada żadnej kategorii',
  'payees.detail.notFound.title': 'Nie ma tu tego kontrahenta',
  'payees.detail.notFound.body':
    'Mógł zostać usunięty albo scalony z innym, albo adres jest błędny.',
  'payees.field.name.help': 'Nazwa, którą chcesz widzieć w księdze.',
  'payees.field.defaultCategory': 'Podpowiadana kategoria',
  'payees.field.defaultCategory.help':
    'Do niej trafi nowa transakcja z tym kontrahentem.',
  'payees.field.mode': 'Jak stanowczo ją stosować',
  'payees.field.logoDomain': 'Strona internetowa',
  'payees.field.logoDomain.help':
    'Domena, na przykład zabka.pl - nie pełny odnośnik.',
  'payees.mode.off': 'Nic nie podpowiadaj',
  'payees.mode.off.help': 'Ten kontrahent nigdy nie rusza pola kategorii.',
  'payees.mode.hint': 'Wypełnij wstępnie',
  'payees.mode.hint.help':
    'Nowe transakcje zaczynają od podpowiadanej kategorii, a Ty możesz ją zmienić.',
  'payees.mode.enforce': 'Zawsze stosuj',
  'payees.mode.enforce.help':
    'Nowe transakcje przyjmą podpowiadaną kategorię, a zapis przypisze do niej także te już zarejestrowane u tego kontrahenta.',
  'payees.form.create.body':
    'Wystarczy nazwa. Ustawienia podpowiedzi mogą poczekać.',
  'payees.form.edit.body':
    'Zmiana nazwy kontrahenta zmienia ją w każdej transakcji, w której występuje.',
  'payees.form.error.title': 'Nie zapisaliśmy kontrahenta',
  'payees.aliases.title': 'Opisy z wyciągu',
  'payees.aliases.body':
    'Ciągi znaków, których bank używa dla tego kontrahenta. Każdy zapisujemy w postaci porównywanej - małymi literami, bez znaków diakrytycznych i bez numerów referencyjnych - bo właśnie to porównuje import.',
  'payees.aliases.count': {
    one: '{count} alias',
    few: '{count} aliasy',
    many: '{count} aliasów',
    other: '{count} aliasu',
  },
  'payees.aliases.add': 'Dodaj opis z wyciągu',
  'payees.aliases.add.help': 'Wklej go dokładnie tak, jak widnieje na wyciągu.',
  'payees.aliases.added': 'Dodaliśmy opis z wyciągu.',
  'payees.aliases.remove': 'Usuń {name}',
  'payees.aliases.empty':
    'Na razie pasuje tylko własna nazwa tego kontrahenta.',
  'payees.aliases.failed': 'Nie dodaliśmy tego opisu',
  'payees.ignored.title': 'Opisy, które nigdy nie są kontrahentem',
  'payees.ignored.body':
    'Ciągi znaków, z których import nie może zrobić kontrahenta - „PŁATNOŚĆ KARTĄ”, „POLECENIE ZAPŁATY” i wszystko inne, co bank dopisuje do każdej pozycji.',
  'payees.ignored.add': 'Dodaj opis do pominięcia',
  'payees.ignored.remove': 'Przestań pomijać {name}',
  'payees.ignored.empty': 'Nie pomijamy żadnego opisu.',
  'payees.ignored.failed': 'Nie dodaliśmy tego opisu',
  'payees.merge.action': 'Scal z innym kontrahentem',
  'payees.merge.title': 'Scal kontrahenta {name}',
  'payees.merge.into': 'Zachowaj tego kontrahenta',
  'payees.merge.body':
    'Wszystkie transakcje, aliasy i etykiety kontrahenta {from} przejdą do {into}, a „{from}” zachowamy jako opis z wyciągu, żeby kolejne importy nadal go rozpoznawały. Tej operacji nie da się cofnąć.',
  'payees.merge.noTargets': 'Nie ma innego kontrahenta, z którym można scalić.',
  'payees.merge.failed': 'Nie scaliliśmy kontrahentów',
  'payees.delete.title': 'Usunąć kontrahenta {name}?',
  'payees.delete.body':
    'Tej operacji nie da się cofnąć. Transakcje zachowają kwoty i daty, stracą tylko nazwę kontrahenta.',
  'payees.toast.created': 'Dodaliśmy kontrahenta {name}.',
  'payees.toast.updated': 'Zapisaliśmy kontrahenta {name}.',
  'payees.toast.deleted': 'Usunęliśmy kontrahenta {name}.',
  'payees.toast.merged': 'Scaliliśmy {from} z {into}.',

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
  'dashboard.cashFlow.shareOfIncome': '{share} z {amount} wpływów',
  'dashboard.cashFlow.context':
    'Wybrany okres: {month}. Wcześniejsze miesiące to kontekst.',
  'dashboard.cashFlow.empty.title': 'W tym okresie nic się nie wydarzyło',
  'dashboard.cashFlow.empty.body':
    'Zapisz transakcję albo wybierz dłuższy okres.',
  'dashboard.spending.other': 'Pozostałe',
  'dashboard.spending.showOther': 'Pokaż mniejsze kategorie',
  'dashboard.spending.hideOther': 'Ukryj mniejsze kategorie',
  'dashboard.spending.share': 'Udział',
  'dashboard.spending.uncategorised': 'Bez kategorii',
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
  'budgets.subtitle': 'Ile zostało — koperta po kopercie.',
  'budgets.spentOf': '{spent} z {limit}',
  'budgets.remaining': 'Pozostało {amount}',
  'budgets.overspent': 'Przekroczono o {amount}',
  'budgets.daysLeft': {
    one: 'Został {count} dzień do końca okresu',
    few: 'Zostały {count} dni do końca okresu',
    many: 'Zostało {count} dni do końca okresu',
    other: 'Zostało {count} dnia do końca okresu',
  },

  // Nazwa dostępna miernika podaje najpierw kwoty, potem procent — samo „62%”
  // nie mówi, czego dotyczy.
  'budgets.meter.label': 'Wykorzystanie budżetu: {name}',
  'budgets.meter.valueText': 'Wydano {spent} z {available}, {percent}',
  'budgets.meter.tick': '100% z {available}',
  'budgets.meter.notch': 'Ostrzeżenie przy {percent}',
  'budgets.meter.unavailable': 'Wykorzystanie niedostępne',
  'budgets.meter.noRate':
    'Brak kursu waluty {currency} na ten dzień, więc nie możemy jeszcze porównać tego budżetu z walutą raportowania.',
  'budgets.state.under': 'Bez zagrożenia',
  'budgets.state.approaching': 'Blisko limitu',
  'budgets.state.over': 'Przekroczenie budżetu',
  'budgets.carriedIn': 'Przeniesiono {amount}',
  'budgets.carriedInNegative': 'Przeniesiono {amount} z przekroczenia',
  'budgets.notStarted': 'Start {date}',
  'budgets.ended': 'Zakończony {date}',

  'budgets.kind.label': 'Co obejmuje',
  'budgets.kind.category': 'Kategorie',
  'budgets.kind.category.help':
    'Liczy każdą transakcję z wybranych kategorii i ich podkategorii.',
  'budgets.kind.manual': 'Wybrane ręcznie',
  'budgets.kind.manual.help':
    'Liczy tylko transakcje, które sam do niego dodasz. Na wyjazd, remont, jednorazowy wydatek.',

  'budgets.period.label': 'Okres rozliczeniowy',
  'budgets.period.one_off': 'Jednorazowy',
  'budgets.period.weekly': 'Tygodniowy',
  'budgets.period.monthly': 'Miesięczny',
  'budgets.period.quarterly': 'Kwartalny',
  'budgets.period.yearly': 'Roczny',

  'budgets.rollover.label': 'Co dzieje się z resztą',
  'budgets.rollover.none': 'Każdy okres zaczyna się od zera',
  'budgets.rollover.none.help':
    'To, co zostało albo zostało przekroczone, znika wraz z końcem okresu.',
  'budgets.rollover.carry_surplus': 'Przenoś nadwyżkę',
  'budgets.rollover.carry_surplus.help':
    'Niewydane pieniądze doliczamy do kolejnego okresu. Przekroczenie nie przechodzi dalej, ale zapisujemy je w zestawieniu.',
  'budgets.rollover.carry_all': 'Przenoś całe saldo',
  'budgets.rollover.carry_all.help':
    'Kolejny okres zaczyna się od tego, co zostało — albo na minusie, jeśli był przekroczony.',

  'budgets.status.archived': 'Zarchiwizowany',
  'budgets.status.closed': 'Zamknięty',
  'budgets.status.open': 'Otwarty',
  'budgets.autoInclude': 'Automatycznie liczy nowe transakcje',
  'budgets.categories.count': {
    one: '{count} kategoria',
    few: '{count} kategorie',
    many: '{count} kategorii',
    other: '{count} kategorii',
  },
  'budgets.categories.none': 'Brak kategorii',
  'budgets.limitIn': 'Limit ustawiony w walucie {currency}',

  'budgets.filter.label': 'Pokaż',
  'budgets.filter.active': 'Aktywne',
  'budgets.filter.archived': 'Zarchiwizowane',
  'budgets.filter.all': 'Wszystkie',

  'budgets.new': 'Nowy budżet',
  'budgets.list.loading': 'Wczytujemy Twoje budżety…',
  'budgets.detail.loading': 'Wczytujemy ten budżet…',
  'budgets.error.title': 'Nie udało się wczytać budżetów',
  'budgets.error.body':
    'Lista nie wróciła. Nic nie zostało zmienione — spróbuj ponownie.',
  'budgets.detail.error.title': 'Nie udało się wczytać tego budżetu',
  'budgets.detail.error.body':
    'Jego okresy nie wróciły. Nic nie zostało zmienione — spróbuj ponownie.',

  'budgets.empty.title': 'Nie masz jeszcze budżetów',
  'budgets.empty.body':
    'Budżet to koperta z limitem i okresem. Podepnij pod niego kategorie, a wypełni się sam, albo dodawaj transakcje ręcznie — do jednorazowego wydatku.',
  'budgets.empty.action': 'Utwórz pierwszy budżet',
  'budgets.empty.archived.title': 'Nic nie jest zarchiwizowane',
  'budgets.empty.archived.body':
    'Zarchiwizowane budżety zachowują wszystkie zamknięte okresy. Na razie nie ma tu żadnego.',

  'budgets.detail.back': 'Wszystkie budżety',
  'budgets.detail.thisPeriod': 'Bieżący okres',
  'budgets.detail.spentGross': 'Wydatki',
  'budgets.detail.credited': 'Wróciło w tych samych kategoriach',
  'budgets.detail.refunded': 'Zwroty poza budżetem',
  'budgets.detail.net': 'Zaliczone do budżetu',

  'budgets.ledger.title': 'Zestawienie przeniesień',
  'budgets.ledger.caption':
    'Wszystkie okresy tego budżetu: z czym się zaczęły, ile wydano i co przeszło dalej.',
  'budgets.ledger.col.period': 'Okres',
  'budgets.ledger.col.limit': 'Limit okresu',
  'budgets.ledger.col.carriedIn': 'Przeniesione',
  'budgets.ledger.col.spent': 'Wydano',
  'budgets.ledger.col.carriedOut': 'Do przeniesienia',
  'budgets.ledger.col.status': 'Stan',
  'budgets.ledger.overBy': 'przekroczenie o {amount}',
  'budgets.ledger.empty':
    'Ten budżet ma na razie jeden okres i wciąż jest otwarty. Zestawienie wypełni się, gdy okresy zaczną się zamykać.',

  'budgets.timeline.title': 'Wydatki wobec limitu, okres po okresie',
  'budgets.timeline.categoryHeader': 'Okres',
  'budgets.timeline.spent': 'Wydano',
  'budgets.timeline.available': 'Do dyspozycji',
  'budgets.timeline.empty.title': 'Na razie jeden okres',
  'budgets.timeline.empty.body':
    'Wykres narysuje słupek na okres, gdy ten budżet zamknie pierwszy z nich.',
  'budgets.timeline.noData': 'Brak odczytu',

  'budgets.corrections.title': 'Korekty',
  'budgets.corrections.body':
    'Te zamknięte okresy nie zgadzają się już z tym, co dziś wynika z ich dat — coś w środku zmieniono po zamknięciu. Zamknięte kwoty zostają bez zmian; różnicę pokazujemy tutaj.',
  'budgets.corrections.row': '{period}: zapisano {stored}, obecnie {actual}',
  'budgets.corrections.delta': 'Różnica {amount}',

  'budgets.allocation.title': 'Kategorie w tym budżecie',
  'budgets.allocation.body':
    'Każda transakcja z tych kategorii i ich podkategorii pomniejsza limit.',
  'budgets.allocation.manual':
    'Ten budżet liczy tylko transakcje dodane do niego ręcznie.',
  'budgets.allocation.edit': 'Zmień kategorie',
  'budgets.transactions.title': 'Co zaliczyliśmy w tym okresie',
  'budgets.transactions.empty':
    'Nic jeszcze nie zostało zaliczone do tego budżetu.',

  'budgets.actions.label': 'Działania: {name}',
  'budgets.actions.edit': 'Edytuj budżet',
  'budgets.actions.archive': 'Archiwizuj',
  'budgets.actions.restore': 'Przywróć',
  'budgets.actions.delete': 'Usuń',
  'budgets.actions.closePeriod': 'Zamknij ten okres',
  'budgets.actions.reopenPeriod': 'Otwórz ponownie',
  'budgets.actions.refresh': 'Przelicz okresy',

  'budgets.form.create.title': 'Nowy budżet',
  'budgets.form.edit.title': 'Edycja budżetu',
  'budgets.form.name': 'Nazwa',
  'budgets.form.name.placeholder': 'Zakupy spożywcze',
  'budgets.form.limit': 'Limit na okres',
  'budgets.form.currency': 'Waluta',
  'budgets.form.startDate': 'Początek',
  'budgets.form.startDate.help':
    'Okresy biegną od tego dnia — budżet zaczęty 12. trwa od 12. do 11.',
  'budgets.form.endDate': 'Koniec',
  'budgets.form.endDate.help': 'Zostaw puste, żeby trwał aż do archiwizacji.',
  'budgets.form.categories': 'Kategorie',
  'budgets.form.categories.help':
    'Podkategorie wliczają się automatycznie. Wybierz kategorię nadrzędną i gotowe.',
  'budgets.form.thresholds': 'Ostrzegaj przy',
  'budgets.form.thresholds.help':
    'Procent kwoty do dyspozycji. 100% i więcej jest dozwolone — czasem chce się wiedzieć przy 150%.',
  'budgets.form.thresholds.pending':
    'Progi zapisujesz tutaj, a docierać będą, gdy ruszą powiadomienia. Na razie nic nie jest wysyłane.',
  'budgets.form.submit.create': 'Utwórz budżet',
  'budgets.form.submit.save': 'Zapisz zmiany',
  'budgets.form.cancel': 'Anuluj',
  'budgets.form.error':
    'Nie udało się zapisać budżetu. Nic nie zostało zmienione.',

  'budgets.confirm.archive.title': 'Zarchiwizować ten budżet?',
  'budgets.confirm.archive.body':
    'Zniknie z listy i zachowa wszystkie zamknięte okresy. Możesz go przywrócić w każdej chwili.',
  'budgets.confirm.archive.action': 'Archiwizuj budżet',
  'budgets.confirm.delete.title': 'Usunąć ten budżet?',
  'budgets.confirm.delete.body':
    'Tej operacji nie da się cofnąć. Budżetu, który zamknął choć jeden okres, nie można usunąć — zarchiwizuj go zamiast tego.',
  'budgets.confirm.delete.action': 'Usuń budżet',
  'budgets.confirm.closePeriod.title': 'Zamknąć ten okres?',
  'budgets.confirm.closePeriod.body':
    'Jego kwoty zostaną zamrożone, a kolejny okres zacznie się od tego, co ten budżet przenosi.',
  'budgets.confirm.closePeriod.action': 'Zamknij okres',
  'budgets.confirm.reopenPeriod.title': 'Otworzyć ten okres ponownie?',
  'budgets.confirm.reopenPeriod.body':
    'Jego kwoty znów zaczną się zmieniać, a następny okres do czasu ponownego zamknięcia nie dostanie nic na start.',
  'budgets.confirm.reopenPeriod.action': 'Otwórz okres',

  'budgets.toast.created': 'Budżet utworzony.',
  'budgets.toast.saved': 'Budżet zapisany.',
  'budgets.toast.archived': 'Budżet zarchiwizowany.',
  'budgets.toast.restored': 'Budżet przywrócony.',
  'budgets.toast.deleted': 'Budżet usunięty.',
  'budgets.toast.periodClosed': 'Okres zamknięty.',
  'budgets.toast.periodReopened': 'Okres otwarty ponownie.',
  'budgets.toast.refreshed': 'Okresy przeliczone.',
  'budgets.toast.failed': 'Nie udało się. Nic nie zostało zmienione.',

  /* -- Money and currency ------------------------------------------------- */
  'money.baseCurrency.label': 'Waluta raportowania',
  'money.baseCurrency.help':
    'Wszystkie sumy i wykresy przeliczamy na tę walutę po kursie z danego dnia.',
  'money.exchangeRate.label': 'Kurs wymiany',
  'money.exchangeRate.manual': 'Ustawiony przez Ciebie',
  'money.exchangeRate.automatic': 'Aktualizowany codziennie',
  'money.convertedAt': 'Przeliczono po kursie {rate}',
  'money.amountIn': 'Kwota w walucie {currency}',
  'money.spoken.negative': 'minus {amount}',
  'money.spoken.positive': 'plus {amount}',
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
  'a11y.showSuggestions': 'Pokaż podpowiedzi',

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

  /* -- Settings ----------------------------------------------------------- */
  'settings.subtitle':
    'Jak produkt wygląda dla Ciebie i co zawiera ta przestrzeń. Każda karta wskazuje, czyje jest dane ustawienie.',
  'settings.scope.you': 'Tylko Twoje',
  'settings.scope.workspace': 'Wspólne dla przestrzeni',
  'settings.appearance.description':
    'Jasny, ciemny albo zgodny z ustawieniem tego urządzenia. Zapisujemy go lokalnie, więc telefon i laptop mogą mieć różne motywy.',
  'settings.language.description':
    'W tym języku opisany jest każdy ekran, każda etykieta i każda data. Zmiana przeładowuje stronę, bo teksty dobiera serwer.',
  'settings.account.title': 'Twoje konto',
  'settings.account.description': 'Dane konta, z którego korzystasz.',
  'settings.workspace.description':
    'Wspólne księgi tej przestrzeni. Do tych dwóch list przypisywana jest każda transakcja.',
  'settings.workspace.name': 'Nazwa przestrzeni',
  'settings.categories.description':
    'Dwupoziomowe drzewo, do którego trafia każda transakcja.',
  'settings.payees.description':
    'Komu trafiły pieniądze oraz nazwy, które import ma z nimi scalać.',

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

  /* -- Cykliczne ---------------------------------------------------------- */
  /* -- Lista -------------------------------------------------------------- */
  'recurring.title': 'Cykliczne',
  'recurring.subtitle':
    'To, co wraca regularnie — subskrypcje, rachunki, raty i stałe wpływy.',
  'recurring.new': 'Nowa seria',
  'recurring.list.loading': 'Wczytywanie serii cyklicznych…',
  'recurring.detail.loading': 'Wczytywanie serii…',
  'recurring.detail.back': 'Wszystkie serie cykliczne',

  'recurring.filter.label': 'Pokaż',
  'recurring.filter.active': 'Aktywne',
  'recurring.filter.all': 'Wszystkie, łącznie z wstrzymanymi',

  'recurring.error.title': 'Nie udało się wczytać serii cyklicznych',
  'recurring.error.body':
    'Lista nie wróciła. Nic nie zostało zmienione — spróbuj ponownie.',
  'recurring.detail.error.title': 'Nie udało się wczytać tej serii',
  'recurring.detail.error.body':
    'Mogła zostać usunięta albo żądanie nie wróciło. Nic nie zostało zmienione.',

  'recurring.empty.title': 'Nie masz jeszcze nic cyklicznego',
  'recurring.empty.body':
    'Seria to plan: kwota, częstotliwość i data pierwszej płatności. Sama z siebie niczego nie zapisuje, dopóki jej o to nie poprosisz.',
  'recurring.empty.action': 'Utwórz pierwszą serię',
  'recurring.empty.detect': 'Albo przejrzyj to, co już masz zapisane',
  'recurring.empty.filtered.title': 'Tu nic nie ma',
  'recurring.empty.filtered.body':
    'Żadna seria nie pasuje do tego filtra. Spróbuj innego.',

  /* -- Status jest słowem, zanim stanie się kolorem ------------------------ */
  'recurring.status.upcoming': 'Nadchodzi',
  'recurring.status.paid': 'Opłacone',
  'recurring.status.overdue': 'Po terminie',
  'recurring.status.skipped': 'Pominięte',

  'recurring.series.active': 'Aktywna',
  'recurring.series.paused': 'Wstrzymana',
  'recurring.series.completed': 'Zakończona',

  /* -- Co jest do zapłaty, słowami ----------------------------------------- */
  'recurring.due.today': 'Termin dzisiaj',
  'recurring.due.on': 'Termin {date}',
  'recurring.due.in': {
    one: 'Termin jutro',
    few: 'Termin za {count} dni',
    many: 'Termin za {count} dni',
    other: 'Termin za {count} dnia',
  },
  'recurring.due.late': {
    one: '{count} dzień po terminie',
    few: '{count} dni po terminie',
    many: '{count} dni po terminie',
    other: '{count} dnia po terminie',
  },
  'recurring.due.none': 'Nic nieuregulowanego',
  'recurring.due.overdueCount': {
    one: '{count} okres po terminie',
    few: '{count} okresy po terminie',
    many: '{count} okresów po terminie',
    other: '{count} okresu po terminie',
  },

  'recurring.upcoming.title': 'Wkrótce',
  'recurring.upcoming.caption':
    'Każdy nieuregulowany okres z najbliższego miesiąca oraz wszystko, co jest już po terminie.',
  'recurring.upcoming.empty': 'W najbliższym miesiącu nic nie wypada.',

  /* -- Jak często ----------------------------------------------------------- */
  'recurring.frequency.label': 'Jak często',
  'recurring.frequency.weekly': 'Co tydzień',
  'recurring.frequency.biweekly': 'Co dwa tygodnie',
  'recurring.frequency.monthly': 'Co miesiąc',
  'recurring.frequency.quarterly': 'Co kwartał',
  'recurring.frequency.semi_annual': 'Dwa razy w roku',
  'recurring.frequency.annual': 'Raz w roku',

  /* -- Rodzaj --------------------------------------------------------------- */
  'recurring.kind.label': 'Rodzaj',
  'recurring.kind.subscription': 'Subskrypcja',
  'recurring.kind.bill': 'Rachunek',
  'recurring.kind.installment': 'Rata',
  'recurring.kind.income': 'Wpływ',

  'recurring.direction.label': 'Kierunek',
  'recurring.direction.expense': 'Wydatek',
  'recurring.direction.income': 'Wpływ',

  /* -- Tabela okresów -------------------------------------------------------- */
  'recurring.periods.title': 'Historia okresów',
  'recurring.periods.caption':
    'Wszystkie okresy tej serii, od najstarszego, wraz z tym, co je uregulowało.',
  'recurring.periods.empty':
    'Brak okresów. Pierwszy pojawi się, gdy nadejdzie data początkowa.',
  'recurring.periods.col.due': 'Termin',
  'recurring.periods.col.expected': 'Oczekiwana',
  'recurring.periods.col.settled': 'Uregulowana',
  'recurring.periods.col.variance': 'Różnica',
  'recurring.periods.col.status': 'Stan',
  'recurring.periods.col.actions': 'Działania',
  'recurring.periods.variance.none': 'Zgodnie z oczekiwaniem',
  'recurring.periods.variance.unavailable': 'Inna waluta',
  'recurring.periods.variance.over': '{amount} więcej niż oczekiwano',
  'recurring.periods.variance.under': '{amount} mniej niż oczekiwano',
  'recurring.periods.notSettled': 'Nieuregulowany',

  'recurring.period.markPaid': 'Oznacz jako opłacone',
  'recurring.period.markPaid.for':
    'Oznacz okres z terminem {date} jako opłacony',
  'recurring.period.skip': 'Pomiń',
  'recurring.period.skip.for': 'Pomiń okres z terminem {date}',
  'recurring.period.revert': 'Cofnij',
  'recurring.period.revert.for': 'Cofnij okres z terminem {date}',

  /* -- Oznaczanie jako opłacone ---------------------------------------------- */
  'recurring.markPaid.title': 'Oznacz ten okres jako opłacony',
  'recurring.markPaid.body':
    'Wskaż transakcję, która go uregulowała. Nic tutaj nie tworzy transakcji — jeśli płatność nie jest jeszcze zapisana, zapisz ją najpierw.',
  'recurring.markPaid.field': 'Transakcja, która to uregulowała',
  'recurring.markPaid.placeholder': 'Szukaj w transakcjach',
  'recurring.markPaid.empty':
    'Żadna transakcja z tego okna nie pasuje. Zapisz najpierw płatność i wróć tutaj.',
  'recurring.markPaid.confirm': 'Połącz',
  'recurring.markPaid.never':
    'Oznaczenie okresu jako opłaconego nigdy nie tworzy transakcji.',

  /* -- Automatyzacja --------------------------------------------------------- */
  'recurring.automation.label': 'Automatyzacja',
  'recurring.automation.none':
    'Wyłączona — każdą płatność zapisujesz samodzielnie',
  'recurring.automation.none.help':
    'Seria przypomina i pilnuje, co jest nieuregulowane. Nic nie zostanie zapisane bez Ciebie.',
  'recurring.automation.auto': 'Zapisuj za mnie',
  'recurring.automation.auto.help':
    'W dniu terminu na wskazanym koncie powstaje transakcja na oczekiwaną kwotę. Możesz ją potem edytować jak każdą inną.',
  'recurring.automation.match': 'Dopasowuj to, co zapiszę',
  'recurring.automation.match.help':
    'Nic nie zostaje zapisane. Transakcja, którą wprowadzisz i która pasuje do poniższej reguły, zostanie połączona z okresem, który reguluje.',
  'recurring.automation.exclusive':
    'Seria albo zapisuje za Ciebie, albo dopasowuje to, co zapisujesz. Nie może robić obu naraz — automatyczny wpis nie ma już czego dopasowywać.',
  'recurring.automation.needsAccount':
    'Zapisywanie za Ciebie wymaga konta, na którym ma powstać transakcja.',
  'recurring.automation.badge.auto': 'Zapisuje automatycznie',
  'recurring.automation.badge.match': 'Dopasowuje Twoje wpisy',

  'recurring.match.payee': 'Słowa w odbiorcy lub notatce',
  'recurring.match.payee.help':
    'Wystarczy jedno z nich. Wielkość liter nie ma znaczenia.',
  'recurring.match.account': 'Tylko na tym koncie',
  'recurring.match.account.any': 'Dowolne konto',
  'recurring.match.tolerance': 'Dopuszczalna różnica kwoty',
  'recurring.match.tolerance.help':
    'Rachunek, który trochę się waha, nadal pasuje. Zero oznacza, że kwota musi się zgadzać co do grosza.',
  'recurring.match.window': 'Dopuszczalna różnica daty',
  'recurring.match.window.days': {
    one: '{count} dzień',
    few: '{count} dni',
    many: '{count} dni',
    other: '{count} dnia',
  },

  /* -- Przypomnienia ---------------------------------------------------------- */
  'recurring.reminders.label': 'Przypomnij mi',
  'recurring.reminders.help':
    'Najwyżej trzy. Zostaw wszystkie wyłączone, jeśli nie chcesz przypomnień.',
  'recurring.reminders.none': 'Bez przypomnień',
  'recurring.reminders.max': 'Seria może mieć najwyżej trzy przypomnienia.',
  'recurring.reminders.0d': 'W dniu terminu',
  'recurring.reminders.1d': 'Dzień wcześniej',
  'recurring.reminders.2d': 'Dwa dni wcześniej',
  'recurring.reminders.3d': 'Trzy dni wcześniej',
  'recurring.reminders.5d': 'Pięć dni wcześniej',
  'recurring.reminders.1w': 'Tydzień wcześniej',
  'recurring.reminders.2w': 'Dwa tygodnie wcześniej',
  'recurring.reminders.1m': 'Miesiąc wcześniej',
  'recurring.reminders.email': 'Wysyłaj je również e-mailem',
  'recurring.reminders.pending':
    'Przypomnienia są tutaj ustalane, a dostarczane będą wraz z powiadomieniami. Na razie nic nie jest wysyłane.',

  /* -- Formularz -------------------------------------------------------------- */
  'recurring.form.create.title': 'Nowa seria cykliczna',
  'recurring.form.edit.title': 'Edytuj serię',
  'recurring.form.error': 'Nie udało się zapisać tej serii',
  'recurring.form.name': 'Nazwa',
  'recurring.form.name.placeholder': 'Czynsz, Netflix, wypłata…',
  'recurring.form.amount': 'Oczekiwana kwota',
  'recurring.form.currency': 'Waluta',
  'recurring.form.currency.locked':
    'Waluta jest stała od chwili powstania serii. Każdy zaplanowany okres jest w niej wyrażony.',
  'recurring.form.direction.locked':
    'Kierunek jest stały od chwili powstania serii. Jego odwrócenie oznaczałoby, że cała historia przebiegła w drugą stronę.',
  'recurring.form.startDate': 'Pierwszy termin',
  'recurring.form.startDate.help':
    'Okresy sprzed dzisiaj też powstaną, więc seria wstecz od razu pokaże swoją historię.',
  'recurring.form.anchorDay': 'Dzień miesiąca',
  'recurring.form.anchorDay.help':
    'Dzień wykraczający poza koniec krótszego miesiąca cofa się do jego ostatniego dnia, a kolejny miesiąc znów trzyma się kotwicy, zamiast się przesuwać.',
  'recurring.form.anchorDay.auto': 'Ten sam dzień co pierwszy termin',
  'recurring.form.account': 'Konto',
  'recurring.form.account.none': 'Bez konta',
  'recurring.form.category': 'Kategoria',
  'recurring.form.category.none': 'Bez kategorii',
  'recurring.form.payee': 'Odbiorca',
  'recurring.form.payee.none': 'Bez odbiorcy',
  'recurring.form.widget': 'Pokazuj na pulpicie',

  'recurring.termination.label': 'Kiedy się kończy',
  'recurring.termination.open': 'Nie kończy się — trwa dalej',
  'recurring.termination.endDate': 'W konkretnym dniu',
  'recurring.termination.endDate.field': 'Ostatni dzień',
  'recurring.termination.endDate.help':
    'Okres z terminem dokładnie w tym dniu nadal się liczy.',
  'recurring.termination.maxOccurrences': 'Po określonej liczbie razy',
  'recurring.termination.maxOccurrences.field': 'Ile razy',
  'recurring.termination.maxOccurrences.help':
    'Liczone łącznie: dwanaście oznacza dwanaście okresów, razem z ostatnim.',

  'recurring.preview.title': 'Najbliższe terminy',
  'recurring.preview.help':
    'To, co daje ten harmonogram — do obejrzenia przed zapisaniem.',

  /* -- Działania -------------------------------------------------------------- */
  'recurring.actions.menu': 'Działania dla {name}',
  'recurring.actions.edit': 'Edytuj',
  'recurring.actions.pause': 'Wstrzymaj',
  'recurring.actions.resume': 'Wznów',
  'recurring.actions.complete': 'Zakończ',
  'recurring.actions.delete': 'Usuń',

  'recurring.confirm.pause.title': 'Wstrzymać tę serię?',
  'recurring.confirm.pause.body':
    'Dopóki jest wstrzymana, nic nie powstaje ani nie jest zapisywane. Historia i nieuregulowane okresy zostają bez zmian.',
  'recurring.confirm.complete.title': 'Zakończyć tę serię?',
  'recurring.confirm.complete.body':
    'Kończy się na dobre. Nic więcej już nie powstanie. Historia zostaje.',
  'recurring.confirm.delete.title': 'Usunąć tę serię?',
  'recurring.confirm.delete.body':
    'Tego nie da się cofnąć. Serii, która uregulowała choć jeden okres, nie można usunąć — zakończ ją, żeby historia przetrwała.',

  'recurring.toast.created': 'Seria utworzona',
  'recurring.toast.saved': 'Seria zapisana',
  'recurring.toast.paused': 'Seria wstrzymana',
  'recurring.toast.resumed': 'Seria wznowiona',
  'recurring.toast.completed': 'Seria zakończona',
  'recurring.toast.deleted': 'Seria usunięta',
  'recurring.toast.failed': 'Nie udało się',
  'recurring.toast.periodPaid': 'Okres oznaczony jako opłacony',
  'recurring.toast.periodSkipped': 'Okres pominięty',
  'recurring.toast.periodReverted': 'Okres otwarty ponownie',
  'recurring.toast.unlinked': 'Transakcja odłączona',

  /* -- Połączone transakcje ---------------------------------------------------- */
  'recurring.links.title': 'Połączone transakcje',
  'recurring.links.caption':
    'To, co ta seria przyjęła, i skąd wzięło się każde połączenie.',
  'recurring.links.empty': 'Nic jeszcze nie jest połączone.',
  'recurring.links.source.manual': 'Połączone przez Ciebie',
  'recurring.links.source.rule': 'Dopasowane regułą',
  'recurring.links.source.auto': 'Zapisane automatycznie',
  'recurring.links.unlink': 'Odłącz',
  'recurring.links.unlinked': 'Odłączone',

  /* -- Propozycje --------------------------------------------------------------- */
  'recurring.candidates.title': 'Zauważone serie',
  'recurring.candidates.subtitle':
    'Wzorce w tym, co masz już zapisane. Każdy z nich to propozycja, a nie coś, co zrobiliśmy.',
  'recurring.candidates.loading': 'Przeglądanie transakcji…',
  'recurring.candidates.detect': 'Poszukaj ponownie',
  'recurring.candidates.detecting': 'Szukanie…',
  'recurring.candidates.link': 'Zauważone serie',
  'recurring.candidates.pending': {
    one: '{count} propozycja',
    few: '{count} propozycje',
    many: '{count} propozycji',
    other: '{count} propozycji',
  },
  'recurring.candidates.empty.title': 'Nie mamy czego zaproponować',
  'recurring.candidates.empty.body':
    'Szukamy tego samego odbiorcy, w mniej więcej równych odstępach, na zbliżoną kwotę, co najmniej trzy razy. Nic z ostatnich osiemnastu miesięcy nie pasuje.',
  'recurring.candidates.found': {
    one: 'Znaleziono {count} propozycję',
    few: 'Znaleziono {count} propozycje',
    many: 'Znaleziono {count} propozycji',
    other: 'Znaleziono {count} propozycji',
  },
  'recurring.candidates.error.title': 'Nie udało się wczytać propozycji',
  'recurring.candidates.error.body':
    'Lista nie wróciła. Nic nie zostało zmienione — spróbuj ponownie.',

  'recurring.candidate.confidence.label': 'Pewność',
  'recurring.candidate.confidence.high': 'Wysoka',
  'recurring.candidate.confidence.medium': 'Średnia',
  'recurring.candidate.confidence.low': 'Niska',
  'recurring.candidate.evidence': {
    one: 'Na podstawie {count} transakcji',
    few: 'Na podstawie {count} transakcji',
    many: 'Na podstawie {count} transakcji',
    other: 'Na podstawie {count} transakcji',
  },
  'recurring.candidate.because.occurrences':
    'Pewność obniża to, jak niewiele razy to się wydarzyło.',
  'recurring.candidate.because.regularity':
    'Pewność obniża to, jak bardzo przesuwają się daty.',
  'recurring.candidate.because.amount':
    'Pewność obniża to, jak bardzo waha się kwota.',
  'recurring.candidate.accept': 'Utwórz serię',
  'recurring.candidate.dismiss': 'To nie jest seria',
  'recurring.candidate.dismiss.for': 'Odrzuć propozycję dla {name}',
  'recurring.candidate.accept.for': 'Utwórz serię dla {name}',
  'recurring.candidate.creates':
    'Utworzenie serii tworzy wyłącznie plan. Żadna z transakcji, na podstawie których ją znaleziono, nie zostaje zmieniona.',
  'recurring.candidate.toast.dismissed': 'Propozycja odrzucona',
  'recurring.candidate.toast.accepted': 'Seria utworzona z propozycji',

  /* -- Cele oszczędnościowe ----------------------------------------------- */
  /* -- Lista --------------------------------------------------------------- */
  'goals.title': 'Cele oszczędnościowe',
  'goals.subtitle': 'Na co odkładasz pieniądze i jak Ci idzie.',
  'goals.new': 'Nowy cel',
  'goals.list.loading': 'Wczytywanie celów oszczędnościowych…',
  'goals.detail.loading': 'Wczytywanie tego celu…',
  'goals.detail.back': 'Wszystkie cele',

  'goals.filter.label': 'Pokaż',
  'goals.filter.active': 'W trakcie',
  'goals.filter.reached': 'Osiągnięte',
  'goals.filter.archived': 'Zarchiwizowane',
  'goals.filter.all': 'Wszystkie',

  'goals.error.title': 'Nie udało się wczytać celów',
  'goals.error.body':
    'Lista nie wróciła. Nic nie zostało zmienione — spróbuj ponownie.',
  'goals.detail.error.title': 'Nie udało się wczytać tego celu',
  'goals.detail.error.body':
    'Mógł zostać usunięty albo żądanie nie wróciło. Nic nie zostało zmienione.',

  'goals.empty.title': 'Nie masz jeszcze żadnych celów',
  'goals.empty.body':
    'Cel to kwota docelowa i — jeśli chcesz — data. Postęp bierze się z transakcji, które masz już zapisane; nic tutaj nie tworzy pieniędzy ani ich nie przenosi.',
  'goals.empty.action': 'Utwórz pierwszy cel',
  'goals.empty.filtered.title': 'Tutaj nic nie ma',
  'goals.empty.filtered.body':
    'Żaden cel nie pasuje do tego filtra. Wybierz inny.',

  /* -- Status, który jest słowem, zanim stanie się kolorem ------------------ */
  'goals.status.active': 'Oszczędzasz',
  'goals.status.reached': 'Osiągnięty',
  'goals.status.archived': 'Zarchiwizowany',
  'goals.status.overdue': 'Po terminie',

  /* -- Wskaźnik ------------------------------------------------------------ */
  'goals.meter.label': 'Odłożone na cel {name}',
  'goals.meter.valueText': 'odłożone {contributed} z {target}, {percent}',
  'goals.meter.tick': 'Cel, {target}',
  'goals.meter.unavailable': 'Postęp niedostępny',
  'goals.progress.remaining': 'brakuje {amount}',
  'goals.progress.complete': 'Cel w pełni sfinansowany',
  'goals.progress.of': '{contributed} z {target}',
  'goals.progress.base': '{contributed} z {target} w {currency}',
  'goals.progress.baseHelp':
    'Kwota pomocnicza. Każda wpłata została przeliczona w dniu, w którym nastąpiła; cel przeliczamy po dzisiejszym kursie.',

  /* -- Daty ---------------------------------------------------------------- */
  'goals.target.none': 'Bez daty docelowej',
  'goals.target.by': 'Do {date}',
  'goals.target.daysLeft': {
    one: '{count} dzień do daty docelowej',
    few: '{count} dni do daty docelowej',
    many: '{count} dni do daty docelowej',
    other: '{count} dnia do daty docelowej',
  },
  'goals.target.overdue': {
    one: '{count} dzień po dacie docelowej',
    few: '{count} dni po dacie docelowej',
    many: '{count} dni po dacie docelowej',
    other: '{count} dnia po dacie docelowej',
  },

  /* -- Konta --------------------------------------------------------------- */
  'goals.accounts.from': 'Finansowany z konta {name}',
  'goals.accounts.held': 'Trzymany na koncie {name}',
  'goals.accounts.unset': 'Nie ustawiono',

  /* -- Liczby na stronie celu ---------------------------------------------- */
  'goals.detail.saved': 'Odłożone',
  'goals.detail.target': 'Cel',
  'goals.detail.remaining': 'Zostało do odłożenia',
  'goals.detail.pace': 'Typowy miesiąc',
  'goals.reached.title': 'Ten cel jest w pełni sfinansowany',
  'goals.reached.body':
    'Nic więcej nie musi tu trafić. Zarchiwizuj go, aby zniknął z listy, albo podnieś kwotę docelową, jeśli plan urósł.',

  /* -- Prognoza, czyli najuczciwsza część ---------------------------------- */
  'goals.projection.heading': 'Prognozowane zakończenie',
  'goals.projection.disclaimer':
    'To prognoza, nie obietnica. Zakłada, że ostatnie sześć miesięcy się powtórzy.',
  'goals.projection.reached': 'Osiągnięty. Nie ma już czego prognozować.',
  'goals.projection.onTrack': 'Przy tym tempie osiągniesz go do {date}.',
  'goals.projection.onTrackBeforeTarget':
    'Przy tym tempie osiągniesz go do {date}, czyli przed terminem {target}.',
  'goals.projection.behind':
    'Przy tym tempie nie wcześniej niż {date}, czyli {late} po terminie.',
  'goals.projection.late': {
    one: '{count} dzień',
    few: '{count} dni',
    many: '{count} dni',
    other: '{count} dnia',
  },
  'goals.projection.rate': 'Na podstawie typowej wpłaty {amount} miesięcznie.',
  'goals.projection.months': {
    one: 'z {count} miesiąca wpłat',
    few: 'z {count} miesięcy wpłat',
    many: 'z {count} miesięcy wpłat',
    other: 'z {count} miesiąca wpłat',
  },

  'goals.projection.confidence.label': 'Na ile można temu ufać',
  'goals.projection.confidence.low': 'Zgrubne oszacowanie',
  'goals.projection.confidence.low.help':
    'Dotychczasowe wpłaty różnią się od siebie bardziej, niż wynosi ich średnia, więc traktuj tę datę jako kierunek, a nie plan.',
  'goals.projection.confidence.medium': 'Rozsądne oszacowanie',
  'goals.projection.confidence.medium.help':
    'Pół roku wpłat w rozpoznawalnym tempie. Wystarczy do planowania, za mało, by się zobowiązywać.',
  'goals.projection.confidence.high': 'Stały rytm',
  'goals.projection.confidence.high.help':
    'Rok lub więcej wpłat w równym tempie. Lepszej prognozy z tych danych nie da się zrobić.',

  'goals.projection.insufficient.title': 'Za mało historii, by prognozować',
  'goals.projection.insufficient.none':
    'Nie ma jeszcze żadnej wpłaty, więc nie ma tempa, z którego dałoby się prognozować.',
  'goals.projection.insufficient.tooFew': {
    one: 'Jeden miesiąc wpłat to jeszcze nie tempo. Prognozowana data potrzebuje co najmniej {needed} miesięcy za sobą.',
    few: '{count} miesiące wpłat to jeszcze nie tempo. Prognozowana data potrzebuje co najmniej {needed} miesięcy za sobą.',
    many: '{count} miesięcy wpłat to jeszcze nie tempo. Prognozowana data potrzebuje co najmniej {needed} miesięcy za sobą.',
    other:
      '{count} miesiąca wpłat to jeszcze nie tempo. Prognozowana data potrzebuje co najmniej {needed} miesięcy za sobą.',
  },
  'goals.projection.insufficient.stale':
    'Ostatnia wpłata była ponad sześć miesięcy temu. Dawne tempo się zatrzymało, a prognozowanie z niego wymyśliłoby nowe.',

  /* -- Wykres -------------------------------------------------------------- */
  'goals.chart.title': 'Wpłaty miesiąc po miesiącu',
  'goals.chart.category': 'Miesiąc',
  'goals.chart.series.monthly': 'Wpłacone w tym miesiącu',
  'goals.chart.empty.title': 'Nie ma jeszcze czego pokazać',
  'goals.chart.empty.body':
    'Zalicz transakcję na poczet tego celu, a jej historia pojawi się tutaj.',
  'goals.chart.noData': 'Nic',
  'goals.chart.zeroNote':
    'Miesiąc bez słupka to miesiąc, w którym nic nie wpłynęło — prawdziwe zero, a nie brak danych.',

  /* -- Wpłaty -------------------------------------------------------------- */
  'goals.contributions.heading': 'Historia wpłat',
  'goals.contributions.count': {
    one: '{count} wpłata',
    few: '{count} wpłaty',
    many: '{count} wpłat',
    other: '{count} wpłaty',
  },
  'goals.contributions.empty.title': 'Nie ma jeszcze wpłat',
  'goals.contributions.empty.body':
    'Wpłata wskazuje na transakcję, którą masz już zapisaną. Nic nowego nie powstaje i żadne pieniądze się nie przemieszczają.',
  'goals.contributions.column.date': 'Data',
  'goals.contributions.column.amount': 'Kwota',
  'goals.contributions.column.detail': 'Transakcja',
  'goals.contributions.column.actions': 'Działania',
  'goals.contributions.linkedOn': 'Zaliczono {date}',
  'goals.contributions.remove': 'Usuń {amount} z tego celu',
  'goals.contributions.add': 'Zalicz transakcję',

  /* -- Podpowiedzi: propozycje, nigdy automatyczne powiązania -------------- */
  'goals.suggestions.heading': 'Przelewy, które wyglądają na wpłaty',
  'goals.suggestions.body':
    'Żaden z poniższych nie został zaliczony. Każdy wyszedł z konta finansującego i trafił na konto, na którym trzymasz ten cel — to Ty decydujesz, czy był na ten cel.',
  'goals.suggestions.count': {
    one: '{count} przelew do przejrzenia',
    few: '{count} przelewy do przejrzenia',
    many: '{count} przelewów do przejrzenia',
    other: '{count} przelewu do przejrzenia',
  },
  'goals.suggestions.accept': 'Zalicz: {amount} na poczet tego celu',
  'goals.suggestions.from': 'Z konta {account}',

  /* -- Formularz ----------------------------------------------------------- */
  'goals.form.create.title': 'Nowy cel oszczędnościowy',
  'goals.form.edit.title': 'Edycja celu oszczędnościowego',
  'goals.form.description':
    'Kwota docelowa, waluta, w której cel jest liczony, oraz — jeśli ma termin — data.',
  'goals.form.name': 'Na co odkładasz',
  'goals.form.name.placeholder': 'Poduszka finansowa',
  'goals.form.target': 'Kwota docelowa',
  'goals.form.currency': 'Waluta',
  'goals.form.currency.help':
    'Cel jest liczony w jednej walucie i przy niej zostaje. Wpłaty w każdej innej walucie są odrzucane, zamiast przeliczane po kursie, którego nikt nie wybrał.',
  'goals.form.currency.locked': 'Ustalona przy tworzeniu celu',
  'goals.form.targetDate': 'Data docelowa',
  'goals.form.targetDate.help':
    'Opcjonalna. Bez niej cel nadal ma swoje tempo — po prostu nie ma terminu, po którym mógłby być opóźniony.',
  'goals.form.fromAccount': 'Finansowany z',
  'goals.form.fromAccount.help':
    'Skąd pochodzą pieniądze. Służy do wychwytywania przelewów, które wyglądają na wpłaty.',
  'goals.form.heldAccount': 'Trzymany na',
  'goals.form.heldAccount.help':
    'Gdzie leżą pieniądze. Oba konta są opcjonalne; ustaw oba, a cel będzie podpowiadał wpłaty.',
  'goals.form.cancel': 'Anuluj',
  'goals.form.submit.create': 'Utwórz cel',
  'goals.form.submit.save': 'Zapisz zmiany',
  'goals.form.error': 'Nie udało się zapisać celu',

  /* -- Zaliczanie wpłaty ---------------------------------------------------- */
  'goals.contribute.title': 'Zalicz transakcję na poczet celu {name}',
  'goals.contribute.description':
    'Wybierz transakcję, która już się wydarzyła. Zostaje dokładnie taka, jaka jest — zapisujemy tylko to, na co była.',
  'goals.contribute.field': 'Transakcja',
  'goals.contribute.field.help':
    'Zaliczyć można wyłącznie transakcje w walucie {currency}, ponieważ cel jest liczony w {currency}.',
  'goals.contribute.option': '{date} · {amount}',
  'goals.contribute.empty':
    'Nie ma niepowiązanej transakcji w walucie {currency}, którą można zaliczyć. Zapisz ją najpierw albo zmień konto, na którym trzymasz ten cel.',
  'goals.contribute.submit': 'Zalicz',
  'goals.contribute.cancel': 'Anuluj',
  'goals.contribute.error': 'Nie udało się zaliczyć transakcji',
  'goals.contribute.error.currency':
    'Ta transakcja jest w walucie {transaction}, a cel w {goal}. Przeliczenie wymagałoby kursu, którego nikt nie wybrał, więc odrzucamy ją, zamiast zgadywać.',
  'goals.contribute.error.direction':
    'Ten cel jest finansowany transakcjami typu {expected}, a ta jest typu {received}. Zaliczenie jej zmniejszyłoby postęp, zamiast go zwiększyć.',

  /* -- Akcje i potwierdzenia ------------------------------------------------ */
  'goals.actions.label': 'Działania dla celu {name}',
  'goals.actions.edit': 'Edytuj',
  'goals.actions.archive': 'Zarchiwizuj',
  'goals.actions.restore': 'Przywróć',
  'goals.actions.delete': 'Usuń',
  'goals.actions.recompute': 'Przelicz postęp ponownie',

  'goals.confirm.archive.title': 'Zarchiwizować ten cel?',
  'goals.confirm.archive.body':
    'Zniknie z listy i zachowa wszystkie swoje wpłaty. W każdej chwili możesz go przywrócić.',
  'goals.confirm.archive.action': 'Zarchiwizuj',
  'goals.confirm.delete.title': 'Usunąć ten cel?',
  'goals.confirm.delete.body':
    'Cel i zapis o tym, które transakcje się na niego składały, znikną na dobre. Same transakcje pozostają nietknięte.',
  'goals.confirm.delete.action': 'Usuń',
  'goals.confirm.remove.title': 'Usunąć tę wpłatę?',
  'goals.confirm.remove.body':
    'Transakcja zostaje dokładnie taka, jaka jest. Znika tylko adnotacja, że była na ten cel, a postęp spada o tę kwotę.',
  'goals.confirm.remove.action': 'Usuń',

  'goals.toast.created': 'Cel utworzony',
  'goals.toast.saved': 'Cel zapisany',
  'goals.toast.archived': 'Cel zarchiwizowany',
  'goals.toast.restored': 'Cel przywrócony',
  'goals.toast.deleted': 'Cel usunięty',
  'goals.toast.contributed': 'Zaliczono na poczet celu',
  'goals.toast.uncontributed': 'Usunięto z celu',
  'goals.toast.recomputed': 'Postęp przeliczony',
  'goals.toast.reached': 'Cel {name} jest w pełni sfinansowany',
  'goals.toast.failed': 'Nie udało się',
} satisfies TranslationOf<typeof En>

export default messages
