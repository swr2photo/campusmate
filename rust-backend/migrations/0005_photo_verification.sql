-- Photo verification (Amazon Rekognition Face Liveness + CompareFaces).
-- These tables hold state, decisions and object keys only: never images,
-- face data or raw confidence scores. Images live in a private R2 bucket
-- with a deletion deadline (reference_purge_after).
CREATE TYPE face_attempt_state AS ENUM (
    'CREATING', 'CREATED', 'IN_PROGRESS', 'PROCESSING',
    'VERIFIED', 'REVIEW_REQUIRED', 'FAILED', 'EXPIRED', 'REVOKED'
);

CREATE TABLE face_verification_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES accounts(id),
    aws_session_id text UNIQUE,
    aws_region text NOT NULL,
    -- Challenge the server requested. Movement-only (no flashing lights) is
    -- the photosensitivity alternative and is never approved automatically.
    challenge text NOT NULL DEFAULT 'FACE_MOVEMENT_AND_LIGHT'
        CHECK (challenge IN ('FACE_MOVEMENT_AND_LIGHT', 'FACE_MOVEMENT')),
    -- Profile photo URI at start; the bytes live only in the private snapshot.
    reference_source text NOT NULL,
    reference_key text NOT NULL UNIQUE,
    reference_sha256 bytea NOT NULL CHECK (length(reference_sha256) = 32),
    -- AWS liveness frame kept only for human review; purged with the snapshot.
    evidence_key text UNIQUE,
    evidence_stored boolean NOT NULL DEFAULT false,
    reference_purge_after timestamptz,
    reference_deleted_at timestamptz,
    consent_version text NOT NULL,
    consented_at timestamptz NOT NULL,
    policy_version text NOT NULL,
    state face_attempt_state NOT NULL DEFAULT 'CREATING',
    failure_code text CHECK (failure_code ~ '^[A-Z_]{1,40}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    finished_at timestamptz,
    CHECK (finished_at IS NULL OR finished_at >= created_at)
);
-- One active liveness session per person.
CREATE UNIQUE INDEX face_attempts_one_active ON face_verification_attempts(user_id)
    WHERE state IN ('CREATING', 'CREATED', 'IN_PROGRESS', 'PROCESSING');
CREATE INDEX face_attempts_user_recent ON face_verification_attempts(user_id, created_at DESC);
CREATE INDEX face_attempts_state_expiry ON face_verification_attempts(state, expires_at);
CREATE INDEX face_attempts_pending_purge ON face_verification_attempts(reference_purge_after)
    WHERE reference_deleted_at IS NULL;

CREATE TABLE user_photo_verifications (
    user_id text PRIMARY KEY REFERENCES accounts(id),
    latest_attempt_id uuid REFERENCES face_verification_attempts(id),
    verified_reference_source text,
    verified_reference_sha256 bytea CHECK (verified_reference_sha256 IS NULL OR length(verified_reference_sha256) = 32),
    status text NOT NULL CHECK (status IN ('UNVERIFIED', 'VERIFIED', 'REVIEW_REQUIRED', 'REVOKED')),
    method text CHECK (method IS NULL OR method IN ('LIVENESS', 'HUMAN_REVIEW')),
    policy_version text,
    verified_at timestamptz,
    revoked_at timestamptz,
    revoke_reason text CHECK (revoke_reason IS NULL OR revoke_reason ~ '^[A-Z_]{1,40}$'),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_verification_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES accounts(id),
    attempt_id uuid REFERENCES face_verification_attempts(id),
    event_type text NOT NULL CHECK (event_type ~ '^[A-Z_]{1,40}$'),
    actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'admin')),
    actor_id text,
    policy_version text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_audit_user ON identity_verification_audit_events(user_id, created_at DESC);

CREATE TABLE identity_review_requests (
    attempt_id uuid PRIMARY KEY REFERENCES face_verification_attempts(id),
    user_id text NOT NULL REFERENCES accounts(id),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    note text CHECK (note IS NULL OR length(note) <= 500),
    decided_by text REFERENCES accounts(id),
    -- Approval requires that this reviewer opened the evidence.
    viewed_by text REFERENCES accounts(id),
    viewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz
);
CREATE INDEX identity_reviews_open ON identity_review_requests(created_at) WHERE status = 'OPEN';

-- People who cannot take the camera check (e.g. no compatible camera) ask
-- staff for help. Resolving a request never grants a badge by itself.
CREATE TABLE identity_alternative_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES accounts(id),
    reason text NOT NULL CHECK (reason IN ('PHOTOSENSITIVITY', 'CAMERA_UNAVAILABLE', 'ACCESSIBILITY', 'OTHER')),
    note text CHECK (note IS NULL OR length(note) <= 500),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DECLINED', 'WITHDRAWN')),
    resolved_by text REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);
CREATE UNIQUE INDEX identity_alternatives_one_open ON identity_alternative_requests(user_id)
    WHERE status = 'OPEN';
