-- Additive exact NPI serving; preserves all existing row generations.
CREATE TABLE IF NOT EXISTS "TicNpiIndex" (
   "fileId" text PRIMARY KEY REFERENCES "TicFile"(id) ON DELETE CASCADE ON UPDATE CASCADE,
   format text NOT NULL CHECK(format='npi-prefix-v1'),
   "sourceMembershipCount" integer NOT NULL CHECK("sourceMembershipCount" BETWEEN 1 AND 5000000),
   "membershipSha256" text NOT NULL CHECK("membershipSha256" ~ '^[a-f0-9]{64}$'),
   "npiCount" integer NOT NULL CHECK("npiCount" BETWEEN 1 AND 5000000),
   "npiSha256" text NOT NULL CHECK("npiSha256" ~ '^[a-f0-9]{64}$'),
   "bucketCount" integer NOT NULL CHECK("bucketCount" BETWEEN 1 AND 10000),
   "encodedBytes" integer NOT NULL CHECK("encodedBytes" BETWEEN 1 AND 32000000),
   "manifestSha256" text NOT NULL CHECK("manifestSha256" ~ '^[a-f0-9]{64}$'));

CREATE TABLE IF NOT EXISTS "TicNpiBucket" (
   "fileId" text NOT NULL REFERENCES "TicNpiIndex"("fileId") ON DELETE CASCADE ON UPDATE CASCADE,
   prefix text NOT NULL CHECK(prefix ~ '^[0-9]{4}$'),
   count integer NOT NULL CHECK(count BETWEEN 1 AND 1000000),
   "rawSha256" text NOT NULL CHECK("rawSha256" ~ '^[a-f0-9]{64}$'),
   "payloadSha256" text NOT NULL CHECK("payloadSha256" ~ '^[a-f0-9]{64}$'),
   payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 4100000),
   PRIMARY KEY("fileId",prefix));

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='affinity_refresh') THEN GRANT SELECT,INSERT,DELETE ON "TicNpiIndex","TicNpiBucket" TO affinity_refresh; END IF; END $$;
