import { d1Exec, sqlText } from './d1'

/**
 * The one fixture this suite cannot arrange through the product: a zero-decimal currency.
 *
 * `docs/MONEY.md` asks for a JPY case, because JPY is where a hard-coded scale of 100 shows
 * itself, and nothing else in this workspace can reveal it — PLN, EUR, USD and GBP all have two
 * decimal places. Reaching it through the screens is impossible today, in two separate ways:
 *
 * - A workspace holds `DEFAULT_WORKSPACE_CURRENCY_CODES` and there is **no server function that
 *   adds a currency to one**. `requireHeldCurrency` in `src/server/repos/accounts.ts` refuses an
 *   account in anything else, so the settings screen that would switch yen on does not exist yet.
 * - Even with the currency held, `/accounts` offers "the base currency plus every currency already
 *   in use" (`currencyOptions` in `src/routes/_app/accounts/index.tsx`), so yen cannot appear in
 *   the picker until an account already uses it.
 *
 * So the three rows a reader would create through screens that have not been built are written
 * straight to D1: the held currency, the workspace's own JPY→PLN rate, and the account. The
 * **transaction** — the thing the zero-decimal case is actually about — is then typed into the
 * real form and written by the real server function, which is where the scale is decided.
 *
 * `live_rate_update = 0` is what makes the rate row win. `flatRateFor` in
 * `src/server/repos/workspace-currencies.ts` consults a workspace rate only when the base currency
 * is marked as priced by the workspace and the quote is the workspace's base currency. Without it
 * the write would need a catalogue JPY rate, which the demo seed does not load, and the write
 * would be refused for want of a price rather than saved at the wrong scale — a green-looking
 * failure that proves nothing.
 *
 * Everything here lands in the e2e fixture workspace. The demo workspace is never written to, so
 * `scripts/seed/verify.mjs` still finds every counter it asserts.
 */

/** Fixed, so a re-run replaces the row rather than adding another one beside it. */
export const YEN_ACCOUNT_ID = 'e2e-jpy-account'

export const YEN_ACCOUNT_NAME = 'Yen wallet (e2e)'

/**
 * 1 JPY = 0.0271 PLN, as the integer rate × 10^10 the schema stores.
 *
 * A plausible figure rather than a round one, so a spec that accidentally asserted the identity
 * rate — or a converter that quietly skipped the conversion — fails instead of passing.
 */
export const YEN_RATE_E10 = 271_000_000

/**
 * Writes the currency, the rate and the account into one workspace.
 *
 * `insert or ignore` rather than `insert or replace`: a replace *deletes* the existing row first,
 * and by the second run the account has transactions pointing at it, so the delete is refused by
 * the foreign key. Every value here is a constant, so the second run has nothing to update.
 */
export async function installYenFixture(organizationId: string): Promise<void> {
  const id = sqlText(organizationId)
  const now = Date.now()

  await d1Exec([
    `insert or ignore into organization_currencies ` +
      `(organization_id, currency_code, is_base, live_rate_update, added_at) ` +
      `values (${id}, 'JPY', 0, 0, ${now})`,
    `insert or ignore into organization_exchange_rates ` +
      `(organization_id, base_code, quote_code, effective_from, effective_to, rate_e10, ` +
      `created_at, updated_at) ` +
      `values (${id}, 'JPY', 'PLN', '2000-01-01', null, ${YEN_RATE_E10}, ${now}, ${now})`,
    `insert or ignore into accounts ` +
      `(id, organization_id, name, category, currency_code, initial_balance_minor, ` +
      `ref_initial_balance_minor, current_balance_minor, ref_current_balance_minor, ` +
      `status, exclude_from_stats, position, created_at, updated_at) ` +
      `values (${sqlText(YEN_ACCOUNT_ID)}, ${id}, ${sqlText(YEN_ACCOUNT_NAME)}, 'cash', 'JPY', ` +
      `0, 0, 0, 0, 'active', 0, 90, ${now}, ${now})`,
  ])
}

/**
 * Deletes an account a test created in a fixture workspace, with every transaction written to it.
 *
 * ## Why each test cleans up rather than setup resetting the workspace
 *
 * `E2E Tenant A` lives for as long as the local database does (`support/session.ts`), and it is on
 * the free plan, which allows three accounts. The yen account above is one of them, and
 * `tenant-isolation.spec.ts` and `money.spec.ts` create one each, so a single run that leaves them
 * behind fills the quota: on the next run both create dialogs are refused and stay open - a failure
 * about a dialog that points at nothing broken (#228). CI seeds a fresh database every run, so
 * there it is a retry of either test that can hit the same wall. Archiving would not help: the quota
 * counts every row.
 *
 * Each test therefore removes what it named, which is the convention `support/session.ts` already
 * states for the fixture tenants. Resetting the workspaces in the setup project was the other
 * option; it would make setup do teardown's job and could not tell a leftover from a row a
 * parallel file is using.
 *
 * The account is found by its name, which carries the test's token, so the cleanup does not depend
 * on the test having got as far as reading the id out of the URL. The transactions go first because
 * `transactions.account_id` restricts the delete, and they are every transaction on the account
 * rather than the ones the test typed: a keyboard spec saving into the same workspace in parallel
 * may have landed one there. Everything else referencing either row cascades or sets null, the
 * balance rows included. A failure is reported rather than raised, so it never fails a test whose
 * body passed.
 */
