// Deliberately no imports of anything under src/ in this file. ES module
// import statements are hoisted and their target modules fully evaluate
// before any of this file's own top-level code runs - so if this file
// imported anything that transitively pulls in src/config/env.ts, THAT
// module's own bare `dotenv.config()` call would load the real project
// .env (real DATABASE_URL, real SUPER_ADMIN_BOOTSTRAP_EMAIL/PASSWORD, ...)
// before any override below took effect. Keeping src/ out of this file's
// import graph means these process.env assignments are the first thing
// that happens, full stop - vitest's setupFiles run in array order, so
// this file is listed first in vitest.config.ts and test/setup.ts (which
// does import src modules) runs only after this one has completed.
import { existsSync } from "node:fs";
import dotenv from "dotenv";

if (existsSync(".env.test.local")) {
  dotenv.config({ path: ".env.test.local", override: true });
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5434/kahawatrade_test";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.DB_SSL_MODE = "disable";

// Fixed, test-only values - never sourced from the ambient environment or
// a real .env - so a real secret can never end up in a test run.
process.env.JWT_ACCESS_SECRET = "test-access-secret-32-characters-min";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-characters-min";
process.env.SUPER_ADMIN_JWT_SECRET = "test-super-admin-secret-32-characters-min";
process.env.DATA_ENCRYPTION_KEY = "QOXS0h7/79Gmiz/UMpcaHE0LrfwcCWLdBsx8WuUDLiw=";
process.env.CSRF_SECRET = "test-csrf-secret-32-characters-minimum";
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
process.env.RATE_LIMIT_MAX = "100000";
process.env.AUTH_RATE_LIMIT_MAX = "100000";
process.env.NOTIFICATIONS_CRON_ENABLED = "false";
// Prevent dotenv from enabling the real email provider during integration tests.
process.env.EMAILJS_SERVICE_ID = "";
process.env.EMAILJS_TEMPLATE_ID = "";
process.env.EMAILJS_PUBLIC_KEY = "";
process.env.EMAILJS_PRIVATE_KEY = "";
process.env.NOTIFICATION_ADMIN_EMAILS = "";
process.env.CRON_SECRET = "";
process.env.IDEMPOTENCY_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL = "super-admin@test.kahawatrade.local";
process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD = "Sup3rSecureAdminPassw0rd!";

// Hard guard: refuse to run against anything that isn't obviously a test
// database. This is what should have caught the DATABASE_URL mixup during
// development - keep it as defense in depth.
const dbName = new URL(process.env.DATABASE_URL).pathname.replace("/", "");
if (!dbName.includes("test")) {
  throw new Error(
    `Refusing to run tests against database "${dbName}" - DATABASE_URL must point ` +
      `at a database with "test" in its name. Got: ${process.env.DATABASE_URL}`,
  );
}
