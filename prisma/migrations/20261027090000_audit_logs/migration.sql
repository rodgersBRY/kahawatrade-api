-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "user_id" UUID,
    "actor_role" TEXT NOT NULL,
    "api_key_id" UUID,
    "impersonated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs"("organization_id", "entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- audit_logs RLS
-- Reads and inserts are scoped to the org. There are no UPDATE or DELETE
-- policies, so app users can't rewrite or remove history.
-- ------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT
  USING (organization_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT
  WITH CHECK (organization_id = current_setting('app.org_id', true)::uuid);

-- ------------------------------------------------------------
-- lots: finance may update lots so it can correct purchase price and
-- fees. The API limits finance to those pricing columns.
-- ------------------------------------------------------------
CREATE POLICY lots_update_finance ON lots
  FOR UPDATE
  USING (
    organization_id = current_setting('app.org_id', true)::uuid
    AND current_setting('app.user_role', true) = 'finance'
  );
