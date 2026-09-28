import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { seedSuperAdmin } from "./routes/auth";
import { startAuditPurgeScheduler } from "./routes/admin/audit";
import { backfillMemberNameParts } from "./lib/member-name";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  seedIfEmpty();
  seedSuperAdmin().catch((err) => logger.error({ err }, "Failed to seed super admin"));
  backfillMemberNameParts()
    .then(count => { if (count) logger.info({ count }, "Split member names into first and last name"); })
    .catch((err) => logger.error({ err }, "Failed to backfill member first/last names"));
  startAuditPurgeScheduler(logger);
});
