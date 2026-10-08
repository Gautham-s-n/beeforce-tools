/* config.js — everything you may want to change lives here.
 * Plain script body, run as new Function('ctx', <this file>). */

ctx.CONFIG = {
  VERSION: '3.3.0',

  ENVIRONMENTS: {
    production: { label: 'Production', url: 'https://app.beeforce.in' },
    uat:        { label: 'UAT',        url: 'https://app-uat.beeforce.in' }
  },

  // OAuth client id used to get a Beeforce token (not a secret). The client SECRET is entered once per browser
  // on the setup screen and kept in that browser only (see core/secrets.js).
  OAUTH_CLIENT_ID: 'admin-client',

  // Admin console login: fixed username + a password that opens only the Settings screens (no Beeforce sign-in).
  // First time: sign in with this username and any password → "Create admin password" → paste the generated line
  // here (replacing this one) and commit. Change it later in Admin Settings → Admin login. Only a hash is stored.
  ADMIN_LOGIN: { username: 'bft.admin', salt: '9c9c4b16d4fc79a6084f1749a6500eb4', hash: 'e53a4a80ca2a701175c84012e1d841a5a6f63865313477016cab91e3a377cf37', iterations: 210000 },

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
