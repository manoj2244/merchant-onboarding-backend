import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema, written by hand and kept in sync with the entities
 * (verified with `npm run typeorm -- schema:log`, which must report no changes).
 *
 * Notable invariants enforced by the database rather than only by application code:
 *  - uq_risk_assessments_application_submission: one risk assessment per submission (idempotency).
 *  - CHECK constraints on monetary amounts.
 *  - ON DELETE RESTRICT everywhere: onboarding records and their history are never cascaded away.
 *  - trg_audit_logs_append_only: audit rows cannot be updated or deleted.
 */
export class InitialSchema1793836800000 implements MigrationInterface {
  name = 'InitialSchema1793836800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Enum types ---
    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('ADMIN', 'REVIEWER', 'SALES')`);
    await queryRunner.query(
      `CREATE TYPE "business_type" AS ENUM ('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LLC', 'CORPORATION', 'NON_PROFIT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "application_status" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "application_risk_status" AS ENUM ('NOT_STARTED', 'PENDING', 'PROCESSING', 'CLEAR', 'FLAGGED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "risk_assessment_status" AS ENUM ('PENDING', 'PROCESSING', 'CLEAR', 'FLAGGED', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH')`);
    await queryRunner.query(`CREATE TYPE "review_decision_type" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_INFO')`);

    // --- users ---
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "email"         character varying(255) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "full_name"     character varying(200) NOT NULL,
        "role"          "user_role" NOT NULL,
        "is_active"     boolean NOT NULL DEFAULT true,
        "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )`);

    // --- merchant_applications ---
    await queryRunner.query(`
      CREATE TABLE "merchant_applications" (
        "id"                       uuid NOT NULL DEFAULT gen_random_uuid(),
        "business_name"            character varying(200) NOT NULL,
        "legal_business_name"      character varying(200) NOT NULL,
        "business_type"            "business_type" NOT NULL,
        "website"                  character varying(255),
        "owner_full_name"          character varying(200) NOT NULL,
        "owner_email"              character varying(255) NOT NULL,
        "owner_phone"              character varying(32) NOT NULL,
        "owner_tax_id"             character varying(64) NOT NULL,
        "requested_monthly_volume" numeric(14,2) NOT NULL,
        "average_ticket_size"      numeric(12,2) NOT NULL,
        "mcc"                      character(4) NOT NULL,
        "currency"                 character(3) NOT NULL,
        "status"                   "application_status" NOT NULL DEFAULT 'DRAFT',
        "risk_status"              "application_risk_status" NOT NULL DEFAULT 'NOT_STARTED',
        "submission_count"         integer NOT NULL DEFAULT 0,
        "created_by_id"            uuid NOT NULL,
        "assigned_reviewer_id"     uuid,
        "created_at"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_merchant_applications" PRIMARY KEY ("id"),
        CONSTRAINT "chk_merchant_applications_monthly_volume_positive" CHECK ("requested_monthly_volume" > 0),
        CONSTRAINT "chk_merchant_applications_avg_ticket_positive" CHECK ("average_ticket_size" > 0),
        CONSTRAINT "chk_merchant_applications_submission_count" CHECK ("submission_count" >= 0),
        CONSTRAINT "fk_merchant_applications_created_by" FOREIGN KEY ("created_by_id")
          REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "fk_merchant_applications_assigned_reviewer" FOREIGN KEY ("assigned_reviewer_id")
          REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(`CREATE INDEX "idx_merchant_applications_status" ON "merchant_applications" ("status")`);
    // Composite indexes back the scoped list queries: SALES (own) and REVIEWER (assigned), filtered by status.
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_created_by_status" ON "merchant_applications" ("created_by_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_reviewer_status" ON "merchant_applications" ("assigned_reviewer_id", "status")`,
    );

    // --- risk_assessments ---
    await queryRunner.query(`
      CREATE TABLE "risk_assessments" (
        "id"                 uuid NOT NULL DEFAULT gen_random_uuid(),
        "application_id"     uuid NOT NULL,
        "submission_number"  integer NOT NULL,
        "status"             "risk_assessment_status" NOT NULL DEFAULT 'PENDING',
        "score"              integer,
        "risk_level"         "risk_level",
        "reasons"            jsonb NOT NULL DEFAULT '[]'::jsonb,
        "provider_reference" character varying(100),
        "attempts"           integer NOT NULL DEFAULT 0,
        "last_error"         character varying(500),
        "completed_at"       TIMESTAMP WITH TIME ZONE,
        "created_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_risk_assessments" PRIMARY KEY ("id"),
        CONSTRAINT "uq_risk_assessments_application_submission" UNIQUE ("application_id", "submission_number"),
        CONSTRAINT "fk_risk_assessments_application" FOREIGN KEY ("application_id")
          REFERENCES "merchant_applications"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(`CREATE INDEX "idx_risk_assessments_status" ON "risk_assessments" ("status")`);

    // --- review_decisions ---
    await queryRunner.query(`
      CREATE TABLE "review_decisions" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "application_id" uuid NOT NULL,
        "reviewer_id"    uuid NOT NULL,
        "decision"       "review_decision_type" NOT NULL,
        "comment"        text,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_review_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_review_decisions_application" FOREIGN KEY ("application_id")
          REFERENCES "merchant_applications"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "fk_review_decisions_reviewer" FOREIGN KEY ("reviewer_id")
          REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_review_decisions_application" ON "review_decisions" ("application_id", "created_at")`,
    );

    // --- audit_logs ---
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "actor_id"    uuid,
        "action"      character varying(64) NOT NULL,
        "entity_type" character varying(64) NOT NULL,
        "entity_id"   uuid NOT NULL,
        "metadata"    jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_audit_logs_actor" FOREIGN KEY ("actor_id")
          REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" ("actor_id", "created_at")`);

    // Append-only audit trail: reject row-level UPDATE/DELETE. (TRUNCATE, used only by the test
    // suite against its own database, is a table-level operation and is not affected.)
    await queryRunner.query(`
      CREATE FUNCTION "audit_logs_prevent_mutation"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "audit_logs_prevent_mutation"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_audit_logs_append_only" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION "audit_logs_prevent_mutation"()`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "review_decisions"`);
    await queryRunner.query(`DROP TABLE "risk_assessments"`);
    await queryRunner.query(`DROP TABLE "merchant_applications"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "review_decision_type"`);
    await queryRunner.query(`DROP TYPE "risk_level"`);
    await queryRunner.query(`DROP TYPE "risk_assessment_status"`);
    await queryRunner.query(`DROP TYPE "application_risk_status"`);
    await queryRunner.query(`DROP TYPE "application_status"`);
    await queryRunner.query(`DROP TYPE "business_type"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
  }
}
