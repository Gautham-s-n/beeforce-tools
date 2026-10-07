/* config.js — everything you may want to change lives here.
 * Plain script body, run as new Function('ctx', <this file>). */

ctx.CONFIG = {
  VERSION: '3.0.0',

  ENVIRONMENTS: {
    production: { label: 'Production', url: 'https://app.beeforce.in' },
    uat:        { label: 'UAT',        url: 'https://app-uat.beeforce.in' }
  },

  // OAuth client id used to get a Beeforce token (not a secret). The client SECRET is entered once per browser
  // on the setup screen and kept in that browser only (see core/secrets.js).
  OAUTH_CLIENT_ID: 'admin-client',

  // Beeforce usernames that see the Settings area (layout, sign-in & audit setup, endpoints).
  // UI access only — not a security boundary. Never put passwords or secrets here.
  ADMIN_USERS: [
    'replace.with.beeforce.username'
  ],

  // Session length shown in the session ring (minutes).
  TOKEN_VALIDITY_MIN: 120,

  // The Google Chat audit webhook is entered per browser on the setup screen / Admin Settings (never stored here).

  // Libraries loaded on demand.
  LIBS: {
    XLSX: 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
    EXCELJS: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
  },

  // Font (falls back to the system font if the page blocks it).
  FONT_BASE: 'https://cdn.jsdelivr.net/npm/@fontsource/schibsted-grotesk@5/files/schibsted-grotesk-latin-'
};
