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
 */
const messages = {
  /* -- The document itself ------------------------------------------------ */
  // `<title>` and the description meta. They are catalogue keys rather than
  // constants because the negotiated locale decides them: a Polish reader whose
  // page is Polish must not be handed an English tab, an English share card or
  // an English search result.
  'meta.title': 'Money Tracker — know where your money goes',
  'meta.description':
    'A personal finance tracker for accounts, transactions, budgets, recurring bills and multi-currency reporting. Manual entry and file import only — no bank connectors, ever.',

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
  'app.workspace.label': 'Workspace',
  'app.workspace.switch': 'Switch workspace',
  'app.workspace.create': 'New workspace',
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
    'Delete {name}? Its transactions are deleted with it and this cannot be undone.',
  'accounts.field.name': 'Account name',
  'accounts.field.category': 'Kind of account',
  'accounts.field.currency': 'Currency',
  'accounts.field.initialBalance': 'Opening balance',
  'accounts.field.initialBalance.help':
    'What the account held on the day before your first transaction.',
  'accounts.field.creditLimit': 'Credit limit',
  'accounts.field.note': 'Note',
  'accounts.field.excludeFromStats': 'Leave out of reports',
  'accounts.field.excludeFromStats.help':
    'The account still works normally; it just does not count towards totals or charts.',
  'accounts.category.general': 'General',
  'accounts.category.cash': 'Cash',
  'accounts.category.current': 'Current account',
  'accounts.category.creditCard': 'Credit card',
  'accounts.category.savings': 'Savings',
  'accounts.category.investment': 'Investments',
  'accounts.category.loan': 'Loan',
  'accounts.category.other': 'Other',
  'accounts.balance': 'Balance',
  'accounts.balance.available': 'Available',
  'accounts.balance.adjust': 'Correct the balance',
  'accounts.balance.adjust.help':
    'A correction is recorded as its own transaction, so the history stays honest.',
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
    'Add the first account you want to track — a current account, a wallet, a card.',
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
  'accounts.status.excluded': 'Outside reports',
  'accounts.list.label': 'Your accounts',
  'accounts.list.loading': 'Loading your accounts…',
  'accounts.error.title': 'The accounts did not load',
  'accounts.error.body':
    'Nothing was changed. Try again — and if it keeps failing, the workspace is briefly unreachable.',
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
    one: '{count} transaction on this account',
    other: '{count} transactions on this account',
  },
  'accounts.detail.note.empty': 'No note on this account yet.',
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
    'It leaves your totals and the pickers and keeps every transaction. You can restore it whenever you like.',
  'accounts.archive.action': 'Archive account',
  'accounts.restore.action': 'Restore account',
  'accounts.delete.title': 'Delete {name}?',
  'accounts.delete.action': 'Delete permanently',
  'accounts.delete.blocked': {
    one: 'There is {count} transaction on this account, so it cannot be deleted. Archive it instead and the history stays.',
    other:
      'There are {count} transactions on this account, so it cannot be deleted. Archive it instead and the history stays.',
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
    'Only the currencies your workspace holds are offered.',

  /* -- Accounts: correcting a balance ------------------------------------- */
  'accounts.adjust.body':
    'State what the balance should be. The difference is written as a transaction you can find, edit and export.',
  'accounts.adjust.field.target': 'What the balance should be',
  'accounts.adjust.field.date': 'As at the end of',
  'accounts.adjust.field.note': 'Reason',
  'accounts.adjust.field.note.help':
    'Kept on the transaction, so the reason survives with the correction.',
  'accounts.adjust.preview.title': 'What will be recorded',
  'accounts.adjust.preview.income': 'An income of {amount}, booked on {date}.',
  'accounts.adjust.preview.expense':
    'An expense of {amount}, booked on {date}.',
  'accounts.adjust.preview.none':
    'Nothing. The balance on {date} already reads {amount}.',
  'accounts.adjust.preview.past':
    'The difference is measured against the balance at the end of {date}, which is read as you save. You are shown exactly what was written.',
  'accounts.adjust.action': 'Record the correction',
  'accounts.adjust.result.title': 'Recorded',
  'accounts.adjust.result.income':
    'An income of {amount} was booked on {date}.',
  'accounts.adjust.result.expense':
    'An expense of {amount} was booked on {date}.',
  'accounts.adjust.result.unchanged':
    'Nothing was written — the balance on {date} already read {amount}.',
  'accounts.adjust.error.title': 'The correction was not recorded',

  /* -- Transactions ------------------------------------------------------- */
  'transactions.title': 'Transactions',
  'transactions.create': 'New transaction',
  'transactions.createIncome': 'Record income',
  'transactions.createExpense': 'Record an expense',
  'transactions.createTransfer': 'Record a transfer',
  'transactions.edit': 'Edit transaction',
  'transactions.delete.confirm':
    'Delete this transaction? This cannot be undone.',
  'transactions.direction.income': 'Income',
  'transactions.direction.expense': 'Expense',
  'transactions.field.amount': 'Amount',
  'transactions.field.date': 'Date',
  'transactions.field.account': 'Account',
  'transactions.field.category': 'Category',
  'transactions.field.payee': 'Payee',
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
  'transactions.splits.balanced': 'Every part of this transaction is assigned.',
  'transactions.refund.title': 'Refunds',
  'transactions.refund.link': 'Link a refund',
  'transactions.refund.unlink': 'Unlink refund',
  'transactions.refund.external': 'Refund of something outside Money Tracker',
  'transactions.attachment.add': 'Attach a receipt',
  'transactions.attachment.remove': 'Remove attachment',
  'transactions.search.placeholder': 'Search notes, payees and amounts',
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
    'Record your first transaction, or import a statement you already have.',
  'transactions.empty.action': 'Record a transaction',
  'transactions.noResults.title': 'No transactions match',
  'transactions.noResults.body': 'Try a wider date range or fewer filters.',

  /* -- Transactions: the ledger surface ----------------------------------- */
  'transactions.list.label': 'Transaction ledger',
  'transactions.list.caption.all': 'All {count} transactions, {sort}.',
  'transactions.list.caption.filtered':
    '{count} transactions matching {filters}, {sort}.',
  'transactions.list.caption.sort': 'sorted by {field}, {order}',
  'transactions.sort.label': 'Sort by',
  'transactions.sort.ascending': 'oldest first',
  'transactions.sort.descending': 'newest first',
  'transactions.column.description': 'Description',
  'transactions.column.actions': 'Actions',
  'transactions.day.net': 'Day total',
  'transactions.loading': 'Loading transactions…',
  'transactions.loadMore': 'Load more',
  'transactions.loadingMore': 'Loading more transactions…',
  'transactions.loadedOf': '{loaded} of {total} loaded',
  'transactions.selectAllLoaded': 'Select every loaded transaction',
  'transactions.excludedFromTotals': 'Outside totals',
  'transactions.amount.income': 'Income of {amount}',
  'transactions.amount.expense': 'Expense of {amount}',
  'transactions.row.select': 'Select the {amount} transaction of {date}',
  'transactions.row.actions': 'Actions for {name}',
  'transactions.row.open': 'Open',
  'transactions.totals.label': 'Totals for the filtered set',
  'transactions.totals.currency': 'Totals in {currency}',
  'transactions.bulk.label': 'Actions for the selected transactions',
  'transactions.bulk.delete': 'Delete selected',
  'transactions.bulk.confirm': {
    one: 'Delete {count} transaction? This cannot be undone.',
    other: 'Delete {count} transactions? This cannot be undone.',
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
  'transactions.keyboard.open': 'Open the transaction',
  'transactions.keyboard.select': 'Select the row',
  'transactions.keyboard.edit': 'Edit the transaction',
  'transactions.keyboard.duplicate': 'Copy into a new entry',
  'transactions.keyboard.remove': 'Delete the transaction',
  'transactions.keyboard.help': 'Show this list',

  /* -- Transactions: filters ---------------------------------------------- */
  'transactions.filter.description':
    'Narrow the ledger. Everything set here stays in the address, so the view can be shared.',
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
  'transactions.chip.payees': 'Payee: {value}',
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
    'Recorded in {currency} and converted to {base} at the rate for the booking date.',
  'transactions.form.error.title': 'The transaction was not saved',
  'transactions.form.error.amount': 'Enter an amount greater than zero.',
  'transactions.form.error.account': 'Choose the account this belongs to.',
  'transactions.form.error.date': 'Enter a date in the form {example}.',
  'transactions.form.error.note': 'Keep the note to {max} characters or fewer.',
  'transactions.form.noAccounts.title': 'An account comes first',
  'transactions.form.noAccounts.body':
    'A transaction has to belong to an account. Create one, then come back.',
  'transactions.form.noAccounts.action': 'Create an account',
  'transactions.saved': 'Transaction saved.',
  'transactions.deleted': 'Transaction deleted.',
  'transactions.deletedMany': {
    one: '{count} transaction deleted.',
    other: '{count} transactions deleted.',
  },
  'transactions.duplicated': 'Copied into a new entry. Nothing is saved yet.',

  /* -- Transactions: the detail screen ------------------------------------ */
  'transactions.detail.title': 'Transaction',
  'transactions.detail.back': 'Back to transactions',
  'transactions.detail.summary': 'Summary',
  'transactions.detail.recordedAt': 'Recorded {datetime}',
  'transactions.detail.rate': 'Converted at {rate}, the rate for {date}.',
  'transactions.detail.identityRate':
    'Recorded in the reporting currency, so no conversion was needed.',
  'transactions.detail.noTags': 'No tags on this transaction.',
  'transactions.detail.noAttachments': 'No receipt attached.',
  'transactions.detail.noRefunds': 'No refund linked.',
  'transactions.detail.notFound.title': 'That transaction is not here',
  'transactions.detail.notFound.body':
    'It may have been deleted, or the address may be wrong.',
  'transactions.planned.title': 'Planned transactions',
  'transactions.planned.subtitle':
    'Entries booked for a date that has not happened yet. They stay out of your balances until you confirm them.',
  'transactions.planned.empty.title': 'Nothing planned',
  'transactions.planned.empty.body':
    'Record a transaction with a future date and mark it planned to see it here.',
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
    'Which side of the ledger this category is offered on.',
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
    'A category is how a transaction answers "what was this for". Add the first one and the reports have something to group by.',
  'categories.archive.title': 'Archive {name}?',
  'categories.archive.body':
    'It stops being offered on new transactions, and anything already filed under it keeps its label. Subcategories are archived with it. You can restore it at any time.',
  'categories.delete.title': 'Delete {name}?',
  'categories.delete.body':
    'This cannot be undone. A category that has ever been used cannot be deleted — archive it instead.',
  'categories.delete.refused': 'That category cannot be deleted',
  'categories.delete.refused.body':
    'It is already on transactions, and deleting it would leave them without a label. Archive it instead: it disappears from the pickers and keeps its history.',
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
    'A payee turns "ZABKA NANO 4471" on a statement into a name you recognise. Add the first one, or let an import create them for you.',
  'payees.noMatches.title': 'Nothing matches that',
  'payees.noMatches.body': 'Try a shorter piece of the name.',
  'payees.defaultCategory.summary': 'Suggests {name}',
  'payees.detail.back': 'Back to payees',
  'payees.detail.noCategory': 'Suggests no category',
  'payees.detail.notFound.title': 'That payee is not here',
  'payees.detail.notFound.body':
    'It may have been deleted or merged into another one, or the address may be wrong.',
  'payees.field.name.help': 'The name you want to read in the ledger.',
  'payees.field.defaultCategory': 'Suggested category',
  'payees.field.defaultCategory.help':
    'What a new transaction with this payee is filed under.',
  'payees.field.mode': 'How firmly to apply it',
  'payees.field.logoDomain': 'Website',
  'payees.field.logoDomain.help':
    'A domain such as zabka.pl — not a full link.',
  'payees.mode.off': 'Suggest nothing',
  'payees.mode.off.help': 'This payee never touches the category field.',
  'payees.mode.hint': 'Pre-fill it',
  'payees.mode.hint.help':
    'New transactions start with the suggested category, and you can change it.',
  'payees.mode.enforce': 'Always use it',
  'payees.mode.enforce.help':
    'New transactions take the suggested category, and saving this re-files the ones already recorded under this payee.',
  'payees.form.create.body':
    'A name is all it needs. The suggestion settings can wait.',
  'payees.form.edit.body':
    'Renaming a payee renames it on every transaction it appears on.',
  'payees.form.error.title': 'The payee was not saved',
  'payees.aliases.title': 'Statement text',
  'payees.aliases.body':
    'The strings a bank uses for this payee. Each one is stored in its matched form — lower case, without accents, and with reference numbers stripped — because that is what an import actually compares.',
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
    'Strings an import must not turn into a payee — "CARD PAYMENT", "SEPA DD" and anything else your bank writes on every line.',
  'payees.ignored.add': 'Add text to ignore',
  'payees.ignored.remove': 'Stop ignoring {name}',
  'payees.ignored.empty': 'Nothing is being ignored.',
  'payees.ignored.failed': 'That text was not added',
  'payees.merge.action': 'Merge into another payee',
  'payees.merge.title': 'Merge {name}',
  'payees.merge.into': 'Keep this payee',
  'payees.merge.body':
    'Every transaction, alias and tag on {from} moves to {into}, and “{from}” is kept as statement text so future imports still match it. This cannot be undone.',
  'payees.merge.noTargets': 'There is no other payee to merge into.',
  'payees.merge.failed': 'The payees were not merged',
  'payees.delete.title': 'Delete {name}?',
  'payees.delete.body':
    'This cannot be undone. Transactions keep their amounts and dates and simply lose the payee’s name.',
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
    'Record a transaction, or pick a longer period.',
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
  'dashboard.recent.viewAll': 'All transactions',
  'dashboard.firstRun.title':
    'Welcome. Three steps and the numbers start working.',
  'dashboard.firstRun.body':
    'Nothing here is filled with sample figures. Everything you see will be yours.',
  'dashboard.firstRun.steps.label': 'Getting started',
  'dashboard.firstRun.step.account.title': 'Add an account',
  'dashboard.firstRun.step.account.body':
    'A current account, a wallet, a card — whatever you want to follow.',
  'dashboard.firstRun.step.transaction.title': 'Record a transaction',
  'dashboard.firstRun.step.transaction.body':
    'One is enough for the cash-flow chart to have something to draw.',
  'dashboard.firstRun.step.review.title': 'Come back here',
  'dashboard.firstRun.step.review.body':
    'The panels below fill in as soon as there is something to show.',

  /* -- Budgets (shared with the dashboard) -------------------------------- */
  'budgets.title': 'Budgets',
  'budgets.subtitle': 'What is left, envelope by envelope.',
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
    'Counts every transaction filed in the categories you choose, and their subcategories.',
  'budgets.kind.manual': 'Chosen by hand',
  'budgets.kind.manual.help':
    'Counts only the transactions you put in it yourself. For a trip, a renovation, a one-off.',

  'budgets.period.label': 'Billing period',
  'budgets.period.one_off': 'One-off',
  'budgets.period.monthly': 'Monthly',
  'budgets.period.quarterly': 'Quarterly',
  'budgets.period.yearly': 'Yearly',

  'budgets.rollover.label': 'What happens to what is left',
  'budgets.rollover.none': 'Start each period clean',
  'budgets.rollover.none.help':
    'Whatever is left, or overspent, is forgotten when the period rolls.',
  'budgets.rollover.carry_surplus': 'Carry the surplus forward',
  'budgets.rollover.carry_surplus.help':
    'Money left over is added to the next period. An overspend is absorbed, and the ledger says so.',
  'budgets.rollover.carry_all': 'Carry the whole balance forward',
  'budgets.rollover.carry_all.help':
    'The next period opens with what is left — or in the red, if you overspent.',

  'budgets.status.archived': 'Archived',
  'budgets.status.closed': 'Closed',
  'budgets.status.open': 'Open',
  'budgets.autoInclude': 'Counts new transactions automatically',
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
    'A budget is an envelope with a limit and a period. Follow a set of categories and it fills itself, or put transactions in by hand for a one-off.',
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

  'budgets.ledger.title': 'Rollover ledger',
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
    'This budget has one period so far, and it is still open. The ledger fills in as periods close.',

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
    'Every transaction filed in one of these, or in one of their subcategories, counts against the limit.',
  'budgets.allocation.manual':
    'This budget counts only the transactions you put in it by hand.',
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
  'empty.notFound.action': 'Back to the dashboard',
  'empty.forbidden.title': 'No access',
  'empty.forbidden.body': 'Ask a workspace owner to give you access to this.',
  'empty.offline.title': 'You are offline',
  'empty.offline.body':
    'What you record now is saved and sent when you are back.',

  /* -- Notifications ------------------------------------------------------ */
  'notifications.title': 'Notifications',
  'notifications.markAllRead': 'Mark everything as read',
  'notifications.empty.title': 'Nothing new',
  'notifications.empty.body':
    'Alerts about budgets, bills and shared workspaces land here.',
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
  'marketing.nav.features': 'Features',
  'marketing.nav.security': 'Security',
  'marketing.nav.signIn': 'Sign in',
  'marketing.nav.getStarted': 'Get started free',
  'marketing.hero.title':
    'One ledger for every account, in every currency you hold.',
  'marketing.hero.body':
    'Money Tracker records what you spend and what you owe from what you type or from a file you export yourself. No bank logins, no screen scraping, nobody else holding your credentials.',
  'marketing.hero.cta.primary': 'Start tracking free',
  'marketing.hero.cta.secondary': 'See what is included',
  'marketing.hero.note':
    'Free plan, no card. Export everything you enter, at any time.',
  'marketing.features.title': 'What is in the box',
  'marketing.feature.multiCurrency.title': 'Multi-currency that adds up',
  'marketing.feature.multiCurrency.body':
    'Amounts are stored as whole minor units at each currency’s own scale and converted at the rate of the day they were booked, so a March expense stays valued at March.',
  'marketing.feature.manual.title': 'Manual entry and file import',
  'marketing.feature.manual.body':
    'Record a transaction in seconds, or bring a CSV, OFX or QIF export across. Nothing here ever asks for a bank password.',
  'marketing.feature.budgets.title': 'Budgets that carry over',
  'marketing.feature.budgets.body':
    'Set a limit per category or per envelope, and decide what happens to a surplus when the period closes.',
  'marketing.feature.recurring.title': 'Bills before they land',
  'marketing.feature.recurring.body':
    'Subscriptions, instalments and salaries are kept as series, with a reminder ahead of each due date.',
  'marketing.feature.reports.title': 'Reports you can interrogate',
  'marketing.feature.reports.body':
    'Cash flow, net worth, spending by category and a pivot you arrange yourself — every figure drills through to the transactions behind it.',
  'marketing.feature.household.title': 'Shared with the household',
  'marketing.feature.household.body':
    'Invite the people you actually share money with and keep one set of figures instead of two spreadsheets.',
  'marketing.privacy.title': 'Your records stay yours',
  'marketing.privacy.body':
    'There are no bank connectors and there never will be. Everything in a workspace was put there by somebody in it, and the whole of it exports as JSON or CSV whenever you ask.',
  'marketing.cta.title': 'Start with this month',
  'marketing.cta.body':
    'Add one account, import a statement, and see where the money actually went.',
  'marketing.cta.action': 'Create a free workspace',
  'marketing.footer.legal': 'All rights reserved.',

  /* -- The authenticated shell -------------------------------------------- */
  'app.nav.more': 'More',
  'app.nav.moreLabel': 'More destinations',
  'app.nav.section.money': 'Money',
  'app.nav.section.plan': 'Planning',
  'app.nav.section.insight': 'Insight',
  'app.signedInAs': 'Signed in as {email}',
  'app.workspace.current': 'Current workspace',
  'app.workspace.role.owner': 'Owner',
  'app.workspace.role.admin': 'Admin',
  'app.workspace.role.member': 'Member',
  'app.shell.pending': 'Loading this page…',
  'app.shell.error.body':
    'This part of the app did not load. Everything around it still works.',

  /* -- Settings ----------------------------------------------------------- */
  'settings.subtitle':
    'How the product reads for you, and what this workspace holds. Each card says whose setting it is.',
  'settings.scope.you': 'Yours alone',
  'settings.scope.workspace': 'Shared with the workspace',
  'settings.appearance.description':
    'Light, dark, or whatever this device is set to. Kept on the device, so a phone and a laptop can differ.',
  'settings.language.description':
    'Every screen, label and date is written in this language. Choosing one reloads the page, because the server picks the words.',
  'settings.account.title': 'Your account',
  'settings.account.description': 'From the account you signed in with.',
  'settings.workspace.description':
    'The books everyone here shares. These two lists are what a transaction is filed against.',
  'settings.workspace.name': 'Workspace name',
  'settings.categories.description':
    'The two-level tree every transaction is filed under.',
  'settings.payees.description':
    'Who the money went to, and the names an import should fold into them.',

  /* -- The auth screens --------------------------------------------------- */
  'auth.aside.title': 'Every figure, down to the minor unit.',
  'auth.aside.body':
    'Amounts are held as whole minor units and converted at the rate of the day they were booked, so last March still adds up the way last March did.',
  'auth.aside.point.privacy':
    'No bank connectors. Nothing is read that you did not enter or import.',
  'auth.aside.point.currency':
    'Accounts in several currencies, reported against one base currency.',
  'auth.aside.point.export':
    'The whole workspace exports as CSV or JSON whenever you ask for it.',
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
  'recurring.due.on': 'Due {date}',
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
    'Pick the transaction that settled it. Nothing here creates a transaction — if the payment is not recorded yet, record it first.',
  'recurring.markPaid.field': 'The transaction that settled it',
  'recurring.markPaid.placeholder': 'Search your transactions',
  'recurring.markPaid.empty':
    'No transaction in this window matches. Record the payment first, then come back.',
  'recurring.markPaid.confirm': 'Link it',
  'recurring.markPaid.never':
    'Marking a period paid never creates a transaction.',

  /* -- Automation ----------------------------------------------------------- */
  'recurring.automation.label': 'Automation',
  'recurring.automation.none': 'Off — you record each one yourself',
  'recurring.automation.none.help':
    'The series reminds you and tracks what is outstanding. Nothing is written without you.',
  'recurring.automation.auto': 'Record it for me',
  'recurring.automation.auto.help':
    'On the due date, a transaction is written for the expected amount into the chosen account. You can edit it afterwards like any other.',
  'recurring.automation.match': 'Match what I record',
  'recurring.automation.match.help':
    'Nothing is written. A transaction you record that fits the rule below is linked to the period it settles.',
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
  'recurring.toast.unlinked': 'Transaction unlinked',

  /* -- Linked transactions --------------------------------------------------- */
  'recurring.links.title': 'Linked transactions',
  'recurring.links.caption':
    'What this series has adopted, and how each link came about.',
  'recurring.links.empty': 'Nothing linked yet.',
  'recurring.links.source.manual': 'You linked it',
  'recurring.links.source.rule': 'Matched a rule',
  'recurring.links.source.auto': 'Recorded automatically',
  'recurring.links.unlink': 'Unlink',
  'recurring.links.unlinked': 'Unlinked',

  /* -- Candidates ------------------------------------------------------------ */
  'recurring.candidates.title': 'Series we noticed',
  'recurring.candidates.subtitle':
    'Patterns in what you already recorded. Each one is a suggestion, not something we did.',
  'recurring.candidates.loading': 'Looking through your transactions…',
  'recurring.candidates.detect': 'Look again',
  'recurring.candidates.detecting': 'Looking…',
  'recurring.candidates.link': 'Series we noticed',
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
    one: 'From {count} transaction',
    other: 'From {count} transactions',
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
    'Setting it up creates the plan only. None of the transactions it was found from is changed.',
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
    'A goal is a target amount and, if you want one, a date. Progress comes from transactions you already recorded — nothing here creates money or moves it.',
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
    'Count a transaction towards this goal and its history appears here.',
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
    'A contribution points at a transaction you already recorded. Nothing new is created and no money moves.',
  'goals.contributions.column.date': 'Date',
  'goals.contributions.column.amount': 'Amount',
  'goals.contributions.column.detail': 'Transaction',
  'goals.contributions.column.actions': 'Actions',
  'goals.contributions.linkedOn': 'Counted on {date}',
  'goals.contributions.remove': 'Remove {amount} from this goal',
  'goals.contributions.add': 'Count a transaction',

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
  'goals.contribute.title': 'Count a transaction towards {name}',
  'goals.contribute.description':
    'Pick a transaction that already happened. It stays exactly as it is — this only records what it was for.',
  'goals.contribute.field': 'Transaction',
  'goals.contribute.field.help':
    'Only transactions in {currency} can be counted, because the goal is measured in {currency}.',
  'goals.contribute.option': '{date} · {amount}',
  'goals.contribute.empty':
    'No unlinked {currency} transaction is available to count. Record one first, or change the account this goal is held in.',
  'goals.contribute.submit': 'Count it',
  'goals.contribute.cancel': 'Cancel',
  'goals.contribute.error': 'The transaction could not be counted',
  'goals.contribute.error.currency':
    'That transaction is in {transaction} and this goal is in {goal}. Converting it would need a rate nobody chose, so it is refused rather than guessed.',
  'goals.contribute.error.direction':
    'This goal is funded by {expected} transactions, and that one is {received}. Counting it would reduce the progress instead of adding to it.',

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
    'The goal and its record of which transactions counted towards it are removed for good. The transactions themselves are untouched.',
  'goals.confirm.delete.action': 'Delete',
  'goals.confirm.remove.title': 'Remove this contribution?',
  'goals.confirm.remove.body':
    'The transaction stays exactly as it is. Only the note that it was for this goal is removed, and the progress drops by that amount.',
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
} as const satisfies MessageCatalogueSource

export default messages
