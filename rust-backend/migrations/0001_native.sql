-- Native identity IDs intentionally remain TEXT to preserve existing Firebase UIDs.
CREATE TABLE accounts (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash text,
    email_verified boolean NOT NULL DEFAULT false,
    suspended boolean NOT NULL DEFAULT false,
    deleted_at timestamptz,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profiles (
    user_id text PRIMARY KEY REFERENCES accounts(id),
    raw jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(raw) = 'object'),
    face_verified boolean NOT NULL DEFAULT false,
    discoverable boolean NOT NULL DEFAULT false,
    is_new boolean NOT NULL DEFAULT true,
    visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','incognito','hidden')),
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_discoverable ON profiles(user_id) WHERE face_verified AND discoverable AND NOT is_new;
CREATE INDEX profiles_activities ON profiles USING gin ((raw->'activities'));
CREATE TABLE entitlements (
    user_id text PRIMARY KEY REFERENCES accounts(id),
    record jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES accounts(id),
    family_id uuid NOT NULL,
    access_hash bytea NOT NULL UNIQUE,
    refresh_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_family ON sessions(family_id);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES accounts(id),
    kind text NOT NULL CHECK (kind IN ('verify_email','reset_password')),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);
CREATE TABLE outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    user_id text NOT NULL REFERENCES accounts(id),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz
);
CREATE INDEX outbox_pending ON outbox(created_at) WHERE delivered_at IS NULL;
CREATE TABLE blocks (
    actor_id text NOT NULL REFERENCES accounts(id),
    target_id text NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id,target_id), CHECK(actor_id <> target_id)
);
CREATE INDEX blocks_reverse ON blocks(target_id,actor_id);
CREATE TABLE decisions (
    actor_id text NOT NULL REFERENCES accounts(id),
    target_id text NOT NULL REFERENCES accounts(id),
    kind text NOT NULL CHECK (kind IN ('like','skip')),
    status text NOT NULL CHECK (status IN ('pending','accepted','rejected','removed')),
    message text NOT NULL DEFAULT '',
    sequence bigint GENERATED ALWAYS AS IDENTITY,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id,target_id), CHECK(actor_id <> target_id)
);
CREATE INDEX decisions_incoming ON decisions(target_id,status,sequence DESC);
CREATE TABLE action_receipts (
    actor_id text NOT NULL REFERENCES accounts(id),
    action_id uuid NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(actor_id,action_id)
);
CREATE TABLE conversations (
    id text PRIMARY KEY,
    member_a text NOT NULL REFERENCES accounts(id),
    member_b text NOT NULL REFERENCES accounts(id),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(member_a,member_b), CHECK(member_a < member_b)
);
CREATE TABLE encrypted_messages (
    conversation_id text NOT NULL REFERENCES conversations(id),
    id text NOT NULL,
    sender_id text NOT NULL REFERENCES accounts(id),
    ciphertext jsonb NOT NULL CHECK (jsonb_typeof(ciphertext)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(conversation_id,id)
);
CREATE INDEX encrypted_messages_page ON encrypted_messages(conversation_id,created_at DESC,id);
CREATE TABLE encryption_devices (
    user_id text NOT NULL REFERENCES accounts(id),
    device_id text NOT NULL,
    public_key text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,device_id)
);
CREATE TABLE rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count integer NOT NULL
);
-- Immutable ranking pages contain IDs/scores only; profiles are always reauthorized on read.
CREATE TABLE discovery_snapshots (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES accounts(id),
    scope text NOT NULL,
    ranked jsonb NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX discovery_snapshots_expiry ON discovery_snapshots(expires_at);
-- Preserve unmigrated source data for validation. This table is NEVER accessible from public API.
CREATE TABLE migration_documents (
    path text PRIMARY KEY,
    data jsonb NOT NULL,
    batch_id uuid NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);