export async function deleteAccountNamed(name: string): Promise<void> {
  const accounts = `select id from accounts where name = ${sqlText(name)}`
  try {
    await d1Exec([
      `delete from transactions where account_id in (${accounts})`,
      `delete from accounts where id in (${accounts})`,
    ])
  } catch (error) {
    console.warn(`account ${name} was not cleaned up`, error)
  }
}

/**
 * A recurring series with periods in the past, for the specs that settle one.
 *
 * ## Why it is written to D1 and why it is in yen
 *
 * Creating a series through the dialog would put a date picker and four selects between every
 * test and the thing it is about, and the periods' dates have to be exact: the picker looks a
 * fortnight either side of the due date, so two tests that share a window see each other's
 * payments. The series is therefore written straight to the fixture workspace, with the periods the
 * test names, and **in the yen account** that {@link installYenFixture} provides. That account is
 * the one every fixture workspace already has, so this adds nothing to the free plan's account
 * quota (#228) - and a zero-decimal currency is where a hard-coded scale of two shows itself, so
 * the amount that travels through the URL to the entry form is the strongest version of that
 * check.
 *
 * The series ends on the last date it is given (`end_date`): reading `/recurring` materialises every
 * period a schedule has up to the horizon, so an open-ended series would grow rows the test never
 * named and its locators would match them.
 *
 * A period's `period_start` is the first of its due month, as the materialiser writes it, so two
 * dates given to one series must fall in different months.
 *
 * Every test takes its own dates, at least a month from every other test's, and removes what it
 * made: see {@link deleteRecurringFixture}.
 */

export const RECURRING_FIXTURE_AMOUNT_MINOR = 1500

export interface RecurringFixture {
  readonly seriesId: string
  readonly seriesName: string
}

export async function installRecurringFixture(
  organizationId: string,
  token: string,
  periodStarts: ReadonlyArray<string>,
): Promise<RecurringFixture> {
  const org = sqlText(organizationId)
  const seriesId = `e2e-rec-${token}`
  const seriesName = `E2E rent ${token}`
  const now = Date.now()

  await d1Exec([
    // A payment left by an earlier, failed run would make the empty picker not empty.
    ...periodStarts.map(
      (day) =>
        `delete from transactions where account_id = ${sqlText(YEN_ACCOUNT_ID)} ` +
        `and booked_on = ${sqlText(day)}`,
    ),
    `insert into recurring_series ` +
      `(id, organization_id, name, kind, direction, expected_amount_minor, expected_currency_code, ` +
      `frequency, start_date, end_date, account_id, auto_record, notify_email, show_in_widget, is_active, ` +
      `created_at, updated_at) ` +
      `values (${sqlText(seriesId)}, ${org}, ${sqlText(seriesName)}, 'bill', 'expense', ` +
      `${RECURRING_FIXTURE_AMOUNT_MINOR}, 'JPY', 'annual', ${sqlText(periodStarts[0] ?? '')}, ${sqlText(periodStarts.at(-1) ?? '')}, ` +
      `${sqlText(YEN_ACCOUNT_ID)}, 0, 0, 1, 1, ${now}, ${now})`,
    ...periodStarts.map(
      (day) =>
        `insert into recurring_periods ` +
        `(organization_id, series_id, period_start, due_on, status, expected_amount_minor, ` +
        `expected_currency_code, created_at, updated_at) ` +
        `values (${org}, ${sqlText(seriesId)}, ${sqlText(`${day.slice(0, 8)}01`)}, ${sqlText(day)}, 'upcoming', ` +
        `${RECURRING_FIXTURE_AMOUNT_MINOR}, 'JPY', ${now}, ${now})`,
    ),
  ])

  return { seriesId, seriesName }
}

/**
 * Removes the series, its periods and links (they cascade), and the payments the test recorded.
 *
 * The payments are found by account and date rather than by id, because the one a test saves
 * through the entry form is created by the product and the test may have failed before reading its
 * id. A failure is reported rather than raised, so cleanup never fails a test whose body passed.
 */
export async function deleteRecurringFixture(
  fixture: RecurringFixture,
  periodStarts: ReadonlyArray<string>,
): Promise<void> {
  try {
    await d1Exec([
      `delete from recurring_series where id = ${sqlText(fixture.seriesId)}`,
      ...periodStarts.map(
        (day) =>
          `delete from transactions where account_id = ${sqlText(YEN_ACCOUNT_ID)} ` +
          `and booked_on = ${sqlText(day)}`,
      ),
    ])
  } catch (error) {
    console.warn(
      `recurring fixture ${fixture.seriesId} was not cleaned up`,
      error,
    )
  }
}
