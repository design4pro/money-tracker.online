import { json } from "./api"
import type { Env } from "./env"

export async function health(env: Pick<Env, "DB" | "SOURCE_SHA">) {
  const sourceSha = env.SOURCE_SHA || null
  try {
    const result = await env.DB.prepare(
      `SELECT
        (SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name IN
          ('user', 'session', 'account', 'verification', 'rateLimit',
           'ledger_account', 'ledger_category', 'ledger_transaction',
           'ledger_mutation', 'entitlement', 'polar_event')) AS tables,
        (SELECT count(*) FROM pragma_table_info('user') WHERE name IN
          ('first_paid_at', 'first_transaction_at')) AS userColumns,
        (SELECT count(*) FROM pragma_table_info('entitlement') WHERE name IN
          ('refresh_failed_since', 'access_refresh_after')) AS entitlementColumns,
        (SELECT count(*) FROM pragma_table_info('ledger_mutation') WHERE name IN
          ('user_id', 'request_id', 'fingerprint', 'outcome')) AS mutationColumns,
        (SELECT count(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN
          ('record_first_paid', 'record_first_transaction')) AS milestoneTriggers`
    ).first<{
      tables: number
      userColumns: number
      entitlementColumns: number
      mutationColumns: number
      milestoneTriggers: number
    }>()
    const ok =
      result?.tables === 11 &&
      result.userColumns === 2 &&
      result.entitlementColumns === 2 &&
      result.mutationColumns === 4 &&
      result.milestoneTriggers === 2
    return json({ ok, sourceSha }, ok ? 200 : 503)
  } catch {
    return json({ ok: false, sourceSha }, 503)
  }
}
