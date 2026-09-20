/**
 * What a notification row's `params` column holds, as a type.
 *
 * It lives in `lib` rather than beside the function that builds it (`src/server/notify/copy.ts`,
 * which re-exports it so `21-S1`'s surface is unchanged) because **both ends need it**: the server
 * writes the bag, and the two readers — `21-S2`'s email templates and `21-S3`'s in-app item —
 * render it. A reader that had to reach into `server/` for the shape would either drag server code
 * into the browser bundle or keep a second copy of the definition that drifts from the first.
 */

/**
 * An amount on its way to a placeholder: still an integer, still carrying its own scale.
 *
 * The currency travels with the number because `currencies.digits` is what turns one into the
 * other, and it is not always 2 (`docs/MONEY.md` §1.2). A bare `spentMinor` would be a number the
 * reader cannot render without guessing.
 */
export interface MoneyParam {
  readonly minor: number
  readonly currencyCode: string
}

/** A string is a name or an ISO date; a number is a count or a percentage; money is money. */
export type CopyParam = string | number | MoneyParam
