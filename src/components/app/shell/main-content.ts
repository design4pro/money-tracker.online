/**
 * The id the skip link jumps to, and the one `<main>` on every page.
 *
 * It lives in its own module because both ends need it and neither may import the other: the skip
 * link is rendered by the document shell in `src/routes/__root.tsx` (which re-exports this constant
 * so page modules keep importing it from there), and the landmark is rendered by whichever layout
 * is on screen — the marketing page, the auth group, or the guarded shell. A constant shared
 * through the route module would pull the whole app shell into the marketing bundle.
 *
 * There is exactly one element with this id per document. Two would make the skip link ambiguous,
 * and `document.getElementById` would silently pick the first.
 */
export const MAIN_CONTENT_ID = 'main-content'
