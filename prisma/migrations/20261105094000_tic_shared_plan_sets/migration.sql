CREATE TABLE IF NOT EXISTS "TicPlanSet" (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 count integer NOT NULL CHECK(count BETWEEN 1 AND 30000)
);
CREATE TABLE IF NOT EXISTS "TicPlanSetEntry" (
 "setId" text NOT NULL REFERENCES "TicPlanSet"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 29999),
 "planName" text NOT NULL,
 "planIdType" text NOT NULL CHECK("planIdType" IN ('ein','hios')),
 "planId" text NOT NULL CHECK(length("planId") > 0),
 "planMarketType" text NOT NULL,
 PRIMARY KEY("setId",ordinal)
);
CREATE INDEX IF NOT EXISTS "TicPlanSetEntry_planIdType_planId_idx" ON "TicPlanSetEntry"("planIdType","planId");
CREATE TABLE IF NOT EXISTS "TicFilePlanSet" (
 "fileId" text PRIMARY KEY REFERENCES "TicFile"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "setId" text NOT NULL REFERENCES "TicPlanSet"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TicFilePlanSet_setId_idx" ON "TicFilePlanSet"("setId");
