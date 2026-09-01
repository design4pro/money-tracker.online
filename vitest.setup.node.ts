/**
 * Setup for the `server` Vitest project (plain Node, no DOM).
 *
 * Server code runs on workerd, where the only host APIs available are the Web ones. Asserting
 * that up front turns "undefined is not a function" deep inside a handler into one clear failure
 * at boot, and pinning the timezone keeps every date assertion identical on a laptop and in CI —
 * which matters more here than in most projects, because balance history is bucketed by UTC day
 * and a test machine on CET would silently move every bucket boundary by an hour.
 */

process.env.TZ = 'UTC'

const REQUIRED_GLOBALS = [
  'crypto',
  'fetch',
  'Headers',
  'ReadableStream',
  'Request',
  'Response',
  'TextDecoder',
  'TextEncoder',
] as const

const missing = REQUIRED_GLOBALS.filter((name) => !(name in globalThis))
if (missing.length > 0) {
  throw new Error(
    `This Node build is missing Web APIs the Worker relies on: ${missing.join(', ')}.`,
  )
}
