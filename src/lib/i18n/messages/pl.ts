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
 * (`1,5 wydatku`), so it is not a copy of `many`. Every plural message below
 * carries all four.
 *
 * **Household vocabulary, not accountancy.** This is a product for people who
 * keep a household budget, not for bookkeepers, so the surface reads the way
 * they speak: `Wydatek` for a transaction, `Stan konta` for a balance,
 * `Odbiorca` for a payee, `Dom` for a workspace, `Konto osobiste` for a current
 * account, `Zasada` for a rule, `Wyrównanie stanu konta` for a balance
 * adjustment. The code keeps the domain names (`transaction`, `payee`,
 * `workspace`); this rule governs what is displayed, not what is stored.
 * `Zlecenie stałe` and `Polecenie zapłaty` stay, because they are the words
 * printed on the statement the reader is holding.
 *
 * Second person is `Ty`-form and capitalised in direct address (`Cię`, `Twoje`),
 * which is the register a Polish product uses with an individual user.
 */
const messages = {
  /* -- Dokument ----------------------------------------------------------- */
  'meta.title': 'Money Tracker — wiedz, dokąd trafiają Twoje pieniądze',
  'meta.description':
    'Budżet domowy: konta, wydatki, limity na kategorie, płatności cykliczne i kilka walut naraz. Wszystko wpisujesz sam albo wczytujesz z pliku, nigdy nie łączymy się z Twoim bankiem.',
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
  'app.workspace.label': 'Dom',
  'app.workspace.switch': 'Przełącz dom',
  'app.workspace.create': 'Nowy dom',
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
  'nav.payees': 'Odbiorcy',
  'nav.recurring': 'Cykliczne',
  'nav.goals': 'Cele',
  'nav.reports': 'Raporty',
  'nav.rules': 'Zasady',
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
  'action.moveToTop': 'Przenieś na początek',
  'action.moveToBottom': 'Przenieś na koniec',
  'action.undo': 'Cofnij',
  'action.done': 'Gotowe',
  'action.skip': 'Pomiń',
  'action.learnMore': 'Dowiedz się więcej',

  /* -- Dialogs ------------------------------------------------------------ */
  'dialog.unsaved.title': 'Niezapisane zmiany',
  'dialog.unsaved.body':
    'Ten formularz zawiera zmiany, które nie zostały zapisane. Zamknięcie go teraz je odrzuci.',
  'dialog.unsaved.discard': 'Odrzuć zmiany',
  'dialog.unsaved.keepEditing': 'Wróć do edycji',

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
    'Usunąć konto {name}? Razem z nim znikną wszystkie jego wydatki, a tego nie da się cofnąć.',
  'accounts.field.name': 'Nazwa konta',
  'accounts.field.category': 'Rodzaj konta',
  'accounts.field.currency': 'Waluta',
  'accounts.field.initialBalance': 'Stan początkowy',
  'accounts.field.initialBalance.help':
    'Ile było na koncie dzień przed pierwszym wydatkiem.',
  'accounts.field.creditLimit': 'Limit kredytowy',
  'accounts.field.note': 'Notatka',
  'accounts.field.excludeFromStats': 'Pomijaj w raportach',
  'accounts.field.excludeFromStats.help':
    'Konto działa normalnie, ale nie wlicza się do sum ani wykresów.',
  'accounts.category.general': 'Ogólne',
  'accounts.category.cash': 'Gotówka',
  'accounts.category.current': 'Konto osobiste',
  'accounts.category.creditCard': 'Karta kredytowa',
  'accounts.category.savings': 'Oszczędności',
  'accounts.category.investment': 'Inwestycje',
  'accounts.category.loan': 'Kredyt',
  'accounts.category.other': 'Inne',
  'accounts.balance': 'Stan konta',
  'accounts.balance.available': 'Dostępne środki',
  'accounts.balance.adjust': 'Wyrównaj stan konta',
  'accounts.balance.adjust.help':
    'Wyrównanie zapisuje się jako osobny wpis z datą, więc historia zostaje wiarygodna.',
  'accounts.totalBalance': 'Łącznie na kontach',
  'accounts.netWorth': 'Wartość netto',
  'accounts.hideZeroBalance': 'Ukryj konta z zerowym stanem',
  'accounts.group.title': 'Grupy',
  'accounts.group.create': 'Nowa grupa',
  'accounts.group.ungrouped': 'Poza grupami',
  'accounts.groups.title': 'Grupy kont',
  'accounts.groups.description':
    'Foldery na Twoje konta, np. Wspólne albo Firmowe. Grupa nigdy nie zmienia salda.',
  'accounts.groups.manage': 'Zarządzaj grupami',
  'accounts.groups.loading': 'Wczytywanie grup kont',
  'accounts.groups.empty.title': 'Nie masz jeszcze grup',
  'accounts.groups.empty.body':
    'Grupa zbiera konta pod jedną nazwą, np. Wspólne albo Firmowe, żeby lista wyglądała tak, jak o niej myślisz. Konta zachowują własne salda.',
  'accounts.groups.error.title': 'Nie udało się wczytać grup kont',
  'accounts.groups.error.body':
    'Nic nie zostało zmienione. Spróbuj ponownie za chwilę.',
  'accounts.groups.tree.label': 'Grupy kont, w kolejności wyświetlania',
  'accounts.groups.row.group': {
    one: '{name}, grupa, {count} konto',
    few: '{name}, grupa, {count} konta',
    many: '{name}, grupa, {count} kont',
    other: '{name}, grupa, {count} konta',
  },
  'accounts.groups.row.childOf': {
    one: '{name}, wewnątrz {parent}, {count} konto',
    few: '{name}, wewnątrz {parent}, {count} konta',
    many: '{name}, wewnątrz {parent}, {count} kont',
    other: '{name}, wewnątrz {parent}, {count} konta',
  },
  'accounts.groups.row.account': '{account}, w grupie {group}',
  'accounts.groups.row.accountArchived':
    '{account}, zarchiwizowane, w grupie {group}',
  'accounts.groups.drag.label': 'Przeciągnij: {name}',
  'accounts.groups.drag.labelChild': 'Przeciągnij: {name}, wewnątrz {parent}',
  'accounts.groups.actions.label': 'Działania dla: {name}',
  'accounts.groups.actions.labelChild':
    'Działania dla: {name}, wewnątrz {parent}',
  'accounts.group.field.name': 'Nazwa grupy',
  'accounts.group.field.parent': 'Wewnątrz',
  'accounts.group.field.parent.hasChildren':
    'Ta grupa ma podgrupy, więc nie może leżeć wewnątrz innej grupy.',
  'accounts.group.parent.none': 'Bez nadrzędnej',
  'accounts.group.rename': 'Zmień nazwę',
  'accounts.group.addChild': 'Dodaj podgrupę',
  'accounts.group.form.error.title': 'Nie zapisano grupy',
  'accounts.group.disabled.noGrandchild':
    'Podgrupa nie może mieć własnych podgrup',
  'accounts.group.disabled.first': 'Już jest pierwsza',
  'accounts.group.disabled.last': 'Już jest ostatnia',
  'accounts.group.disabled.same': 'Już tam jest',
  'accounts.group.toast.created': 'Utworzono grupę: {name}',
  'accounts.group.toast.renamed': 'Zmieniono nazwę grupy: {name}',
  'accounts.group.toast.reparented':
    'Przeniesiono grupę: {name}, teraz wewnątrz {parent}',
  'accounts.group.toast.reparentedTop':
    'Przeniesiono grupę: {name}, teraz na poziomie głównym',
  'accounts.group.toast.deleted': 'Usunięto grupę: {name}',
  'accounts.group.announce.position':
    'Przeniesiono grupę: {name}, pozycja {position} z {total}',
  'accounts.group.announce.positionChild':
    'Przeniesiono grupę: {name}, pozycja {position} z {total} wewnątrz {parent}',
  'accounts.group.refused.title': 'Nie wprowadzono zmiany',
  'accounts.group.refused.conflict':
    'To nie pasuje do obecnych grup. Grupa może leżeć wewnątrz jednej innej grupy, nie dwóch poziomów głębiej.',
  'accounts.group.refused.notFound':
    'Lista zmieniła się w innym oknie. Wczytaliśmy ją ponownie.',
  'accounts.group.refused.forbidden':
    'Grupy we wspólnym obszarze roboczym może zmieniać tylko właściciel albo administrator.',
  'accounts.group.refused.generic': 'Coś poszło nie tak. Spróbuj ponownie.',
  'accounts.group.delete.action': 'Usuń grupę',
  'accounts.group.delete.title': 'Usunąć grupę {name}?',
  'accounts.group.delete.body': {
    one: '{count} konto opuszcza tę grupę. Żadne nie zostanie usunięte. Podgrupy trafią na poziom główny.',
    few: '{count} konta opuszczą tę grupę. Żadne nie zostanie usunięte. Podgrupy trafią na poziom główny.',
    many: '{count} kont opuści tę grupę. Żadne nie zostanie usunięte. Podgrupy trafią na poziom główny.',
    other:
      '{count} konta opuści tę grupę. Żadne nie zostanie usunięte. Podgrupy trafią na poziom główny.',
  },
  'accounts.group.delete.bodyEmpty': 'Podgrupy trafią na poziom główny.',
  'accounts.group.delete.rules':
    'Reguły używające tej grupy zostaną wstrzymane, dopóki nie wybierzesz innej.',
  'accounts.count': {
    one: '{count} konto',
    few: '{count} konta',
    many: '{count} kont',
    other: '{count} konta',
  },
  'accounts.empty.title': 'Nie masz jeszcze kont',
  'accounts.empty.body':
    'Dodaj pierwsze konto, które chcesz śledzić: konto w banku, portfel albo kartę.',
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
  'accounts.filter.count': {
    one: 'Widoczne {shown} z {total} konta',
    few: 'Widoczne {shown} z {total} kont',
    many: 'Widoczne {shown} z {total} kont',
    other: 'Widoczne {shown} z {total} konta',
  },
  'accounts.status.excluded': 'Poza raportami',
  'accounts.list.label': 'Twoje konta',
  'accounts.list.loading': 'Wczytujemy Twoje konta…',
  'accounts.error.title': 'Nie udało się wczytać kont',
  'accounts.error.body':
    'Nic nie zostało zmienione. Spróbuj ponownie, a jeśli błąd się powtarza, Twój dom jest chwilowo niedostępny.',
  'accounts.balance.missing': 'Stan konta niedostępny',
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
  'accounts.detail.balanceToday': 'Stan na dziś',
  'accounts.detail.transactions': {
    one: '{count} wydatek na tym koncie',
    few: '{count} wydatki na tym koncie',
    many: '{count} wydatków na tym koncie',
    other: '{count} wydatku na tym koncie',
  },
  'accounts.detail.note.empty': 'To konto nie ma jeszcze notatki.',
  'accounts.detail.ledger.empty': 'Na tym koncie nie ma jeszcze transakcji.',
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
    'Zniknie z sum i z list wyboru, ale zachowa wszystkie wydatki. Możesz je przywrócić w każdej chwili.',
  'accounts.archive.action': 'Zarchiwizuj konto',
  'accounts.restore.action': 'Przywróć konto',
  'accounts.delete.title': 'Usunąć konto {name}?',
  'accounts.delete.action': 'Usuń bezpowrotnie',
  'accounts.delete.blocked': {
    one: 'Na tym koncie jest {count} wydatek, więc nie można go usunąć. Zarchiwizuj je, historia zostanie zachowana.',
    few: 'Na tym koncie są {count} wydatki, więc nie można go usunąć. Zarchiwizuj je, historia zostanie zachowana.',
    many: 'Na tym koncie jest {count} wydatków, więc nie można go usunąć. Zarchiwizuj je, historia zostanie zachowana.',
    other:
      'Na tym koncie jest {count} wydatku, więc nie można go usunąć. Zarchiwizuj je, historia zostanie zachowana.',
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
    'Zmiana waluty albo stanu początkowego przelicza całą historię tego konta.',
  'accounts.form.error.title': 'Nie udało się zapisać konta',
  'accounts.field.openedOn': 'Data otwarcia',
  'accounts.field.openedOn.help':
    'Dzień, którego dotyczy stan początkowy. To z tego dnia zapisujemy kurs wymiany.',
  'accounts.field.creditLimit.help':
    'Kwota dodatnia. Zostaw puste, jeśli konto nie ma limitu.',
  'accounts.field.currency.help':
    'Proponujemy tylko waluty, które ma Twój dom.',
  /* -- Accounts: correcting a balance ------------------------------------- */
  'accounts.adjust.body':
    'Podaj, ile powinno być na koncie. Różnicę zapiszemy jako zwykły wpis, który znajdziesz, poprawisz i pobierzesz razem z resztą.',
  'accounts.adjust.field.target': 'Ile powinno być na koncie',
  'accounts.adjust.field.date': 'Na koniec dnia',
  'accounts.adjust.field.note': 'Powód',
  'accounts.adjust.field.note.help':
    'Zapisujemy go przy tym wpisie, więc powód zostaje razem z wyrównaniem.',
  'accounts.adjust.preview.title': 'Co zostanie zapisane',
  'accounts.adjust.preview.income': 'Wpływ {amount} z datą {date}.',
  'accounts.adjust.preview.expense': 'Wydatek {amount} z datą {date}.',
  'accounts.adjust.preview.none':
    'Nic. Na dzień {date} na koncie jest już {amount}.',
  'accounts.adjust.preview.loading': 'Odczytujemy stan konta na dzień {date}…',
  'accounts.adjust.preview.error':
    'Nie udało się odczytać stanu konta na dzień {date}.',
  'accounts.adjust.preview.blocked':
    'Korektę zapiszesz, gdy odczytamy stan konta na dzień {date}.',
  'accounts.adjust.preview.blockedFailed':
    'Korektę zapiszesz, gdy odczytamy stan konta na dzień {date}. Wybierz „{retry}”, aby spróbować jeszcze raz.',
  'accounts.adjust.preview.blockedFuture':
    'Korekty nie zapiszesz z datą, która jeszcze nie nadeszła. Wybierz dzień do dzisiaj włącznie.',
  'accounts.adjust.action': 'Zapisz korektę',
  'accounts.adjust.result.title': 'Zapisano',
  'accounts.adjust.result.income': 'Zapisaliśmy wpływ {amount} z datą {date}.',
  'accounts.adjust.result.expense':
    'Zapisaliśmy wydatek {amount} z datą {date}.',
  'accounts.adjust.result.unchanged':
    'Nic nie zapisaliśmy, na dzień {date} na koncie było już {amount}.',
  'accounts.adjust.error.title': 'Nie udało się zapisać korekty',

  /* -- Transactions ------------------------------------------------------- */
  'transactions.title': 'Transakcje',
  'transactions.create': 'Nowa transakcja',
  'transactions.createIncome': 'Zapisz wpływ',
  'transactions.createExpense': 'Zapisz wydatek',
  'transactions.createTransfer': 'Zapisz przelew',
  'transactions.edit': 'Edytuj wydatek',
  'transactions.delete.confirm': 'Usunąć ten wydatek? Tego nie da się cofnąć.',
  'transactions.direction.income': 'Wpływ',
  'transactions.direction.expense': 'Wydatek',
  'transactions.field.amount': 'Kwota',
  'transactions.field.date': 'Data',
  'transactions.field.account': 'Konto',
  'transactions.field.category': 'Kategoria',
  'transactions.field.payee': 'Odbiorca',
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
    'Nie wpływa na stan konta, dopóki nie potwierdzisz, że doszło do skutku.',
  'transactions.balanceAdjustment': 'Wyrównanie stanu konta',
  'transactions.transfer.from': 'Konto źródłowe',
  'transactions.transfer.to': 'Konto docelowe',
  'transactions.transfer.rate': 'Kurs wymiany',
  'transactions.transfer.unlinkFirst':
    'Najpierw rozłącz obie strony, zanim zmienisz charakter tego przelewu.',
  'transactions.splits.title': 'Podział na kategorie',
  'transactions.splits.add': 'Dodaj pozycję',
  'transactions.splits.remainder': 'Do rozdzielenia: {amount}',
  'transactions.splits.balanced': 'Cała kwota jest rozdzielona.',
  'transactions.refund.title': 'Zwroty',
  'transactions.refund.link': 'Powiąż zwrot',
  'transactions.refund.unlink': 'Rozłącz zwrot',
  'transactions.refund.external': 'Zwrot za coś spoza Money Tracker',
  'transactions.attachment.add': 'Dołącz paragon',
  'transactions.attachment.remove': 'Usuń załącznik',
  'transactions.search.placeholder': 'Szukaj w notatkach, odbiorcach i kwotach',
  'transactions.search.placeholder.short': 'Szukaj',
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
    'Zapisz pierwszą transakcję albo wczytaj wyciąg, który już masz.',
  'transactions.noResults.title': 'Nic nie pasuje do tych filtrów',
  'transactions.noResults.body':
    'Spróbuj szerszego zakresu dat albo mniejszej liczby filtrów.',

  /* -- Transactions: the ledger surface ----------------------------------- */
  'transactions.list.label': 'Lista wydatków i wpływów',
  'transactions.list.caption.all': 'Wszystkie wpisy ({count}), {sort}.',
  'transactions.list.caption.filtered':
    'Wpisy pasujące do filtrów {filters} ({count}), {sort}.',
  'transactions.list.caption.sort': 'sortowanie według: {field}, {order}',
  'transactions.sort.label': 'Sortuj według',
  'transactions.sort.ascending': 'od najstarszych',
  'transactions.sort.descending': 'od najnowszych',
  'transactions.column.description': 'Opis',
  'transactions.column.actions': 'Działania',
  'transactions.day.net': 'Razem',
  'transactions.day.carried': 'Do przeniesienia',
  'transactions.column.balance': 'Saldo',
  'transactions.loading': 'Wczytywanie wydatków…',
  'transactions.loadMore': 'Wczytaj więcej',
  'transactions.loadingMore': 'Wczytywanie kolejnych wydatków…',
  'transactions.loadedOf': 'Wczytano {loaded} z {total}',
  'transactions.selectAllLoaded': 'Zaznacz wszystkie wczytane wpisy',
  'transactions.excludedFromTotals': 'Poza sumami',
  'transactions.amount.income': 'Wpływ {amount}',
  'transactions.amount.expense': 'Wydatek {amount}',
  'transactions.row.select': 'Zaznacz wpis {amount} z dnia {date}',
  'transactions.row.actions': 'Działania dla: {name}',
  'transactions.row.open': 'Otwórz',
  'transactions.totals.label': 'Sumy dla wybranych filtrów',
  'transactions.totals.currency': 'Sumy w walucie {currency}',
  'transactions.bulk.label': 'Działania na zaznaczonych wpisach',
  'transactions.bulk.delete': 'Usuń zaznaczone',
  'transactions.bulk.confirm': {
    one: 'Usunąć {count} wpis? Tego nie da się cofnąć.',
    few: 'Usunąć {count} wpisy? Tego nie da się cofnąć.',
    many: 'Usunąć {count} wpisów? Tego nie da się cofnąć.',
    other: 'Usunąć {count} wpisu? Tego nie da się cofnąć.',
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
  'transactions.keyboard.open': 'Otwarcie wpisu',
  'transactions.keyboard.select': 'Zaznaczenie wiersza',
  'transactions.keyboard.edit': 'Edycja wpisu',
  'transactions.keyboard.duplicate': 'Skopiowanie do nowego wpisu',
  'transactions.keyboard.remove': 'Usunięcie wpisu',
  'transactions.keyboard.help': 'Wyświetlenie tej listy',

  /* -- Transactions: filters ---------------------------------------------- */
  'transactions.filter.description':
    'Zawęź listę. Wszystko, co tu ustawisz, zapisuje się w adresie, więc widok można udostępnić.',
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
  'transactions.filter.payeePlaceholder': 'Znajdź odbiorcę',
  'transactions.filter.tagPlaceholder': 'Znajdź etykietę',
  'transactions.chip.text': 'Tekst: {value}',
  'transactions.chip.dates': 'Daty: od {from} do {to}',
  'transactions.chip.anyDate': 'dowolna',
  'transactions.chip.accounts': 'Konto: {value}',
  'transactions.chip.accountGroups': 'Grupa: {value}',
  'transactions.chip.categories': 'Kategoria: {value}',
  'transactions.chip.payees': 'Odbiorca: {value}',
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
  'transactions.form.editTitle': 'Edytuj transakcję',
  'transactions.form.details': 'Szczegóły',
  'transactions.form.moreDetails': 'Więcej',
  'transactions.form.saveAndNew': 'Zapisz i dodaj kolejną',
  'transactions.form.saveAndNewHint':
    'Zostawia datę, konto i kategorię, więc do następnego wpisu wystarczy kwota.',
  'transactions.form.notePlaceholder': 'Czego dotyczył ten wydatek?',
  'transactions.form.payeePlaceholder': 'Komu zapłacono albo kto zapłacił',
  'transactions.form.categoryPlaceholder': 'Wybierz kategorię',
  'transactions.form.noPayees': 'Nie masz jeszcze żadnych odbiorców',
  'transactions.form.noCategories': 'Nie ma jeszcze kategorii',
  'transactions.form.conversionNote':
    'Zapisujemy w walucie {currency} i przeliczamy na {base} po kursie z dnia, którego dotyczy wpis.',
  'transactions.form.droppedAmountNote':
    'Oczekiwana kwota jest w walucie {currency}; wpisz kwotę w walucie swojego konta.',
  'transactions.form.error.title': 'Nie zapisaliśmy tego wpisu',
  'transactions.form.error.amount': 'Podaj kwotę większą od zera.',
  'transactions.form.error.account': 'Wybierz konto, którego dotyczy wpis.',
  'transactions.form.error.date': 'Podaj datę w formacie {example}.',
  'transactions.form.error.dateFuture':
    'Ta data jeszcze nie nadeszła. Zaznacz „{planned}”, aby zapisać wpis jako planowany, albo wybierz dzisiejszą lub wcześniejszą datę.',
  'transactions.form.error.note': 'Notatka może mieć najwyżej {max} znaków.',
  'transactions.form.noAccounts.title': 'Najpierw konto',
  'transactions.form.noAccounts.body':
    'Każdy wpis musi należeć do konta. Załóż konto i wróć tutaj.',
  'transactions.form.noAccounts.action': 'Załóż konto',
  'transactions.saved': 'Zapisane.',
  'transactions.deleted': 'Usunięte.',
  'transactions.deletedMany': {
    one: 'Usunęliśmy {count} wpis.',
    few: 'Usunęliśmy {count} wpisy.',
    many: 'Usunęliśmy {count} wpisów.',
    other: 'Usunęliśmy {count} wpisu.',
  },
  'transactions.duplicated':
    'Skopiowano do nowego wpisu. Nic nie zostało jeszcze zapisane.',

  /* -- Transactions: the detail screen ------------------------------------ */
  'transactions.detail.title': 'Wydatek',
  'transactions.detail.back': 'Wróć do transakcji',
  'transactions.detail.summary': 'Podsumowanie',
  'transactions.detail.recordedAt': 'Zapisano {datetime}',
  'transactions.detail.rate': 'Przeliczono po kursie {rate} z dnia {date}.',
  'transactions.detail.identityRate':
    'Zapisano w walucie raportowania, więc przeliczenie nie było potrzebne.',
  'transactions.detail.noTags': 'Ten wpis nie ma etykiet.',
  'transactions.detail.noAttachments': 'Nie dołączono paragonu.',
  'transactions.detail.noRefunds': 'Nie powiązano zwrotu.',
  'transactions.detail.error.title': 'Nie udało się wczytać tej transakcji',
  'transactions.detail.error.body':
    'Nic nie zostało zmienione. Spróbuj ponownie za chwilę.',
  'transactions.detail.notFound.title': 'Nie ma takiej transakcji',
  'transactions.detail.notFound.body':
    'Mogła zostać usunięta albo adres jest nieprawidłowy.',
  /* -- Transakcje: podział transakcji -------------------------------------- */
  'splits.title': 'Podziel ten wydatek',
  'splits.description':
    'Rozdziel jedną płatność na kilka kategorii. Zanim zapiszemy podział, części muszą sumować się do pełnej kwoty.',
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
  'splits.over': '{amount} ponad kwotę wydatku.',
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

  /* -- Transakcje: grupy (11-S2) ------------------------------------------- */
  'groups.title': 'Grupy wydatków',
  'groups.subtitle':
    'Kilka wydatków czytanych jako jedna całość: wakacje, remont, przeprowadzka. Grupa to tylko sposób patrzenia na wpisy, a jej usunięcie nigdy nie usuwa samych wydatków.',
  'groups.create': 'Nowa grupa',
  'groups.loading': 'Wczytywanie grup…',
  'groups.error.title': 'Nie udało się wczytać grup',
  'groups.empty.title': 'Nie masz jeszcze żadnej grupy',
  'groups.empty.body':
    'Grupa zbiera wydatki, które chcesz czytać razem: wszystkie płatności za wakacje albo wszystkie faktury za remont. Sumę grupy liczymy przy każdym otwarciu i nigdy jej nie zapisujemy.',
  'groups.table.label': 'Grupy wydatków',
  'groups.table.summary': {
    one: '{count} grupa. Każda suma poniżej jest w walucie {currency}.',
    few: '{count} grupy. Każda suma poniżej jest w walucie {currency}.',
    many: '{count} grup. Każda suma poniżej jest w walucie {currency}.',
    other: '{count} grupy. Każda suma poniżej jest w walucie {currency}.',
  },
  'groups.column.name': 'Grupa',
  'groups.column.members': 'Wydatki',
  'groups.column.total': 'Suma',
  'groups.column.actions': 'Akcje',
  'groups.members': {
    one: '{count} wydatek',
    few: '{count} wydatki',
    many: '{count} wydatków',
    other: '{count} wydatku',
  },
  'groups.total.summary': {
    one: '{name}: {count} wydatek, {amount}',
    few: '{name}: {count} wydatki, {amount}',
    many: '{name}: {count} wydatków, {amount}',
    other: '{name}: {count} wydatku, {amount}',
  },
  'groups.actions.label': 'Akcje dla grupy {name}',
  'groups.rename': 'Zmień nazwę',
  'groups.delete': 'Usuń',
  'groups.form.title.create': 'Nowa grupa',
  'groups.form.title.rename': 'Zmień nazwę grupy',
  'groups.form.name': 'Nazwa',
  'groups.form.note': 'Notatka',
  'groups.form.note.help':
    'Do czego służy ta grupa. Później nie da się tego zmienić.',
  'groups.delete.title': 'Usunąć grupę {name}?',
  'groups.delete.body':
    'Znika sama grupa. Wydatki, które zawierała, zostają dokładnie tam, gdzie były.',
  'groups.toast.created': 'Utworzono grupę {name}.',
  'groups.toast.renamed': 'Zmieniono nazwę na {name}.',
  'groups.toast.deleted': 'Usunięto grupę {name}.',
  'groups.panel.title': 'Grupy',
  'groups.panel.description':
    'Grupy, w ramach których czytany jest ten wydatek. Każda suma jest w Twojej walucie raportowania.',
  'groups.panel.empty': 'Ten wydatek nie należy do żadnej grupy.',
  'groups.panel.add.label': 'Dodaj do grupy',
  'groups.panel.add.placeholder': 'Wybierz grupę',
  'groups.panel.add.action': 'Dodaj',
  'groups.panel.add.none': 'Nie ma jeszcze innej grupy, do której można dodać.',
  'groups.panel.remove': 'Usuń z grupy {name}',
  'groups.panel.added': 'Dodano do grupy {name}.',
  'groups.panel.removed': 'Usunięto z grupy {name}.',
  'groups.panel.dissolved':
    'Grupa {name} miała tylko dwa wydatki, więc usunięcie jednego rozwiązało grupę.',
  'groups.panel.error.title': 'Grupa nie została zmieniona',

  /* -- Transakcje: szablony (11-S2) ---------------------------------------- */
  'templates.picker.title': 'Zacznij od szablonu',
  'templates.picker.label': 'Szablony',
  'templates.picker.error.title': 'Nie udało się zastosować szablonu',
  'templates.applied':
    'Formularz został wypełniony z szablonu {name}. Nic nie zostało jeszcze zapisane.',

  /* -- Transakcje: zwroty -------------------------------------------------- */
  'refunds.title': 'Zwroty',
  'refunds.description':
    'Pieniądze, które wróciły za ten wydatek. Powiązanie zwrotu nigdy nie zmienia tego, co zapłaciłeś na początku; zmienia to, ile ostatecznie kosztowało.',
  'refunds.effective':
    'Pierwotnie {original}, zwrócono {refunded}, ostatecznie {effective}.',
  'refunds.empty': 'Nie powiązano żadnego zwrotu.',
  'refunds.loading': 'Wczytujemy zwroty…',
  'refunds.error.title': 'Nie wczytaliśmy zwrotów',
  'refunds.list.label': 'Zwroty do tego wydatku',
  'refunds.column.date': 'Data',
  'refunds.column.amount': 'Kwota',
  'refunds.column.origin': 'Dotyczy',
  'refunds.column.actions': 'Działania',
  'refunds.origin.whole': 'Całego wydatku',
  'refunds.origin.line': 'Jednego wiersza podziału',
  'refunds.unlink': 'Odepnij',
  'refunds.unlink.label': 'Odepnij zwrot {amount} z dnia {date}',
  'refunds.unlinked': 'Usunęliśmy powiązanie zwrotu.',
  'refunds.linked': 'Powiązaliśmy zwrot.',
  'refunds.given.title': 'Czego dotyczy ten zwrot',
  'refunds.given.transaction': 'Oddaje część kwoty {amount} zapłaconej {date}.',
  'refunds.given.external':
    'Dotyczy zakupu spoza tego domu, więc liczy się jak zwykły wpływ i nie pomniejsza żadnego wydatku.',
  'refunds.given.unlink': 'Usuń to powiązanie zwrotu',
  'refunds.link': 'Zapisz to jako zwrot',
  'refunds.dialog.title': 'Za co jest ten zwrot?',
  'refunds.dialog.description':
    'Zwrot oddaje pieniądze, które wcześniej wyszły. Wskaż, czego dotyczy, aby przy pierwotnym wydatku było widać, ile ostatecznie kosztował.',
  'refunds.dialog.field': 'Czego dotyczy ten zwrot',
  'refunds.dialog.ranking':
    'Najpierw najbliższe kwotą, potem najbliższe datą. Przy każdej propozycji piszemy, dlaczego tu jest.',
  'refunds.dialog.external': 'Czegoś spoza tego domu',
  'refunds.dialog.external.help':
    'Tego zakupu nigdy tu nie zapisaliśmy. Pieniądze i tak wróciły i liczą się jak zwykły przychód.',
  'refunds.dialog.option': '{amount} z dnia {date}',
  'refunds.dialog.submit': 'Powiąż zwrot',
  'refunds.dialog.cancel': 'Anuluj',
  'refunds.dialog.error.title': 'Nie powiązaliśmy zwrotu',
  'refunds.dialog.error.refused':
    'Nic się nie zmieniło. Tego zwrotu nie da się powiązać w tej postaci. Sprawdź transakcję, jej kwotę, walutę i kierunek, a potem spróbuj ponownie.',
  'refunds.suggest.loading': 'Szukamy, czego dotyczy ten zwrot…',
  'refunds.suggest.empty':
    'Żaden wydatek u tego samego odbiorcy z ostatnich 90 dni nie jest dość duży, aby to był jego zwrot.',
  'refunds.suggest.reason.exact':
    'Ten sam odbiorca, dokładnie ta kwota, {when}.',
  'refunds.suggest.reason.larger':
    'Ten sam odbiorca, o {surplus} więcej niż ten zwrot, {when}.',
  'refunds.suggest.when.sameDay': 'zapisany tego samego dnia',
  'refunds.suggest.when.earlier': {
    one: 'zapisany 1 dzień wcześniej',
    few: 'zapisany {count} dni wcześniej',
    many: 'zapisany {count} dni wcześniej',
    other: 'zapisany {count} dnia wcześniej',
  },
  'refunds.suggest.alreadyRefunded': 'Zwrócono już z tego {amount}.',

  'transactions.planned.title': 'Zaplanowane',
  'transactions.planned.subtitle':
    'Wpisy z datą, która jeszcze nie nadeszła. Nie zmieniają stanu kont, dopóki ich nie potwierdzisz.',
  'transactions.planned.empty.title': 'Nic nie jest zaplanowane',
  'transactions.planned.empty.body':
    'Zapisz wydatek z przyszłą datą i oznacz go jako zaplanowany, aby zobaczyć go tutaj.',
  'transactions.planned.empty.recurring':
    'Nic nie jest zaplanowane. Twoje płatności cykliczne są na ekranie cyklicznych.',
  'transactions.planned.expected': 'Oczekiwane',
  'transactions.planned.expected.group': {
    one: 'Oczekiwane w najbliższym dniu',
    few: 'Oczekiwane w najbliższych {count} dniach',
    many: 'Oczekiwane w najbliższych {count} dniach',
    other: 'Oczekiwane w najbliższych {count} dnia',
  },
  'transactions.planned.expected.capped': {
    one: 'Pokazano najbliższą. Zobacz wszystkie na ekranie cyklicznych.',
    few: 'Pokazano {count} najbliższe. Zobacz wszystkie na ekranie cyklicznych.',
    many: 'Pokazano {count} najbliższych. Zobacz wszystkie na ekranie cyklicznych.',
    other:
      'Pokazano {count} najbliższej. Zobacz wszystkie na ekranie cyklicznych.',
  },
  'transactions.planned.expected.hint':
    'To jeszcze nie są pieniądze. Oczekiwane płatności nigdy nie wchodzą do sum.',
  'transactions.planned.expected.suppressed':
    'Oczekiwane płatności są ukryte, dopóki ten filtr jest aktywny.',
  'transactions.planned.expected.failed':
    'Nie udało się wczytać oczekiwanych płatności.',
  'transactions.planned.expected.none':
    'Brak oczekiwanych płatności do pokazania.',
  'transactions.planned.expected.figures':
    'Oczekiwane z wymienionych powyżej płatności. To nie są pieniądze.',
  'transactions.planned.expected.in': 'Oczekiwane wpływy',
  'transactions.planned.expected.out': 'Oczekiwane wydatki',
  'transactions.mode.label': 'Które wpisy pokazać',
  'transactions.mode.actual': 'Zapisane',
  'transactions.mode.planned': 'Zaplanowane',
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
  'categories.move.refused': 'Nie udało się przenieść kategorii',
  'categories.move.refused.nest':
    'Kategoria „{category}” nie może trafić do kategorii „{parent}”: kategorie mają tylko dwa poziomy.',
  'categories.refused.forbidden':
    'Kategorie w tym domu mogą zmieniać tylko właściciele i administratorzy.',
  'categories.restore.refused': 'Nie przywróciliśmy kategorii',
  'categories.filter.showArchived': 'Pokaż zarchiwizowane kategorie',
  'categories.field.kind': 'Stosowana do',
  'categories.field.kind.help':
    'Czy ta kategoria ma być proponowana przy wydatkach, czy przy wpływach.',
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
    'Kategoria odpowiada na pytanie „na co to było”. Dodaj pierwszą, a raporty będą miały według czego grupować.',
  'categories.archive.title': 'Zarchiwizować kategorię {name}?',
  'categories.archive.body':
    'Przestaniemy ją proponować przy nowych wpisach, a wszystko, co już do niej przypisano, zachowa swoją etykietę. Podkategorie archiwizują się razem z nią. Możesz ją przywrócić w każdej chwili.',
  'categories.delete.title': 'Usunąć kategorię {name}?',
  'categories.delete.body':
    'Tej operacji nie da się cofnąć. Kategorii, która była kiedykolwiek użyta, nie można usunąć - zarchiwizuj ją zamiast tego.',
  'categories.delete.refused': 'Tej kategorii nie można usunąć',
  'categories.delete.refused.body':
    'Jest już przypisana do wydatków, a usunięcie zostawiłoby je bez etykiety. Zarchiwizuj ją: zniknie z list wyboru i zachowa historię.',
  'categories.toast.created': 'Dodaliśmy kategorię {name}.',
  'categories.toast.updated': 'Zapisaliśmy kategorię {name}.',
  'categories.toast.archived': 'Zarchiwizowaliśmy kategorię {name}.',
  'categories.toast.restored': 'Przywróciliśmy kategorię.',
  'categories.toast.deleted': 'Usunęliśmy kategorię {name}.',

  /* -- Odbiorcy -------------------------------------------------------- */
  'payees.title': 'Odbiorcy',
  'payees.subtitle':
    'Komu płacisz i kto płaci Tobie, oraz opisy z wyciągu, które mają się z nimi zgadzać.',
  'payees.create': 'Dodaj odbiorcę',
  'payees.edit': 'Edytuj odbiorcę',
  'payees.loading': 'Wczytujemy odbiorców',
  'payees.list.label': 'Odbiorcy',
  'payees.actions.label': 'Działania dla: {name}',
  'payees.search.label': 'Szukaj odbiorców',
  'payees.search.placeholder': 'Fragment nazwy',
  'payees.error.title': 'Nie udało się wczytać odbiorców',
  'payees.empty.title': 'Nie masz jeszcze żadnych odbiorców',
  'payees.empty.body':
    'Odbiorca zamienia „ZABKA NANO 4471” z wyciągu w nazwę, którą rozpoznajesz. Dodaj pierwszego albo pozwól, żeby wczytany plik utworzył ich za Ciebie.',
  'payees.noMatches.title': 'Nic nie pasuje',
  'payees.noMatches.body': 'Spróbuj krótszego fragmentu nazwy.',
  'payees.defaultCategory.summary': 'Podpowiada: {name}',
  'payees.detail.back': 'Wróć do odbiorców',
  'payees.detail.noCategory': 'Nie podpowiada żadnej kategorii',
  'payees.detail.loading': 'Wczytujemy tego odbiorcę…',
  'payees.detail.error.title': 'Nie udało się wczytać tego odbiorcy',
  'payees.detail.error.body':
    'Żądanie nie wróciło. Nic nie zostało zmienione — spróbuj ponownie.',
  'payees.field.name.help': 'Nazwa, którą chcesz widzieć przy swoich wpisach.',
  'payees.field.defaultCategory': 'Podpowiadana kategoria',
  'payees.field.defaultCategory.help':
    'Do niej trafi nowy wydatek u tego odbiorcy.',
  'payees.field.mode': 'Jak stanowczo ją stosować',
  'payees.field.logoDomain': 'Strona internetowa',
  'payees.field.logoDomain.help':
    'Domena, na przykład zabka.pl - nie pełny odnośnik.',
  'payees.mode.off': 'Nic nie podpowiadaj',
  'payees.mode.off.help': 'Ten odbiorca nigdy nie rusza pola kategorii.',
  'payees.mode.hint': 'Wypełnij wstępnie',
  'payees.mode.hint.help':
    'Nowe wydatki zaczynają od podpowiadanej kategorii, a Ty możesz ją zmienić.',
  'payees.mode.enforce': 'Zawsze stosuj',
  'payees.mode.enforce.help':
    'Nowe wydatki przyjmą podpowiadaną kategorię, a zapis przypisze do niej także te już zarejestrowane u tego odbiorcy.',
  'payees.form.create.body':
    'Wystarczy nazwa. Ustawienia podpowiedzi mogą poczekać.',
  'payees.form.edit.body':
    'Zmiana nazwy odbiorcy zmienia ją w każdym wpisie, w którym występuje.',
  'payees.form.error.title': 'Nie zapisaliśmy tego odbiorcy',
  'payees.aliases.title': 'Opisy z wyciągu',
  'payees.aliases.body':
    'Nazwy, których bank używa dla tego odbiorcy. Każdą zapisujemy w postaci porównywanej: małymi literami, bez polskich znaków i bez numerów referencyjnych, bo właśnie to porównujemy przy wczytywaniu pliku.',
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
  'payees.aliases.empty': 'Na razie pasuje tylko własna nazwa tego odbiorcy.',
  'payees.aliases.failed': 'Nie dodaliśmy tego opisu',
  'payees.ignored.title': 'Opisy, które nigdy nie są odbiorcą',
  'payees.ignored.body':
    'Nazwy, z których nie da się zrobić odbiorcy: „PŁATNOŚĆ KARTĄ”, „POLECENIE ZAPŁATY” i wszystko inne, co bank dopisuje do każdej pozycji.',
  'payees.ignored.add': 'Dodaj opis do pominięcia',
  'payees.ignored.remove': 'Przestań pomijać {name}',
  'payees.ignored.empty': 'Nie pomijamy żadnego opisu.',
  'payees.ignored.failed': 'Nie dodaliśmy tego opisu',
  'payees.merge.action': 'Połącz z innym odbiorcą',
  'payees.merge.title': 'Połącz odbiorcę {name}',
  'payees.merge.into': 'Zachowaj tego odbiorcę',
  'payees.merge.body':
    'Wszystkie wydatki, nazwy z wyciągu i etykiety odbiorcy {from} przejdą do {into}, a „{from}” zachowamy jako nazwę z wyciągu, żeby kolejne pliki nadal go rozpoznawały. Tego nie da się cofnąć.',
  'payees.merge.noTargets': 'Nie ma innego odbiorcy, z którym można połączyć.',
  'payees.merge.failed': 'Nie połączyliśmy odbiorców',
  'payees.delete.title': 'Usunąć odbiorcę {name}?',
  'payees.delete.body':
    'Tego nie da się cofnąć. Wydatki zachowają kwoty i daty, stracą tylko nazwę odbiorcy.',
  'payees.toast.created': 'Dodaliśmy odbiorcę {name}.',
  'payees.toast.updated': 'Zapisaliśmy odbiorcę {name}.',
  'payees.toast.deleted': 'Usunęliśmy odbiorcę {name}.',
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
  'dashboard.recentTransactions.empty.action': 'Przejdź do transakcji',
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
    'Dodaj konto, a jego stan będzie pierwszą kwotą w tym miejscu.',
  'dashboard.cashFlow.month': 'Miesiąc',
  'dashboard.cashFlow.surplus': 'Zostało Ci {amount}',
  'dashboard.cashFlow.deficit': 'Wydatki przewyższyły wpływy o {amount}',
  'dashboard.cashFlow.balanced': 'Wpływy i wydatki wyszły dokładnie na zero',
  'dashboard.cashFlow.shareOfIncome': '{share} z {amount} wpływów',
  'dashboard.cashFlow.context':
    'Wybrany okres: {month}. Wcześniejsze miesiące to kontekst.',
  'dashboard.cashFlow.empty.title': 'W tym okresie nic się nie wydarzyło',
  'dashboard.cashFlow.empty.body': 'Zapisz wydatek albo wybierz dłuższy okres.',
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
  'dashboard.recent.viewAll': 'Wszystkie wydatki',
  'dashboard.firstRun.title': 'Witamy. Trzy kroki i liczby zaczną pracować.',
  'dashboard.firstRun.body':
    'Nie ma tu przykładowych kwot. Wszystko, co zobaczysz, będzie Twoje.',
  'dashboard.firstRun.steps.label': 'Pierwsze kroki',
  'dashboard.firstRun.step.account.title': 'Dodaj konto',
  'dashboard.firstRun.step.account.body':
    'Konto w banku, portfel, karta - cokolwiek chcesz śledzić.',
  'dashboard.firstRun.step.transaction.title': 'Zapisz wydatek',
  'dashboard.firstRun.step.transaction.body':
    'Jedna wystarczy, żeby wykres przepływów miał co narysować.',
  'dashboard.firstRun.step.review.title': 'Wróć tutaj',
  'dashboard.firstRun.step.review.body':
    'Panele poniżej wypełnią się, gdy tylko będzie co pokazać.',
  'dashboard.firstEntry.lead':
    'Konta już są. Nie ma przy nich jeszcze żadnej transakcji.',
  'dashboard.firstEntry.action': 'Zapisz pierwszą transakcję',

  /* -- Budgets (shared with the dashboard) -------------------------------- */
  'budgets.title': 'Budżety',
  'budgets.subtitle': 'Ile zostało w każdej kategorii.',
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
    'Liczy każdy wydatek z wybranych kategorii i ich podkategorii.',
  'budgets.kind.manual': 'Wybrane ręcznie',
  'budgets.kind.manual.help':
    'Liczy tylko te wydatki, które sam do niego dodasz. Na wyjazd, remont albo jednorazowy zakup.',
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
  'budgets.rollover.carry_all': 'Przenoś resztę i przekroczenie',
  'budgets.rollover.carry_all.help':
    'Kolejny okres zaczyna się od tego, co zostało — albo na minusie, jeśli był przekroczony.',

  'budgets.status.archived': 'Zarchiwizowany',
  'budgets.status.closed': 'Zamknięty',
  'budgets.status.open': 'Otwarty',
  'budgets.autoInclude': 'Automatycznie liczy nowe wydatki',
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
    'Budżet to limit na wybrane kategorie w wybranym okresie. Podepnij pod niego kategorie, a wypełni się sam, albo dodawaj wydatki ręcznie, gdy chodzi o jeden konkretny zakup.',
  'budgets.empty.action': 'Utwórz pierwszy budżet',
  'budgets.empty.pick.title': 'Albo zacznij od jednego z tych',
  'budgets.empty.pick.body':
    'Każdy otwiera formularz z wybranym już rodzajem budżetu. Nic nie powstaje, dopóki nie zapiszesz.',
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
    'Każdy wydatek z tych kategorii i ich podkategorii pomniejsza limit.',
  'budgets.allocation.manual':
    'Ten budżet liczy tylko wydatki dodane do niego ręcznie.',
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
  'budgets.confirm.restore.body':
    'Wraca na listę i działa dalej. Zamknięte okresy zostają bez zmian.',
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

  /* -- Błędy nazwane przez serwer ----------------------------------------- */
  // Jeden klucz na rodzaj błędu i trzy na pole, czytane przez zamknięte tabele w
  // `src/lib/failure-envelope.ts`; żaden klucz nie jest budowany w czasie działania.
  'failure.internal': 'Coś poszło nie tak po naszej stronie.',
  'failure.unauthenticated': 'Zaloguj się, aby kontynuować.',
  'failure.forbidden': 'Nie masz do tego dostępu.',
  'failure.not_found': 'Nie możemy tego znaleźć.',
  'failure.validation':
    'Niektóre pola wymagają poprawy. Sprawdź je i spróbuj ponownie.',
  'failure.conflict':
    'To koliduje z tym, co jest już zapisane. Odśwież stronę i spróbuj ponownie.',
  'failure.quota': 'Twój plan osiągnął limit w tym zakresie.',
  'failure.feature_locked': 'To nie wchodzi w skład Twojego planu.',
  'failure.rate_unavailable': 'Brak kursu waluty na ten dzień.',
  'failure.rate_limited': 'Usługa jest teraz zajęta. Spróbuj za chwilę.',
  'failure.upstream':
    'Usługa, z której korzystamy, nie odpowiedziała. Spróbuj ponownie.',
  'failure.field.invalid': 'Ta wartość jest nieprawidłowa.',
  'failure.field.tooShort': 'Ta wartość jest za krótka.',
  'failure.field.tooLong': 'Ta wartość jest za długa.',
  // What `FailurePanel` adds around the envelope's own sentence above.
  'failure.quota.title': 'Ten dom osiągnął limit',
  'failure.quota.metric': 'Osiągnięty limit: {metric}.',
  'failure.featureLocked.title': 'Poza Twoim planem',
  'failure.dashboard.action': 'Wróć do pulpitu',
  'failure.reference.copy': 'Skopiuj numer',
  'failure.reference.copied': 'Numer skopiowany',
  'failure.reference.copyFailed': 'Nie udało się skopiować numeru',

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
  'empty.notFound.home': 'Strona główna',
  'empty.forbidden.title': 'Brak dostępu',
  'empty.forbidden.body': 'Poproś właściciela tego domu o nadanie Ci dostępu.',
  'empty.offline.title': 'Jesteś offline',
  'empty.offline.body':
    'To, co teraz zapiszesz, wyślemy, gdy wrócisz do sieci.',

  /* -- Notifications ------------------------------------------------------ */
  'notifications.title': 'Powiadomienia',
  'notifications.markAllRead': 'Oznacz wszystkie jako przeczytane',
  'notifications.empty.title': 'Nic nowego',
  'notifications.empty.body':
    'Alerty o budżetach, rachunkach i wspólnych domach pojawią się tutaj.',
  'notifications.unread': {
    one: '{count} nieprzeczytane powiadomienie',
    few: '{count} nieprzeczytane powiadomienia',
    many: '{count} nieprzeczytanych powiadomień',
    other: '{count} nieprzeczytanego powiadomienia',
  },
  'notifications.badge': '{count}+',

  'notifications.kind.budgetThresholdCrossed.title':
    'Budżet {budget} osiągnął {threshold}%',
  'notifications.kind.budgetThresholdCrossed.body':
    'W tym okresie wydano {spent} z {available} w budżecie {budget}.',
  'notifications.kind.budgetExceeded.title': 'Budżet {budget} wyczerpany',
  'notifications.kind.budgetExceeded.body':
    'Przekroczono o {overspent} kwotę {available} przewidzianą na {budget}.',
  'notifications.kind.recurringDueSoon.title':
    'Płatność {series} przypada {date}',
  'notifications.kind.recurringDueSoon.body':
    'Kwota {amount} za {series} przypada na {date}.',
  'notifications.kind.recurringOverdue.title':
    'Płatność {series} przypadała {date}',
  'notifications.kind.recurringOverdue.body':
    'Kwota {amount} za {series} przypadała na {date} i wciąż nie została zapisana.',
  'notifications.kind.goalReached.title': 'Cel {goal} osiągnięty',
  'notifications.kind.goalReached.body':
    'Cel {goal} jest zrealizowany — odłożono {contributed} z {target}.',
  // Nominative on purpose: the unsubscribe sentence places the topic after a colon, so no Polish
  // case has to agree with it, and 21-S3's preference matrix reuses these as row headers.
  'notifications.kind.budgetThresholdCrossed.label': 'Progi budżetów',
  'notifications.kind.budgetExceeded.label': 'Wyczerpane budżety',
  'notifications.kind.recurringDueSoon.label': 'Nadchodzące płatności',
  'notifications.kind.recurringOverdue.label': 'Zaległe płatności',
  'notifications.kind.goalReached.label': 'Osiągnięte cele',

  /*
    Email (21-S2).

    Every line is addressed to one person and phrased so it carries no grammatical gender: a
    catalogue that cannot ask who is reading must not guess. That is why the reset line reads
    "Jeśli to nie Ty prosisz" rather than the past tense, which would have to pick one form.
  */
  'email.layout.footer.reasonAccount':
    'Dostajesz tę wiadomość, bo na Twoim koncie {app} coś się wydarzyło.',
  'email.auth.greeting': 'Cześć {name},',
  'email.auth.singleUse': 'Ten link zadziała tylko raz i wkrótce wygaśnie.',
  'email.auth.verifyEmail.subject': 'Potwierdź swój adres w {app}',
  'email.auth.verifyEmail.lead':
    'Potwierdź ten adres, aby dokończyć zakładanie konta {app}.',
  'email.auth.verifyEmail.action': 'Potwierdź adres',
  'email.auth.resetPassword.subject': 'Zresetuj hasło do {app}',
  'email.auth.resetPassword.lead':
    'Użyj przycisku poniżej, aby wybrać nowe hasło. Jeśli to nie Ty prosisz o zmianę, zignoruj tę wiadomość — hasło pozostanie bez zmian.',
  'email.auth.resetPassword.action': 'Wybierz nowe hasło',
  'email.auth.invitation.subject': 'Zaproszenie do domu {workspace} w {app}',
  'email.auth.invitation.lead':
    'Dom {workspace} zaprasza Cię do wspólnego korzystania z {app}.',
  'email.auth.invitation.action': 'Przyjmij zaproszenie',

  /* -- Accessibility ------------------------------------------------------ */
  'a11y.skipToContent': 'Przejdź do treści głównej',
  'a11y.showSuggestions': 'Pokaż podpowiedzi',

  /* -- Marketing (public pages) ------------------------------------------- */
  'marketing.nav.how': 'Jak to działa',
  'marketing.nav.ledger': 'Wydatki',
  'marketing.nav.scope': 'Zakres',
  'marketing.nav.signIn': 'Zaloguj się',
  'marketing.nav.getStarted': 'Zacznij za darmo',

  'marketing.hero.title.lead': 'Bez loginu do banku.',
  'marketing.hero.title.rest': 'Ani teraz, ani nigdy.',
  'marketing.hero.body':
    'Money Tracker to domowy budżet dla jednej osoby albo dla całego domu: konta, budżety i każda waluta, którą trzymasz.',
  'marketing.hero.cta.primary': 'Zacznij zapisywać za darmo',
  'marketing.hero.note': 'Wszystko, co wpiszesz, pobierzesz w dowolnej chwili.',

  'marketing.instead.title': 'To skąd cokolwiek się w niej bierze?',
  'marketing.instead.body':
    'Na cztery sposoby i żaden z nich nie wymaga oddania danych logowania do banku ani nam, ani nikomu innemu.',
  'marketing.instead.entry.title': 'Wpisujesz, w jakieś dziesięć sekund',
  'marketing.instead.entry.body':
    'Kwota, odbiorca, kategoria. Pole kwoty przyjmuje tyle miejsc po przecinku, ile naprawdę ma dana waluta, i pokazuje zapisywaną wartość, zanim ją wyślesz.',
  'marketing.instead.import.title': 'Wczytujesz plik, który już masz',
  'marketing.instead.import.body':
    'CSV z mapowaniem kolumn, które zapisujesz i wykorzystujesz ponownie, OFX, QIF albo eksport z innego programu. Duplikaty wychodzą przed zapisem, a całą partię można wycofać.',
  'marketing.instead.recurring.title': 'Seria zapisuje się sama',
  'marketing.instead.recurring.body':
    'Abonamenty, raty, rachunki i wypłaty ustawiasz raz jako płatności cykliczne. Mogą zapisywać się same albo tylko przypominać.',
  'marketing.instead.rules.title': 'Zasady porządkują od razu',
  'marketing.instead.rules.body':
    'Warunki i działania w kolejności, którą ustawiasz, z licznikiem dopasowań na żywo jeszcze przed zapisem. Zasada, której kategorię usunięto, wstrzymuje się sama i mówi o tym wprost.',
  'marketing.ledger.title':
    'Jeden wydatek, pół roku później, wciąż wyceniony na dzień, w którym się wydarzył.',
  'marketing.ledger.body':
    'Dom prowadzony w złotych, w którym siedzi wydatek zrobiony w euro. Wpisana kwota nigdy się nie zmienia, a przeliczona pod nią została zapisana po kursie z tamtego dnia i nie jest przeliczana ani dziś, ani za rok.',
  'marketing.ledger.caption':
    'Sześć przykładowych wpisów z domu prowadzonego w złotych.',
  'marketing.ledger.sample':
    'Wiersze przykładowe. Nic tutaj nie pochodzi z prawdziwego konta.',
  'marketing.ledger.col.balance': 'Stan po zapisie',
  'marketing.ledger.opening': 'Przeniesione z lutego',
  'marketing.ledger.closing': 'Do przeniesienia na kwiecień',
  'marketing.ledger.settled': 'Rozliczono',
  'marketing.ledger.note': 'Każdy zapis i to, co po nim zostaje.',
  'marketing.ledger.figure.label': 'Trzymane w złotych',
  'marketing.ledger.figure.caption':
    '27,40 € przeliczone po kursie 4,3218 z 14 marca 2026 i tam zostawione.',
  'marketing.ledger.row.groceries': 'Sklep spożywczy, Berlin',
  'marketing.ledger.row.salary': 'Wynagrodzenie',
  'marketing.ledger.row.streaming': 'Subskrypcja streamingowa',
  'marketing.ledger.row.savings': 'Przeniesione na oszczędności',
  'marketing.ledger.row.rent': 'Czynsz',
  'marketing.ledger.row.electricity': 'Rachunek za prąd',
  'marketing.ledger.category.groceries': 'Zakupy spożywcze',
  'marketing.ledger.category.income': 'Przychód',
  'marketing.ledger.category.subscriptions': 'Subskrypcje',
  'marketing.ledger.category.transfer': 'Przelew',
  'marketing.ledger.category.housing': 'Mieszkanie',
  'marketing.ledger.category.utilities': 'Media',

  'marketing.meter.title':
    'To, że przekraczasz budżet, widać także z wyłączonym kolorem.',
  'marketing.meter.body':
    'Każdy stan zmienia cztery rzeczy naraz: słowo, ikonę, pozostałą kwotę i kreskowanie wypełnienia. Zmierzona odległość między naszą zielenią a czerwienią przy deuteranopii spada do 1,14:1, więc kolor jest tu ostatnim kanałem, a nigdy pierwszym.',
  'marketing.meter.caption':
    'Nagłówkiem jest to, co zostało, a nie to, co wydane: właśnie tej liczby potrzebujesz, stojąc w sklepie.',
  'marketing.meter.sample':
    'Budżety przykładowe. Nic tutaj nie pochodzi z prawdziwego domu.',
  'marketing.meter.groceries': 'Zakupy spożywcze',
  'marketing.meter.fuel': 'Paliwo',
  'marketing.meter.eatingOut': 'Jedzenie na mieście',

  'marketing.scope.title': 'Co w niej jest',
  'marketing.scope.accounts':
    'Konta w ośmiu kategoriach, z grupami, archiwizacją i limitami kredytowymi',
  'marketing.scope.transactions':
    'Wydatki z podziałem na kategorie, zwrotami, załącznikami i edycją zbiorczą',
  'marketing.scope.classification':
    'Dwupoziomowe kategorie, tagi i odbiorcy z aliasami',
  'marketing.scope.budgets':
    'Budżety z okresami, progami alertów i przenoszeniem nadwyżki',
  'marketing.scope.recurring':
    'Płatności cykliczne, cele oszczędnościowe i zasady',
  'marketing.scope.currency':
    'Zestaw walut na dom, jedna waluta główna, kursy na każdy dzień',
  'marketing.scope.dashboard':
    'Pulpit z przepływami, wartością netto i wydatkami według kategorii, za wybrany okres',
  'marketing.scope.data':
    'Import CSV, OFX i QIF, sprawdzany w podglądzie, zanim cokolwiek zostanie zapisane',
  'marketing.scope.household':
    'Dom liczący od dwóch do sześciu osób na jednym zestawie liczb',
  'marketing.scope.plannedLabel': 'W planach',
  'marketing.scope.planned.pivot':
    'Konfigurowalna tabela przestawna i przegląd roczny',
  'marketing.scope.planned.reorder':
    'Przestawianie pulpitu myszą albo z klawiatury',
  'marketing.scope.planned.export':
    'Eksport JSON i CSV oraz pełna kopia zapasowa',

  'marketing.never.title': 'Czym nigdy nie będzie',
  'marketing.never.connectors.title': 'Połączeniem z bankiem',
  'marketing.never.connectors.body':
    'Nie ma go i nie będzie. Ta decyzja jest zapisana i opatrzona datą, a nie zostawiona jako plan na później.',
  'marketing.never.investments.title': 'Portfelem inwestycyjnym',
  'marketing.never.investments.body':
    'Konto inwestycyjne trzyma stan. Nie trzyma pozycji, transz, ceny nabycia ani dywidend.',
  'marketing.never.tax.title': 'Narzędziem podatkowym ani doradztwem',
  'marketing.never.tax.body':
    'Żadnych rozliczeń podatkowych, żadnego fakturowania i niczego, co dałoby się odczytać jako poradę, co zrobić z pieniędzmi.',
  'marketing.never.realtime.title': 'Dokumentem edytowanym na żywo',
  'marketing.never.realtime.body':
    'Osoby dzielące dom widzą swoje wpisy po przeładowaniu strony, a nie w trakcie pisania.',
  'marketing.commit.title': 'Dwie rzeczy, które zapisujemy na piśmie',
  'marketing.commit.export.title': 'Wszystko wychodzi, kiedy tylko zechcesz',
  'marketing.commit.export.body':
    'Pełny eksport JSON i CSV w każdym planie, także darmowym, bez ścieżki do przeklikania i bez oferty stojącej po drodze.',
  'marketing.commit.a11y.title':
    'Dostępność jest bramką w buildzie, a nie akapitem',
  'marketing.commit.a11y.body':
    'WCAG 2.2 AA sprawdzamy audytem automatycznym, który zatrzymuje build, na każdej trasie ze specyfikacji wizualnej, a ponad tym utrzymujemy nazwaną listę kryteriów AAA na poziomie AAA. Nie deklarujemy AAA w całym produkcie.',

  'marketing.cta.title': 'Zacznij od tego miesiąca',
  'marketing.cta.body':
    'Dodaj jedno konto, wczytaj wyciąg i zobacz, dokąd naprawdę poszły pieniądze.',
  'marketing.cta.action': 'Załóż darmowy dom',
  'marketing.footer.legal': 'Wszelkie prawa zastrzeżone.',

  /* -- The authenticated shell -------------------------------------------- */
  'app.nav.more': 'Więcej',
  'app.nav.moreLabel': 'Pozostałe sekcje',
  'app.nav.section.money': 'Pieniądze',
  'app.nav.section.plan': 'Planowanie',
  'app.nav.section.insight': 'Analizy',
  'app.signedInAs': 'Zalogowano jako {email}',
  'app.workspace.current': 'Bieżący dom',
  'app.workspace.role.owner': 'Właściciel',
  'app.workspace.role.admin': 'Administrator',
  'app.workspace.role.member': 'Uczestnik',
  'app.shell.pending': 'Wczytujemy tę stronę…',
  'app.shell.error.body':
    'Tej części aplikacji nie udało się wczytać. Reszta działa dalej.',

  /* -- Settings ----------------------------------------------------------- */
  'settings.subtitle':
    'Jak produkt wygląda dla Ciebie i co zawiera ten dom. Każda karta wskazuje, czyje jest dane ustawienie.',
  'settings.scope.you': 'Tylko Twoje',
  'settings.scope.workspace': 'Wspólne dla całego domu',
  'settings.appearance.description':
    'Jasny, ciemny albo zgodny z ustawieniem tego urządzenia. Zapisujemy go lokalnie, więc telefon i laptop mogą mieć różne motywy.',
  'settings.language.description':
    'W tym języku opisany jest każdy ekran, każda etykieta i każda data. Zmiana przeładowuje stronę, bo teksty dobiera serwer.',
  'settings.account.title': 'Twoje konto',
  'settings.account.description': 'Dane konta, z którego korzystasz.',
  'settings.workspace.description':
    'Wspólne listy tego domu. Do tych dwóch trafia każdy wpis.',
  'settings.workspace.name': 'Nazwa domu',
  'settings.categories.description':
    'Dwupoziomowe drzewo, do którego trafia każdy wpis.',
  'settings.payees.description':
    'Komu trafiły pieniądze oraz nazwy, które import ma z nimi scalać.',

  /* -- Plans and billing -------------------------------------------------- */
  'plans.free.name': 'Bezpłatny',
  'plans.free.tagline':
    'Jedna osoba, codzienne konta i dane, które zawsze zostają Twoje.',
  'plans.plus.name': 'Plus',
  'plans.plus.tagline':
    'Jedna osoba, żadnych limitów i tyle walut, ile trzymasz.',
  'plans.household.name': 'Dom',
  'plans.household.tagline': 'Kto dzieli pieniądze, ten dzieli też rachunki.',
  'plans.feature.free.people': 'Tylko Ty',
  'plans.feature.free.accounts': 'Trzy konta i jedna waluta',
  'plans.feature.free.currency':
    'Budżety, cele i rachunki cykliczne w niewielkiej liczbie',
  'plans.feature.free.planning': 'Wczytanie wyciągu dwa razy w miesiącu',
  'plans.feature.export': 'Eksport wszystkiego, kiedy tylko chcesz',
  'plans.feature.plus.people': 'Tylko Ty',
  'plans.feature.plus.unlimited': 'Konta, budżety i cele bez limitu',
  'plans.feature.plus.currencies': 'Tyle walut, w ilu trzymasz pieniądze',
  'plans.feature.plus.rules':
    'Dwadzieścia reguł opisywania i comiesięczne importy',
  'plans.feature.plus.storage': 'Gigabajt na paragony',
  'plans.feature.household.people': 'Do sześciu osób w jednym domu',
  'plans.feature.household.unlimited': 'Nic w produkcie nie jest ograniczone',
  'plans.feature.household.roles':
    'Właściciele i administratorzy decydują, kto co zmienia',
  'plans.feature.household.storage': 'Pięć gigabajtów na paragony',
  'plans.interval.monthly': 'Miesięcznie',
  'plans.interval.yearly': 'Rocznie',
  'plans.price.monthly': '{amount} miesięcznie',
  'plans.price.yearly': '{amount} rocznie',
  'plans.price.free': 'Zawsze bezpłatnie',
  'plans.saving': 'Oszczędzasz {percent}%',
  'plans.current': 'Twój plan',
  'billing.title': 'Plan i płatności',
  'billing.subtitle':
    'Na czym stoi ten dom, ile z tego wykorzystujesz i dokąd idą pieniądze. Ceny pokazujemy dokładnie tak, jak są pobierane.',
  'billing.plan.title': 'Obecny plan',
  'billing.state.free':
    'Korzystasz z planu bezpłatnego. Nic nie pobieramy i nic nie wygasa.',
  'billing.state.entitled': 'Aktywny. Odnowi się {date}.',
  'billing.state.trialing': 'Okres próbny. Stanie się planem płatnym {date}.',
  'billing.state.cancelling': 'Anulowany. Działa do {date} i możesz to cofnąć.',
  'billing.state.grace':
    'Ostatnia płatność się nie powiodła. Plan działa do {date}.',
  'billing.state.lapsed':
    'Subskrypcja się zakończyła, więc dom wrócił do planu bezpłatnego.',
  'billing.state.confirming':
    'Płatność przyjęta. Plan przełączy się, gdy tylko potwierdzi to dostawca — zwykle w ciągu minuty.',
  'billing.action.upgrade': 'Wybierz ten plan',
  'billing.action.portal': 'Metody płatności i faktury',
  'billing.action.cancel': 'Anuluj subskrypcję',
  'billing.action.resume': 'Zostaw subskrypcję',
  'billing.action.refresh': 'Sprawdź ponownie',
  'billing.cancel.title': 'Anulować tę subskrypcję?',
  'billing.cancel.body':
    'Plan działa do {date}, czyli do dnia, za który zapłacono. Potem dom wraca do planu bezpłatnego; nic nie zostaje usunięte.',
  'billing.cancel.confirm': 'Anuluj ją',
  'billing.cancel.keep': 'Zostaw ją',
  'billing.usage.title': 'Co wykorzystujesz',
  'billing.usage.description':
    'To te same liczby, które produkt sprawdza, zanim pozwoli coś dodać.',
  'billing.usage.value': '{used} z {limit}',
  'billing.usage.unlimited': '{used}, bez limitu',
  'billing.usage.metric.members': 'Osoby',
  'billing.usage.metric.accounts': 'Konta',
  'billing.usage.metric.currencies': 'Waluty',
  'billing.usage.metric.budgets': 'Budżety',
  'billing.usage.metric.goals': 'Cele',
  'billing.usage.metric.rules': 'Reguły opisywania',
  'billing.usage.metric.recurringSeries': 'Rachunki cykliczne',
  'billing.usage.metric.transactions': 'Wpisy',
  'billing.usage.metric.importsPerMonth': 'Importy w tym miesiącu',
  'billing.usage.metric.storageBytes': 'Paragony',
  'billing.overLimit.title': 'Powyżej limitu tego planu',
  'billing.overLimit.body':
    'Wszystko, co już masz, nadal czytasz, edytujesz i eksportujesz. Odmawiamy tylko dodawania kolejnych pozycji tam, gdzie limit jest przekroczony — dopóki czegoś nie usuniesz albo nie zmienisz planu.',
  'billing.notConfigured':
    'Płatności są w tym wdrożeniu wyłączone, więc dostępny jest tu wyłącznie plan bezpłatny.',
  'billing.error.title': 'Nie udało się wczytać strony płatności',
  'billing.error.unknownPlan': 'Takiego planu nie sprzedajemy.',
  'billing.error.noCustomer':
    'Nic tu jeszcze nie kupiono, więc nie ma faktur do pokazania.',

  /* -- People in the household -------------------------------------------- */
  'members.title': 'Osoby',
  'members.subtitle':
    'Każdy tutaj widzi te same konta, wpisy i budżety. Właściciele i administratorzy mogą dodatkowo zmieniać skład domu.',
  'members.list.title': 'W tym domu',
  'members.column.person': 'Osoba',
  'members.column.role': 'Rola',
  'members.column.joined': 'Dołączenie',
  'members.column.actions': 'Działania',
  'members.you': 'Ty',
  'members.alone':
    'Jesteś tu sam na sam z domem. Zaproś kogoś, żeby dzielić go z Tobą.',
  'members.role.change': 'Zmień rolę: {name}',
  'members.role.description.owner':
    'Wszystko, łącznie z płatnościami i własnością.',
  'members.role.description.admin':
    'Wszystko poza własnością i usuwaniem właściciela.',
  'members.role.description.member':
    'Czyta i zapisuje pieniądze; nie zmienia składu domu.',
  'members.seats.title': 'Miejsca',
  'members.seats.value': 'Zajęte {used} z {limit}',
  'members.seats.full':
    'Wszystkie miejsca w tym planie są zajęte. Zmień plan, żeby zaprosić kogoś jeszcze.',
  'members.seats.upgrade': 'Zobacz plany',
  'members.invite.action': 'Zaproś kogoś',
  'members.invite.title': 'Zaproś kogoś do tego domu',
  'members.invite.description':
    'Dostanie link, który zadziała wyłącznie z podanego tu adresu i wygaśnie po tygodniu.',
  'members.invite.email': 'Adres e-mail',
  'members.invite.role': 'Dołącza jako',
  'members.invite.submit': 'Wyślij zaproszenie',
  'members.invite.sent': 'Zaproszenie jest w drodze na adres {email}.',
  'members.pending.title': 'Zaproszeni, jeszcze nieobecni',
  'members.pending.empty': 'Żadne zaproszenie nie czeka.',
  'members.pending.expires': 'Wygasa {date}',
  'members.pending.expired': 'Wygasło',
  'members.pending.resend': 'Wyślij ponownie',
  'members.pending.resent': 'Zaproszenie zostało wysłane ponownie.',
  'members.pending.revoke': 'Wycofaj',
  'members.pending.revoked': 'Zaproszenie zostało wycofane.',
  'members.remove.action': 'Usuń: {name}',
  'members.remove.title': 'Usunąć osobę {name} z tego domu?',
  'members.remove.body':
    'Straci dostęp od razu. Wszystko, co wpisała, zostaje — konta, wpisy i budżety należą do domu, a nie do osoby.',
  'members.remove.confirm': 'Usuń tę osobę',
  'members.removed': 'Osoba {name} nie ma już dostępu.',
  'members.leave.action': 'Opuść ten dom',
  'members.leave.title': 'Opuścić ten dom?',
  'members.leave.body':
    'Stracisz dostęp do jego kont i wpisów. To, co wpisano, zostaje przy domu.',
  'members.leave.confirm': 'Opuść',
  'members.error.title': 'Nie udało się wczytać listy osób',
  'members.error.lastOwner':
    'W domu musi zostać przynajmniej jeden właściciel. Najpierw uczyń właścicielem kogoś innego.',
  'members.error.alreadyHere': 'Ta osoba już jest w tym domu.',
  'members.error.alreadyInvited': 'Na ten adres czeka już zaproszenie.',
  'members.error.notAllowed': 'Twoja rola na to nie pozwala.',
  'members.error.seatsFull':
    'W tym planie nie ma wolnego miejsca. Zmień plan albo najpierw wycofaj jedno zaproszenie.',
  'members.error.generic': 'Nie udało się. Nic nie zostało zmienione.',

  /* -- Accepting an invitation -------------------------------------------- */
  'invite.title': 'Dołącz do domu {workspace}',
  'invite.body':
    'Masz zaproszenie do wspólnych kont, wpisów i budżetów tego domu.',
  'invite.invitedAs': 'Zaproszenie na adres {email}',
  'invite.accept': 'Dołącz do domu',
  'invite.joined': 'Jesteś w środku. Witaj w domu {workspace}.',
  'invite.signIn': 'Zaloguj się, aby kontynuować',
  'invite.signInBody':
    'Zaloguj się adresem {email}, na który wysłano zaproszenie, a link wróci Cię w to miejsce.',
  'invite.state.expired':
    'To zaproszenie wygasło. Poproś osobę, która je wysłała, o kolejne.',
  'invite.state.revoked': 'To zaproszenie zostało wycofane.',
  'invite.state.accepted': 'To zaproszenie zostało już wykorzystane.',
  'invite.state.alreadyMember': 'Jesteś już w tym domu.',
  'invite.state.wrongAccount':
    'Zaproszenie wysłano na adres {email}. Wyloguj się i zaloguj tym adresem, aby je przyjąć.',
  'invite.loading': 'Wczytujemy to zaproszenie…',
  'invite.notFound': 'Ten link z zaproszeniem donikąd nie prowadzi.',
  'invite.goToApp': 'Przejdź do domu',

  /* -- Unsubscribing from an email link ------------------------------------ */
  'unsubscribe.meta.title': 'Wypisanie z e-maili',
  'unsubscribe.topic.digest': 'codzienne podsumowanie',
  'unsubscribe.confirm.title': 'Wyłączyć te e-maile?',
  'unsubscribe.confirm.body':
    'Przestaniesz dostawać e-maile z {workspace} na temat: {topic}.',
  'unsubscribe.confirm.action': 'Wypisz mnie',
  'unsubscribe.done.title': 'Wypisano Cię',
  'unsubscribe.done.body':
    'Nie będziesz już dostawać e-maili z {workspace} na temat: {topic}. Powiadomienia w aplikacji zostają bez zmian.',
  'unsubscribe.invalid.title': 'Ten link nie działa',
  'unsubscribe.invalid.body':
    'Mógł wygasnąć albo zostać skopiowany niekompletnie. Zaloguj się, aby zmienić, jakie e-maile dostajesz.',
  'unsubscribe.invalid.signIn': 'Zaloguj się',

  /* -- The auth screens --------------------------------------------------- */
  'auth.aside.title': 'Każda kwota co do grosza.',
  'auth.aside.body':
    'Kwoty trzymamy co do grosza i przeliczamy po kursie z dnia, którego dotyczy wydatek, więc zeszły marzec nadal zgadza się tak, jak zgadzał się w marcu.',
  'auth.aside.point.privacy':
    'Żadnych integracji z bankami. Czytamy tylko to, co sam wpiszesz lub zaimportujesz.',
  'auth.aside.point.currency':
    'Konta w kilku walutach raportowane w jednej walucie bazowej.',
  'auth.aside.point.export':
    'Cały dom pobierzesz jako CSV lub JSON, kiedy tylko zechcesz.',
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
  'recurring.period.markPaid.for': 'Oznacz jako opłacone, termin {date}',
  'recurring.period.markPaid.forSeries':
    'Oznacz jako opłacone, termin {date}, {series}',
  'recurring.period.skip': 'Pomiń',
  'recurring.period.skip.for': 'Pomiń, termin {date}',
  'recurring.period.skip.forSeries': 'Pomiń, termin {date}, {series}',
  'recurring.period.revert': 'Cofnij',
  'recurring.period.revert.for': 'Cofnij, termin {date}',

  /* -- Oznaczanie jako opłacone ---------------------------------------------- */
  'recurring.markPaid.title': 'Oznacz ten okres jako opłacony',
  'recurring.markPaid.body':
    'Wskaż wydatek, który to uregulował. Nic tutaj nie tworzy nowych wpisów: jeśli płatność nie jest jeszcze zapisana, zapisz ją najpierw.',
  'recurring.markPaid.field': 'Wydatek, który to uregulował',
  'recurring.markPaid.placeholder': 'Szukaj wśród wydatków',
  'recurring.markPaid.empty':
    'Żaden wydatek z tego okna nie pasuje. Zapisz najpierw płatność i wróć tutaj.',
  'recurring.markPaid.record': 'Zapisz płatność',
  'recurring.markPaid.recordHint':
    'Po zapisaniu wrócisz tutaj, aby ją połączyć.',
  'recurring.markPaid.confirm': 'Połącz',
  'recurring.markPaid.status.found': {
    one: '{count} transakcja do wyboru',
    few: '{count} transakcje do wyboru',
    many: '{count} transakcji do wyboru',
    other: '{count} transakcji do wyboru',
  },
  'recurring.markPaid.never':
    'Oznaczenie jako opłaconego nigdy nie tworzy nowego wpisu.',
  /* -- Automatyzacja --------------------------------------------------------- */
  'recurring.automation.label': 'Automatyzacja',
  'recurring.automation.none':
    'Wyłączona — każdą płatność zapisujesz samodzielnie',
  'recurring.automation.none.help':
    'Seria przypomina i pilnuje, co jest nieuregulowane. Nic nie zostanie zapisane bez Ciebie.',
  'recurring.automation.auto': 'Zapisuj za mnie',
  'recurring.automation.auto.help':
    'W dniu terminu na wskazanym koncie powstaje wydatek na oczekiwaną kwotę. Możesz go potem edytować jak każdy inny.',
  'recurring.automation.match': 'Dopasowuj to, co zapiszę',
  'recurring.automation.match.help':
    'Nic nie zostaje zapisane. Wydatek, który wprowadzisz i który pasuje do poniższych warunków, zostanie połączony z płatnością, którą reguluje.',
  'recurring.automation.exclusive':
    'Seria albo zapisuje za Ciebie, albo dopasowuje to, co zapisujesz. Nie może robić obu naraz — automatyczny wpis nie ma już czego dopasowywać.',
  'recurring.automation.needsAccount':
    'Zapisywanie za Ciebie wymaga konta, na którym ma powstać wydatek.',
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
  'recurring.toast.unlinked': 'Wydatek odłączony',
  /* -- Połączone transakcje ---------------------------------------------------- */
  'recurring.links.title': 'Połączone wydatki',
  'recurring.links.caption':
    'To, co ta seria przyjęła, i skąd wzięło się każde połączenie.',
  'recurring.links.empty': 'Nic jeszcze nie jest połączone.',
  'recurring.links.source.manual': 'Połączone przez Ciebie',
  'recurring.links.source.rule': 'Dopasowane zasadą',
  'recurring.links.source.auto': 'Zapisane automatycznie',
  'recurring.links.unlink': 'Odłącz',
  'recurring.links.unlinked': 'Odłączone',

  /* -- Propozycje --------------------------------------------------------------- */
  'recurring.candidates.title': 'Powtarzające się wzorce w transakcjach',
  'recurring.candidates.subtitle':
    'Płatności, które powtarzają się w tym, co masz zapisane: ten sam odbiorca, zbliżona kwota, stały odstęp. Każda z nich to propozycja - załóż z niej serię albo oznacz, że to nie seria.',
  'recurring.candidates.loading': 'Przeglądanie transakcji…',
  'recurring.candidates.detect': 'Poszukaj ponownie',
  'recurring.candidates.detecting': 'Szukanie…',
  'recurring.candidates.link': 'Znajdź wzorce w transakcjach',
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
    one: 'Na podstawie {count} wydatku',
    few: 'Na podstawie {count} wydatków',
    many: 'Na podstawie {count} wydatków',
    other: 'Na podstawie {count} wydatku',
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
    'Utworzenie płatności cyklicznej tworzy wyłącznie plan. Żaden z wydatków, na podstawie których ją znaleźliśmy, nie zostaje zmieniony.',
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
    'Cel to kwota docelowa i, jeśli chcesz, data. Postęp bierze się z wpisów, które masz już zapisane; nic tutaj nie tworzy pieniędzy ani ich nie przenosi.',
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
    'Zalicz wpis na poczet tego celu, a jego historia pojawi się tutaj.',
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
    'Wpłata wskazuje na wpis, który masz już zapisany. Nic nowego nie powstaje i żadne pieniądze się nie przemieszczają.',
  'goals.contributions.column.date': 'Data',
  'goals.contributions.column.amount': 'Kwota',
  'goals.contributions.column.detail': 'Wpis',
  'goals.contributions.column.actions': 'Działania',
  'goals.contributions.linkedOn': 'Zaliczono {date}',
  'goals.contributions.remove': 'Usuń {amount} z tego celu',
  'goals.contributions.add': 'Zalicz wpis',
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
  'goals.contribute.title': 'Zalicz wpis na poczet celu {name}',
  'goals.contribute.description':
    'Wybierz wpis, który już się wydarzył. Zostaje dokładnie taki, jaki jest, zapisujemy tylko to, na co poszedł.',
  'goals.contribute.field': 'Wpis',
  'goals.contribute.field.help':
    'Zaliczyć można wyłącznie wpisy w walucie {currency}, ponieważ cel jest liczony w {currency}.',
  'goals.contribute.option': '{date} · {amount}',
  'goals.contribute.empty':
    'Nie ma niepowiązanego wpisu w walucie {currency}, który można zaliczyć. Zapisz go najpierw albo zmień konto, na którym trzymasz ten cel.',
  'goals.contribute.submit': 'Zalicz',
  'goals.contribute.cancel': 'Anuluj',
  'goals.contribute.error': 'Nie udało się zaliczyć tego wpisu',
  'goals.contribute.error.currency':
    'Ten wpis jest w walucie {transaction}, a cel w {goal}. Przeliczenie wymagałoby kursu, którego nikt nie wybrał, więc odrzucamy go, zamiast zgadywać.',
  'goals.contribute.error.direction':
    'Ten cel zasilają wpisy typu {expected}, a ten jest typu {received}. Zaliczenie go zmniejszyłoby postęp, zamiast go zwiększyć.',
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
    'Cel i zapis o tym, które wpisy się na niego składały, znikną na dobre. Same wpisy pozostają nietknięte.',
  'goals.confirm.delete.action': 'Usuń',
  'goals.confirm.remove.title': 'Usunąć tę wpłatę?',
  'goals.confirm.remove.body':
    'Wpis zostaje dokładnie taki, jaki jest. Znika tylko adnotacja, że był na ten cel, a postęp spada o tę kwotę.',
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
  /* -- Zasady · baner wstrzymanej zasady ------------------------------------ */
  'rules.paused.badge': 'Wstrzymana',
  'rules.paused.title': 'Zasada „{name}” jest wstrzymana',
  'rules.paused.body':
    'Element, którego potrzebowała ta zasada, został usunięty, więc przestała działać. Wybierz zamiennik, aby włączyć ją z powrotem, albo usuń zasadę.',
  'rules.paused.at': 'Wstrzymano {when}.',
  'rules.paused.missing.account': 'Usunięte konto: „{label}”',
  'rules.paused.missing.accountGroup': 'Usunięta grupa kont: „{label}”',
  'rules.paused.missing.category': 'Usunięta kategoria: „{label}”',
  'rules.paused.missing.payee': 'Usunięty odbiorca: „{label}”',
  'rules.paused.missing.tag': 'Usunięty tag: „{label}”',
  'rules.paused.replace.label': 'Zamiennik dla zasady „{name}”',
  'rules.paused.replace.placeholder': 'Wybierz zamiennik',
  'rules.paused.replace.empty':
    'Nie ma na co przełączyć. Najpierw utwórz zamiennik albo usuń tę zasadę.',
  'rules.paused.delete': 'Usuń tę zasadę',
  'rules.paused.resumed': 'Zasada znów działa',

  /* -- Zasady: silnik automatyzacji ---------------------------------------- */
  'rules.title': 'Zasady',
  'rules.subtitle':
    'Zasady działają od góry do dołu na każdym wpisie, który je uruchamia. Wykonują się wszystkie pasujące, a późniejsza zasada nadpisuje to, co ustawiła wcześniejsza.',
  'rules.new': 'Nowa zasada',
  'rules.list.label': 'Zasady w kolejności działania',
  'rules.back': 'Wróć do zasad',
  'rules.list.loading': 'Wczytujemy Twoje zasady…',
  'rules.editor.loading': 'Wczytujemy edytor zasady…',
  'rules.editor.load.error.title': 'Nie udało się wczytać edytora zasady',
  'rules.editor.load.error.body':
    'Żadna zasada nie została utworzona ani zmieniona. Spróbuj ponownie za chwilę.',
  'rules.error.title': 'Nie udało się wczytać zasad',
  'rules.error.body': 'Nic nie zostało zmienione. Spróbuj ponownie za chwilę.',

  'rules.empty.title': 'Nie ma jeszcze żadnej zasady',
  'rules.empty.body':
    'Zasada wypatruje wpisów, które opiszesz, i zmienia je za Ciebie: nadaje kategorię sklepowi, do którego chodzisz co tydzień, albo etykietę płatności, o której ciągle zapominasz.',
  'rules.empty.locked.title': 'Automatyzacja nie wchodzi w skład tego planu',
  'rules.empty.locked.body':
    'Zasady nadają kategorie, etykiety i nazwy nowym wpisom w chwili, gdy się pojawiają. Zmiana planu je włącza; nic z tego, co już wprowadziłeś, się nie zmienia.',
  'rules.empty.locked.action': 'Zobacz plany',

  'rules.row.actions': 'Działania dla {name}',
  'rules.row.active': 'Aktywna: {name}',
  'rules.row.position': 'Kolejność {position} z {count}',
  'rules.row.matches': 'Dopasowania: {count}',
  'rules.row.inert': 'Nie ma wyzwalacza',
  'rules.row.paused': 'Wstrzymana',
  'rules.row.off': 'Wyłączona',
  'rules.drag.label': 'Zmień kolejność: {name}',
  'rules.move.top': 'Przenieś na górę',
  'rules.move.bottom': 'Przenieś na dół',

  'rules.confirm.delete.title': 'Usunąć tę zasadę?',
  'rules.confirm.delete.body':
    'Od tej chwili przestaje działać. Nic, co już wpisała, nie zostaje cofnięte.',
  'rules.confirm.delete.action': 'Usuń',

  'rules.toast.reordered': 'Kolejność zapisana',
  'rules.toast.activated': 'Zasada włączona',
  'rules.toast.deactivated': 'Zasada wyłączona',
  'rules.toast.created': 'Zasada utworzona',
  'rules.toast.saved': 'Zasada zapisana',
  'rules.toast.deleted': 'Zasada usunięta',
  'rules.toast.failed': 'Nie udało się',

  /* -- Edytor --------------------------------------------------------------- */
  'rules.editor.new.title': 'Nowa zasada',
  'rules.editor.edit.title': 'Edytuj zasadę',
  'rules.editor.name': 'Nazwa',
  'rules.editor.name.description':
    'To, jak nazwiesz tę zasadę, przeglądając listę.',
  'rules.editor.matchMode': 'Dopasowanie',
  'rules.editor.matchMode.all': 'Każdy warunek',
  'rules.editor.matchMode.any': 'Dowolny warunek',
  'rules.editor.when': 'Gdy',
  'rules.editor.then': 'Wtedy',
  'rules.editor.conditions.label': 'Warunki',
  'rules.editor.actions.label': 'Działania',
  'rules.editor.addCondition': 'Dodaj warunek',
  'rules.editor.addAction': 'Dodaj działanie',
  'rules.editor.addRange': 'Dodaj przedział kwoty',
  'rules.editor.addRange.description':
    'Dodaje dwa warunki — co najmniej i co najwyżej. Przedział jest przedziałem tylko wtedy, gdy muszą zachodzić wszystkie warunki, więc najpierw ustaw Dopasowanie na „Każdy warunek”.',
  'rules.editor.conditions.full': 'Zasada mieści najwyżej {count} warunków.',
  'rules.editor.actions.full': 'Zasada mieści najwyżej {count} działań.',
  'rules.editor.runOn': 'Uruchamiaj tę zasadę',
  'rules.editor.runOn.manual_create': 'Gdy dodaję wpis',
  'rules.editor.runOn.import': 'Gdy importuję plik',
  'rules.editor.runOn.edit': 'Gdy edytuję wpis',
  'rules.editor.runOn.none':
    'Ta zasada nie uruchamia się w żadnej sytuacji, więc nigdy niczego nie zmieni. Mimo to można ją zapisać.',
  'rules.editor.sentence.label': 'Co robi ta zasada',
  'rules.editor.save': 'Zapisz zasadę',
  'rules.editor.delete': 'Usuń tę zasadę',
  'rules.editor.error.title': 'Zasada nie została zapisana',

  /* -- Wiersz warunku ------------------------------------------------------- */
  'rules.condition.legend': 'Warunek {position}',
  'rules.condition.field': 'Pole',
  'rules.condition.operator': 'Porównanie',
  'rules.condition.remove': 'Usuń warunek {position}',
  'rules.condition.moveUp': 'Przenieś warunek {position} w górę',
  'rules.condition.moveDown': 'Przenieś warunek {position} w dół',
  'rules.condition.keywords': 'Słowa kluczowe',
  'rules.condition.keywords.description':
    'Po jednym w wierszu. Wielkość liter i polskie znaki są pomijane, więc „Żabka” znajdzie „ZABKA 4471”.',
  'rules.condition.values': 'Wartości',
  'rules.condition.values.add': 'Dodaj wartość',
  'rules.condition.values.toggle': 'Pokaż opcje',
  'rules.condition.values.remove': 'Usuń {name}',
  'rules.condition.values.none': 'Nic jeszcze nie wybrano.',
  'rules.condition.values.empty': 'Nie ma tu jeszcze czego wybierać.',
  'rules.condition.values.noMatch': 'Nic nie pasuje.',
  'rules.condition.values.full': 'Najwyżej {count} naraz.',
  'rules.condition.days': 'Dni',
  'rules.condition.days.description':
    'Liczby całkowite od 1 do 31, oddzielone przecinkami. Miesiąc trzydziestodniowy nigdy nie pasuje do 31.',
  'rules.condition.days.invalid': 'Tylko liczby całkowite od 1 do 31.',
  'rules.condition.amount': 'Kwota',
  'rules.condition.currency': 'Waluta',
  'rules.condition.currency.description':
    'Kwotę porównujemy w jednej walucie i nigdy nie przeliczamy, więc wpis w innej walucie nie pasuje.',
  'rules.condition.direction': 'Kierunek',
  'rules.condition.direction.income': 'Wpływ',
  'rules.condition.direction.expense': 'Wydatek',

  'rules.field.note': 'Notatka',
  'rules.field.payee': 'Odbiorca',
  'rules.field.account': 'Konto',
  'rules.field.account_group': 'Grupa kont',
  'rules.field.amount': 'Kwota',
  'rules.field.direction': 'Kierunek',
  'rules.field.day_of_month': 'Dzień miesiąca',
  'rules.field.tag': 'Tag',
  'rules.field.category': 'Kategoria',

  'rules.operator.contains': 'zawiera',
  'rules.operator.not_contains': 'nie zawiera',
  'rules.operator.is_any_of': 'jest jednym z',
  'rules.operator.is_none_of': 'nie jest żadnym z',
  'rules.operator.eq': 'wynosi dokładnie',
  'rules.operator.gt': 'jest większa niż',
  'rules.operator.gte': 'wynosi co najmniej',
  'rules.operator.lt': 'jest mniejsza niż',
  'rules.operator.lte': 'wynosi co najwyżej',

  /* -- Wiersz działania ----------------------------------------------------- */
  'rules.action.legend': 'Działanie {position}',
  'rules.action.kind': 'Zrób to',
  'rules.action.remove': 'Usuń działanie {position}',
  'rules.action.moveUp': 'Przenieś działanie {position} w górę',
  'rules.action.moveDown': 'Przenieś działanie {position} w dół',
  'rules.action.set_category': 'Ustaw kategorię',
  'rules.action.set_payee': 'Ustaw odbiorcę',
  'rules.action.add_tag': 'Dodaj tag',
  'rules.action.remove_tag': 'Usuń tag',
  'rules.action.set_note': 'Ustaw notatkę',
  'rules.action.set_payment_method': 'Ustaw sposób płatności',
  'rules.action.mark_planned': 'Oznacz jako planowaną',
  'rules.action.set_excluded': 'Wyłącz ze statystyk',
  'rules.action.value.category': 'Kategoria',
  'rules.action.value.payee': 'Odbiorca',
  'rules.action.value.tag': 'Tag',
  'rules.action.value.note': 'Notatka',
  'rules.action.value.paymentMethod': 'Sposób płatności',
  'rules.action.value.planned': 'Planowana',
  'rules.action.value.planned.waitsForDate':
    'Wpis z przyszłą datą pozostaje planowany, dopóki zasada nie zadziała na nim po nadejściu tej daty (przy dodaniu, edycji lub imporcie wpisu).',
  'rules.action.value.excluded': 'Wyłączona ze statystyk',
  'rules.action.value.empty': 'Nie ma tu jeszcze czego wybierać.',

  /* -- Podgląd na żywo ------------------------------------------------------ */
  'rules.preview.title': 'Podgląd',
  'rules.preview.counts': 'Pasuje {matched} z ostatnich {scanned} wpisów.',
  'rules.preview.empty': 'Brak dopasowań wśród ostatnich {scanned} wpisów.',
  'rules.preview.incomplete':
    'Dodaj warunek i działanie, a podgląd pojawi się tutaj.',
  'rules.preview.loading': 'Sprawdzam…',
  'rules.preview.samples.label': 'Pasujące wpisy',
  'rules.preview.samples.shown': 'Wypisano pierwsze {shown}.',
  'rules.preview.scanCap':
    'Sprawdzamy tylko {limit} najnowszych wpisów, więc to próbka Twojej historii, a nie całość.',
  'rules.preview.error.title': 'Nie udało się wykonać podglądu',
  'rules.preview.error.body':
    'Nic nie zostało zmienione — podgląd nigdy nie zapisuje. Zasada nadal czeka na zapisanie lub edycję.',

  /* -- Zasada odczytana jako zdanie ----------------------------------------- */
  'rules.sentence.template': 'Gdy {when}, {then}.',
  'rules.sentence.and': ' i ',
  'rules.sentence.or': ' lub ',
  'rules.sentence.listSeparator': ', ',
  'rules.sentence.quoted': '„{value}”',
  'rules.sentence.unknownReference': 'coś, czego już nie ma',
  'rules.sentence.noConditions':
    'Dodaj warunek, a zasada zostanie tu odczytana zdaniem.',
  'rules.sentence.noActions':
    'Dodaj działanie, a zasada zostanie tu odczytana zdaniem.',

  'rules.clause.note.contains': 'notatka zawiera {values}',
  'rules.clause.note.notContains': 'notatka nie zawiera {values}',
  'rules.clause.payee.contains': 'odbiorca zawiera {values}',
  'rules.clause.payee.notContains': 'odbiorca nie zawiera {values}',
  'rules.clause.account.isAnyOf': 'kontem jest {values}',
  'rules.clause.account.isNoneOf': 'kontem nie jest {values}',
  'rules.clause.accountGroup.isAnyOf': 'grupą kont jest {values}',
  'rules.clause.accountGroup.isNoneOf': 'grupą kont nie jest {values}',
  'rules.clause.category.isAnyOf': 'kategorią jest {values}',
  'rules.clause.category.isNoneOf': 'kategorią nie jest {values}',
  'rules.clause.tag.isAnyOf': 'ma tag {values}',
  'rules.clause.tag.isNoneOf': 'nie ma tagu {values}',
  'rules.clause.dayOfMonth.isAnyOf': 'dniem miesiąca jest {values}',
  'rules.clause.dayOfMonth.isNoneOf': 'dniem miesiąca nie jest {values}',
  'rules.clause.amount.eq': 'kwota wynosi dokładnie {amount}',
  'rules.clause.amount.gt': 'kwota jest większa niż {amount}',
  'rules.clause.amount.gte': 'kwota wynosi co najmniej {amount}',
  'rules.clause.amount.lt': 'kwota jest mniejsza niż {amount}',
  'rules.clause.amount.lte': 'kwota wynosi co najwyżej {amount}',
  'rules.clause.direction.income': 'pieniądze wpływają',
  'rules.clause.direction.expense': 'pieniądze wypływają',
  'rules.clause.setCategory': 'ustaw kategorię na {value}',
  'rules.clause.setPayee': 'ustaw odbiorcę na {value}',
  'rules.clause.addTag': 'dodaj tag {value}',
  'rules.clause.removeTag': 'usuń tag {value}',
  'rules.clause.setNote': 'ustaw notatkę na „{value}”',
  'rules.clause.setPaymentMethod': 'ustaw sposób płatności na {value}',
  'rules.clause.markPlanned': 'oznacz ją jako planowaną',
  'rules.clause.markNotPlanned': 'oznacz ją jako nieplanowaną',
  'rules.clause.exclude': 'pomiń ją w statystykach',
  'rules.clause.include': 'uwzględnij ją w statystykach',

  /* -- Attachments (11-S3) -------------------------------------------------- */
  'attachments.title': 'Paragony',
  'attachments.description':
    'Zdjęcia i pliki PDF przechowywane przy tym wpisie. Otworzą je tylko osoby z tego domu.',
  'attachments.list.label': 'Załączone paragony',
  'attachments.link': '{name} · {size} · {kind}',
  'attachments.remove': 'Usuń {name}',
  'attachments.empty.title': 'Brak załączonych paragonów',
  'attachments.empty.body':
    'Trzymaj paragon, fakturę lub potwierdzenie przelewu razem z wydatkiem, którego dotyczą.',
  'attachments.attach': 'Załącz paragon',
  'attachments.dropzone.label': 'Upuść tutaj paragony, aby je załączyć',
  'attachments.dropzone.hint': 'Upuść pliki tutaj albo je wybierz:',
  'attachments.dropzone.limits':
    'JPEG, PNG, WebP, HEIC lub PDF, każdy do 10 MB.',
  'attachments.progress.label': 'Trwające przesyłanie',
  'attachments.progress.file': 'Przesyłanie {name}',
  'attachments.error.file': 'Nie załączono {name}: {reason}',
  'attachments.error.size': 'plik jest większy niż 10 MB',
  'attachments.error.type': 'ten typ pliku nie jest przyjmowany',
  'attachments.error.failed': 'przesyłanie nie powiodło się',
  'attachments.type.jpeg': 'Obraz JPEG',
  'attachments.type.png': 'Obraz PNG',
  'attachments.type.webp': 'Obraz WebP',
  'attachments.type.heic': 'Obraz HEIC',
  'attachments.type.pdf': 'Dokument PDF',
  'attachments.type.other': 'Plik',
  'attachments.confirm.title': 'Usunąć ten paragon?',
  'attachments.confirm.body':
    'Plik {name} zostanie usunięty na stałe. Sam wpis pozostanie bez zmian.',
  'attachments.confirm.action': 'Usuń',
  'attachments.toast.deleted': 'Paragon usunięty',
  /* -- Why an import refused a row (19-S2) ---------------------------------- */
  'import.error.date_empty': 'Kolumna daty jest pusta w tym wierszu.',
  'import.error.date_unparseable':
    'Ta data nie jest zapisana w sposób opisany przez wybrany format daty.',
  'import.error.date_impossible': 'Taka data nie istnieje w kalendarzu.',
  'import.error.amount_empty': 'Kolumna kwoty jest pusta w tym wierszu.',
  'import.error.amount_unparseable':
    'Nie udało się odczytać tej kwoty przy wybranym separatorze dziesiętnym.',
  'import.error.amount_currency_mismatch':
    'Ta kwota wskazuje inną walutę niż konto, do którego miałaby trafić.',
  'import.error.amount_too_precise':
    'Ta kwota ma więcej miejsc po przecinku niż waluta, więc nie została zaokrąglona.',
  'import.error.amount_out_of_range':
    'Ta kwota jest zbyt duża, aby ją zapisać.',
  'import.error.amount_zero': 'Wczytywany wpis nie może opiewać na zero.',
  'import.error.amount_both_empty':
    'W tym wierszu nie ma kwoty ani w kolumnie obciążeń, ani uznań.',
  'import.error.amount_debit_and_credit':
    'Ten wiersz ma jednocześnie obciążenie i uznanie, więc nie jest jednym wpisem.',
  'import.error.row_currency_mismatch':
    'Ten wiersz jest w innej walucie niż konto, do którego miałby trafić.',

  /* -- Import: ekran wejściowy, kreator, mapowanie i podgląd (19-S2) -------- */
  'import.title': 'Import',
  'import.lead':
    'Wczytaj wyciąg albo eksport z innego programu. Nic nie zostanie zapisane, zanim nie zobaczysz, co ten plik by zrobił.',

  'import.group.file.title': 'Z banku albo z arkusza',
  'import.group.file.body':
    'Wyciąg pobrany z banku albo arkusz, który prowadzisz sam. Format rozpoznajemy z pliku - nie ma tu listy skrótów do wyboru.',
  'import.group.migration.title': 'Z innego programu',
  'import.group.migration.body':
    'Eksport z aplikacji, w której trzymałeś finanse wcześniej.',
  'import.group.empty':
    'Nic tutaj nie jest jeszcze czytane. Gdy format się pojawi, sam znajdzie się w tej grupie.',

  'import.upload.account.label': 'Importuj do',
  'import.upload.account.placeholder': 'Wybierz konto',
  'import.upload.file.label': 'Plik',
  'import.upload.dropzone': 'Upuść tutaj plik, aby go wczytać',
  'import.upload.choose': 'Wybierz plik',
  'import.upload.accepts': 'Przyjmujemy tutaj: {extensions}. Do {size}.',
  'import.upload.selected': 'Wybrano: {name}',
  'import.upload.submit': 'Wczytaj ten plik',
  'import.upload.state.uploading': 'Wysyłanie {name}…',
  'import.upload.state.sniffing': 'Ustalamy, czym jest ten plik…',
  'import.upload.noAccounts':
    'Najpierw załóż konto, wczytane wpisy muszą gdzieś trafić.',
  'import.upload.error.account': 'Wybierz konto, do którego należą te wpisy.',
  'import.upload.error.file': 'Wybierz plik do zaimportowania.',
  'import.upload.error.extension':
    'Plik {name} nie ma rozszerzenia, które umiemy tu odczytać, więc nie ma dla niego parsera.',
  'import.upload.error.tooLarge':
    'Plik {name} jest większy niż {size}. Wyeksportuj krótszy okres i wczytaj go w dwóch plikach.',
  'import.upload.error.failed': 'Nie udało się wczytać pliku: {reason}',

  'import.list.loading': 'Wczytujemy Twoje importy…',
  'import.load.error.title': 'Nie udało się wczytać strony importu',
  'import.load.error.body':
    'Nic nie zostało wysłane ani zmienione. Spróbuj ponownie za chwilę.',
  'import.detail.loading': 'Wczytujemy ten import…',
  'import.detail.error.title': 'Nie udało się wczytać tego importu',
  'import.detail.error.body':
    'Plik i jego wiersze pozostały nietknięte. Spróbuj ponownie za chwilę.',

  'import.history.title': 'Historia importów',
  'import.history.body': 'Każdy plik wczytany w tym domu, od najnowszego.',
  'import.history.empty.title': 'Nie było jeszcze importu',
  'import.history.empty.body':
    'Wczytany plik zostaje tutaj razem z tym, co zrobił, więc import da się odnaleźć także po miesiącach.',
  'import.history.table': 'Importy, od najnowszego',
  'import.history.column.file': 'Plik',
  'import.history.column.status': 'Stan',
  'import.history.column.rows': 'Wiersze',
  'import.history.column.created': 'Rozpoczęto',
  'import.history.open': 'Otwórz import pliku {name}',
  'import.history.rows': '{imported} z {total}',

  'import.source.csv': 'Arkusz albo CSV',
  'import.source.ofx': 'Wyciąg OFX',
  'import.source.qif': 'Wyciąg QIF',
  'import.source.ynab': 'Eksport z YNAB',
  'import.source.wallet': 'Eksport z Wallet',
  'import.source.json_backup': 'Kopia Money Trackera',

  'import.status.queued': 'Oczekuje',
  'import.status.parsing': 'Odczyt',
  'import.status.mapping': 'Do zmapowania',
  'import.status.previewing': 'Po podglądzie',
  'import.status.running': 'Importowanie',
  'import.status.completed': 'Zaimportowany',
  'import.status.failed': 'Niepowodzenie',
  'import.status.reverted': 'Cofnięty',

  'import.stepper.label': 'Kroki importu',
  'import.step.upload': 'Wczytanie',
  'import.step.map': 'Mapowanie kolumn',
  'import.step.review': 'Przegląd',
  'import.step.done': 'Import',
  'import.step.position': 'Krok {position} z {total}: {name}',
  'import.step.current': 'Jesteś tutaj',
  'import.step.back': 'Wstecz: {name}',
  'import.step.next': 'Dalej: {name}',
  'import.step.locked': 'Ten krok otworzy się po zakończeniu poprzedniego.',

  'import.file.title': 'Plik',
  'import.file.rows': 'Z pliku {name} odczytano {rows} wierszy.',
  'import.file.account': 'Trafiłyby na konto {account}.',
  'import.file.truncated':
    'Odczytano tylko pierwsze {rows} wierszy - plik ma ich więcej, niż mieści jeden import.',
  'import.warnings.title': 'Co warto wiedzieć o tym pliku',
  'import.warning.ragged_row':
    'Część wierszy ma inną liczbę pól niż wiersz nagłówka. Nic nie zostało pominięte.',
  'import.warning.re_encoded':
    'Plik nie jest w UTF-8 i został odczytany kodowaniem zapasowym, więc sprawdź poniżej znaki diakrytyczne.',
  'import.warning.replacement_character':
    'Części znaków nie dało się zdekodować, co zwykle oznacza źle odgadnięte kodowanie.',
  'import.warning.row_cap_reached':
    'Plik ma więcej wierszy, niż mieści jeden import, więc reszta nie została odczytana.',

  'import.resume.pending': 'Ponowny odczyt zapisanego pliku…',
  'import.resume.title': 'Nie udało się ponownie odczytać zapisanego pliku',
  'import.resume.body':
    'Ta karta nie ma już kolumn pliku, a odczyt zapisanej kopii się nie powiódł. Nic nie zostało zapisane, a poprzednie wysłanie nadal jest w historii - wyślij plik ponownie, aby go zmapować.',
  'import.resume.action': 'Zacznij od nowa',

  'import.mapping.title': 'Zmapuj kolumny',
  'import.mapping.body':
    'Powiedz, co zawiera każda kolumna pliku. Przy każdej pokazujemy trzy pierwsze wartości, żeby wybór opierał się na danych, a nie na nazwie nagłówka.',
  'import.mapping.table': 'Kolumny pliku i to, co zawierają',
  'import.mapping.column.header': 'Kolumna',
  'import.mapping.column.samples': 'Pierwsze wartości',
  'import.mapping.column.target': 'Zawiera',
  'import.mapping.column.empty': '(pusto)',
  'import.mapping.target.label': 'Co zawiera kolumna „{column}”',
  'import.mapping.target.ignore': 'Pomiń tę kolumnę',
  'import.mapping.target.date': 'Data',
  'import.mapping.target.amount': 'Kwota z własnym znakiem',
  'import.mapping.target.debit': 'Obciążenie',
  'import.mapping.target.credit': 'Uznanie',
  'import.mapping.target.description': 'Opis',
  'import.mapping.target.payee': 'Odbiorca',
  'import.mapping.target.category': 'Kategoria',
  'import.mapping.target.reference': 'Numer referencyjny',
  'import.mapping.target.notes': 'Notatka',
  'import.mapping.target.currency': 'Waluta',
  'import.mapping.target.sourceRef': 'Własny identyfikator wiersza z banku',

  'import.mapping.preset.title': 'Wstawiliśmy zapisane wcześniej mapowanie',
  'import.mapping.preset.body':
    'Zapamiętaliśmy je dla pliku dokładnie z tymi kolumnami. Sprawdź każdy wiersz, zanim przejdziesz dalej: bank, który zamienia kolumny miejscami, zostawia te same nazwy nagłówków.',
  'import.mapping.preset.named': 'Nazwałeś je „{label}”.',

  'import.mapping.numbers.title': 'Jak zapisane są liczby',
  'import.mapping.decimal.label': 'Separator dziesiętny',
  'import.mapping.decimal.dot': 'Kropka - 1234.56',
  'import.mapping.decimal.comma': 'Przecinek - 1234,56',
  'import.mapping.thousands.label': 'Separator tysięcy',
  'import.mapping.thousands.dot': 'Kropka - 1.234,56',
  'import.mapping.thousands.comma': 'Przecinek - 1,234.56',
  'import.mapping.thousands.space': 'Spacja - 1 234,56',
  'import.mapping.thousands.none': 'Brak - 1234,56',
  'import.mapping.accounting.label': 'Wydatki zapisane w nawiasach',
  'import.mapping.accounting.description':
    'Część eksportów zapisuje wydatek jako (45,00), a nie −45,00.',

  'import.mapping.date.label': 'Format daty',
  'import.mapping.date.iso': 'Najpierw rok - 2026-04-03',
  'import.mapping.date.dmySlash': 'Najpierw dzień - 03/04/2026',
  'import.mapping.date.mdySlash': 'Najpierw miesiąc - 04/03/2026',
  'import.mapping.date.dmyDot': 'Najpierw dzień - 03.04.2026',
  'import.mapping.date.ambiguous.title':
    'W której kolejności zapisane są te daty?',
  'import.mapping.date.ambiguous.body':
    'Każdą z próbek da się odczytać na dwa sposoby - {sample} jest jedną z nich. Plik nie mówi, co ma na myśli, a zgadywanie przestawia datę nawet w dwunastu wierszach na trzydzieści jeden i przez miesiące nikt tego nie zauważy.',
  'import.mapping.date.ambiguous.legend': 'Jak ten plik zapisuje daty',
  'import.mapping.date.ambiguous.required':
    'Zanim przejdziesz dalej, wybierz, jak ten plik zapisuje daty.',
  'import.mapping.date.unrecognised':
    'Wartości w kolumnie „{column}” nie są zapisane w żadnym formacie daty, który tu czytamy. Wyeksportuj plik ze zwykłą kolumną daty.',
  'import.mapping.date.checking': 'Odczytujemy daty w tej kolumnie…',

  'import.mapping.save.label': 'Nazwij to mapowanie',
  'import.mapping.save.description':
    'Zapamiętamy je dla kolejnego pliku z tymi samymi kolumnami i następnym razem tylko je zaproponujemy. Nazwa jest tym, jak sam nazywasz ten bank.',
  'import.mapping.save.placeholder': 'Mój bank, konto osobiste',

  'import.mapping.problems': 'Zanim przejdziesz dalej',
  'import.mapping.error.account':
    'Wybierz konto, do którego trafią te wiersze.',
  'import.mapping.error.date': 'Wskaż kolumnę z datą.',
  'import.mapping.error.amount':
    'Wskaż kolumnę z kwotą albo jedną z obciążeniami i jedną z uznaniami.',
  'import.mapping.error.amountShapes':
    'Wybierz albo jedną kolumnę kwoty ze znakiem, albo parę obciążenie i uznanie - nie oba naraz.',
  'import.mapping.error.creditMissing':
    'Kolumna obciążeń potrzebuje obok kolumny uznań.',
  'import.mapping.error.debitMissing':
    'Kolumna uznań potrzebuje obok kolumny obciążeń.',
  'import.mapping.error.separators':
    'Separator dziesiętny i separator tysięcy muszą być różnymi znakami.',
  'import.mapping.submit': 'Zapisz mapowanie i pokaż podgląd',
  'import.mapping.pending': 'Zapisywanie mapowania…',
  'import.mapping.failed': 'Nie zapisano mapowania: {reason}',

  'import.preview.title': 'Sprawdź, co się wydarzy',
  'import.preview.body':
    'Nic nie zostało zapisane. Każdy wiersz poniżej to wpis w takiej postaci, w jakiej zostałby utworzony, a kwoty są dokładnie tymi, które trafiłyby do bazy.',
  'import.preview.pending': 'Ustalamy, co zrobiłby ten plik…',
  'import.preview.failed.title': 'Podgląd się nie wykonał',
  'import.preview.failed.body':
    'Nic nie zostało zapisane. Wróć do mapowania, sprawdź kolumny i spróbuj ponownie.',
  'import.preview.retry': 'Spróbuj podglądu ponownie',

  'import.preview.summary.label': 'Co zrobiłby ten plik',
  'import.preview.count.total': 'Odczytane wiersze',
  'import.preview.count.toCreate': 'Do utworzenia',
  'import.preview.count.duplicates': 'Pominięte duplikaty',
  'import.preview.count.invalid': 'Odrzucone',
  'import.preview.count.flagged': 'Do obejrzenia',
  'import.preview.count.amount': 'Zmiana stanu konta',
  'import.preview.filter.label': 'Pokaż',
  'import.preview.filter.all': 'Wszystkie wiersze',
  'import.preview.filter.create': 'Wiersze do utworzenia',
  'import.preview.filter.duplicate': 'Wiersze do pominięcia',
  'import.preview.filter.flagged': 'Możliwe duplikaty',

  'import.preview.table': 'Wiersze, które utworzyłby ten plik',
  'import.preview.column.date': 'Data',
  'import.preview.column.description': 'Opis',
  'import.preview.column.amount': 'Kwota',
  'import.preview.column.match': 'Dopasowanie',
  'import.preview.column.decision': 'Co się stanie',
  'import.preview.decision.label': 'Co stanie się z wierszem {date}, {amount}',
  'import.preview.decision.create': 'Utwórz',
  'import.preview.decision.skip': 'Pomiń',
  'import.preview.match.certain': 'Duplikat',
  'import.preview.match.probable': 'Możliwy duplikat',
  'import.preview.match.none': 'Nowa',
  'import.preview.reason.source_ref':
    'Wiersz o tym identyfikatorze jest już zapisany na tym koncie.',
  'import.preview.reason.exact_match':
    'Ten sam dzień, ta sama kwota i ten sam opis.',
  'import.preview.reason.amount_and_date':
    'Ta sama kwota w ciągu trzech dni, ale dzień albo opis się zmienił.',
  'import.preview.reason.within_file':
    'Wcześniejszy wiersz tego samego pliku mówi to samo.',
  'import.preview.empty': 'Żaden wiersz nie pasuje do tego filtra.',
  'import.preview.sourceRef.used':
    'Ten plik stempluje własne identyfikatory wierszy, więc duplikaty dopasowaliśmy po nich, a nie po przypuszczeniach.',
  'import.preview.quota':
    'Wczytanie tych wierszy przekroczyłoby limit {limit} wpisów w Twoim planie o {excess}.',
  'import.preview.decisions.note':
    'To, co wybierzesz przy poszczególnych wierszach, żyje w tej przeglądarce. Zapis wierszy pojawi się razem z ostatnim krokiem tego przepływu.',

  'import.preview.invalid.title': 'Odrzucone wiersze',
  'import.preview.invalid.body':
    'Te wiersze nie zostaną zaimportowane. Cytujemy własny tekst pliku, żebyś zobaczył, co w nim było.',
  'import.preview.invalid.row': 'Wiersz {row}',
  'import.preview.invalid.raw': 'W pliku jest: {raw}',
  'import.preview.allInvalid.title':
    'Nie dało się odczytać ani jednego wiersza',
  'import.preview.allInvalid.body':
    'Odrzucono wszystkie wiersze ({count}), co niemal zawsze oznacza kolumnę wskazaną na złe pole. Trzy pierwsze mówią dlaczego:',
  'import.preview.allInvalid.remap': 'Wróć do mapowania',
  'import.preview.allInvalid.restart': 'Zacznij od nowa z innym plikiem',

  'import.done.title': 'Zaimportuj wiersze',
  'import.done.body':
    'Nic jeszcze nie zostało zapisane. Zapis sprawdzonego importu do Twoich wydatków nie jest tu jeszcze dostępny, więc podgląd powyżej możesz spokojnie zostawić otwarty albo wrócić do niego później.',
  'import.done.back': 'Wróć do przeglądu',
} satisfies TranslationOf<typeof En>

export default messages
