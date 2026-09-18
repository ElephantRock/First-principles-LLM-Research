-- Phase 1 web persistence baseline. PostgreSQL 18 supplies uuidv7().
CREATE TABLE "User" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "handle" TEXT NOT NULL UNIQUE,
  "displayName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Identity" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Identity_provider_providerUserId_key" UNIQUE ("provider", "providerUserId")
);
CREATE INDEX "Identity_userId_idx" ON "Identity"("userId");

CREATE TABLE "Session" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

CREATE TABLE "CourseVersion" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "courseId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "publishedAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseVersion_courseId_version_key" UNIQUE ("courseId", "version"),
  CONSTRAINT "CourseVersion_courseId_contentSha256_key" UNIQUE ("courseId", "contentSha256")
);

CREATE TABLE "UnitVersion" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "courseVersionId" UUID NOT NULL REFERENCES "CourseVersion"("id") ON DELETE RESTRICT,
  "unitId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnitVersion_courseVersionId_unitId_version_key" UNIQUE ("courseVersionId", "unitId", "version")
);
CREATE INDEX "UnitVersion_unitId_idx" ON "UnitVersion"("unitId");

CREATE TABLE "Enrollment" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "courseVersionId" UUID NOT NULL REFERENCES "CourseVersion"("id") ON DELETE RESTRICT,
  "track" TEXT NOT NULL,
  "currentUnitId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Enrollment_userId_courseVersionId_key" UNIQUE ("userId", "courseVersionId")
);

CREATE TABLE "LearnerUnitState" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "unitVersionId" UUID NOT NULL REFERENCES "UnitVersion"("id") ON DELETE RESTRICT,
  "state" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LearnerUnitState_userId_unitVersionId_key" UNIQUE ("userId", "unitVersionId")
);
CREATE INDEX "LearnerUnitState_userId_state_idx" ON "LearnerUnitState"("userId", "state");

CREATE TABLE "ComputeProfile" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "detectedGpu" TEXT,
  "vramGiB" DOUBLE PRECISION,
  "bf16Supported" BOOLEAN NOT NULL DEFAULT false,
  "cudaAvailable" BOOLEAN NOT NULL DEFAULT false,
  "selectedProfile" TEXT NOT NULL,
  "precision" TEXT NOT NULL,
  "gradScaler" BOOLEAN NOT NULL DEFAULT false,
  "evidenceJson" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ComputeProfile_userId_createdAt_idx" ON "ComputeProfile"("userId", "createdAt");

CREATE TABLE "EnvironmentReport" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "pythonVersion" TEXT,
  "pytorchVersion" TEXT,
  "operatingSystem" TEXT,
  "cudaVersion" TEXT,
  "gpuModel" TEXT,
  "totalVramBytes" BIGINT,
  "bf16Supported" BOOLEAN,
  "selectedProfile" TEXT,
  "fpllmVersion" TEXT,
  "repositoryCommit" TEXT,
  "reportJson" JSONB NOT NULL,
  "capturedAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EnvironmentReport_userId_capturedAt_idx" ON "EnvironmentReport"("userId", "capturedAt");

CREATE TABLE "GitHubInstallation" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "githubInstallationId" BIGINT NOT NULL UNIQUE,
  "accountLogin" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "suspendedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "Repository" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "githubInstallationDbId" UUID REFERENCES "GitHubInstallation"("id") ON DELETE SET NULL,
  "provider" TEXT NOT NULL DEFAULT 'github',
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "providerRepositoryId" BIGINT,
  "defaultBranch" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Repository_userId_provider_owner_name_key" UNIQUE ("userId", "provider", "owner", "name")
);
CREATE INDEX "Repository_githubInstallationDbId_idx" ON "Repository"("githubInstallationDbId");

CREATE TABLE "RepositoryBinding" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE CASCADE,
  "githubInstallationDbId" UUID NOT NULL REFERENCES "GitHubInstallation"("id") ON DELETE RESTRICT,
  "boundAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepositoryBinding_repositoryId_githubInstallationDbId_key" UNIQUE ("repositoryId", "githubInstallationDbId")
);

CREATE TABLE "Submission" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "repositoryId" UUID NOT NULL REFERENCES "Repository"("id") ON DELETE RESTRICT,
  "courseVersionId" UUID NOT NULL REFERENCES "CourseVersion"("id") ON DELETE RESTRICT,
  "labId" TEXT NOT NULL,
  "labVersion" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "commitSha" CHAR(40) NOT NULL,
  "state" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "Submission_userId_labId_createdAt_idx" ON "Submission"("userId", "labId", "createdAt");
CREATE INDEX "Submission_commitSha_idx" ON "Submission"("commitSha");

CREATE TABLE "TestRun" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "submissionId" UUID NOT NULL REFERENCES "Submission"("id") ON DELETE RESTRICT,
  "state" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "TestRun_submissionId_createdAt_idx" ON "TestRun"("submissionId", "createdAt");

