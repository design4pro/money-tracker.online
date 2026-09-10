import type { MessageCatalogueSource } from '../types'

/**
 * The English catalogue — the schema for every key in the product.
 *
 * `as const` is load-bearing: it keeps each value a string literal type, and
 * that literal is what `t()` reads placeholder names out of. A message with a
 * `{name}` cannot be rendered without one.
 *
 * Keys are dotted and grouped by surface. The groups are a reading aid, not a
 * namespace the loader knows about, so a key can be moved between them without
 * anything but this file and its translations changing.
 *
 * **Plural messages exist for a reason, not for symmetry.** A count that always
 * reads naturally beside a bare numeral (`3 / 12`) is a plain string; a count
 * that appears inside a sentence gets branches, because Polish needs four of
 * them and a sentence built by concatenation cannot have four.
 *
 * **Household words, not accountancy.** The reader keeps a household budget and
 * is not a bookkeeper, so the surface says `expense` or `entry` rather than
 * `transaction`, `household` rather than `workspace`, `everyday account` rather
 * than `current account`, and never `ledger` or `envelope`. Words a consumer
 * bank already uses with them (`balance`, `payee`, `rule`, `budget`) stay,
 * because replacing those buys nothing. The keys keep the domain names
 * (`transactions.*`, `payees.*`, `settings.workspace.*`): this rule governs what
 * is displayed, not what is stored.
 */
