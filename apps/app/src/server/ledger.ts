export interface Account {
  id: string
  name: string
  currency: string
}

export interface Category {
  id: string
  name: string
}

export interface Transaction {
  id: string
  account_id: string
  category_id: string | null
  currency: string
  amount_minor: number
  description: string
  booked_on: string
}

export interface Ledger {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  balances: { currency: string; amountMinor: string }[]
}

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

const currencies = new Set(Intl.supportedValuesOf("currency"))

export async function readLedger(
  db: D1Database,
  userId: string
): Promise<Ledger> {
  const [accounts, categories, transactions] = (await db.batch([
    db
      .prepare(
        "SELECT id, name, currency FROM ledger_account WHERE user_id = ? ORDER BY name, id"
      )
      .bind(userId),
    db
      .prepare(
        "SELECT id, name FROM ledger_category WHERE user_id = ? ORDER BY name, id"
      )
      .bind(userId),
    db
      .prepare(
        `
      SELECT id, account_id, category_id, currency, amount_minor, description, booked_on
      FROM ledger_transaction WHERE user_id = ? ORDER BY booked_on DESC, id
    `
      )
      .bind(userId),
  ])) as [D1Result<Account>, D1Result<Category>, D1Result<Transaction>]

  const totals = new Map(accounts.results.map(({ currency }) => [currency, 0n]))
  for (const { currency, amount_minor } of transactions.results) {
    totals.set(currency, (totals.get(currency) ?? 0n) + BigInt(amount_minor))
  }
  return {
    accounts: accounts.results,
    categories: categories.results,
    transactions: transactions.results,
    balances: [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({
        currency,
        amountMinor: amount.toString(),
      })),
  }
}

function required(value: unknown, label: string, max: number) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text || text.length > max)
    throw new RequestError(`Enter a valid ${label}.`)
  return text
}

function bookedOn(value: unknown) {
  const date = required(value, "date", 10)
  const utc = new Date(`${date}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(+utc) ||
    utc.toISOString().slice(0, 10) !== date
  )
    throw new RequestError("Enter a valid date.")
  return date
}

export async function writeLedger(
  db: D1Database,
  userId: string,
  body: Record<string, unknown>
) {
  const id = crypto.randomUUID()
  let statement: D1PreparedStatement
  switch (body.action) {
    case "add-account": {
      const currency = required(body.currency, "currency", 3).toUpperCase()
      if (!currencies.has(currency))
        throw new RequestError("Enter a supported ISO currency code.")
      statement = db
        .prepare(
          "INSERT INTO ledger_account(user_id, id, name, currency) VALUES (?, ?, ?, ?)"
        )
        .bind(userId, id, required(body.name, "account name", 80), currency)
      break
    }
    case "add-category":
      statement = db
        .prepare(
          "INSERT INTO ledger_category(user_id, id, name) VALUES (?, ?, ?)"
        )
        .bind(userId, id, required(body.name, "category name", 80))
      break
    case "add-transaction": {
      const amount = body.amountMinor
      if (
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount === 0
      ) {
        throw new RequestError("Enter a nonzero safe integer in minor units.")
      }
      const accountId = required(body.accountId, "account", 80)
      const categoryId =
        body.categoryId === "" || body.categoryId === undefined
          ? null
          : required(body.categoryId, "category", 80)
      statement = db
        .prepare(
          `
        INSERT INTO ledger_transaction(user_id, id, account_id, category_id, currency, amount_minor, description, booked_on)
        SELECT user_id, ?, id, ?, currency, ?, ?, ? FROM ledger_account
        WHERE user_id = ? AND id = ?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM ledger_category WHERE user_id = ? AND id = ?))
      `
        )
        .bind(
          id,
          categoryId,
          amount,
          required(body.description, "description", 160),
          bookedOn(body.bookedOn),
          userId,
          accountId,
          categoryId,
          userId,
          categoryId
        )
      break
    }
    case "delete-account":
      statement = db
        .prepare("DELETE FROM ledger_account WHERE user_id = ? AND id = ?")
        .bind(userId, required(body.id, "account", 80))
      break
    case "delete-category":
      statement = db
        .prepare("DELETE FROM ledger_category WHERE user_id = ? AND id = ?")
        .bind(userId, required(body.id, "category", 80))
      break
    case "delete-transaction":
      statement = db
        .prepare("DELETE FROM ledger_transaction WHERE user_id = ? AND id = ?")
        .bind(userId, required(body.id, "transaction", 80))
      break
    default:
      throw new RequestError("Unknown ledger action.")
  }

  try {
    const result = await statement.run()
    if (!result.meta.changes) throw new RequestError("Record not found.", 404)
  } catch (error) {
    if (
      error instanceof Error &&
      /(?:FOREIGN KEY|UNIQUE) constraint failed/.test(error.message)
    ) {
      throw new RequestError("This entry is in use or already exists.", 409)
    }
    throw error
  }
}
