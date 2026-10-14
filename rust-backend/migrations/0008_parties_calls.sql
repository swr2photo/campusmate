-- Party finder (legacy parties/{id} and parties/{id}/requests/{uid}).
CREATE TABLE parties (
    id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    host_id text NOT NULL REFERENCES accounts(id),
    host jsonb NOT NULL CHECK (jsonb_typeof(host)='object'),
    location jsonb NOT NULL CHECK (jsonb_typeof(location)='object'),
    schedule jsonb NOT NULL CHECK (jsonb_typeof(schedule)='object'),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    max_people integer NOT NULL CHECK (max_people BETWEEN 2 AND 50),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled','expired','closed')),
    legacy boolean NOT NULL DEFAULT false,
    chat_activation_required boolean NOT NULL DEFAULT false,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parties_open ON parties(starts_at) WHERE status='open';
CREATE INDEX parties_host ON parties(host_id);
CREATE TABLE party_members (
    party_id text NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES accounts(id),
    position integer NOT NULL,
    name text NOT NULL DEFAULT '' CHECK (length(name) <= 100),
    avatar_uri text NOT NULL DEFAULT '' CHECK (length(avatar_uri) <= 5000),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(party_id,user_id)
);
CREATE INDEX party_members_user ON party_members(user_id);
CREATE TABLE party_requests (
    party_id text NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    requester_id text NOT NULL REFERENCES accounts(id),
    host_id text NOT NULL REFERENCES accounts(id),
    requester_name text NOT NULL DEFAULT '' CHECK (length(requester_name) <= 100),
    avatar_uri text NOT NULL DEFAULT '' CHECK (length(avatar_uri) <= 5000),
    status text NOT NULL CHECK (status IN ('pending','approved','rejected','withdrawn')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(party_id,requester_id)
);
CREATE INDEX party_requests_requester ON party_requests(requester_id,status,updated_at DESC);
CREATE INDEX party_requests_host ON party_requests(host_id,status,updated_at);

-- Encrypted group chat. Each epoch holds per-member, per-device key envelopes;
-- a membership change requires a new epoch before anyone can send again.
CREATE TABLE group_chats (
    party_id text PRIMARY KEY REFERENCES parties(id),
    host_id text NOT NULL REFERENCES accounts(id),
    title text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
    current_epoch integer NOT NULL DEFAULT 0 CHECK (current_epoch >= 0),
    epoch_count integer NOT NULL DEFAULT 1 CHECK (epoch_count BETWEEN 1 AND 100),
    rekey_required boolean NOT NULL DEFAULT false,
    last_message_id text,
    last_message_at timestamptz,
    last_sender_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE group_members (
    party_id text NOT NULL REFERENCES group_chats(party_id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES accounts(id),
    PRIMARY KEY(party_id,user_id)
);
CREATE INDEX group_members_user ON group_members(user_id);
CREATE TABLE group_epochs (
    party_id text NOT NULL REFERENCES group_chats(party_id) ON DELETE CASCADE,
    epoch integer NOT NULL CHECK (epoch >= 0),
    key_envelopes jsonb NOT NULL CHECK (jsonb_typeof(key_envelopes)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(party_id,epoch)
);
CREATE TABLE group_messages (
    party_id text NOT NULL REFERENCES group_chats(party_id) ON DELETE CASCADE,
    id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    sender_id text NOT NULL REFERENCES accounts(id),
    epoch integer NOT NULL CHECK (epoch >= 0),
    type text NOT NULL CHECK (type IN ('text','image')),
    nonce text NOT NULL CHECK (length(nonce) = 32),
    ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 20000),
    sequence bigint GENERATED ALWAYS AS IDENTITY,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(party_id,id)
);
CREATE INDEX group_messages_page ON group_messages(party_id,sequence DESC);
CREATE TABLE group_reads (
    party_id text NOT NULL REFERENCES group_chats(party_id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES accounts(id),
    message_id text NOT NULL,
    last_read_message_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(party_id,user_id)
);

-- Call sessions for LiveKit rooms (legacy calls/{id}).
CREATE TABLE calls (
    id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    caller_id text NOT NULL REFERENCES accounts(id),
    receiver_id text NOT NULL REFERENCES accounts(id),
    conversation_id text REFERENCES conversations(id),
    call_type text NOT NULL CHECK (call_type IN ('voice','video')),
    status text NOT NULL CHECK (status IN ('calling','ringing','connected','ended','rejected','busy','missed')),
    caller_profile jsonb NOT NULL DEFAULT '{}',
    receiver_profile jsonb NOT NULL DEFAULT '{}',
    started_at timestamptz,
    ended_at timestamptz,
    duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    end_reason text CHECK (end_reason IS NULL OR length(end_reason) <= 40),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (caller_id <> receiver_id)
);
CREATE INDEX calls_incoming ON calls(receiver_id,created_at DESC) WHERE status IN ('calling','ringing');
CREATE INDEX calls_participants ON calls(caller_id,created_at DESC);

-- RevenueCat webhook idempotency (legacy revenueCatEvents/{id}).
CREATE TABLE revenuecat_events (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
    type text NOT NULL DEFAULT 'UNKNOWN',
    processed_at timestamptz NOT NULL DEFAULT now()
);

-- Administrative audit trail for moderation and account actions.
CREATE TABLE admin_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id text NOT NULL REFERENCES accounts(id),
    action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
    target_id text,
    details jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_time ON admin_audit(created_at DESC);

-- Reported app versions (legacy reportAppVersion) for the update prompt.
CREATE TABLE app_versions (
    platform text NOT NULL,
    version text NOT NULL CHECK (length(version) <= 50),
    reported_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(platform,version)
);
