/**
 * Where the suites point their browser.
 *
 * Its own port, and its own server: every browser suite starts by deleting the
 * database, and the database belongs to the origin. Sharing a port with the app
 * you actually read in would mean a test run wiping your library.
 */
export const APP = process.env.APP_URL ?? 'http://localhost:5175'
export const PORT = new URL(APP).port