CREATE TABLE "TestResult" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "testRunId" UUID NOT NULL REFERENCES "TestRun"("id") ON DELETE RESTRICT,
  "visibility" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "invariantId" TEXT,
  "passed" BOOLEAN NOT NULL,
  "summary" TEXT NOT NULL,
  "evidenceJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TestResult_testRunId_visibility_idx" ON "TestResult"("testRunId", "visibility");
CREATE INDEX "TestResult_invariantId_idx" ON "TestResult"("invariantId");

CREATE TABLE "Experiment" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "displayId" TEXT NOT NULL UNIQUE,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "submissionId" UUID NOT NULL REFERENCES "Submission"("id") ON DELETE RESTRICT,
  "experimentType" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "commitSha" CHAR(40) NOT NULL,
  "hypothesis" TEXT,
  "prediction" TEXT,
  "lockedAt" TIMESTAMPTZ(6),
  "conclusion" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Experiment_userId_experimentType_createdAt_idx" ON "Experiment"("userId", "experimentType", "createdAt");
CREATE INDEX "Experiment_commitSha_idx" ON "Experiment"("commitSha");

CREATE TABLE "ExperimentRun" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "experimentId" UUID NOT NULL REFERENCES "Experiment"("id") ON DELETE RESTRICT,
  "environmentReportId" UUID REFERENCES "EnvironmentReport"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL,
  "failureCode" TEXT,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExperimentRun_experimentId_createdAt_idx" ON "ExperimentRun"("experimentId", "createdAt");

CREATE TABLE "ExperimentMetric" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "experimentRunId" UUID NOT NULL REFERENCES "ExperimentRun"("id") ON DELETE RESTRICT,
  "sequenceLength" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "peakAllocatedBytes" BIGINT,
  "peakReservedBytes" BIGINT,
  "tokensPerSecond" DOUBLE PRECISION,
  "stepSeconds" DOUBLE PRECISION,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExperimentMetric_experimentRunId_sequenceLength_key" UNIQUE ("experimentRunId", "sequenceLength")
);

CREATE TABLE "ExperimentArtifact" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "experimentId" UUID NOT NULL REFERENCES "Experiment"("id") ON DELETE RESTRICT,
  "experimentRunId" UUID REFERENCES "ExperimentRun"("id") ON DELETE RESTRICT,
  "submissionId" UUID REFERENCES "Submission"("id") ON DELETE RESTRICT,
  "sha256" CHAR(64) NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "artifactType" TEXT NOT NULL,
  "storageKey" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "metadataJson" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExperimentArtifact_experimentId_createdAt_idx" ON "ExperimentArtifact"("experimentId", "createdAt");
CREATE INDEX "ExperimentArtifact_sha256_idx" ON "ExperimentArtifact"("sha256");

CREATE TABLE "JournalEntry" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "experimentId" UUID UNIQUE REFERENCES "Experiment"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "JournalEntryVersion" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "journalEntryId" UUID NOT NULL REFERENCES "JournalEntry"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "observation" TEXT,
  "interpretation" TEXT,
  "uncertainty" TEXT,
  "nextExperiment" TEXT,
  "conclusion" TEXT,
  "finalizedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalEntryVersion_journalEntryId_version_key" UNIQUE ("journalEntryId", "version")
);

CREATE TABLE "MasteryRequirement" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "unitId" TEXT NOT NULL,
  "unitVersion" TEXT NOT NULL,
  "dimension" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MasteryRequirement_unitId_unitVersion_dimension_key" UNIQUE ("unitId", "unitVersion", "dimension")
);

CREATE TABLE "MasteryEvidence" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "unitId" TEXT NOT NULL,
  "unitVersion" TEXT NOT NULL,
  "dimension" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "evidenceRef" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MasteryEvidence_user_unit_version_dimension_ref_key" UNIQUE ("userId", "unitId", "unitVersion", "dimension", "evidenceRef")
);
CREATE INDEX "MasteryEvidence_userId_unitId_unitVersion_idx" ON "MasteryEvidence"("userId", "unitId", "unitVersion");

CREATE TABLE "MasteryState" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "unitVersionId" UUID NOT NULL REFERENCES "UnitVersion"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL,
  "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MasteryState_userId_unitVersionId_key" UNIQUE ("userId", "unitVersionId")
);

CREATE TABLE "Job" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "jobType" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "testRunId" UUID REFERENCES "TestRun"("id") ON DELETE SET NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(6),
  "nextAttemptAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "Job_state_nextAttemptAt_idx" ON "Job"("state", "nextAttemptAt");
CREATE INDEX "Job_leaseExpiresAt_idx" ON "Job"("leaseExpiresAt");

CREATE TABLE "JobEvent" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "jobId" UUID NOT NULL REFERENCES "Job"("id") ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  "dataJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");

CREATE TABLE "AuditEvent" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "actorUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "eventType" TEXT NOT NULL,
  "objectType" TEXT,
  "objectId" TEXT,
  "correlationId" TEXT,
  "dataJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

CREATE TABLE "IdempotencyRecord" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "actorKey" TEXT NOT NULL,
  "routeKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "responseCode" INTEGER NOT NULL,
  "responseJson" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "IdempotencyRecord_actor_route_key_key" UNIQUE ("actorKey", "routeKey", "idempotencyKey")
);
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
