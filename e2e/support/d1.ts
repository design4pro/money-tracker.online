import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * A read-only window onto the local D1 the dev server is writing to.
 *
 * ## Why a suite that drives the UI still talks to the database
 *
 * Two assertions in this suite cannot be made from the screen alone.
 *
 * **The stored amount.** `docs/MONEY.md` says money never leaves integer minor units. A screen
 * that prints `1 234,56 zł` is consistent with `123456` stored and with `1234.56` stored — the
 * formatter would render the second one identically right up until it was summed. So the money
 * spec reads `amount_minor` back and asserts the integer, which is the only assertion that
 * discriminates between a correct write and the bug the whole money layer exists to prevent.
 *
 * **The provisioned workspace.** "Signing up provisions a workspace" is a claim about rows in
 * `member` and `organization_currencies`, and the shell renders a workspace name whether that
 * name came from a real membership or from the fallback in `src/routes/_app.tsx`. Counting the
 * rows is the honest check.
 *
 * Everything else in the suite goes through the product, as it should.
 *
 * `wrangler d1 execute --local` is the same door `scripts/seed/seed.mjs` uses, and it reads the
 * same `.wrangler` state the Vite dev server serves from, so what it sees is what the running
 * application sees.
 */

const DATABASE = process.env.E2E_D1_DATABASE ?? 'money-tracker-db'

/** One row, as wrangler hands it back: column name to JSON scalar. */
export type D1Row = Record<string, unknown>

/**
 * Failures that mean "somebody else had the local database open", never "the SQL is wrong".
 *
 * Every worker in this suite shells out to its own `wrangler d1 execute` while the dev server
 * holds the same SQLite file, and miniflare answers a colliding open with an opaque
 * `internal error; reference = …` rather than with `SQLITE_BUSY`. Left alone it lands as a red
 * money or provisioning assertion — a failure that names the wrong thing and does not reproduce.
 */
const CONTENTION =
  /internal error|SQLITE_BUSY|database is locked|Failed to parse body as JSON/i

/** Retrying is safe: every statement this suite writes is an idempotent `insert or ignore`. */
const ATTEMPTS = 3

async function execute(args: ReadonlyArray<string>): Promise<Array<D1Row>> {
  let lastFailure: Error | undefined
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await executeOnce(args)
    } catch (error) {
      lastFailure = error as Error
      if (!CONTENTION.test(lastFailure.message)) {
        throw lastFailure
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
  throw lastFailure ?? new Error('wrangler d1 execute failed')
}

async function executeOnce(args: ReadonlyArray<string>): Promise<Array<D1Row>> {
  let stdout: string
  try {
    ;({ stdout } = await run(
      'pnpm',
      [
        'exec',
        'wrangler',
        'd1',
        'execute',
        DATABASE,
        '--local',
        '--json',
        ...args,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    ))
  } catch (error) {
    // `execFile` rejects with a message that is only the command line; the SQLite complaint is on
    // the child's stderr. Dropping it turns a five-second fix into an afternoon.
    const failure = error as {
      message?: string
      stderr?: string
      stdout?: string
    }
    const detail = [failure.stderr, failure.stdout]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(
      detail
        ? `${failure.message ?? 'wrangler d1 execute failed'}\n${detail}`
        : String(failure.message ?? error),
    )
  }

  // Some wrangler versions print human lines before the JSON payload.
  const start = stdout.indexOf('[')
  if (start === -1) {
    throw new Error(`wrangler d1 execute returned no JSON:\n${stdout}`)
  }
  const parsed = JSON.parse(stdout.slice(start)) as Array<{
    results?: Array<D1Row>
  }>
  return parsed.flatMap((entry) => entry.results ?? [])
}

/** Runs one statement and returns its rows. */
export async function d1Query(sql: string): Promise<Array<D1Row>> {
  return execute(['--command', sql])
}

/** Runs a batch of statements, as one `--command` string. Returns the last statement's rows. */
export async function d1Exec(
  statements: ReadonlyArray<string>,
): Promise<Array<D1Row>> {
  return execute(['--command', statements.join(';\n')])
}

/** A SQL string literal with the quotes escaped. Test fixtures only — never a product path. */
export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** The workspace a signed-up account was provisioned into, or `null`. */
export async function organizationIdFor(email: string): Promise<string | null> {
  const rows = await d1Query(
    `select m.organization_id as org from user u join member m on m.user_id = u.id ` +
      `where u.email = ${sqlText(email)} order by m.created_at limit 1`,
  )
  const id = rows[0]?.org
  return typeof id === 'string' ? id : null
}

/** How many currencies a workspace holds, and how many of them are the base. */
export async function currencyCountsFor(
  organizationId: string,
): Promise<{ held: number; base: number }> {
  const rows = await d1Query(
    `select count(*) as held, sum(is_base) as base from organization_currencies ` +
      `where organization_id = ${sqlText(organizationId)}`,
  )
  return {
    held: Number(rows[0]?.held ?? 0),
    base: Number(rows[0]?.base ?? 0),
  }
}

/** The stored minor units, currency and reference amount of one transaction. */
export async function storedTransaction(id: string): Promise<D1Row | null> {
  const rows = await d1Query(
    `select amount_minor, currency_code, ref_amount_minor, ref_currency_code, rate_e10, ` +
      `booked_on, direction, note from transactions where id = ${sqlText(id)}`,
  )
  return rows[0] ?? null
}
