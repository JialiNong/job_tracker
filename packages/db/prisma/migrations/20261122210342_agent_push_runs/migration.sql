-- CreateTable
CREATE TABLE "public"."agent_push_runs" (
    "id" BIGSERIAL NOT NULL,
    "agent" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received" INTEGER NOT NULL DEFAULT 0,
    "saved" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "needs_link_jobs" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "agent_push_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_push_runs_at_idx" ON "public"."agent_push_runs"("at");