const messages = {
  /* -- The document itself ------------------------------------------------ */
  // `<title>` and the description meta. They are catalogue keys rather than
  // constants because the negotiated locale decides them: a Polish reader whose
  // page is Polish must not be handed an English tab, an English share card or
  // an English search result.
  'meta.title': 'Money Tracker — know where your money goes',
  'meta.description':
    'A household budget: accounts, spending, category limits, recurring bills and several currencies at once. You type it in or load a file yourself, and we never connect to your bank.',
  /* -- The shell ---------------------------------------------------------- */
  'app.name': 'Money Tracker',
  'app.tagline': 'Know where your money goes.',
  'app.loading': 'Loading…',
  'app.skipToContent': 'Skip to main content',
  'app.menu.open': 'Open menu',
  'app.menu.close': 'Close menu',
  'app.sidebar.collapse': 'Collapse sidebar',
  'app.sidebar.expand': 'Expand sidebar',
  'app.theme.label': 'Appearance',
  'app.theme.light': 'Light',
  'app.theme.dark': 'Dark',
  'app.theme.system': 'Match system',
  'app.language.label': 'Language',
  'app.language.change': 'Change language',
  'app.workspace.label': 'Household',
  'app.workspace.switch': 'Switch household',
  'app.workspace.create': 'New household',
  'app.account.menu': 'Your account',
  'app.signOut': 'Sign out',

  /* -- Navigation --------------------------------------------------------- */
  'nav.primary': 'Main navigation',
  'nav.dashboard': 'Dashboard',
  'nav.accounts': 'Accounts',
  'nav.transactions': 'Transactions',
  'nav.budgets': 'Budgets',
  'nav.categories': 'Categories',
  'nav.tags': 'Tags',
  'nav.payees': 'Payees',
  'nav.recurring': 'Recurring',
  'nav.goals': 'Savings goals',
  'nav.reports': 'Reports',
  'nav.rules': 'Rules',
  'nav.import': 'Import',
  'nav.export': 'Export',
  'nav.settings': 'Settings',
  'nav.notifications': 'Notifications',
  'nav.search': 'Search',
  'nav.help': 'Help',

  /* -- Actions ------------------------------------------------------------ */
  'action.save': 'Save',
  'action.saveChanges': 'Save changes',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.create': 'Create',
  'action.add': 'Add',
  'action.remove': 'Remove',
  'action.close': 'Close',
  'action.confirm': 'Confirm',
  'action.back': 'Back',
  'action.next': 'Next',
  'action.previous': 'Previous',
  'action.continue': 'Continue',
  'action.retry': 'Try again',
  'action.refresh': 'Refresh',
  'action.search': 'Search',
  'action.filter': 'Filter',
  'action.clear': 'Clear',
  'action.clearAll': 'Clear all',
  'action.apply': 'Apply',
  'action.reset': 'Reset',
  'action.duplicate': 'Duplicate',
  'action.archive': 'Archive',
  'action.unarchive': 'Restore from archive',
  'action.export': 'Export',
  'action.import': 'Import',
  'action.download': 'Download',
  'action.upload': 'Upload',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.selectAll': 'Select all',
  'action.deselectAll': 'Clear selection',
  'action.showMore': 'Show more',
  'action.showLess': 'Show less',
  'action.viewAll': 'View all',
  'action.sortAscending': 'Sort ascending',
  'action.sortDescending': 'Sort descending',
  'action.moveUp': 'Move up',
  'action.moveDown': 'Move down',
  'action.moveTo': 'Move to…',
  'action.undo': 'Undo',
  'action.done': 'Done',
  'action.skip': 'Skip',
  'action.learnMore': 'Learn more',

  /* -- Dialogs ------------------------------------------------------------ */
  'dialog.unsaved.title': 'Unsaved changes',
  'dialog.unsaved.body':
    'This form has changes that have not been saved. Close it now and they are discarded.',
  'dialog.unsaved.discard': 'Discard changes',
  'dialog.unsaved.keepEditing': 'Keep editing',

  /* -- Shared vocabulary -------------------------------------------------- */
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.optional': 'Optional',
  'common.required': 'Required',
  'common.none': 'None',
  'common.all': 'All',
  'common.other': 'Other',
  'common.unknown': 'Unknown',
  'common.name': 'Name',
  'common.description': 'Description',
  'common.note': 'Note',
  'common.date': 'Date',
  'common.amount': 'Amount',
  'common.currency': 'Currency',
  'common.colour': 'Colour',
  'common.icon': 'Icon',
  'common.state': 'State',
  'common.active': 'Active',
  'common.archived': 'Archived',
  'common.createdAt': 'Created',
  'common.updatedAt': 'Last changed',
  'common.total': 'Total',
  'common.subtotal': 'Subtotal',
  'common.average': 'Average',
  'common.from': 'From',
  'common.to': 'To',
  'common.range': '{from} – {to}',
  'common.today': 'Today',
  'common.yesterday': 'Yesterday',
  'common.tomorrow': 'Tomorrow',
  'common.thisWeek': 'This week',
  'common.thisMonth': 'This month',
  'common.thisYear': 'This year',
  'common.lastMonth': 'Last month',
  'common.customRange': 'Custom range',
  'common.never': 'Never',
  'common.justNow': 'Just now',

  /* -- Status ------------------------------------------------------------- */
  'status.saving': 'Saving…',
  'status.saved': 'Saved',
  'status.saveFailed': 'Could not save',
  'status.offline': 'You are offline. Changes are queued.',
  'status.backOnline': 'Back online. Syncing your changes.',
  'status.loadFailed': 'Could not load this.',

  /* -- Authentication ----------------------------------------------------- */
  'auth.signIn.title': 'Sign in',
  'auth.signIn.subtitle': 'Pick up where you left off.',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.noAccount': 'No account yet?',
  'auth.signIn.createAccount': 'Create one',
  'auth.signUp.title': 'Create your account',
  'auth.signUp.subtitle': 'Start tracking in a couple of minutes.',
  'auth.signUp.submit': 'Create account',
  'auth.signUp.haveAccount': 'Already have an account?',
  'auth.signUp.terms':
    'By creating an account you accept the terms of service and the privacy policy.',
  'auth.field.name': 'Your name',
  'auth.field.email': 'Email address',
  'auth.field.password': 'Password',
  'auth.field.passwordConfirm': 'Repeat password',
  'auth.field.currentPassword': 'Current password',
  'auth.field.newPassword': 'New password',
  'auth.password.show': 'Show password',
  'auth.password.hide': 'Hide password',
  'auth.password.strength.weak': 'Weak password',
  'auth.password.strength.fair': 'Reasonable password',
  'auth.password.strength.strong': 'Strong password',
  'auth.forgot.link': 'Forgotten your password?',
  'auth.forgot.title': 'Reset your password',
  'auth.forgot.subtitle': 'We will send you a link to set a new password.',
  'auth.forgot.submit': 'Send reset link',
  'auth.forgot.sent':
    'If that address has an account, a reset link is on its way.',
  'auth.reset.title': 'Set a new password',
  'auth.reset.submit': 'Save new password',
  'auth.reset.success': 'Your password has been changed.',
  'auth.verify.title': 'Confirm your email address',
  'auth.verify.subtitle': 'We sent a confirmation link to {email}.',
  'auth.verify.resend': 'Send it again',
  'auth.verify.sent': 'Confirmation link sent.',
  'auth.twoFactor.title': 'Two-step verification',
  'auth.twoFactor.subtitle': 'Enter the code from your authenticator app.',
  'auth.twoFactor.code': 'Verification code',
  'auth.twoFactor.submit': 'Verify',
  'auth.twoFactor.useBackupCode': 'Use a recovery code instead',
  'auth.twoFactor.backupCode': 'Recovery code',
  'auth.passkey.title': 'Passkeys',
  'auth.passkey.subtitle':
    'Sign in with your fingerprint, face or device PIN instead of a password.',
  'auth.passkey.create': 'Add a passkey',
  'auth.passkey.use': 'Sign in with a passkey',
  'auth.passkey.none': 'No passkeys on this account yet.',
  'auth.sessions.title': 'Signed-in devices',
  'auth.sessions.current': 'This device',
  'auth.sessions.revoke': 'Sign out this device',
  'auth.sessions.revokeOthers': 'Sign out everywhere else',
  'auth.sessions.count': {
    one: '{count} signed-in device',
    other: '{count} signed-in devices',
  },
  'auth.signOut.confirm': 'Sign out of this device?',
  'auth.error.invalidCredentials':
    'That email address and password do not match.',
  'auth.error.emailTaken': 'An account already uses that email address.',
  'auth.error.rateLimited': 'Too many attempts. Try again in a few minutes.',
  'auth.error.sessionExpired': 'Your session has expired. Sign in again.',
  'auth.error.forbidden': 'You do not have access to this.',

  /* -- Accounts ----------------------------------------------------------- */
  'accounts.title': 'Accounts',
  'accounts.subtitle': 'Everything you hold, in one place.',
  'accounts.create': 'New account',
  'accounts.edit': 'Edit account',
  'accounts.delete.confirm':
    'Delete {name}? Everything recorded on it goes with it, and this cannot be undone.',
  'accounts.field.name': 'Account name',
  'accounts.field.category': 'Kind of account',
  'accounts.field.currency': 'Currency',
  'accounts.field.initialBalance': 'Opening balance',
  'accounts.field.initialBalance.help':
    'What the account held on the day before your first entry.',
  'accounts.field.creditLimit': 'Credit limit',
  'accounts.field.note': 'Note',
  'accounts.field.excludeFromStats': 'Leave out of reports',
  'accounts.field.excludeFromStats.help':
    'The account still works normally; it just does not count towards totals or charts.',
  'accounts.category.general': 'General',
  'accounts.category.cash': 'Cash',
  'accounts.category.current': 'Everyday account',
  'accounts.category.creditCard': 'Credit card',
  'accounts.category.savings': 'Savings',
  'accounts.category.investment': 'Investments',
  'accounts.category.loan': 'Loan',
  'accounts.category.other': 'Other',
  'accounts.balance': 'Balance',
  'accounts.balance.available': 'Available',
  'accounts.balance.adjust': 'Correct the balance',
  'accounts.balance.adjust.help':
    'A correction is recorded as an entry of its own, so the history stays honest.',
  'accounts.totalBalance': 'Total balance',
  'accounts.netWorth': 'Net worth',
  'accounts.hideZeroBalance': 'Hide accounts with a zero balance',
  'accounts.group.title': 'Groups',
  'accounts.group.create': 'New group',
  'accounts.group.ungrouped': 'Not in a group',
  'accounts.count': {
    one: '{count} account',
    other: '{count} accounts',
  },
  'accounts.empty.title': 'No accounts yet',
  'accounts.empty.body':
    'Add the first account you want to track: a bank account, a wallet, a card.',
  'accounts.empty.action': 'Add your first account',
  'accounts.archived.empty.title': 'Nothing archived',
  'accounts.archived.empty.body':
    'Accounts you archive are kept here with their history.',

  /* -- Accounts: the list surface ----------------------------------------- */
  'accounts.overview.assets': 'What you hold',
  'accounts.overview.liabilities': 'What you owe',
  'accounts.overview.basis': {
    one: 'From {count} account counted in reports.',
    other: 'From {count} accounts counted in reports.',
  },
  'accounts.overview.excluded':
    'Archived accounts, and accounts left out of reports, are not in these figures.',
  'accounts.overview.excluded.label': 'What these figures include',
  'accounts.byCurrency.title': 'Held by currency',
  'accounts.byCurrency.help':
    'Each currency is totalled in its own units. Nothing is converted here.',
  'accounts.filter.label': 'Show',
  'accounts.filter.active': 'Open accounts',
  'accounts.filter.archived': 'Archived accounts',
  'accounts.filter.all': 'Open and archived',
  'accounts.filter.count': {
    one: 'Showing {shown} of {total} account',
    other: 'Showing {shown} of {total} accounts',
  },
  'accounts.status.excluded': 'Outside reports',
  'accounts.list.label': 'Your accounts',
  'accounts.list.loading': 'Loading your accounts…',
  'accounts.error.title': 'The accounts did not load',
  'accounts.error.body':
    'Nothing was changed. Try again, and if it keeps failing, the household is briefly unreachable.',
  'accounts.balance.missing': 'Balance unavailable',
  'accounts.balance.inBase': 'In {currency}',
  'accounts.empty.pick.title': 'Or start from one of these',
  'accounts.empty.pick.body':
    'Each one opens the form with the kind already chosen. Nothing is created until you save.',
  'accounts.active.empty.title': 'Every account is archived',
  'accounts.active.empty.body':
    'Restore one from the archived view, or add a new account.',

  /* -- Accounts: one account ---------------------------------------------- */
  'accounts.detail.tab.overview': 'Overview',
  'accounts.detail.tab.settings': 'Settings',
  'accounts.detail.balanceToday': 'Balance today',
  'accounts.detail.transactions': {
    one: '{count} entry on this account',
    other: '{count} entries on this account',
  },
  'accounts.detail.note.empty': 'No note on this account yet.',
  'accounts.detail.ledger.empty': 'No transactions on this account yet.',
  'accounts.detail.error.title': 'This account did not load',
  'accounts.detail.danger': 'Archiving and deleting',
  'accounts.credit.title': 'Credit used',
  'accounts.credit.valueText': '{used} of {limit} used, {percent}',
  'accounts.credit.ofLimit': '{used} of {limit}',
  'accounts.credit.percentUsed': '{percent} used',
  'accounts.credit.within': 'Within limit',
  'accounts.credit.approaching': 'Approaching limit',
  'accounts.credit.over': 'Over limit',
  'accounts.credit.available': '{amount} still available',
  'accounts.credit.none': 'This account has no credit limit.',

  /* -- Accounts: the lifecycle -------------------------------------------- */
  'accounts.archive.title': 'Archive {name}?',
  'accounts.archive.body':
    'It leaves your totals and the pickers and keeps everything recorded on it. You can restore it whenever you like.',
  'accounts.archive.action': 'Archive account',
  'accounts.restore.action': 'Restore account',
  'accounts.delete.title': 'Delete {name}?',
  'accounts.delete.action': 'Delete permanently',
  'accounts.delete.blocked': {
    one: 'There is {count} entry on this account, so it cannot be deleted. Archive it instead and the history stays.',
    other:
      'There are {count} entries on this account, so it cannot be deleted. Archive it instead and the history stays.',
  },
  'accounts.actions.label': 'Actions for {name}',
  'accounts.toast.created': '{name} was added.',
  'accounts.toast.updated': '{name} was saved.',
  'accounts.toast.archived': '{name} was archived.',
  'accounts.toast.restored': '{name} is open again.',
  'accounts.toast.deleted': '{name} was deleted.',

  /* -- Accounts: the form -------------------------------------------------- */
  'accounts.form.create.body':
    'A name and a currency are all that is required. The rest can wait.',
  'accounts.form.edit.body':
    'Changing the currency or the opening balance re-values this account’s whole history.',
  'accounts.form.error.title': 'The account was not saved',
  'accounts.field.openedOn': 'Opening date',
  'accounts.field.openedOn.help':
    'The day the opening balance is true of. That day’s exchange rate is the one recorded.',
  'accounts.field.creditLimit.help':
    'A positive figure. Leave it empty when there is no limit.',
  'accounts.field.currency.help':
    'Only the currencies your household holds are offered.',
  /* -- Accounts: correcting a balance ------------------------------------- */
  'accounts.adjust.body':
    'State what the balance should be. The difference is written as an entry you can find, edit and export.',
  'accounts.adjust.field.target': 'What the balance should be',
  'accounts.adjust.field.date': 'As at the end of',
  'accounts.adjust.field.note': 'Reason',
  'accounts.adjust.field.note.help':
    'Kept on the entry, so the reason survives with the correction.',
  'accounts.adjust.preview.title': 'What will be recorded',
  'accounts.adjust.preview.income': 'Money in of {amount}, dated {date}.',
  'accounts.adjust.preview.expense': 'An expense of {amount}, dated {date}.',
  'accounts.adjust.preview.none':
    'Nothing. The balance on {date} already reads {amount}.',
  'accounts.adjust.preview.past':
    'The difference is measured against the balance at the end of {date}, which is read as you save. You are shown exactly what was written.',
  'accounts.adjust.action': 'Record the correction',
  'accounts.adjust.result.title': 'Recorded',
  'accounts.adjust.result.income':
    'Money in of {amount} was recorded, dated {date}.',
  'accounts.adjust.result.expense':
    'An expense of {amount} was recorded, dated {date}.',
  'accounts.adjust.result.unchanged':
    'Nothing was written — the balance on {date} already read {amount}.',
  'accounts.adjust.error.title': 'The correction was not recorded',

  /* -- Transactions ------------------------------------------------------- */
  'transactions.title': 'Transactions',
  'transactions.create': 'New transaction',
  'transactions.createIncome': 'Record income',
  'transactions.createExpense': 'Record an expense',
  'transactions.createTransfer': 'Record a transfer',
  'transactions.edit': 'Edit expense',
  'transactions.delete.confirm': 'Delete this entry? This cannot be undone.',
  'transactions.direction.income': 'Income',
  'transactions.direction.expense': 'Expense',
  'transactions.field.amount': 'Amount',
  'transactions.field.date': 'Date',
  'transactions.field.account': 'Account',
  'transactions.field.category': 'Category',
  'transactions.field.payee': 'Paid to',
  'transactions.field.note': 'Note',
  'transactions.field.tags': 'Tags',
  'transactions.field.paymentMethod': 'Payment method',
  'transactions.method.cash': 'Cash',
  'transactions.method.card': 'Card',
  'transactions.method.transfer': 'Bank transfer',
  'transactions.method.directDebit': 'Direct debit',
  'transactions.method.standingOrder': 'Standing order',
  'transactions.method.other': 'Other',
  'transactions.planned': 'Planned',
  'transactions.planned.help':
    'Not counted in balances until you confirm it happened.',
  'transactions.balanceAdjustment': 'Balance correction',
  'transactions.transfer.from': 'From account',
  'transactions.transfer.to': 'To account',
  'transactions.transfer.rate': 'Exchange rate',
  'transactions.transfer.unlinkFirst':
    'Unlink the two sides before changing what this transfer is.',
  'transactions.splits.title': 'Split across categories',
  'transactions.splits.add': 'Add a line',
  'transactions.splits.remainder': 'Left to assign: {amount}',
  'transactions.splits.balanced': 'The whole amount is assigned.',
  'transactions.refund.title': 'Refunds',
  'transactions.refund.link': 'Link a refund',
  'transactions.refund.unlink': 'Unlink refund',
  'transactions.refund.external': 'Refund of something outside Money Tracker',
  'transactions.attachment.add': 'Attach a receipt',
  'transactions.attachment.remove': 'Remove attachment',
  'transactions.search.placeholder': 'Search notes, payees and amounts',
  'transactions.search.placeholder.short': 'Search',
  'transactions.filter.title': 'Filters',
  'transactions.filter.reset': 'Reset filters',
  'transactions.count': {
    one: '{count} transaction',
    other: '{count} transactions',
  },
  'transactions.selected': {
    one: '{count} selected',
    other: '{count} selected',
  },
  'transactions.empty.title': 'Nothing recorded yet',
  'transactions.empty.body':
    'Record your first expense, or load a statement you already have.',
  'transactions.empty.action': 'Record an expense',
  'transactions.noResults.title': 'Nothing matches these filters',
  'transactions.noResults.body': 'Try a wider date range or fewer filters.',

  /* -- Transactions: the ledger surface ----------------------------------- */
  'transactions.list.label': 'Money out and money in',
  'transactions.list.caption.all': 'All {count} entries, {sort}.',
  'transactions.list.caption.filtered':
    '{count} entries matching {filters}, {sort}.',
  'transactions.list.caption.sort': 'sorted by {field}, {order}',
  'transactions.sort.label': 'Sort by',
  'transactions.sort.ascending': 'oldest first',
  'transactions.sort.descending': 'newest first',
  'transactions.column.description': 'Description',
  'transactions.column.actions': 'Actions',
  'transactions.day.net': 'Day total',
  'transactions.day.carried': 'Carried forward',
  'transactions.column.balance': 'Balance after',
  'transactions.loading': 'Loading your spending…',
  'transactions.loadMore': 'Load more',
  'transactions.loadingMore': 'Loading more…',
  'transactions.loadedOf': '{loaded} of {total} loaded',
  'transactions.selectAllLoaded': 'Select every loaded entry',
  'transactions.excludedFromTotals': 'Outside totals',
  'transactions.amount.income': 'Income of {amount}',
  'transactions.amount.expense': 'Expense of {amount}',
  'transactions.row.select': 'Select the {amount} entry of {date}',
  'transactions.row.actions': 'Actions for {name}',
  'transactions.row.open': 'Open',
  'transactions.totals.label': 'Totals for the filtered set',
  'transactions.totals.currency': 'Totals in {currency}',
  'transactions.bulk.label': 'Actions for the selected entries',
  'transactions.bulk.delete': 'Delete selected',
  'transactions.bulk.confirm': {
    one: 'Delete {count} entry? This cannot be undone.',
    other: 'Delete {count} entries? This cannot be undone.',
  },
  'transactions.keyboard.title': 'Keyboard shortcuts',
  'transactions.keyboard.column.key': 'Key',
  'transactions.keyboard.column.action': 'Action',
  'transactions.keyboard.keys.arrows': 'Arrow keys',
  'transactions.keyboard.keys.enter': 'Enter',
  'transactions.keyboard.keys.space': 'Space',
  'transactions.keyboard.keys.edit': 'E',
  'transactions.keyboard.keys.duplicate': 'D',
  'transactions.keyboard.keys.delete': 'Delete',
  'transactions.keyboard.keys.help': '?',
  'transactions.keyboard.move': 'Move between cells',
  'transactions.keyboard.open': 'Open the entry',
  'transactions.keyboard.select': 'Select the row',
  'transactions.keyboard.edit': 'Edit the entry',
  'transactions.keyboard.duplicate': 'Copy into a new entry',
  'transactions.keyboard.remove': 'Delete the entry',
  'transactions.keyboard.help': 'Show this list',

  /* -- Transactions: filters ---------------------------------------------- */
  'transactions.filter.description':
    'Narrow the list. Everything set here stays in the address, so the view can be shared.',
  'transactions.filter.activeLabel': 'Active filters',
  'transactions.filter.remove': 'Remove {name}',
  'transactions.filter.direction': 'Money in or out',
  'transactions.filter.accountGroup': 'Account group',
  'transactions.filter.dateRange': 'Date range',
  'transactions.filter.anyDate': 'Any date',
  'transactions.filter.openCalendar': 'Open calendar',
  'transactions.filter.amountRange': 'Amount range',
  'transactions.filter.amountMin': 'At least',
  'transactions.filter.amountMax': 'At most',
  'transactions.filter.receipt': 'Receipt',
  'transactions.filter.noMatches': 'Nothing matches',
  'transactions.filter.categoryPlaceholder': 'Find a category',
  'transactions.filter.payeePlaceholder': 'Find a payee',
  'transactions.filter.tagPlaceholder': 'Find a tag',
  'transactions.chip.text': 'Text: {value}',
  'transactions.chip.dates': 'Dates: {from} to {to}',
  'transactions.chip.anyDate': 'any',
  'transactions.chip.accounts': 'Account: {value}',
  'transactions.chip.accountGroups': 'Group: {value}',
  'transactions.chip.categories': 'Category: {value}',
  'transactions.chip.payees': 'Paid to: {value}',
  'transactions.chip.tags': 'Tag: {value}',
  'transactions.chip.direction': 'Direction: {value}',
  'transactions.chip.paymentMethods': 'Paid by: {value}',
  'transactions.chip.amount': 'Amount: {from} to {to}',
  'transactions.chip.anyAmount': 'any',
  'transactions.chip.withReceipt': 'With a receipt',
  'transactions.chip.withoutReceipt': 'Without a receipt',

  /* -- Transactions: the entry form --------------------------------------- */
  'transactions.form.newTitle': 'New transaction',
  'transactions.form.newSubtitle':
    'The amount comes first. Everything below it is optional except the account and the date.',
  'transactions.form.editTitle': 'Edit transaction',
  'transactions.form.details': 'Details',
  'transactions.form.moreDetails': 'More',
  'transactions.form.saveAndNew': 'Save and add another',
  'transactions.form.saveAndNewHint':
    'Keeps the date, account and category so the next entry is only an amount away.',
  'transactions.form.notePlaceholder': 'What was this for?',
  'transactions.form.payeePlaceholder': 'Who was paid, or who paid you',
  'transactions.form.categoryPlaceholder': 'Choose a category',
  'transactions.form.noPayees': 'No payees yet',
  'transactions.form.noCategories': 'No categories yet',
  'transactions.form.conversionNote':
    'Recorded in {currency} and converted to {base} at the rate for the date of the entry.',
  'transactions.form.error.title': 'The entry was not saved',
  'transactions.form.error.amount': 'Enter an amount greater than zero.',
  'transactions.form.error.account': 'Choose the account this belongs to.',
  'transactions.form.error.date': 'Enter a date in the form {example}.',
  'transactions.form.error.note': 'Keep the note to {max} characters or fewer.',
  'transactions.form.noAccounts.title': 'An account comes first',
  'transactions.form.noAccounts.body':
    'Every entry has to belong to an account. Create one, then come back.',
  'transactions.form.noAccounts.action': 'Create an account',
  'transactions.saved': 'Saved.',
  'transactions.deleted': 'Deleted.',
  'transactions.deletedMany': {
    one: '{count} entry deleted.',
    other: '{count} entries deleted.',
  },
  'transactions.duplicated': 'Copied into a new entry. Nothing is saved yet.',

  /* -- Transactions: the detail screen ------------------------------------ */
  'transactions.detail.title': 'Expense',
  'transactions.detail.back': 'Back to transactions',
  'transactions.detail.summary': 'Summary',
  'transactions.detail.recordedAt': 'Recorded {datetime}',
  'transactions.detail.rate': 'Converted at {rate}, the rate for {date}.',
  'transactions.detail.identityRate':
    'Recorded in the reporting currency, so no conversion was needed.',
  'transactions.detail.noTags': 'No tags on this entry.',
  'transactions.detail.noAttachments': 'No receipt attached.',
  'transactions.detail.noRefunds': 'No refund linked.',
  'transactions.detail.notFound.title': 'That transaction is not here',
  'transactions.detail.notFound.body':
    'It may have been deleted, or the address may be wrong.',
  /* -- Transactions: the split editor -------------------------------------- */
  'splits.title': 'Split this expense',
  'splits.description':
    'Divide one payment across several categories. The lines have to add up to the full amount before the split can be saved.',
  'splits.lines.label': 'Split lines',
  'splits.row.legend': 'Line {position}',
  'splits.row.category': 'Category',
  'splits.row.category.none': 'No category',
  'splits.row.amount': 'Amount',
  'splits.row.note': 'Note',
  'splits.row.remove': 'Remove line {position}',
  'splits.row.moveUp': 'Move line {position} up',
  'splits.row.moveDown': 'Move line {position} down',
  'splits.add': 'Add a line',
  'splits.assigned': 'Assigned {assigned} of {total}.',
  'splits.remaining': '{amount} left to assign.',
  'splits.over': '{amount} more than the expense.',
  'splits.balanced': 'Everything is assigned.',
  'splits.assignRemainder': 'Assign the remainder',
  'splits.save': 'Save the split',
  'splits.clear': 'Remove the split',
  'splits.saved': 'Split saved.',
  'splits.cleared': 'Split removed.',
  'splits.error.title': 'The split was not saved',
  'splits.error.amounts': 'Every line needs an amount greater than zero.',
  'splits.transfer.title': 'A transfer leg cannot be split',
  'splits.transfer.body':
    'Its amount belongs to the movement between the two accounts, not to a breakdown by category.',

  /* -- Transactions: groups (11-S2) ---------------------------------------- */
  'groups.title': 'Spending groups',
  'groups.subtitle':
    'Several expenses read as one thing: a holiday, a renovation, a move. A group is a way of reading rows; deleting it never deletes them.',
  'groups.create': 'New group',
  'groups.loading': 'Loading your groups…',
  'groups.error.title': 'Your groups could not be loaded',
  'groups.empty.title': 'No groups yet',
  'groups.empty.body':
    'A group holds expenses you want to read together: every payment for a holiday, or every invoice for a renovation. Its total is worked out from the members each time you look, and is never stored.',
  'groups.table.label': 'Spending groups',
  'groups.table.summary': {
    one: '{count} group. Every total below is in {currency}.',
    other: '{count} groups. Every total below is in {currency}.',
  },
  'groups.column.name': 'Group',
  'groups.column.members': 'Expenses',
  'groups.column.total': 'Total',
  'groups.column.actions': 'Actions',
  'groups.members': {
    one: '{count} expense',
    other: '{count} expenses',
  },
  'groups.total.summary': {
    one: '{name}: {count} expense, {amount}',
    other: '{name}: {count} expenses, {amount}',
  },
  'groups.actions.label': 'Actions for {name}',
  'groups.rename': 'Rename',
  'groups.delete': 'Delete',
  'groups.form.title.create': 'New group',
  'groups.form.title.rename': 'Rename group',
  'groups.form.name': 'Name',
  'groups.form.note': 'Note',
  'groups.form.note.help':
    'What this group is for. It cannot be changed later.',
  'groups.delete.title': 'Delete {name}?',
  'groups.delete.body':
    'The group goes. The expenses in it stay exactly where they are.',
  'groups.toast.created': '{name} created.',
  'groups.toast.renamed': 'Renamed to {name}.',
  'groups.toast.deleted': '{name} deleted.',
  'groups.panel.title': 'Groups',
  'groups.panel.description':
    'The groups this expense is read as part of. Every total is in your reporting currency.',
  'groups.panel.empty': 'This expense is not in any group.',
  'groups.panel.add.label': 'Add to a group',
  'groups.panel.add.placeholder': 'Choose a group',
  'groups.panel.add.action': 'Add',
  'groups.panel.add.none': 'There is no other group to add this to yet.',
  'groups.panel.remove': 'Remove from {name}',
  'groups.panel.added': 'Added to {name}.',
  'groups.panel.removed': 'Removed from {name}.',
  'groups.panel.dissolved':
    '{name} had only two expenses, so removing one dissolved the group.',
  'groups.panel.error.title': 'The group was not changed',

  /* -- Transactions: templates (11-S2) ------------------------------------- */
  'templates.picker.title': 'Start from a template',
  'templates.picker.label': 'Templates',
  'templates.picker.error.title': 'The template could not be applied',
  'templates.applied':
    'The form is filled in from {name}. Nothing is saved yet.',

  /* -- Transactions: refunds ---------------------------------------------- */
  // The effective amount is the reason this feature exists, so it is one
  // sentence with all three figures in it rather than three chips a reader has
  // to subtract for themselves.
  'refunds.title': 'Refunds',
  'refunds.description':
    'Money that came back for this expense. Linking a refund never changes what was originally paid; it changes what it ended up costing.',
  'refunds.effective':
    'Original {original}, refunded {refunded}, effective {effective}.',
  'refunds.empty': 'No refunds linked.',
  'refunds.loading': 'Loading the refunds…',
  'refunds.error.title': 'The refunds did not load',
  'refunds.list.label': 'Refunds of this expense',
  'refunds.column.date': 'Date',
  'refunds.column.amount': 'Amount',
  'refunds.column.origin': 'Refunds',
  'refunds.column.actions': 'Actions',
  'refunds.origin.whole': 'The whole expense',
  'refunds.origin.line': 'One line of the split',
  'refunds.unlink': 'Unlink',
  'refunds.unlink.label': 'Unlink the refund of {amount} from {date}',
  'refunds.unlinked': 'Refund link removed.',
  'refunds.linked': 'Refund linked.',
  'refunds.given.title': 'What this refunds',
  'refunds.given.transaction': 'It gives back part of {amount} paid on {date}.',
  'refunds.given.external':
    'It refunds something bought outside this household, so it counts as ordinary income and is netted against nothing.',
  'refunds.given.unlink': 'Remove this refund link',
  'refunds.link': 'Record this as a refund',
  'refunds.dialog.title': 'What is this refund for?',
  'refunds.dialog.description':
    'A refund gives back money that went out earlier. Pick what it gives back, so the original shows what it ended up costing.',
  'refunds.dialog.field': 'What this refunds',
  'refunds.dialog.ranking':
    'Closest in amount first, then closest in date. Every option says why it is here.',
  'refunds.dialog.external': 'Something outside this household',
  'refunds.dialog.external.help':
    'The purchase was never recorded here. The money still arrived, and it is counted as ordinary income.',
  'refunds.dialog.option': '{amount} on {date}',
  'refunds.dialog.submit': 'Link the refund',
  'refunds.dialog.cancel': 'Cancel',
  'refunds.dialog.error.title': 'The refund was not linked',
  'refunds.suggest.loading': 'Looking for what this refunds…',
  'refunds.suggest.empty':
    'Nothing with the same payee in the last 90 days is large enough to be what this refunds.',
  'refunds.suggest.reason.exact': 'Same payee, exactly this amount, {when}.',
  'refunds.suggest.reason.larger':
    'Same payee, {surplus} larger than this refund, {when}.',
  'refunds.suggest.when.sameDay': 'recorded the same day',
  'refunds.suggest.when.earlier': {
    one: 'recorded 1 day earlier',
    other: 'recorded {count} days earlier',
  },
  'refunds.suggest.alreadyRefunded': '{amount} of it is already refunded.',

  'transactions.planned.title': 'Planned',
  'transactions.planned.subtitle':
    'Entries dated for a day that has not happened yet. They stay out of your balances until you confirm them.',
  'transactions.planned.empty.title': 'Nothing planned',
  'transactions.planned.empty.body':
    'Record an expense with a future date and mark it planned to see it here.',
  /* -- Colours (the eight measured category hues) ------------------------- */
  'colour.blue': 'Blue',
  'colour.teal': 'Teal',
  'colour.green': 'Green',
  'colour.olive': 'Olive',
  'colour.gold': 'Gold',
  'colour.orange': 'Orange',
  'colour.crimson': 'Crimson',
  'colour.violet': 'Violet',

  /* -- Categories --------------------------------------------------------- */
  'categories.title': 'Categories',
  'categories.subtitle':
    'The vocabulary your spending is grouped by. Two levels deep, in whatever order suits you.',
  'categories.create': 'Add a category',
  'categories.createChild': 'Add a subcategory',
  'categories.edit': 'Edit category',
  'categories.loading': 'Loading categories',
  'categories.tree.label': 'Categories, in display order',
  'categories.tree.childOf': '{name}, inside {parent}',
  'categories.actions.label': 'Actions for {name}',
  'categories.drag.label': 'Reorder {name}',
  'categories.badge.system': 'Built in',
  'categories.kind.expense': 'Money out',
  'categories.kind.income': 'Money in',
  'categories.kind.both': 'Either way',
  'categories.parent.none': 'Top level',
  'categories.move.top': 'Move to top',
  'categories.move.bottom': 'Move to bottom',
  'categories.move.refused': 'That move was not made',
  'categories.move.refused.body':
    'Categories go two levels deep. A category that already holds subcategories cannot be filed inside another one.',
  'categories.filter.showArchived': 'Show archived categories',
  'categories.field.kind': 'Used for',
  'categories.field.kind.help':
    'Whether this category is offered on money out or on money in.',
  'categories.field.parent': 'Inside',
  'categories.field.parent.help':
    'Leave it at the top level, or file it under an existing category.',
  'categories.field.colour.help':
    'Shown as a dot beside the name, never as the row behind it.',
  'categories.form.create.body':
    'A name is all it needs. Everything else can change later.',
  'categories.form.edit.body':
    'Renaming a category renames it everywhere it has been used.',
  'categories.form.error.title': 'The category was not saved',
  'categories.error.title': 'Could not load your categories',
  'categories.empty.title': 'No categories yet',
  'categories.empty.body':
    'A category answers "what was this for". Add the first one and the reports have something to group by.',
  'categories.archive.title': 'Archive {name}?',
  'categories.archive.body':
    'It stops being offered on new entries, and anything already filed under it keeps its label. Subcategories are archived with it. You can restore it at any time.',
  'categories.delete.title': 'Delete {name}?',
  'categories.delete.body':
    'This cannot be undone. A category that has ever been used cannot be deleted — archive it instead.',
  'categories.delete.refused': 'That category cannot be deleted',
  'categories.delete.refused.body':
    'It is already in use, and deleting it would leave those entries without a label. Archive it instead: it disappears from the pickers and keeps its history.',
  'categories.toast.created': '{name} added.',
  'categories.toast.updated': '{name} saved.',
  'categories.toast.archived': '{name} archived.',
  'categories.toast.restored': 'Category restored.',
  'categories.toast.deleted': '{name} deleted.',

  /* -- Payees ------------------------------------------------------------- */
  'payees.title': 'Payees',
  'payees.subtitle':
    'Who you pay and who pays you, and the statement text that should match each one.',
  'payees.create': 'Add a payee',
  'payees.edit': 'Edit payee',
  'payees.loading': 'Loading payees',
  'payees.list.label': 'Payees',
  'payees.actions.label': 'Actions for {name}',
  'payees.search.label': 'Search payees',
  'payees.search.placeholder': 'Part of a name',
  'payees.error.title': 'Could not load your payees',
  'payees.empty.title': 'No payees yet',
  'payees.empty.body':
    'A payee turns "ZABKA NANO 4471" on a statement into a name you recognise. Add the first one, or let a loaded file create them for you.',
  'payees.noMatches.title': 'Nothing matches that',
  'payees.noMatches.body': 'Try a shorter piece of the name.',
  'payees.defaultCategory.summary': 'Suggests {name}',
  'payees.detail.back': 'Back to payees',
  'payees.detail.noCategory': 'Suggests no category',
  'payees.detail.error.title': 'This payee could not be loaded',
  'payees.detail.error.body':
    'The request did not come back. Nothing has been changed — try again.',
  'payees.field.name.help': 'The name you want to see on your entries.',
  'payees.field.defaultCategory': 'Suggested category',
  'payees.field.defaultCategory.help':
    'What a new expense with this payee is filed under.',
  'payees.field.mode': 'How firmly to apply it',
  'payees.field.logoDomain': 'Website',
  'payees.field.logoDomain.help':
    'A domain such as zabka.pl — not a full link.',
  'payees.mode.off': 'Suggest nothing',
  'payees.mode.off.help': 'This payee never touches the category field.',
  'payees.mode.hint': 'Pre-fill it',
  'payees.mode.hint.help':
    'New expenses start with the suggested category, and you can change it.',
  'payees.mode.enforce': 'Always use it',
  'payees.mode.enforce.help':
    'New expenses take the suggested category, and saving this re-files the ones already recorded under this payee.',
  'payees.form.create.body':
    'A name is all it needs. The suggestion settings can wait.',
  'payees.form.edit.body':
    'Renaming a payee renames it on every entry it appears on.',
  'payees.form.error.title': 'The payee was not saved',
  'payees.aliases.title': 'Statement text',
  'payees.aliases.body':
    'The strings a bank uses for this payee. Each one is stored in its matched form: lower case, without accents, and with reference numbers stripped, because that is what a loaded file actually compares.',
  'payees.aliases.count': {
    one: '{count} alias',
    other: '{count} aliases',
  },
  'payees.aliases.add': 'Add statement text',
  'payees.aliases.add.help': 'Paste it exactly as it appears on the statement.',
  'payees.aliases.added': 'Statement text added.',
  'payees.aliases.remove': 'Remove {name}',
  'payees.aliases.empty': 'Nothing but the payee’s own name matches it yet.',
  'payees.aliases.failed': 'That text was not added',
  'payees.ignored.title': 'Text that is never a payee',
  'payees.ignored.body':
    'Strings that must never become a payee: "CARD PAYMENT", "SEPA DD" and anything else your bank writes on every line.',
  'payees.ignored.add': 'Add text to ignore',
  'payees.ignored.remove': 'Stop ignoring {name}',
  'payees.ignored.empty': 'Nothing is being ignored.',
  'payees.ignored.failed': 'That text was not added',
  'payees.merge.action': 'Merge into another payee',
  'payees.merge.title': 'Merge {name}',
  'payees.merge.into': 'Keep this payee',
  'payees.merge.body':
    'Every entry, alias and tag on {from} moves to {into}, and “{from}” is kept as statement text so future files still match it. This cannot be undone.',
  'payees.merge.noTargets': 'There is no other payee to merge into.',
  'payees.merge.failed': 'The payees were not merged',
  'payees.delete.title': 'Delete {name}?',
  'payees.delete.body':
    'This cannot be undone. Your entries keep their amounts and dates and simply lose the payee’s name.',
  'payees.toast.created': '{name} added.',
  'payees.toast.updated': '{name} saved.',
  'payees.toast.deleted': '{name} deleted.',
  'payees.toast.merged': '{from} merged into {into}.',

  /* -- Dashboard ---------------------------------------------------------- */
  'dashboard.title': 'Dashboard',
  'dashboard.greeting': 'Good to see you, {name}.',
  'dashboard.period.label': 'Period',
  'dashboard.income': 'Money in',
  'dashboard.expenses': 'Money out',
  'dashboard.net': 'Difference',
  'dashboard.comparedToPrevious': '{change} against the previous period',
  'dashboard.widget.netWorth': 'Net worth',
  'dashboard.widget.cashFlow': 'Cash flow',
  'dashboard.widget.spendingByCategory': 'Spending by category',
  'dashboard.widget.recentTransactions': 'Latest transactions',
  'dashboard.widget.upcomingBills': 'Coming up',
  'dashboard.widget.budgetProgress': 'Budgets',
  'dashboard.widget.savingsGoals': 'Savings goals',
  'dashboard.widget.accountsOverview': 'Accounts',
  'dashboard.widget.monthlySummary': 'This month in short',
  'dashboard.edit': 'Rearrange dashboard',
  'dashboard.editDone': 'Finish rearranging',
  'dashboard.widget.add': 'Add a panel',
  'dashboard.widget.remove': 'Remove this panel',
  'dashboard.widget.move': 'Move this panel',
  'dashboard.empty.title': 'Your dashboard is empty',
  'dashboard.empty.body': 'Add the panels you want to see every day.',
  'dashboard.empty.action': 'Add a panel',
  'dashboard.chart.tableLabel': 'The same data as a table',

  /* -- Dashboard: the slice ----------------------------------------------- */
  'dashboard.period.last3Months': 'Last 3 months',
  'dashboard.period.last12Months': 'Last 12 months',
  'dashboard.period.showing': 'Showing {range}',
  'dashboard.panels.label': 'Dashboard panels',
  'dashboard.summary.label': 'This period at a glance',
  'dashboard.chart.noData': 'No reading',
  'dashboard.netWorth.help':
    'Counted in {currency}, at the rate stored with each account.',
  'dashboard.netWorth.empty.title': 'Nothing to add up yet',
  'dashboard.netWorth.empty.body':
    'Add an account and its balance becomes the first figure here.',
  'dashboard.cashFlow.month': 'Month',
  'dashboard.cashFlow.surplus': 'You kept {amount}',
  'dashboard.cashFlow.deficit': 'You spent {amount} more than came in',
  'dashboard.cashFlow.balanced': 'Money in and money out matched exactly',
  'dashboard.cashFlow.shareOfIncome': '{share} of the {amount} that came in',
  'dashboard.cashFlow.context':
    'Selected period: {month}. Earlier months are context.',
  'dashboard.cashFlow.empty.title': 'No money moved in this period',
  'dashboard.cashFlow.empty.body':
    'Record an expense, or pick a longer period.',
  'dashboard.spending.other': 'Everything else',
  'dashboard.spending.showOther': 'Show the smaller categories',
  'dashboard.spending.hideOther': 'Hide the smaller categories',
  'dashboard.spending.share': 'Share',
  'dashboard.spending.uncategorised': 'Not categorised',
  'dashboard.spending.empty.title': 'No categorised spending yet',
  'dashboard.spending.empty.body':
    'Give an expense a category and its share of the period shows up here.',
  'dashboard.accounts.viewAll': 'All accounts',
  'dashboard.accounts.owed': 'Owed',
  'dashboard.recent.viewAll': 'All your spending',
  'dashboard.firstRun.title':
    'Welcome. Three steps and the numbers start working.',
  'dashboard.firstRun.body':
    'Nothing here is filled with sample figures. Everything you see will be yours.',
  'dashboard.firstRun.steps.label': 'Getting started',
  'dashboard.firstRun.step.account.title': 'Add an account',
  'dashboard.firstRun.step.account.body':
    'A bank account, a wallet, a card: whatever you want to follow.',
  'dashboard.firstRun.step.transaction.title': 'Record an expense',
  'dashboard.firstRun.step.transaction.body':
    'One is enough for the cash-flow chart to have something to draw.',
  'dashboard.firstRun.step.review.title': 'Come back here',
  'dashboard.firstRun.step.review.body':
    'The panels below fill in as soon as there is something to show.',
  'dashboard.firstEntry.lead':
    'Your accounts are in. Nothing is written against them yet.',
  'dashboard.firstEntry.action': 'Record your first transaction',

  /* -- Budgets (shared with the dashboard) -------------------------------- */
  'budgets.title': 'Budgets',
  'budgets.subtitle': 'What is left in each category.',
  'budgets.spentOf': '{spent} of {limit}',
  'budgets.remaining': '{amount} left',
  'budgets.overspent': '{amount} over',
  'budgets.daysLeft': {
    one: '{count} day left in this period',
    other: '{count} days left in this period',
  },

  // The meter. The accessible name states the amounts and then the percentage,
  // because a meter announced as "62%" alone says nothing about of what.
  'budgets.meter.label': 'Budget used: {name}',
  'budgets.meter.valueText': '{spent} of {available} spent, {percent}',
  'budgets.meter.tick': '100% of {available}',
  'budgets.meter.notch': 'Alert at {percent}',
  'budgets.meter.unavailable': 'Utilisation unavailable',
  'budgets.meter.noRate':
    'No exchange rate for {currency} on this date, so this budget cannot be measured against your reporting currency yet.',
  'budgets.state.under': 'On track',
  'budgets.state.approaching': 'Close to the limit',
  'budgets.state.over': 'Over budget',
  'budgets.carriedIn': '{amount} carried in',
  'budgets.carriedInNegative': '{amount} carried in from an overspend',
  'budgets.notStarted': 'Starts {date}',
  'budgets.ended': 'Ended {date}',

  'budgets.kind.label': 'What it follows',
  'budgets.kind.category': 'Categories',
  'budgets.kind.category.help':
    'Counts every expense filed in the categories you choose, and their subcategories.',
  'budgets.kind.manual': 'Chosen by hand',
  'budgets.kind.manual.help':
    'Counts only the expenses you put in it yourself. For a trip, a renovation, a one-off.',
  'budgets.period.label': 'Billing period',
  'budgets.period.one_off': 'One-off',
  'budgets.period.weekly': 'Weekly',
  'budgets.period.monthly': 'Monthly',
  'budgets.period.quarterly': 'Quarterly',
  'budgets.period.yearly': 'Yearly',

  'budgets.rollover.label': 'What happens to what is left',
  'budgets.rollover.none': 'Start each period clean',
  'budgets.rollover.none.help':
    'Whatever is left, or overspent, is forgotten when the period rolls.',
  'budgets.rollover.carry_surplus': 'Carry the surplus forward',
  'budgets.rollover.carry_surplus.help':
    'Money left over is added to the next period. An overspend is absorbed, and the history says so.',
  'budgets.rollover.carry_all': 'Carry the whole balance forward',
  'budgets.rollover.carry_all.help':
    'The next period opens with what is left — or in the red, if you overspent.',

  'budgets.status.archived': 'Archived',
  'budgets.status.closed': 'Closed',
  'budgets.status.open': 'Open',
  'budgets.autoInclude': 'Counts new expenses automatically',
  'budgets.categories.count': {
    one: '{count} category',
    other: '{count} categories',
  },
  'budgets.categories.none': 'No categories yet',
  'budgets.limitIn': 'Limit set in {currency}',

  'budgets.filter.label': 'Show',
  'budgets.filter.active': 'Active',
  'budgets.filter.archived': 'Archived',
  'budgets.filter.all': 'All',

  'budgets.new': 'New budget',
  'budgets.list.loading': 'Loading your budgets…',
  'budgets.detail.loading': 'Loading this budget…',
  'budgets.error.title': 'Budgets could not be loaded',
  'budgets.error.body':
    'The list did not come back. Nothing has been changed — try again.',
  'budgets.detail.error.title': 'This budget could not be loaded',
  'budgets.detail.error.body':
    'Its periods did not come back. Nothing has been changed — try again.',

  'budgets.empty.title': 'No budgets yet',
  'budgets.empty.body':
    'A budget is a limit on a set of categories for a period. Follow a set of categories and it fills itself, or put expenses in by hand for a one-off.',
  'budgets.empty.action': 'Create your first budget',
  'budgets.empty.archived.title': 'Nothing archived',
  'budgets.empty.archived.body':
    'Archived budgets keep every period they closed. None have been archived yet.',

  'budgets.detail.back': 'All budgets',
  'budgets.detail.thisPeriod': 'This period',
  'budgets.detail.spentGross': 'Spent',
  'budgets.detail.credited': 'Came back in the same categories',
  'budgets.detail.refunded': 'Refunded elsewhere',
  'budgets.detail.net': 'Counted against the budget',

  'budgets.ledger.title': 'Rollover history',
  'budgets.ledger.caption':
    'Every period of this budget: what it opened with, what it spent, and what it handed on.',
  'budgets.ledger.col.period': 'Period',
  'budgets.ledger.col.limit': 'Limit',
  'budgets.ledger.col.carriedIn': 'Carried in',
  'budgets.ledger.col.spent': 'Spent',
  'budgets.ledger.col.carriedOut': 'Carried out',
  'budgets.ledger.col.status': 'Status',
  'budgets.ledger.overBy': 'over by {amount}',
  'budgets.ledger.empty':
    'This budget has one period so far, and it is still open. The history fills in as periods close.',
  'budgets.timeline.title': 'Spending against the limit, period by period',
  'budgets.timeline.categoryHeader': 'Period',
  'budgets.timeline.spent': 'Spent',
  'budgets.timeline.available': 'Available',
  'budgets.timeline.empty.title': 'One period so far',
  'budgets.timeline.empty.body':
    'The timeline draws a bar per period once this budget has closed one.',
  'budgets.timeline.noData': 'No reading',

  'budgets.corrections.title': 'Corrections',
  'budgets.corrections.body':
    'These closed periods no longer match what their dates add up to today — something inside them was edited after they closed. The closed figures stay as they were; the difference is shown here.',
  'budgets.corrections.row': '{period}: stored {stored}, now {actual}',
  'budgets.corrections.delta': 'Difference {amount}',

  'budgets.allocation.title': 'Categories in this budget',
  'budgets.allocation.body':
    'Every expense filed in one of these, or in one of their subcategories, counts against the limit.',
  'budgets.allocation.manual':
    'This budget counts only the expenses you put in it by hand.',
  'budgets.allocation.edit': 'Change categories',
  'budgets.transactions.title': 'What counted this period',
  'budgets.transactions.empty': 'Nothing has counted against this budget yet.',

  'budgets.actions.label': 'Actions for {name}',
  'budgets.actions.edit': 'Edit budget',
  'budgets.actions.archive': 'Archive',
  'budgets.actions.restore': 'Restore',
  'budgets.actions.delete': 'Delete',
  'budgets.actions.closePeriod': 'Close this period',
  'budgets.actions.reopenPeriod': 'Reopen',
  'budgets.actions.refresh': 'Recalculate periods',

  'budgets.form.create.title': 'New budget',
  'budgets.form.edit.title': 'Edit budget',
  'budgets.form.name': 'Name',
  'budgets.form.name.placeholder': 'Groceries',
  'budgets.form.limit': 'Limit per period',
  'budgets.form.currency': 'Currency',
  'budgets.form.startDate': 'Starts',
  'budgets.form.startDate.help':
    'Periods run from this day — a budget started on the 12th runs the 12th to the 11th.',
  'budgets.form.endDate': 'Ends',
  'budgets.form.endDate.help': 'Leave empty to run until you archive it.',
  'budgets.form.categories': 'Categories',
  'budgets.form.categories.help':
    'Subcategories are included automatically. Choose the parent and you are done.',
  'budgets.form.thresholds': 'Warn me at',
  'budgets.form.thresholds.help':
    'Percentages of what is available. 100% and over are allowed — some people want to know at 150%.',
  'budgets.form.thresholds.pending':
    'Thresholds are recorded here and delivered once notifications ship. Nothing is being sent yet.',
  'budgets.form.submit.create': 'Create budget',
  'budgets.form.submit.save': 'Save changes',
  'budgets.form.cancel': 'Cancel',
  'budgets.form.error':
    'The budget could not be saved. Nothing has been changed.',

  'budgets.confirm.archive.title': 'Archive this budget?',
  'budgets.confirm.archive.body':
    'It leaves the list and keeps every period it closed. You can restore it at any time.',
  'budgets.confirm.archive.action': 'Archive budget',
  'budgets.confirm.restore.body':
    'It returns to the list and picks up where it left off. Its closed periods stay as they were.',
  'budgets.confirm.delete.title': 'Delete this budget?',
  'budgets.confirm.delete.body':
    'This cannot be undone. A budget that has closed a period cannot be deleted — archive it instead.',
  'budgets.confirm.delete.action': 'Delete budget',
  'budgets.confirm.closePeriod.title': 'Close this period?',
  'budgets.confirm.closePeriod.body':
    'Its figures are frozen from then on, and the next period opens with whatever this budget carries.',
  'budgets.confirm.closePeriod.action': 'Close period',
  'budgets.confirm.reopenPeriod.title': 'Reopen this period?',
  'budgets.confirm.reopenPeriod.body':
    'Its figures start moving again, and the period after it opens with nothing carried in until this one closes.',
  'budgets.confirm.reopenPeriod.action': 'Reopen period',

  'budgets.toast.created': 'Budget created.',
  'budgets.toast.saved': 'Budget saved.',
  'budgets.toast.archived': 'Budget archived.',
  'budgets.toast.restored': 'Budget restored.',
  'budgets.toast.deleted': 'Budget deleted.',
  'budgets.toast.periodClosed': 'Period closed.',
  'budgets.toast.periodReopened': 'Period reopened.',
  'budgets.toast.refreshed': 'Periods recalculated.',
  'budgets.toast.failed': 'That did not work. Nothing has been changed.',

  /* -- Money and currency ------------------------------------------------- */
  'money.baseCurrency.label': 'Reporting currency',
  'money.baseCurrency.help':
    'Every total and chart is converted into this currency at the rate of the day.',
  'money.exchangeRate.label': 'Exchange rate',
  'money.exchangeRate.manual': 'Set by you',
  'money.exchangeRate.automatic': 'Updated daily',
  'money.convertedAt': 'Converted at {rate}',
  'money.amountIn': 'Amount in {currency}',
  // The spoken form of a signed figure. The drawn form uses U+2212, which
  // several screen readers announce as nothing at all, so the sign is a word
  // here and the currency is named in full rather than by its symbol.
  'money.spoken.negative': 'negative {amount}',
  'money.spoken.positive': 'positive {amount}',
  'money.currency.search': 'Search currencies',
  'money.currency.zeroDecimal': 'This currency has no minor unit.',

  /* -- Validation --------------------------------------------------------- */
  'validation.required': 'This is required.',
  'validation.email.invalid': 'That does not look like an email address.',
  'validation.password.tooShort': {
    one: 'Use at least {count} character.',
    other: 'Use at least {count} characters.',
  },
  'validation.password.mismatch': 'The two passwords do not match.',
  'validation.amount.required': 'Enter an amount.',
  'validation.amount.invalid': 'That is not an amount we can read.',
  'validation.amount.positive': 'The amount must be more than zero.',
  'validation.amount.tooLarge':
    'That amount is larger than this product can hold.',
  'validation.date.invalid': 'That is not a date we can read.',
  'validation.date.future': 'That date has not happened yet.',
  'validation.name.required': 'Give this a name.',
  'validation.tooLong': {
    one: 'Use at most {count} character.',
    other: 'Use at most {count} characters.',
  },
  'validation.unique': 'Something else already uses that name.',
  'validation.currency.unknown': 'We do not know that currency code.',
  'validation.currency.mismatch': 'Both sides must be in the same currency.',
  'validation.splits.sum': 'The lines are {difference} away from the total.',
  'validation.transfer.sameAccount': 'Pick two different accounts.',
  'validation.number.invalid': 'Enter a number.',
  'validation.generic': 'Check this field.',

  /* -- Empty and failure states ------------------------------------------ */
  'empty.search.title': 'Nothing found',
  'empty.search.body': 'Nothing matches {query}. Try a shorter search.',
  'empty.filter.title': 'Nothing matches these filters',
  'empty.filter.body': 'Loosen a filter or widen the dates.',
  'empty.error.title': 'Something went wrong',
  'empty.error.body': 'The problem has been reported. Try again in a moment.',
  'empty.error.reference': 'Reference: {reference}',
  'empty.notFound.title': 'Not here',
  'empty.notFound.body':
    'This page does not exist, or it is no longer shared with you.',
  'empty.notFound.home': 'Front page',
  'empty.forbidden.title': 'No access',
  'empty.forbidden.body': 'Ask a household owner to give you access to this.',
  'empty.offline.title': 'You are offline',
  'empty.offline.body':
    'What you record now is saved and sent when you are back.',

  /* -- Notifications ------------------------------------------------------ */
  'notifications.title': 'Notifications',
  'notifications.markAllRead': 'Mark everything as read',
  'notifications.empty.title': 'Nothing new',
  'notifications.empty.body':
    'Alerts about budgets, bills and shared households land here.',
  'notifications.unread': {
    one: '{count} unread notification',
    other: '{count} unread notifications',
  },
  'notifications.badge': '{count}+',

  /* -- Accessibility ------------------------------------------------------ */
  'a11y.skipToContent': 'Skip to main content',
  /*
    The accessible name of a combo box's disclosure button. `components/ui` takes it as a prop
    rather than translating it itself — the design system holds no catalogue — so every call site
    passes this key. Its English default in `combobox.tsx` used to reach the Polish UI unchanged.
  */
  'a11y.showSuggestions': 'Show suggestions',

  /* -- Marketing (public pages) ------------------------------------------- */
  'marketing.nav.how': 'How it works',
  'marketing.nav.ledger': 'Spending',
  'marketing.nav.scope': 'Scope',
  'marketing.nav.signIn': 'Sign in',
  'marketing.nav.getStarted': 'Start free',

  'marketing.hero.title.lead': 'No bank login.',
  'marketing.hero.title.rest': 'Not now, not ever.',
  'marketing.hero.body':
    'Money Tracker is a household budget for one person or a whole home: accounts, budgets, and every currency you hold.',
  'marketing.hero.cta.primary': 'Start tracking free',
  'marketing.hero.note': 'Export everything you enter, at any time.',

  'marketing.instead.title': 'So how does anything get into it?',
  'marketing.instead.body':
    'Four ways, and not one of them involves handing your banking credentials to us or to anybody else.',
  'marketing.instead.entry.title': 'You type it, in about ten seconds',
  'marketing.instead.entry.body':
    'Amount, payee, category. The amount field takes the number of decimals that currency actually has, and shows you the value it will store before you submit it.',
  'marketing.instead.import.title': 'You bring a file you already have',
  'marketing.instead.import.body':
    'CSV with a column mapping you save and reuse, OFX, QIF, or an export from another tracker. Duplicates are found before anything is written, and a whole batch can be reverted.',
  'marketing.instead.recurring.title': 'A series records itself',
  'marketing.instead.recurring.body':
    'Subscriptions, instalments, bills and salaries are set up once as recurring series. They can record themselves, or only remind you.',
  'marketing.instead.rules.title': 'Rules tidy up straight away',
  'marketing.instead.rules.body':
    'Conditions and actions in an order you set, with a live match count before you save. A rule whose category was deleted pauses itself and says so.',

  'marketing.ledger.title':
    'One expense, six months on, still valued at the day it happened.',
  'marketing.ledger.body':
    'A household kept in Polish zloty, holding an expense made in euro. The figure you entered never changes, and the converted figure beneath it was frozen at the rate of that day, not recalculated today and not recalculated next year.',
  'marketing.ledger.caption':
    'Six example rows from a household kept in Polish zloty.',
  'marketing.ledger.sample':
    'Example rows. Nothing here comes from a real account.',
  'marketing.ledger.col.balance': 'Balance after',
  'marketing.ledger.opening': 'Carried over from February',
  'marketing.ledger.closing': 'Carried forward to April',
  'marketing.ledger.settled': 'Settled',
  'marketing.ledger.note': 'Every line, and what is left after it.',
  'marketing.ledger.figure.label': 'Held in zloty',
  'marketing.ledger.figure.caption':
    '27.40 € converted at 4.3218, the rate on 14 March 2026, and left there.',
  'marketing.ledger.row.groceries': 'Grocery shop, Berlin',
  'marketing.ledger.row.salary': 'Salary',
  'marketing.ledger.row.streaming': 'Streaming subscription',
  'marketing.ledger.row.savings': 'Moved to savings',
  'marketing.ledger.row.rent': 'Rent',
  'marketing.ledger.row.electricity': 'Electricity bill',
  'marketing.ledger.category.groceries': 'Groceries',
  'marketing.ledger.category.income': 'Income',
  'marketing.ledger.category.subscriptions': 'Subscriptions',
  'marketing.ledger.category.transfer': 'Transfer',
  'marketing.ledger.category.housing': 'Housing',
  'marketing.ledger.category.utilities': 'Utilities',

  'marketing.meter.title':
    'You can tell that you are over budget with the colour switched off.',
  'marketing.meter.body':
    'Every state changes four things at once: the word, the icon, the remaining figure, and the hatching on the fill. Measured separation between our green and our red under deuteranopia falls to 1.14:1, so colour is the last channel here and never the first.',
  'marketing.meter.caption':
    'The headline is what is left rather than what is spent, because what is left is the figure you need while standing in a shop.',
  'marketing.meter.sample':
    'Example budgets. Nothing here comes from a real household.',
  'marketing.meter.groceries': 'Groceries',
  'marketing.meter.fuel': 'Fuel',
  'marketing.meter.eatingOut': 'Eating out',

  'marketing.scope.title': 'What is in it',
  'marketing.scope.accounts':
    'Accounts in eight categories, with groups, archiving and credit limits',
  'marketing.scope.transactions':
    'Spending with splits, refunds, attachments and bulk editing',
  'marketing.scope.classification':
    'Two-level categories, tags, and payees with aliases',
  'marketing.scope.budgets':
    'Budgets with periods, alert thresholds and rollover',
  'marketing.scope.recurring': 'Recurring series, savings goals, and rules',
  'marketing.scope.currency':
    'A currency set per household, one base currency, rates per day',
  'marketing.scope.dashboard':
    'A dashboard of cash flow, net worth and spending by category, for the period you pick',
  'marketing.scope.data':
    'CSV, OFX and QIF import, checked in a preview before anything is written',
  'marketing.scope.household':
    'A household of two to six people on one set of figures',
  // Planned, not built. Written in pencil on the page (see SCOPE in `src/routes/index.tsx`);
  // an entry moves up into the list above only once a visitor can open it.
  'marketing.scope.plannedLabel': 'Planned',
  'marketing.scope.planned.pivot':
    'A configurable pivot report and an annual overview',
  'marketing.scope.planned.reorder':
    'Rearranging the dashboard by dragging or by keyboard',
  'marketing.scope.planned.export': 'JSON and CSV export, and a full backup',

  'marketing.never.title': 'What it will never be',
  'marketing.never.connectors.title': 'A bank connection',
  'marketing.never.connectors.body':
    'There are none and there will be none. That decision is written down and dated, not left standing as a plan for later.',
  'marketing.never.investments.title': 'An investment portfolio',
  'marketing.never.investments.body':
    'An investment account holds a balance. It does not hold positions, lots, cost basis or dividends.',
  'marketing.never.tax.title': 'A tax tool, or financial advice',
  'marketing.never.tax.body':
    'No tax reporting, no invoicing, and nothing that could be read as advice about what to do with your money.',
  'marketing.never.realtime.title': 'A document edited live',
  'marketing.never.realtime.body':
    'People sharing a household see each other’s rows when the page reloads, not as they are being typed.',
  'marketing.commit.title': 'Two things we put in writing',
  'marketing.commit.export.title': 'Everything leaves whenever you want it to',
  'marketing.commit.export.body':
    'Full JSON and CSV export on every plan, the free one included, with nothing to click through and no offer standing in the way.',
  'marketing.commit.a11y.title':
    'Accessibility is a build gate, not a paragraph',
  'marketing.commit.a11y.body':
    'WCAG 2.2 AA is checked by an automated audit that fails the build, on every route in the visual spec, and a named list of AAA criteria is held to AAA above it. We do not claim AAA across the product.',

  'marketing.cta.title': 'Start with this month',
  'marketing.cta.body':
    'Add one account, import a statement, and see where the money actually went.',
  'marketing.cta.action': 'Create a free household',
  'marketing.footer.legal': 'All rights reserved.',

  /* -- The authenticated shell -------------------------------------------- */
  'app.nav.more': 'More',
  'app.nav.moreLabel': 'More destinations',
  'app.nav.section.money': 'Money',
  'app.nav.section.plan': 'Planning',
  'app.nav.section.insight': 'Insight',
  'app.signedInAs': 'Signed in as {email}',
  'app.workspace.current': 'Current household',
  'app.workspace.role.owner': 'Owner',
  'app.workspace.role.admin': 'Admin',
  'app.workspace.role.member': 'Member',
  'app.shell.pending': 'Loading this page…',
  'app.shell.error.body':
    'This part of the app did not load. Everything around it still works.',

  /* -- Settings ----------------------------------------------------------- */
  'settings.subtitle':
    'How the product reads for you, and what this household holds. Each card says whose setting it is.',
  'settings.scope.you': 'Yours alone',
  'settings.scope.workspace': 'Shared with the household',
  'settings.appearance.description':
    'Light, dark, or whatever this device is set to. Kept on the device, so a phone and a laptop can differ.',
  'settings.language.description':
    'Every screen, label and date is written in this language. Choosing one reloads the page, because the server picks the words.',
  'settings.account.title': 'Your account',
  'settings.account.description': 'From the account you signed in with.',
  'settings.workspace.description':
    'The lists everyone here shares. These two are what every entry is filed against.',
  'settings.workspace.name': 'Household name',
  'settings.categories.description':
    'The two-level tree every entry is filed under.',
  'settings.payees.description':
    'Who the money went to, and the names an import should fold into them.',

  /* -- Plans and billing -------------------------------------------------- */
  // The catalogue in `src/lib/plans.ts` holds the numbers; these are the words
  // beside them. Nothing here states a limit as prose — a sentence and a
  // ceiling that disagree is a refund, so every figure on the screen is
  // rendered from the catalogue.
  'plans.free.name': 'Free',
  'plans.free.tagline':
    'One person, the everyday accounts, and your data always yours.',
  'plans.plus.name': 'Plus',
  'plans.plus.tagline':
    'One person, no ceilings, and as many currencies as you keep.',
  'plans.household.name': 'Household',
  'plans.household.tagline': 'Everyone who shares the money shares the books.',
  'plans.feature.free.people': 'Just you',
  'plans.feature.free.accounts': 'Three accounts and one currency',
  'plans.feature.free.currency':
    'Budgets, goals and recurring bills, in small numbers',
  'plans.feature.free.planning': 'Load a statement twice a month',
  'plans.feature.export': 'Export everything, whenever you ask',
  'plans.feature.plus.people': 'Just you',
  'plans.feature.plus.unlimited':
    'Accounts, budgets and goals without a ceiling',
  'plans.feature.plus.currencies': 'As many currencies as you keep money in',
  'plans.feature.plus.rules': 'Twenty filing rules and monthly imports',
  'plans.feature.plus.storage': 'A gigabyte of receipts',
  'plans.feature.household.people': 'Up to six people in one household',
  'plans.feature.household.unlimited': 'Nothing in the product is capped',
  'plans.feature.household.roles':
    'Owners and admins decide who may change what',
  'plans.feature.household.storage': 'Five gigabytes of receipts',
  'plans.interval.monthly': 'Monthly',
  'plans.interval.yearly': 'Yearly',
  'plans.price.monthly': '{amount} a month',
  'plans.price.yearly': '{amount} a year',
  'plans.price.free': 'Always free',
  'plans.saving': 'Save {percent}%',
  'plans.current': 'Your plan',
  'billing.title': 'Plan and payment',
  'billing.subtitle':
    'What this household is on, how much of it you are using, and where the money goes. Prices are shown exactly as they are charged.',
  'billing.plan.title': 'Current plan',
  'billing.state.free':
    'You are on the free plan. Nothing is charged and nothing expires.',
  'billing.state.entitled': 'Active. Renews on {date}.',
  'billing.state.trialing': 'Trial. It becomes a paid plan on {date}.',
  'billing.state.cancelling':
    'Cancelled. It stays active until {date}, and you can undo that.',
  'billing.state.grace':
    'The last payment did not go through. The plan keeps working until {date}.',
  'billing.state.lapsed':
    'The subscription ended, so the household is on the free plan again.',
  'billing.state.confirming':
    'Payment received. The plan switches over as soon as the provider confirms it — usually within a minute.',
  'billing.action.upgrade': 'Choose this plan',
  'billing.action.portal': 'Payment methods and invoices',
  'billing.action.cancel': 'Cancel subscription',
  'billing.action.resume': 'Keep the subscription',
  'billing.action.refresh': 'Check again',
  'billing.cancel.title': 'Cancel this subscription?',
  'billing.cancel.body':
    'The plan keeps working until {date}, the day you have paid up to. After that the household goes back to the free plan; nothing is deleted.',
  'billing.cancel.confirm': 'Cancel it',
  'billing.cancel.keep': 'Keep it',
  'billing.usage.title': 'What you are using',
  'billing.usage.description':
    'The same numbers the product checks before it lets you add anything.',
  'billing.usage.value': '{used} of {limit}',
  'billing.usage.unlimited': '{used}, no limit',
  'billing.usage.metric.members': 'People',
  'billing.usage.metric.accounts': 'Accounts',
  'billing.usage.metric.currencies': 'Currencies',
  'billing.usage.metric.budgets': 'Budgets',
  'billing.usage.metric.goals': 'Goals',
  'billing.usage.metric.rules': 'Filing rules',
  'billing.usage.metric.recurringSeries': 'Recurring bills',
  'billing.usage.metric.transactions': 'Entries',
  'billing.usage.metric.importsPerMonth': 'Imports this month',
  'billing.usage.metric.storageBytes': 'Receipts',
  'billing.overLimit.title': 'Over the limit on this plan',
  'billing.overLimit.body':
    'Everything you already have stays readable, editable and exportable. Only adding more of what is over the line is refused until you remove some or move up a plan.',
  'billing.notConfigured':
    'Payments are switched off on this deployment, so only the free plan is available here.',
  'billing.error.title': 'The billing page did not load',
  'billing.error.unknownPlan': 'That plan is not one we sell.',
  'billing.error.noCustomer':
    'Nothing has been bought here yet, so there are no invoices to show.',

  /* -- People in the household -------------------------------------------- */
  'members.title': 'People',
  'members.subtitle':
    'Everyone here sees the same accounts, entries and budgets. Owners and admins can also change who is in the household.',
  'members.list.title': 'In this household',
  'members.column.person': 'Person',
  'members.column.role': 'Role',
  'members.column.joined': 'Joined',
  'members.column.actions': 'Actions',
  'members.you': 'You',
  'members.alone':
    'It is just you here. Invite someone to share the household.',
  'members.role.change': 'Change {name}’s role',
  'members.role.description.owner':
    'Everything, including billing and ownership.',
  'members.role.description.admin':
    'Everything except ownership and removing an owner.',
  'members.role.description.member':
    'Reads and writes the money; does not change who is here.',
  'members.seats.title': 'Seats',
  'members.seats.value': '{used} of {limit} used',
  'members.seats.full':
    'Every seat on this plan is taken. Move up a plan to invite anyone else.',
  'members.seats.upgrade': 'See the plans',
  'members.invite.action': 'Invite someone',
  'members.invite.title': 'Invite someone to this household',
  'members.invite.description':
    'They get a link that only works from the address you type here, and it lasts a week.',
  'members.invite.email': 'Email address',
  'members.invite.role': 'They join as',
  'members.invite.submit': 'Send the invitation',
  'members.invite.sent': 'The invitation is on its way to {email}.',
  'members.pending.title': 'Invited, not here yet',
  'members.pending.empty': 'No invitations are waiting.',
  'members.pending.expires': 'Expires {date}',
  'members.pending.expired': 'Expired',
  'members.pending.resend': 'Send again',
  'members.pending.resent': 'The invitation was sent again.',
  'members.pending.revoke': 'Withdraw',
  'members.pending.revoked': 'The invitation was withdrawn.',
  'members.remove.action': 'Remove {name}',
  'members.remove.title': 'Remove {name} from this household?',
  'members.remove.body':
    'They lose access straight away. Everything they entered stays — the accounts, entries and budgets belong to the household, not to the person.',
  'members.remove.confirm': 'Remove them',
  'members.removed': '{name} no longer has access.',
  'members.leave.action': 'Leave this household',
  'members.leave.title': 'Leave this household?',
  'members.leave.body':
    'You lose access to its accounts and entries. What you entered stays with the household.',
  'members.leave.confirm': 'Leave',
  'members.error.title': 'The people list did not load',
  'members.error.lastOwner':
    'A household has to keep at least one owner. Make somebody else an owner first.',
  'members.error.alreadyHere': 'That person is already in this household.',
  'members.error.alreadyInvited':
    'That address already has an invitation waiting.',
  'members.error.notAllowed': 'Your role does not allow that.',
  'members.error.seatsFull':
    'This plan has no seat left. Move up a plan, or withdraw an invitation first.',
  'members.error.generic': 'That did not work. Nothing was changed.',

  /* -- Accepting an invitation -------------------------------------------- */
  'invite.title': 'Join {workspace}',
  'invite.body':
    'You have been invited to share this household’s accounts, entries and budgets.',
  'invite.invitedAs': 'Invited as {email}',
  'invite.accept': 'Join the household',
  'invite.joined': 'You are in. Welcome to {workspace}.',
  'invite.signIn': 'Sign in to continue',
  'invite.signInBody':
    'Sign in with {email} — the address this invitation was sent to — and the link will bring you back here.',
  'invite.state.expired':
    'This invitation has expired. Ask whoever invited you to send it again.',
  'invite.state.revoked': 'This invitation was withdrawn.',
  'invite.state.accepted': 'This invitation has already been used.',
  'invite.state.alreadyMember': 'You are already in this household.',
  'invite.state.wrongAccount':
    'This invitation was sent to {email}. Sign out and sign in with that address to accept it.',
  'invite.notFound': 'This invitation link does not lead anywhere.',
  'invite.goToApp': 'Go to the household',

  /* -- The auth screens --------------------------------------------------- */
  'auth.aside.title': 'Every figure, down to the minor unit.',
  'auth.aside.body':
    'Amounts are held to the penny and converted at the rate of the day they happened, so last March still adds up the way last March did.',
  'auth.aside.point.privacy':
    'No bank connectors. Nothing is read that you did not enter or import.',
  'auth.aside.point.currency':
    'Accounts in several currencies, reported against one base currency.',
  'auth.aside.point.export':
    'The whole household exports as CSV or JSON whenever you ask for it.',
  'auth.continueWith': 'or',
  'auth.provider.google': 'Continue with Google',
  'auth.provider.apple': 'Continue with Apple',
  'auth.backToSignIn': 'Back to sign in',
  'auth.password.help': {
    one: 'At least {count} character. Pasting from a password manager is welcome.',
    other:
      'At least {count} characters. Pasting from a password manager is welcome.',
  },
  'auth.forgot.sentTitle': 'Check your inbox',
  'auth.forgot.tryAnother': 'Use a different address',
  'auth.reset.subtitle':
    'Pick something you have not already used on this account.',
  'auth.reset.invalid.title': 'This link cannot be used',
  'auth.reset.invalid.body':
    'A reset link works once and expires after an hour. Ask for a fresh one and it arrives in a moment.',
  'auth.reset.requestNew': 'Send me a new link',
  'auth.reset.continue': 'Continue to sign in',
  'auth.error.title': 'That did not work',
  'auth.error.generic': 'We could not complete that just now. Try again.',
  'auth.error.network':
    'We could not reach the server. Check your connection and try again.',
  'auth.error.invalidToken': 'That link has expired or has already been used.',
  'auth.error.weakPassword':
    'That password is too easy to guess. Try a longer one.',

  /* -- Recurring ---------------------------------------------------------- */
  /* -- The list ----------------------------------------------------------- */
  'recurring.title': 'Recurring',
  'recurring.subtitle':
    'What comes round again — subscriptions, bills, instalments and regular income.',
  'recurring.new': 'New series',
  'recurring.list.loading': 'Loading your recurring series…',
  'recurring.detail.loading': 'Loading this series…',
  'recurring.detail.back': 'All recurring series',

  'recurring.filter.label': 'Show',
  'recurring.filter.active': 'Active',
  'recurring.filter.all': 'All, including paused',

  'recurring.error.title': 'Recurring series could not be loaded',
  'recurring.error.body':
    'The list did not come back. Nothing has been changed — try again.',
  'recurring.detail.error.title': 'This series could not be loaded',
  'recurring.detail.error.body':
    'It may have been deleted, or the request did not come back. Nothing has been changed.',

  'recurring.empty.title': 'Nothing recurring yet',
  'recurring.empty.body':
    'A series is a plan: an amount, how often it comes round, and when it starts. It records nothing on its own until you tell it to.',
  'recurring.empty.action': 'Create your first series',
  'recurring.empty.detect': 'Or look through what you already recorded',
  'recurring.empty.filtered.title': 'Nothing here',
  'recurring.empty.filtered.body':
    'No series matches this filter. Try a different one.',

  /* -- Status, which is a word before it is a colour ----------------------- */
  'recurring.status.upcoming': 'Upcoming',
  'recurring.status.paid': 'Paid',
  'recurring.status.overdue': 'Overdue',
  'recurring.status.skipped': 'Skipped',

  'recurring.series.active': 'Active',
  'recurring.series.paused': 'Paused',
  'recurring.series.completed': 'Finished',

  /* -- What is due, in words ---------------------------------------------- */
  'recurring.due.today': 'Due today',
  'recurring.due.on': 'Due on {date}',
  'recurring.due.in': {
    one: 'Due tomorrow',
    other: 'Due in {count} days',
  },
  'recurring.due.late': {
    one: '{count} day overdue',
    other: '{count} days overdue',
  },
  'recurring.due.none': 'Nothing outstanding',
  'recurring.due.overdueCount': {
    one: '{count} overdue period',
    other: '{count} overdue periods',
  },

  'recurring.upcoming.title': 'Due soon',
  'recurring.upcoming.caption':
    'Every unsettled period in the next month, plus everything already late.',
  'recurring.upcoming.empty': 'Nothing is due in the next month.',

  /* -- How often ----------------------------------------------------------- */
  'recurring.frequency.label': 'How often',
  'recurring.frequency.weekly': 'Weekly',
  'recurring.frequency.biweekly': 'Every two weeks',
  'recurring.frequency.monthly': 'Monthly',
  'recurring.frequency.quarterly': 'Quarterly',
  'recurring.frequency.semi_annual': 'Twice a year',
  'recurring.frequency.annual': 'Yearly',

  /* -- What kind ------------------------------------------------------------ */
  'recurring.kind.label': 'Kind',
  'recurring.kind.subscription': 'Subscription',
  'recurring.kind.bill': 'Bill',
  'recurring.kind.installment': 'Instalment',
  'recurring.kind.income': 'Income',

  'recurring.direction.label': 'Direction',
  'recurring.direction.expense': 'Money out',
  'recurring.direction.income': 'Money in',

  /* -- The period table ----------------------------------------------------- */
  'recurring.periods.title': 'Period history',
  'recurring.periods.caption':
    'Every period this series has produced, oldest first, with what settled it.',
  'recurring.periods.empty':
    'No periods yet. The first one appears once the start date arrives.',
  'recurring.periods.col.due': 'Due',
  'recurring.periods.col.expected': 'Expected',
  'recurring.periods.col.settled': 'Settled',
  'recurring.periods.col.variance': 'Difference',
  'recurring.periods.col.status': 'Status',
  'recurring.periods.col.actions': 'Actions',
  'recurring.periods.variance.none': 'Same as expected',
  'recurring.periods.variance.unavailable': 'Different currency',
  'recurring.periods.variance.over': '{amount} more than expected',
  'recurring.periods.variance.under': '{amount} less than expected',
  'recurring.periods.notSettled': 'Not settled',

  'recurring.period.markPaid': 'Mark paid',
  'recurring.period.markPaid.for': 'Mark the period due {date} as paid',
  'recurring.period.skip': 'Skip',
  'recurring.period.skip.for': 'Skip the period due {date}',
  'recurring.period.revert': 'Undo',
  'recurring.period.revert.for': 'Undo the period due {date}',

  /* -- Mark paid ------------------------------------------------------------ */
  'recurring.markPaid.title': 'Mark this period paid',
  'recurring.markPaid.body':
    'Pick the expense that settled it. Nothing here creates an entry: if the payment is not recorded yet, record it first.',
  'recurring.markPaid.field': 'The expense that settled it',
  'recurring.markPaid.placeholder': 'Search your spending',
  'recurring.markPaid.empty':
    'Nothing in this window matches. Record the payment first, then come back.',
  'recurring.markPaid.confirm': 'Link it',
  'recurring.markPaid.never': 'Marking a period paid never creates an entry.',
  /* -- Automation ----------------------------------------------------------- */
  'recurring.automation.label': 'Automation',
  'recurring.automation.none': 'Off — you record each one yourself',
  'recurring.automation.none.help':
    'The series reminds you and tracks what is outstanding. Nothing is written without you.',
  'recurring.automation.auto': 'Record it for me',
  'recurring.automation.auto.help':
    'On the due date, an expense is written for the expected amount into the chosen account. You can edit it afterwards like any other.',
  'recurring.automation.match': 'Match what I record',
  'recurring.automation.match.help':
    'Nothing is written. An expense you record that fits the rule below is linked to the period it settles.',
  'recurring.automation.exclusive':
    'A series either records for you or matches what you record. It cannot do both — an automatic entry has nothing left to match.',
  'recurring.automation.needsAccount':
    'Recording for you needs an account to write into.',
  'recurring.automation.badge.auto': 'Records automatically',
  'recurring.automation.badge.match': 'Matches what you record',

  'recurring.match.payee': 'Words in the payee or note',
  'recurring.match.payee.help':
    'Any one of them is enough. Case does not matter.',
  'recurring.match.account': 'Only in this account',
  'recurring.match.account.any': 'Any account',
  'recurring.match.tolerance': 'Allow the amount to differ by',
  'recurring.match.tolerance.help':
    'A bill that varies a little still matches. Zero means the amount must be exact.',
  'recurring.match.window': 'Allow the date to differ by',
  'recurring.match.window.days': {
    one: '{count} day',
    other: '{count} days',
  },

  /* -- Reminders ------------------------------------------------------------ */
  'recurring.reminders.label': 'Remind me',
  'recurring.reminders.help':
    'Up to three. Leave them all off for no reminder.',
  'recurring.reminders.none': 'No reminders',
  'recurring.reminders.max': 'Three reminders is the most a series can have.',
  'recurring.reminders.0d': 'On the day',
  'recurring.reminders.1d': 'A day before',
  'recurring.reminders.2d': 'Two days before',
  'recurring.reminders.3d': 'Three days before',
  'recurring.reminders.5d': 'Five days before',
  'recurring.reminders.1w': 'A week before',
  'recurring.reminders.2w': 'Two weeks before',
  'recurring.reminders.1m': 'A month before',
  'recurring.reminders.email': 'Also send these by email',
  'recurring.reminders.pending':
    'Reminders are decided here and delivered once notifications ship. Nothing is being sent yet.',

  /* -- The form ------------------------------------------------------------- */
  'recurring.form.create.title': 'New recurring series',
  'recurring.form.edit.title': 'Edit series',
  'recurring.form.error': 'This series could not be saved',
  'recurring.form.name': 'Name',
  'recurring.form.name.placeholder': 'Rent, Netflix, salary…',
  'recurring.form.amount': 'Expected amount',
  'recurring.form.currency': 'Currency',
  'recurring.form.currency.locked':
    'The currency is fixed once a series exists. Every period already expected is denominated in it.',
  'recurring.form.direction.locked':
    'The direction is fixed once a series exists. Reversing it would claim every past period moved the other way.',
  'recurring.form.startDate': 'First due date',
  'recurring.form.startDate.help':
    'Periods before today are created too, so a backdated series shows its history at once.',
  'recurring.form.anchorDay': 'Day of the month',
  'recurring.form.anchorDay.help':
    'A day past the end of a short month falls back to its last day, and the month after is anchored again rather than drifting.',
  'recurring.form.anchorDay.auto': 'Same day as the first due date',
  'recurring.form.account': 'Account',
  'recurring.form.account.none': 'No account',
  'recurring.form.category': 'Category',
  'recurring.form.category.none': 'No category',
  'recurring.form.payee': 'Payee',
  'recurring.form.payee.none': 'No payee',
  'recurring.form.widget': 'Show on the dashboard',

  'recurring.termination.label': 'When it ends',
  'recurring.termination.open': 'It does not — keep going',
  'recurring.termination.endDate': 'On a date',
  'recurring.termination.endDate.field': 'Last day',
  'recurring.termination.endDate.help':
    'A period due on this exact day still counts.',
  'recurring.termination.maxOccurrences': 'After a number of times',
  'recurring.termination.maxOccurrences.field': 'How many times',
  'recurring.termination.maxOccurrences.help':
    'Counted inclusively: twelve means twelve periods, the last one included.',

  'recurring.preview.title': 'The next few dates',
  'recurring.preview.help':
    'What this schedule produces, so you can see it before you save it.',

  /* -- Actions -------------------------------------------------------------- */
  'recurring.actions.menu': 'Actions for {name}',
  'recurring.actions.edit': 'Edit',
  'recurring.actions.pause': 'Pause',
  'recurring.actions.resume': 'Resume',
  'recurring.actions.complete': 'Finish',
  'recurring.actions.delete': 'Delete',

  'recurring.confirm.pause.title': 'Pause this series?',
  'recurring.confirm.pause.body':
    'Nothing further is created or recorded while it is paused. Its history and its outstanding periods stay exactly as they are.',
  'recurring.confirm.complete.title': 'Finish this series?',
  'recurring.confirm.complete.body':
    'It stops for good. Nothing further is ever created. Its history stays.',
  'recurring.confirm.delete.title': 'Delete this series?',
  'recurring.confirm.delete.body':
    'This cannot be undone. A series that has settled a period cannot be deleted — finish it instead, so its history survives.',

  'recurring.toast.created': 'Series created',
  'recurring.toast.saved': 'Series saved',
  'recurring.toast.paused': 'Series paused',
  'recurring.toast.resumed': 'Series resumed',
  'recurring.toast.completed': 'Series finished',
  'recurring.toast.deleted': 'Series deleted',
  'recurring.toast.failed': 'That did not work',
  'recurring.toast.periodPaid': 'Period marked paid',
  'recurring.toast.periodSkipped': 'Period skipped',
  'recurring.toast.periodReverted': 'Period reopened',
  'recurring.toast.unlinked': 'Entry unlinked',
  /* -- Linked transactions --------------------------------------------------- */
  'recurring.links.title': 'Linked entries',
  'recurring.links.caption':
    'What this series has adopted, and how each link came about.',
  'recurring.links.empty': 'Nothing linked yet.',
  'recurring.links.source.manual': 'You linked it',
  'recurring.links.source.rule': 'Matched a rule',
  'recurring.links.source.auto': 'Recorded automatically',
  'recurring.links.unlink': 'Unlink',
  'recurring.links.unlinked': 'Unlinked',

  /* -- Candidates ------------------------------------------------------------ */
  'recurring.candidates.title': 'Recurring patterns in your transactions',
  'recurring.candidates.subtitle':
    'Payments that repeat in what you recorded: the same payee, a similar amount, a steady interval. Each one is a suggestion - set it up as a series, or mark it as not one.',
  'recurring.candidates.loading': 'Looking through your transactions…',
  'recurring.candidates.detect': 'Look again',
  'recurring.candidates.detecting': 'Looking…',
  'recurring.candidates.link': 'Find recurring patterns',
  'recurring.candidates.pending': {
    one: '{count} suggestion',
    other: '{count} suggestions',
  },
  'recurring.candidates.empty.title': 'Nothing to suggest',
  'recurring.candidates.empty.body':
    'We look for the same payee, at roughly the same interval, for roughly the same amount, at least three times. Nothing in the last eighteen months fits.',
  'recurring.candidates.found': {
    one: 'Found {count} suggestion',
    other: 'Found {count} suggestions',
  },
  'recurring.candidates.error.title': 'Suggestions could not be loaded',
  'recurring.candidates.error.body':
    'The list did not come back. Nothing has been changed — try again.',

  'recurring.candidate.confidence.label': 'Confidence',
  'recurring.candidate.confidence.high': 'High',
  'recurring.candidate.confidence.medium': 'Medium',
  'recurring.candidate.confidence.low': 'Low',
  'recurring.candidate.evidence': {
    one: 'From {count} entry',
    other: 'From {count} entries',
  },
  'recurring.candidate.because.occurrences':
    'Confidence is held back by how few times this has happened.',
  'recurring.candidate.because.regularity':
    'Confidence is held back by how much the dates move about.',
  'recurring.candidate.because.amount':
    'Confidence is held back by how much the amount varies.',
  'recurring.candidate.accept': 'Set it up',
  'recurring.candidate.dismiss': 'Not a series',
  'recurring.candidate.dismiss.for': 'Dismiss the suggestion for {name}',
  'recurring.candidate.accept.for': 'Set up a series for {name}',
  'recurring.candidate.creates':
    'Setting it up creates the plan only. None of the entries it was found from is changed.',
  'recurring.candidate.toast.dismissed': 'Suggestion dismissed',
  'recurring.candidate.toast.accepted': 'Series created from the suggestion',

  /* -- Savings goals ------------------------------------------------------ */
  /* -- The list ----------------------------------------------------------- */
  'goals.title': 'Savings goals',
  'goals.subtitle':
    'What you are putting money aside for, and how it is going.',
  'goals.new': 'New goal',
  'goals.list.loading': 'Loading your savings goals…',
  'goals.detail.loading': 'Loading this goal…',
  'goals.detail.back': 'All savings goals',

  'goals.filter.label': 'Show',
  'goals.filter.active': 'In progress',
  'goals.filter.reached': 'Reached',
  'goals.filter.archived': 'Archived',
  'goals.filter.all': 'All',

  'goals.error.title': 'Savings goals could not be loaded',
  'goals.error.body':
    'The list did not come back. Nothing has been changed — try again.',
  'goals.detail.error.title': 'This goal could not be loaded',
  'goals.detail.error.body':
    'It may have been deleted, or the request did not come back. Nothing has been changed.',

  'goals.empty.title': 'No savings goals yet',
  'goals.empty.body':
    'A goal is a target amount and, if you want one, a date. Progress comes from entries you already recorded: nothing here creates money or moves it.',
  'goals.empty.action': 'Create your first goal',
  'goals.empty.filtered.title': 'Nothing here',
  'goals.empty.filtered.body':
    'No goal matches this filter. Try a different one.',

  /* -- Status, which is a word before it is a colour ----------------------- */
  'goals.status.active': 'Saving',
  'goals.status.reached': 'Reached',
  'goals.status.archived': 'Archived',
  'goals.status.overdue': 'Past its date',

  /* -- The meter ---------------------------------------------------------- */
  // The accessible name states both amounts before the percentage: "62%" alone says nothing about
  // of what, and this is the one figure a reader may act on.
  'goals.meter.label': 'Saved towards {name}',
  'goals.meter.valueText': '{contributed} of {target} saved, {percent}',
  'goals.meter.tick': 'The target, {target}',
  'goals.meter.unavailable': 'Progress unavailable',
  'goals.progress.remaining': '{amount} to go',
  'goals.progress.complete': 'Fully funded',
  'goals.progress.of': '{contributed} of {target}',
  'goals.progress.base': '{contributed} of {target} in {currency}',
  'goals.progress.baseHelp':
    'The secondary figure. Each contribution was converted on the day it happened; the target is converted at today’s rate.',

  /* -- Dates -------------------------------------------------------------- */
  'goals.target.none': 'No target date',
  'goals.target.by': 'By {date}',
  'goals.target.daysLeft': {
    one: '{count} day to the target date',
    other: '{count} days to the target date',
  },
  'goals.target.overdue': {
    one: '{count} day past the target date',
    other: '{count} days past the target date',
  },

  /* -- Accounts ----------------------------------------------------------- */
  'goals.accounts.from': 'Funded from {name}',
  'goals.accounts.held': 'Held in {name}',
  'goals.accounts.unset': 'Not set',

  /* -- The detail figures -------------------------------------------------- */
  'goals.detail.saved': 'Saved',
  'goals.detail.target': 'Target',
  'goals.detail.remaining': 'Left to save',
  'goals.detail.pace': 'Typical month',
  'goals.reached.title': 'This goal is fully funded',
  'goals.reached.body':
    'Nothing more needs to go in. Archive it to take it off the list, or raise the target if the plan has grown.',

  /* -- The projection, which is the honest part ---------------------------- */
  'goals.projection.heading': 'Projected completion',
  'goals.projection.disclaimer':
    'A projection, not a promise. It assumes the last six months repeat.',
  'goals.projection.reached': 'Reached. There is nothing left to project.',
  'goals.projection.onTrack': 'On course to get there by {date}.',
  'goals.projection.onTrackBeforeTarget':
    'On course to get there by {date}, ahead of the {target} target.',
  'goals.projection.behind':
    'At this pace, not before {date} — {late} after the target.',
  'goals.projection.late': {
    one: '{count} day',
    other: '{count} days',
  },
  'goals.projection.rate': 'Based on a typical {amount} a month.',
  'goals.projection.months': {
    one: 'from {count} month of contributions',
    other: 'from {count} months of contributions',
  },

  'goals.projection.confidence.label': 'How much to trust this',
  'goals.projection.confidence.low': 'Rough guess',
  'goals.projection.confidence.low.help':
    'The contributions so far vary by more than they average, so read the date as a direction rather than a plan.',
  'goals.projection.confidence.medium': 'Fair estimate',
  'goals.projection.confidence.medium.help':
    'Half a year of contributions at a recognisable pace. Enough for planning, not enough to commit to.',
  'goals.projection.confidence.high': 'Steady pattern',
  'goals.projection.confidence.high.help':
    'A year or more of contributions at a steady pace. As good as a projection from this data gets.',

  'goals.projection.insufficient.title': 'Not enough history to project',
  'goals.projection.insufficient.none':
    'Nothing has been contributed yet, so there is no pace to project from.',
  'goals.projection.insufficient.tooFew': {
    one: 'One month of contributions is not a pace. A projected date needs at least {needed} months behind it.',
    other:
      '{count} months of contributions is not yet a pace. A projected date needs at least {needed} months behind it.',
  },
  'goals.projection.insufficient.stale':
    'The last contribution was over six months ago. Whatever pace there was has stopped, and projecting from it would invent one.',

  /* -- The chart ----------------------------------------------------------- */
  'goals.chart.title': 'Contributions, month by month',
  'goals.chart.category': 'Month',
  'goals.chart.series.monthly': 'Added that month',
  'goals.chart.empty.title': 'Nothing to plot yet',
  'goals.chart.empty.body':
    'Count an entry towards this goal and its history appears here.',
  'goals.chart.noData': 'Nothing',
  'goals.chart.zeroNote':
    'A month with no bar is a month nothing went in — a real zero, not a missing reading.',

  /* -- Contributions ------------------------------------------------------- */
  'goals.contributions.heading': 'Contribution history',
  'goals.contributions.count': {
    one: '{count} contribution',
    other: '{count} contributions',
  },
  'goals.contributions.empty.title': 'No contributions yet',
  'goals.contributions.empty.body':
    'A contribution points at an entry you already recorded. Nothing new is created and no money moves.',
  'goals.contributions.column.date': 'Date',
  'goals.contributions.column.amount': 'Amount',
  'goals.contributions.column.detail': 'Entry',
  'goals.contributions.column.actions': 'Actions',
  'goals.contributions.linkedOn': 'Counted on {date}',
  'goals.contributions.remove': 'Remove {amount} from this goal',
  'goals.contributions.add': 'Count an entry',
  /* -- Suggestions, which are offers and never links ----------------------- */
  'goals.suggestions.heading': 'Transfers that look like contributions',
  'goals.suggestions.body':
    'Nothing below has been counted. Each one left the funding account and arrived in the account this goal is held in — you decide whether it was for this goal.',
  'goals.suggestions.count': {
    one: '{count} transfer to review',
    other: '{count} transfers to review',
  },
  'goals.suggestions.accept': 'Count it: {amount} towards this goal',
  'goals.suggestions.from': 'From {account}',

  /* -- The form ------------------------------------------------------------ */
  'goals.form.create.title': 'New savings goal',
  'goals.form.edit.title': 'Edit savings goal',
  'goals.form.description':
    'A target amount, a currency it is measured in, and — if it has a deadline — a date.',
  'goals.form.name': 'What it is for',
  'goals.form.name.placeholder': 'Emergency fund',
  'goals.form.target': 'Target amount',
  'goals.form.currency': 'Currency',
  'goals.form.currency.help':
    'A goal is measured in one currency and keeps it. Contributions in any other currency are refused rather than converted at a rate nobody chose.',
  'goals.form.currency.locked': 'Set when the goal was created',
  'goals.form.targetDate': 'Target date',
  'goals.form.targetDate.help':
    'Optional. Without one the goal still has a pace — it simply has no deadline to be behind.',
  'goals.form.fromAccount': 'Funded from',
  'goals.form.fromAccount.help':
    'Where the money comes from. Used to spot transfers that look like contributions.',
  'goals.form.heldAccount': 'Held in',
  'goals.form.heldAccount.help':
    'Where the money sits. Both accounts are optional; set both and this goal can suggest contributions.',
  'goals.form.cancel': 'Cancel',
  'goals.form.submit.create': 'Create goal',
  'goals.form.submit.save': 'Save changes',
  'goals.form.error': 'The goal could not be saved',

  /* -- The contribution flow ------------------------------------------------ */
  'goals.contribute.title': 'Count an entry towards {name}',
  'goals.contribute.description':
    'Pick something that already happened. It stays exactly as it is: this only records what it was for.',
  'goals.contribute.field': 'Entry',
  'goals.contribute.field.help':
    'Only entries in {currency} can be counted, because the goal is measured in {currency}.',
  'goals.contribute.option': '{date} · {amount}',
  'goals.contribute.empty':
    'No unlinked {currency} entry is available to count. Record one first, or change the account this goal is held in.',
  'goals.contribute.submit': 'Count it',
  'goals.contribute.cancel': 'Cancel',
  'goals.contribute.error': 'The entry could not be counted',
  'goals.contribute.error.currency':
    'That entry is in {transaction} and this goal is in {goal}. Converting it would need a rate nobody chose, so it is refused rather than guessed.',
  'goals.contribute.error.direction':
    'This goal is funded by {expected} entries, and that one is {received}. Counting it would reduce the progress instead of adding to it.',
  /* -- Actions and confirmations -------------------------------------------- */
  'goals.actions.label': 'Actions for {name}',
  'goals.actions.edit': 'Edit',
  'goals.actions.archive': 'Archive',
  'goals.actions.restore': 'Restore',
  'goals.actions.delete': 'Delete',
  'goals.actions.recompute': 'Recheck the progress',

  'goals.confirm.archive.title': 'Archive this goal?',
  'goals.confirm.archive.body':
    'It leaves the list and keeps every contribution it holds. You can restore it at any time.',
  'goals.confirm.archive.action': 'Archive',
  'goals.confirm.delete.title': 'Delete this goal?',
  'goals.confirm.delete.body':
    'The goal and its record of which entries counted towards it are removed for good. The entries themselves are untouched.',
  'goals.confirm.delete.action': 'Delete',
  'goals.confirm.remove.title': 'Remove this contribution?',
  'goals.confirm.remove.body':
    'The entry stays exactly as it is. Only the note that it was for this goal is removed, and the progress drops by that amount.',
  'goals.confirm.remove.action': 'Remove',

  'goals.toast.created': 'Goal created',
  'goals.toast.saved': 'Goal saved',
  'goals.toast.archived': 'Goal archived',
  'goals.toast.restored': 'Goal restored',
  'goals.toast.deleted': 'Goal deleted',
  'goals.toast.contributed': 'Counted towards this goal',
  'goals.toast.uncontributed': 'Removed from this goal',
  'goals.toast.recomputed': 'Progress rechecked',
  'goals.toast.reached': '{name} is fully funded',
  'goals.toast.failed': 'That did not go through',
  /* -- Rules · the paused banner -------------------------------------------- */
  // A rule pauses when something it names is deleted. The banner has to say *what*
  // broke, so the reason carries the deleted row's name — by the time this is read
  // the row is gone and its id resolves to nothing. One message per kind rather
  // than a shared sentence with the kind slotted in: Polish inflects the adjective
  // for it, and a sentence built by concatenation cannot.
  'rules.paused.badge': 'Paused',
  'rules.paused.title': '“{name}” is paused',
  'rules.paused.body':
    'Something this rule needed was deleted, so it stopped running. Pick a replacement to switch it back on, or delete the rule.',
  'rules.paused.at': 'Paused on {when}.',
  'rules.paused.missing.account': 'Deleted account: “{label}”',
  'rules.paused.missing.accountGroup': 'Deleted account group: “{label}”',
  'rules.paused.missing.category': 'Deleted category: “{label}”',
  'rules.paused.missing.payee': 'Deleted payee: “{label}”',
  'rules.paused.missing.tag': 'Deleted tag: “{label}”',
  'rules.paused.replace.label': 'Replacement for “{name}”',
  'rules.paused.replace.placeholder': 'Pick a replacement',
  'rules.paused.replace.empty':
    'There is nothing to switch to. Create a replacement first, or delete this rule.',
  'rules.paused.delete': 'Delete this rule',
  'rules.paused.resumed': 'Rule resumed',

  /* -- Rules: the automation engine ---------------------------------------- */
  // Order is the whole model here, so the subtitle states it rather than leaving
  // somebody to discover it: every matching rule runs, top to bottom, and the
  // last write to a field wins. See `src/server/rules/apply.ts`.
  'rules.title': 'Rules',
  'rules.subtitle':
    'Rules run top to bottom on every entry that fires their trigger. All of the matching ones run, and a later rule overwrites what an earlier one set.',
  'rules.new': 'New rule',
  'rules.list.label': 'Rules, in the order they run',
  'rules.back': 'Back to the rules',
  'rules.error.title': 'The rules could not be loaded',
  'rules.error.body':
    'Nothing was changed. Try again, and if it keeps happening the detail below is what to send us.',
  'rules.error.locked':
    'Rules are not part of this plan, so nothing was saved.',

  'rules.empty.title': 'No rules yet',
  'rules.empty.body':
    'A rule watches for entries you describe and changes them for you: categorising the shop you visit every week, or tagging the subscription you keep forgetting about.',
  'rules.empty.locked.title': 'Automation is not part of this plan',
  'rules.empty.locked.body':
    'Rules categorise, tag and rename new entries as they arrive. Upgrading switches them on; nothing you have already entered changes.',
  'rules.empty.locked.action': 'See the plans',

  'rules.row.actions': 'Actions for {name}',
  'rules.row.active': 'Active for {name}',
  'rules.row.position': 'Runs {position} of {count}',
  'rules.row.matches': 'Matches: {count}',
  'rules.row.inert': 'Runs on nothing',
  'rules.row.paused': 'Paused',
  'rules.row.off': 'Off',
  'rules.drag.label': 'Reorder {name}',
  'rules.move.top': 'Move to the top',
  'rules.move.bottom': 'Move to the bottom',

  'rules.confirm.delete.title': 'Delete this rule?',
  'rules.confirm.delete.body':
    'It stops running from now on. Nothing it has already written is undone.',
  'rules.confirm.delete.action': 'Delete',

  'rules.toast.reordered': 'Order saved',
  'rules.toast.activated': 'Rule switched on',
  'rules.toast.deactivated': 'Rule switched off',
  'rules.toast.created': 'Rule created',
  'rules.toast.saved': 'Rule saved',
  'rules.toast.deleted': 'Rule deleted',
  'rules.toast.failed': 'That did not go through',

  /* -- The editor ----------------------------------------------------------- */
  'rules.editor.new.title': 'New rule',
  'rules.editor.edit.title': 'Edit rule',
  'rules.editor.name': 'Name',
  'rules.editor.name.description':
    'What you would call this rule when scanning the list.',
  'rules.editor.matchMode': 'Match',
  'rules.editor.matchMode.all': 'Every condition',
  'rules.editor.matchMode.any': 'Any condition',
  'rules.editor.when': 'When',
  'rules.editor.then': 'Then',
  'rules.editor.conditions.label': 'Conditions',
  'rules.editor.actions.label': 'Actions',
  'rules.editor.addCondition': 'Add a condition',
  'rules.editor.addAction': 'Add an action',
  'rules.editor.addRange': 'Add an amount range',
  // There is no `between` operator on purpose — a range is two conditions. The
  // button is the convenience; the sentence explains what it produced, so nobody
  // is surprised to find two rows where they pressed one button.
  'rules.editor.addRange.description':
    'Adds two conditions — at least, and at most. A range only means a range when every condition has to hold, so set Match to “Every condition” first.',
  'rules.editor.conditions.full': 'A rule holds at most {count} conditions.',
  'rules.editor.actions.full': 'A rule holds at most {count} actions.',
  'rules.editor.runOn': 'Run this rule',
  'rules.editor.runOn.manual_create': 'When I add an entry',
  'rules.editor.runOn.import': 'When I import a file',
  'rules.editor.runOn.edit': 'When I edit an entry',
  'rules.editor.runOn.none':
    'This rule runs on nothing, so it will never change anything. It still saves.',
  'rules.editor.sentence.label': 'What this rule does',
  'rules.editor.save': 'Save the rule',
  'rules.editor.delete': 'Delete this rule',
  'rules.editor.error.title': 'The rule was not saved',

  /* -- One condition row ---------------------------------------------------- */
  'rules.condition.legend': 'Condition {position}',
  'rules.condition.field': 'Field',
  'rules.condition.operator': 'Comparison',
  'rules.condition.remove': 'Remove condition {position}',
  'rules.condition.moveUp': 'Move condition {position} up',
  'rules.condition.moveDown': 'Move condition {position} down',
  'rules.condition.keywords': 'Keywords',
  'rules.condition.keywords.description':
    'One per line. Capitals and Polish diacritics are ignored, so “Żabka” finds “ZABKA 4471”.',
  'rules.condition.values': 'Values',
  'rules.condition.values.add': 'Add a value',
  'rules.condition.values.toggle': 'Show the options',
  'rules.condition.values.remove': 'Remove {name}',
  'rules.condition.values.none': 'Nothing chosen yet.',
  'rules.condition.values.empty': 'There is nothing to pick here yet.',
  'rules.condition.values.noMatch': 'Nothing matches.',
  'rules.condition.values.full': 'At most {count} of these at a time.',
  'rules.condition.days': 'Days',
  'rules.condition.days.description':
    'Whole numbers from 1 to 31, separated by commas. A 30-day month never matches 31.',
  'rules.condition.days.invalid': 'Only whole numbers from 1 to 31.',
  'rules.condition.amount': 'Amount',
  'rules.condition.currency': 'Currency',
  // The evaluator refuses to convert rather than reaching for a rate on a day
  // nobody chose (`src/server/rules/evaluate.ts`), so the editor says so here
  // instead of letting somebody discover it from an empty preview.
  'rules.condition.currency.description':
    'An amount is compared in one currency and never converted, so an entry in any other currency does not match.',
  'rules.condition.direction': 'Direction',
  'rules.condition.direction.income': 'Money in',
  'rules.condition.direction.expense': 'Money out',

  'rules.field.note': 'Note',
  'rules.field.payee': 'Payee',
  'rules.field.account': 'Account',
  'rules.field.account_group': 'Account group',
  'rules.field.amount': 'Amount',
  'rules.field.direction': 'Direction',
  'rules.field.day_of_month': 'Day of the month',
  'rules.field.tag': 'Tag',
  'rules.field.category': 'Category',

  'rules.operator.contains': 'contains',
  'rules.operator.not_contains': 'does not contain',
  'rules.operator.is_any_of': 'is any of',
  'rules.operator.is_none_of': 'is none of',
  'rules.operator.eq': 'is exactly',
  'rules.operator.gt': 'is over',
  'rules.operator.gte': 'is at least',
  'rules.operator.lt': 'is under',
  'rules.operator.lte': 'is at most',

  /* -- One action row ------------------------------------------------------- */
  'rules.action.legend': 'Action {position}',
  'rules.action.kind': 'Do this',
  'rules.action.remove': 'Remove action {position}',
  'rules.action.moveUp': 'Move action {position} up',
  'rules.action.moveDown': 'Move action {position} down',
  'rules.action.set_category': 'Set the category',
  'rules.action.set_payee': 'Set the payee',
  'rules.action.add_tag': 'Add a tag',
  'rules.action.remove_tag': 'Remove a tag',
  'rules.action.set_note': 'Set the note',
  'rules.action.set_payment_method': 'Set the payment method',
  'rules.action.mark_planned': 'Mark as planned',
  'rules.action.set_excluded': 'Exclude from statistics',
  'rules.action.value.category': 'Category',
  'rules.action.value.payee': 'Payee',
  'rules.action.value.tag': 'Tag',
  'rules.action.value.note': 'Note',
  'rules.action.value.paymentMethod': 'Payment method',
  'rules.action.value.planned': 'Planned',
  'rules.action.value.excluded': 'Excluded from statistics',
  'rules.action.value.empty': 'There is nothing to pick here yet.',

  /* -- The live preview ----------------------------------------------------- */
  // Both counts, always. "12 matches" is not a fact somebody can act on; "12 of
  // the last 2 000" is. See `-server/preview.ts`.
  'rules.preview.title': 'Preview',
  'rules.preview.counts': '{matched} of the last {scanned} entries match.',
  'rules.preview.empty': 'No matches in the last {scanned} entries.',
  'rules.preview.incomplete':
    'Add a condition and an action, and the preview appears here.',
  'rules.preview.loading': 'Checking…',
  'rules.preview.samples.label': 'Matching entries',
  'rules.preview.samples.shown': 'The first {shown} are listed.',
  'rules.preview.scanCap':
    'Only the {limit} most recent entries are checked, so this is a sample of your history rather than all of it.',
  'rules.preview.error.title': 'The preview could not run',
  'rules.preview.error.body':
    'Nothing was changed — a preview never writes. The rule itself is still here to save or edit.',

  /* -- The rule, read back as a sentence ------------------------------------ */
  'rules.sentence.template': 'When {when}, {then}.',
  'rules.sentence.and': ' and ',
  'rules.sentence.or': ' or ',
  'rules.sentence.listSeparator': ', ',
  'rules.sentence.quoted': '“{value}”',
  'rules.sentence.unknownReference': 'something that no longer exists',
  'rules.sentence.noConditions':
    'Add a condition, and this rule reads back here.',
  'rules.sentence.noActions': 'Add an action, and this rule reads back here.',

  'rules.clause.note.contains': 'the note contains {values}',
  'rules.clause.note.notContains': 'the note does not contain {values}',
  'rules.clause.payee.contains': 'the payee contains {values}',
  'rules.clause.payee.notContains': 'the payee does not contain {values}',
  'rules.clause.account.isAnyOf': 'the account is {values}',
  'rules.clause.account.isNoneOf': 'the account is not {values}',
  'rules.clause.accountGroup.isAnyOf': 'the account group is {values}',
  'rules.clause.accountGroup.isNoneOf': 'the account group is not {values}',
  'rules.clause.category.isAnyOf': 'the category is {values}',
  'rules.clause.category.isNoneOf': 'the category is not {values}',
  'rules.clause.tag.isAnyOf': 'it is tagged {values}',
  'rules.clause.tag.isNoneOf': 'it is not tagged {values}',
  'rules.clause.dayOfMonth.isAnyOf': 'the day of the month is {values}',
  'rules.clause.dayOfMonth.isNoneOf': 'the day of the month is not {values}',
  'rules.clause.amount.eq': 'the amount is exactly {amount}',
  'rules.clause.amount.gt': 'the amount is over {amount}',
  'rules.clause.amount.gte': 'the amount is at least {amount}',
  'rules.clause.amount.lt': 'the amount is under {amount}',
  'rules.clause.amount.lte': 'the amount is at most {amount}',
  'rules.clause.direction.income': 'the money is coming in',
  'rules.clause.direction.expense': 'the money is going out',
  'rules.clause.setCategory': 'set the category to {value}',
  'rules.clause.setPayee': 'set the payee to {value}',
  'rules.clause.addTag': 'add the tag {value}',
  'rules.clause.removeTag': 'remove the tag {value}',
  'rules.clause.setNote': 'set the note to “{value}”',
  'rules.clause.setPaymentMethod': 'set the payment method to {value}',
  'rules.clause.markPlanned': 'mark it as planned',
  'rules.clause.markNotPlanned': 'mark it as not planned',
  'rules.clause.exclude': 'leave it out of the statistics',
  'rules.clause.include': 'count it in the statistics',

  /* -- Attachments (11-S3) -------------------------------------------------- */
  'attachments.title': 'Receipts',
  'attachments.description':
    'Photos and PDFs kept with this entry. Only people in this household can open them.',
  'attachments.list.label': 'Attached receipts',
  'attachments.link': '{name} · {size} · {kind}',
  'attachments.remove': 'Remove {name}',
  'attachments.empty.title': 'No receipts attached',
  'attachments.empty.body':
    'Keep the till slip, the invoice or the transfer confirmation with the expense it belongs to.',
  'attachments.attach': 'Attach a receipt',
  'attachments.dropzone.label': 'Drop receipts here to attach them',
  'attachments.dropzone.hint': 'Drop files here, or choose them:',
  'attachments.dropzone.limits':
    'JPEG, PNG, WebP, HEIC or PDF, up to 10 MB each.',
  'attachments.progress.label': 'Uploads in progress',
  'attachments.progress.file': 'Uploading {name}',
  'attachments.error.file': '{name} was not attached: {reason}',
  'attachments.error.size': 'the file is larger than 10 MB',
  'attachments.error.type': 'that file type is not accepted',
  'attachments.error.failed': 'the upload did not go through',
  'attachments.type.jpeg': 'JPEG image',
  'attachments.type.png': 'PNG image',
  'attachments.type.webp': 'WebP image',
  'attachments.type.heic': 'HEIC image',
  'attachments.type.pdf': 'PDF document',
  'attachments.type.other': 'File',
  'attachments.confirm.title': 'Remove this receipt?',
  'attachments.confirm.body':
    '{name} is deleted for good. The entry itself is untouched.',
  'attachments.confirm.action': 'Remove',
  'attachments.toast.deleted': 'Receipt removed',
  /* -- Why an import refused a row (19-S2) ---------------------------------- */
  // One key per `import_row_errors.code`. The row is written once and read back
  // in whatever language the person is using then, so the column stores the key
  // and this is where the sentence lives. Each one says what the file contained
  // and what to do, because "invalid row" is not something anybody can act on.
  'import.error.date_empty': 'The date column is empty on this row.',
  'import.error.date_unparseable':
    'This date is not written the way the chosen date format describes.',
  'import.error.date_impossible': 'This date does not exist in the calendar.',
  'import.error.amount_empty': 'The amount column is empty on this row.',
  'import.error.amount_unparseable':
    'This amount could not be read with the chosen decimal separator.',
  'import.error.amount_currency_mismatch':
    'This amount names a different currency from the account it would be imported into.',
  'import.error.amount_too_precise':
    'This amount has more decimal places than the currency has, so it was not rounded.',
  'import.error.amount_out_of_range': 'This amount is too large to store.',
  'import.error.amount_zero': 'A loaded entry cannot be for zero.',
  'import.error.amount_both_empty':
    'Neither the debit nor the credit column has a figure on this row.',
  'import.error.amount_debit_and_credit':
    'This row has both a debit and a credit, so it is not one entry.',
  'import.error.row_currency_mismatch':
    'This row is in a different currency from the account it would be imported into.',

  /* -- Import: the entry surface, the stepper, mapping and preview (19-S2) -- */
  // The flow is four named steps and every state it can be in is designed: an
  // upload, a mapping, a blocking DMY/MDY question, a preview, a dead end when
  // nothing could be read, and a seam for the commit that lands later.
  'import.title': 'Import',
  'import.lead':
    'Bring a statement or another tracker’s export into this household. Nothing is written until you have seen what the file would do.',
  'import.group.file.title': 'From your bank or a spreadsheet',
  'import.group.file.body':
    'A statement you downloaded, or a sheet you keep yourself. The format is worked out from the file — there is nothing to pick from a list of acronyms.',
  'import.group.migration.title': 'From another tracker',
  'import.group.migration.body':
    'An export out of the app you were keeping your money in before.',
  'import.group.empty':
    'Nothing here can be read yet. When a format lands it appears in this group on its own.',

  'import.upload.account.label': 'Import into',
  'import.upload.account.placeholder': 'Choose an account',
  'import.upload.file.label': 'The file',
  'import.upload.dropzone': 'Drop a file here to read it',
  'import.upload.choose': 'Choose a file',
  'import.upload.accepts': 'Accepted here: {extensions}. Up to {size}.',
  'import.upload.selected': 'Chosen: {name}',
  'import.upload.submit': 'Read this file',
  'import.upload.state.uploading': 'Sending {name}…',
  'import.upload.state.sniffing': 'Working out what the file is…',
  'import.upload.noAccounts':
    'Make an account first: a loaded entry has to land in one.',
  'import.upload.error.account': 'Choose the account these entries belong to.',
  'import.upload.error.file': 'Choose a file to import.',
  'import.upload.error.extension':
    '{name} does not end in a file type this import can read, so there is no parser for it.',
  'import.upload.error.tooLarge':
    '{name} is larger than {size}. Export a shorter period and bring it in as two files.',
  'import.upload.error.failed': 'The file was not read: {reason}',

  'import.history.title': 'Import history',
  'import.history.body':
    'Every file this household has brought in, newest first.',
  'import.history.empty.title': 'No imports yet',
  'import.history.empty.body':
    'A file you bring in stays here with what it did, so an import can be found again months later.',
  'import.history.table': 'Imports, newest first',
  'import.history.column.file': 'File',
  'import.history.column.status': 'Status',
  'import.history.column.rows': 'Rows',
  'import.history.column.created': 'Started',
  'import.history.open': 'Open the import of {name}',
  'import.history.rows': '{imported} of {total}',

  'import.source.csv': 'Spreadsheet or CSV',
  'import.source.ofx': 'OFX statement',
  'import.source.qif': 'QIF statement',
  'import.source.ynab': 'YNAB export',
  'import.source.wallet': 'Wallet export',
  'import.source.json_backup': 'Money Tracker backup',

  'import.status.queued': 'Waiting',
  'import.status.parsing': 'Reading',
  'import.status.mapping': 'Needs mapping',
  'import.status.previewing': 'Reviewed',
  'import.status.running': 'Importing',
  'import.status.completed': 'Imported',
  'import.status.failed': 'Failed',
  'import.status.reverted': 'Undone',

  'import.stepper.label': 'Import steps',
  'import.step.upload': 'Upload',
  'import.step.map': 'Map the columns',
  'import.step.review': 'Review',
  'import.step.done': 'Import',
  'import.step.position': 'Step {position} of {total}: {name}',
  'import.step.current': 'You are here',
  'import.step.back': 'Back: {name}',
  'import.step.next': 'Next: {name}',
  'import.step.locked': 'This step opens once the one before it is finished.',

  'import.file.title': 'The file',
  'import.file.rows': '{rows} rows were read from {name}.',
  'import.file.account': 'They would be imported into {account}.',
  'import.file.truncated':
    'Only the first {rows} rows were read — the file carries more than one import may take.',
  'import.warnings.title': 'Worth knowing about this file',
  'import.warning.ragged_row':
    'Some rows carry a different number of fields from the header row. Nothing was dropped.',
  'import.warning.re_encoded':
    'The file is not UTF-8 and was read through a fallback encoding, so check the accented characters below.',
  'import.warning.replacement_character':
    'Some characters could not be decoded, which usually means the encoding was guessed wrongly.',
  'import.warning.row_cap_reached':
    'The file has more rows than one import can carry, so the rest were not read.',

  'import.resume.pending': 'Reading the stored file again…',
  'import.resume.title': 'The stored file could not be read again',
  'import.resume.body':
    'This tab no longer holds the file’s columns, and reading the stored copy back did not work. Nothing was written, and the earlier upload is still in your history — upload the file again to map it.',
  'import.resume.action': 'Start over',

  'import.mapping.title': 'Map the columns',
  'import.mapping.body':
    'Say what each column of the file holds. The first three values are shown beside every column so the choice is made on the data rather than on a header name.',
  'import.mapping.table': 'The file’s columns and what each one holds',
  'import.mapping.column.header': 'Column',
  'import.mapping.column.samples': 'First values',
  'import.mapping.column.target': 'Holds',
  'import.mapping.column.empty': '(empty)',
  'import.mapping.target.label': 'What the column “{column}” holds',
  'import.mapping.target.ignore': 'Leave this column out',
  'import.mapping.target.date': 'Date',
  'import.mapping.target.amount': 'Amount, with its own sign',
  'import.mapping.target.debit': 'Money out',
  'import.mapping.target.credit': 'Money in',
  'import.mapping.target.description': 'Description',
  'import.mapping.target.payee': 'Payee',
  'import.mapping.target.category': 'Category',
  'import.mapping.target.reference': 'Reference',
  'import.mapping.target.notes': 'Notes',
  'import.mapping.target.currency': 'Currency',
  'import.mapping.target.sourceRef': 'The bank’s own row id',

  'import.mapping.preset.title': 'A mapping you saved has been filled in',
  'import.mapping.preset.body':
    'It was remembered for a file with exactly these columns. Check every row before continuing: a bank that reorders its columns keeps the same header names.',
  'import.mapping.preset.named': 'You called it “{label}”.',

  'import.mapping.numbers.title': 'How the numbers are written',
  'import.mapping.decimal.label': 'Decimal separator',
  'import.mapping.decimal.dot': 'Dot — 1234.56',
  'import.mapping.decimal.comma': 'Comma — 1234,56',
  'import.mapping.thousands.label': 'Thousands separator',
  'import.mapping.thousands.dot': 'Dot — 1.234,56',
  'import.mapping.thousands.comma': 'Comma — 1,234.56',
  'import.mapping.thousands.space': 'Space — 1 234,56',
  'import.mapping.thousands.none': 'None — 1234,56',
  'import.mapping.accounting.label': 'Money out is written in brackets',
  'import.mapping.accounting.description':
    'Some exports write money out as (45,00) rather than −45,00.',

  'import.mapping.date.label': 'Date format',
  'import.mapping.date.iso': 'Year first — 2026-04-03',
  'import.mapping.date.dmySlash': 'Day first — 03/04/2026',
  'import.mapping.date.mdySlash': 'Month first — 04/03/2026',
  'import.mapping.date.dmyDot': 'Day first — 03.04.2026',
  'import.mapping.date.ambiguous.title': 'Which way round are these dates?',
  'import.mapping.date.ambiguous.body':
    'Every sampled date can be read both ways — {sample} is one of them. The file does not say which it means, and a guess misdates up to twelve rows in every thirty-one without anybody noticing for months.',
  'import.mapping.date.ambiguous.legend': 'How this file writes its dates',
  'import.mapping.date.ambiguous.required':
    'Choose how this file writes its dates before continuing.',
  'import.mapping.date.unrecognised':
    'The values in “{column}” are not written in any date format this import reads. Re-export the file with a plain date column.',
  'import.mapping.date.checking': 'Reading the dates in this column…',

  'import.mapping.save.label': 'Call this mapping',
  'import.mapping.save.description':
    'The mapping is remembered for the next file with the same columns, and offered rather than applied. The name is what you call this bank.',
  'import.mapping.save.placeholder': 'My bank, everyday account',
  'import.mapping.problems': 'Before continuing',
  'import.mapping.error.account':
    'Choose the account these rows would be imported into.',
  'import.mapping.error.date': 'Point one column at the date.',
  'import.mapping.error.amount':
    'Point one column at the amount, or one at money out and one at money in.',
  'import.mapping.error.amountShapes':
    'Use either one signed amount column or a money-out and money-in pair, not both.',
  'import.mapping.error.creditMissing':
    'A money-out column needs a money-in column beside it.',
  'import.mapping.error.debitMissing':
    'A money-in column needs a money-out column beside it.',
  'import.mapping.error.separators':
    'The decimal and thousands separators have to be different characters.',
  'import.mapping.submit': 'Save the mapping and preview',
  'import.mapping.pending': 'Saving the mapping…',
  'import.mapping.failed': 'The mapping was not saved: {reason}',

  'import.preview.title': 'Review what this would do',
  'import.preview.body':
    'Nothing has been written. Every row below is an entry as it would be created, and the figures are the ones that would be stored.',
  'import.preview.pending': 'Working out what this file would do…',
  'import.preview.failed.title': 'The preview did not run',
  'import.preview.failed.body':
    'Nothing was written. Go back to the mapping, check the columns and try again.',
  'import.preview.retry': 'Try the preview again',

  'import.preview.summary.label': 'What this file would do',
  'import.preview.count.total': 'Rows read',
  'import.preview.count.toCreate': 'To create',
  'import.preview.count.duplicates': 'Duplicates skipped',
  'import.preview.count.invalid': 'Refused',
  'import.preview.count.flagged': 'Worth a look',
  'import.preview.count.amount': 'Change to the balance',

  'import.preview.filter.label': 'Show',
  'import.preview.filter.all': 'Every row',
  'import.preview.filter.create': 'Rows to create',
  'import.preview.filter.duplicate': 'Rows to skip',
  'import.preview.filter.flagged': 'Possible duplicates',

  'import.preview.table': 'The rows this file would create',
  'import.preview.column.date': 'Date',
  'import.preview.column.description': 'Description',
  'import.preview.column.amount': 'Amount',
  'import.preview.column.match': 'Match',
  'import.preview.column.decision': 'What happens',
  'import.preview.decision.label': 'What happens to {date}, {amount}',
  'import.preview.decision.create': 'Create it',
  'import.preview.decision.skip': 'Skip it',
  'import.preview.match.certain': 'Duplicate',
  'import.preview.match.probable': 'Possible duplicate',
  'import.preview.match.none': 'New',
  'import.preview.reason.source_ref':
    'The row id this file stamped is already on an entry in this account.',
  'import.preview.reason.exact_match':
    'Same day, same amount and the same description.',
  'import.preview.reason.amount_and_date':
    'Same amount within three days, but the day or the wording moved.',
  'import.preview.reason.within_file':
    'An earlier row of this same file says the same thing.',
  'import.preview.empty': 'No row matches this filter.',
  'import.preview.sourceRef.used':
    'This file stamps its own row ids, so duplicates were matched on those rather than guessed at.',
  'import.preview.quota':
    'Loading these rows would take you {excess} entries past your plan’s limit of {limit}.',
  'import.preview.decisions.note':
    'What you choose per row is held in this browser. Writing the rows arrives with the last step of this flow.',

  'import.preview.invalid.title': 'Rows that were refused',
  'import.preview.invalid.body':
    'These rows are not imported. The file’s own text is quoted so you can see what was there.',
  'import.preview.invalid.row': 'Row {row}',
  'import.preview.invalid.raw': 'The file says: {raw}',
  'import.preview.allInvalid.title': 'Not one row could be read',
  'import.preview.allInvalid.body':
    'All {count} rows were refused, which almost always means a column is pointed at the wrong field. The first three say why:',
  'import.preview.allInvalid.remap': 'Back to the mapping',
  'import.preview.allInvalid.restart': 'Start over with another file',

  'import.done.title': 'Import the rows',
  'import.done.body':
    'Nothing has been written yet. Writing a reviewed file into your spending is not available in this household yet, so the review above is safe to leave open or to come back to.',
  'import.done.back': 'Back to the review',
} as const satisfies MessageCatalogueSource

export default messages
