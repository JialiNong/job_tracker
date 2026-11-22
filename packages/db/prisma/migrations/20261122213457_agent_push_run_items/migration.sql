-- AlterTable
ALTER TABLE "public"."agent_push_runs" ADD COLUMN     "items" JSONB NOT NULL DEFAULT '[]';
