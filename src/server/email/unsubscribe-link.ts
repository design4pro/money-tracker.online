/**
 * The two unsubscribe URLs a notification email carries, and the RFC 8058 headers.
 *
 * The footer points at the confirmation page (`GET` changes nothing). The headers point at the
 * one-click endpoint. Both carry the same signed token; only the path differs.
 */

export interface NotificationUnsubscribeLinks {
  readonly pageHref: string
  readonly oneClickHref: string
}

function originOf(appUrl: string): string {
  return appUrl.replace(/\/+$/, '')
}

export function notificationUnsubscribeLinks(
  appUrl: string,
  token: string,
): NotificationUnsubscribeLinks {
  const origin = originOf(appUrl)
  const query = `t=${encodeURIComponent(token)}`
  return {
    pageHref: `${origin}/unsubscribe?${query}`,
    oneClickHref: `${origin}/api/unsubscribe?${query}`,
  }
}

/** Headers on every notification and digest email. Auth mail must not carry these (spec A4). */
export function listUnsubscribeHeaders(
  oneClickHref: string,
): Readonly<Record<string, string>> {
  return {
    'List-Unsubscribe': `<${oneClickHref}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
