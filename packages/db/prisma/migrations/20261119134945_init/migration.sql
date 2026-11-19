-- CreateEnum
CREATE TYPE "public"."ApplicationStatus" AS ENUM ('pending', 'applied', 'screening', 'interview', 'interview_cancelled', 'offer', 'rejected', 'unsuitable', 'closed', 'closed_no_reply', 'prev_rejected', 'too_many_questions', 'repost', 'duplicate');

-- CreateEnum
CREATE TYPE "public"."TimelineStep" AS ENUM ('applied', 'reapplied', 'screening', 'screening_done', 'interview_invite', 'interview_1', 'interview_2', 'interview_3', 'interview_final', 'interview_cancelled', 'rejected', 'offer');

-- CreateEnum
CREATE TYPE "public"."Origin" AS ENUM ('pipeline', 'api', 'manual', 'agent');

-- CreateEnum
CREATE TYPE "public"."AnalysisState" AS ENUM ('none', 'pending', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" CHAR(24) NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '',
    "external_url" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "applicants" TEXT NOT NULL DEFAULT '',
    "posting_key" TEXT,
    "dedup_key" TEXT,
    "ats_provider" TEXT,
    "ats_slug" TEXT,
    "remote" BOOLEAN,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "job_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keyword" TEXT,
    "run_id" TEXT,
    "manual_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description_quality" TEXT,
    "description_quality_reason" TEXT,
    "description_empty" BOOLEAN NOT NULL DEFAULT false,
    "description_incomplete" BOOLEAN NOT NULL DEFAULT false,
    "description_cleared_at" TIMESTAMPTZ(3),
    "needs_refetch" BOOLEAN NOT NULL DEFAULT false,
    "details_fetched_at" TIMESTAMPTZ(3),
    "link_replaced_at" TIMESTAMPTZ(3),
    "posted_at" TIMESTAMPTZ(3),
    "scraped_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "analysis_state" "public"."AnalysisState" NOT NULL DEFAULT 'none',
    "analysis_started_at" TIMESTAMPTZ(3),
    "current_analysis_id" BIGINT,
    "user_status" TEXT,
    "agent_recommended_by" TEXT,
    "agent_recommended_at" TIMESTAMPTZ(3),
    "agent_recommend_reason" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_analyses" (
    "id" BIGSERIAL NOT NULL,
    "job_id" CHAR(24) NOT NULL,
    "analyzed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "match_score" REAL,
    "match_gate" TEXT,
    "recommendation" TEXT,
    "summary" TEXT,
    "disqualification_reason" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "company_key" TEXT,

    CONSTRAINT "job_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."applications" (
    "id" CHAR(24) NOT NULL,
    "job_id" CHAR(24) NOT NULL,
    "status" "public"."ApplicationStatus" NOT NULL DEFAULT 'pending',
    "origin" "public"."Origin" NOT NULL DEFAULT 'pipeline',
    "applied_at" TIMESTAMPTZ(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "application_qa" JSONB NOT NULL DEFAULT '[]',
    "applicant_position" INTEGER,
    "country" TEXT,
    "recommended_by" TEXT,
    "recommend_reason" TEXT,
    "manually_logged" BOOLEAN NOT NULL DEFAULT false,
    "manually_applied" BOOLEAN NOT NULL DEFAULT false,
    "from_unmatched" BOOLEAN NOT NULL DEFAULT false,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."application_events" (
    "id" BIGSERIAL NOT NULL,
    "application_id" CHAR(24) NOT NULL,
    "step" "public"."TimelineStep" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scrape_timeouts" (
    "id" CHAR(24) NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "keyword" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'detail_timeout',
    "review_status" TEXT NOT NULL DEFAULT 'open',
    "timeout_count" INTEGER NOT NULL DEFAULT 1,
    "added_to_tracker_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scrape_timeouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scraper_daily_stats" (
    "day" DATE NOT NULL,
    "title_passed_clicked" INTEGER NOT NULL DEFAULT 0,
    "german_filtered" INTEGER NOT NULL DEFAULT 0,
    "ai_title_filtered" INTEGER NOT NULL DEFAULT 0,
    "detail_timeout" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scraper_daily_stats_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "public"."scraper_totals" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "title_passed_clicked" INTEGER NOT NULL DEFAULT 0,
    "german_filtered" INTEGER NOT NULL DEFAULT 0,
    "ai_title_filtered" INTEGER NOT NULL DEFAULT 0,
    "detail_timeout" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scraper_totals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_profiles" (
    "key" TEXT NOT NULL,
    "business" TEXT NOT NULL DEFAULT '',
    "product_type" TEXT NOT NULL DEFAULT '',
    "vertical" TEXT NOT NULL DEFAULT '',
    "markets" TEXT NOT NULL DEFAULT '',
    "markets_detail" TEXT NOT NULL DEFAULT '',
    "is_recruiter_for_other_company" BOOLEAN NOT NULL DEFAULT false,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "usage" JSONB,
    "cached_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."stats_cache" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stats_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_posting_key_key" ON "public"."jobs"("posting_key");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_current_analysis_id_key" ON "public"."jobs"("current_analysis_id");

-- CreateIndex
CREATE INDEX "jobs_analysis_state_idx" ON "public"."jobs"("analysis_state");

-- CreateIndex
CREATE INDEX "jobs_dedup_key_idx" ON "public"."jobs"("dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_source_external_id_key" ON "public"."jobs"("source", "external_id");

-- CreateIndex
CREATE INDEX "job_analyses_job_id_analyzed_at_idx" ON "public"."job_analyses"("job_id", "analyzed_at" DESC);

-- CreateIndex
CREATE INDEX "job_analyses_match_score_idx" ON "public"."job_analyses"("match_score");

-- CreateIndex
CREATE INDEX "job_analyses_analyzed_at_idx" ON "public"."job_analyses"("analyzed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "applications_job_id_key" ON "public"."applications"("job_id");

-- CreateIndex
CREATE INDEX "applications_status_applied_at_idx" ON "public"."applications"("status", "applied_at" DESC);

-- CreateIndex
CREATE INDEX "applications_added_at_idx" ON "public"."applications"("added_at" DESC);

-- CreateIndex
CREATE INDEX "application_events_application_id_at_idx" ON "public"."application_events"("application_id", "at");

-- CreateIndex
CREATE INDEX "application_events_step_at_idx" ON "public"."application_events"("step", "at");

-- CreateIndex
CREATE INDEX "scrape_timeouts_review_status_idx" ON "public"."scrape_timeouts"("review_status");

-- CreateIndex
CREATE UNIQUE INDEX "scrape_timeouts_source_external_id_key" ON "public"."scrape_timeouts"("source", "external_id");

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_current_analysis_id_fkey" FOREIGN KEY ("current_analysis_id") REFERENCES "public"."job_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_analyses" ADD CONSTRAINT "job_analyses_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_analyses" ADD CONSTRAINT "job_analyses_company_key_fkey" FOREIGN KEY ("company_key") REFERENCES "public"."company_profiles"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."application_events" ADD CONSTRAINT "application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
