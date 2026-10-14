-- Legacy decision documents expose createdAt; keep it for clients and import.
ALTER TABLE decisions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Per-member direct-room state that Firestore kept in participantSettings,
-- unreadCounts, readReceipts and meetupAcceptedUsers on the room document.
CREATE TABLE conversation_members (
    conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES accounts(id),
    hidden boolean NOT NULL DEFAULT false,
    muted boolean NOT NULL DEFAULT false,
    show_pinned_meetup boolean NOT NULL DEFAULT true,
    history_cleared_at timestamptz,
    unread integer NOT NULL DEFAULT 0 CHECK (unread >= 0),
    read_at timestamptz,
    meetup_accepted boolean NOT NULL DEFAULT false,
    PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX conversation_members_user ON conversation_members(user_id);
INSERT INTO conversation_members(conversation_id,user_id)
    SELECT id,member_a FROM conversations UNION ALL SELECT id,member_b FROM conversations
    ON CONFLICT DO NOTHING;

-- Routing/UI metadata that the legacy encrypted record kept beside the
-- ciphertext (video mode, call status, system notice, forward marker). It
-- never contains message text; see chat::message_meta for the allowlist.
ALTER TABLE encrypted_messages
    ADD COLUMN meta jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(meta)='object'),
    ADD COLUMN reactions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(reactions)='object'),
    ADD COLUMN reaction_times jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(reaction_times)='object'),
    ADD COLUMN hidden_for text[] NOT NULL DEFAULT '{}',
    ADD COLUMN client_sent_at timestamptz,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- View-once / limited-replay media accounting per viewer.
CREATE TABLE message_views (
    conversation_id text NOT NULL,
    message_id text NOT NULL,
    viewer_id text NOT NULL REFERENCES accounts(id),
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    first_viewed_at timestamptz NOT NULL DEFAULT now(),
    last_viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(conversation_id,message_id,viewer_id),
    FOREIGN KEY(conversation_id,message_id) REFERENCES encrypted_messages(conversation_id,id) ON DELETE CASCADE
);
-- Encrypted video renditions uploaded after send (quality -> object reference).
CREATE TABLE message_renditions (
    conversation_id text NOT NULL,
    message_id text NOT NULL,
    quality text NOT NULL CHECK (quality IN ('high','medium')),
    data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(conversation_id,message_id,quality),
    FOREIGN KEY(conversation_id,message_id) REFERENCES encrypted_messages(conversation_id,id) ON DELETE CASCADE
);

CREATE TABLE appointments (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 400),
    conversation_id text NOT NULL REFERENCES conversations(id),
    host_id text NOT NULL REFERENCES accounts(id),
    guest_id text NOT NULL REFERENCES accounts(id),
    meetup jsonb NOT NULL CHECK (jsonb_typeof(meetup)='object'),
    scheduled_for timestamptz,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
    cancelled_by text REFERENCES accounts(id),
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (host_id <> guest_id)
);
CREATE INDEX appointments_host ON appointments(host_id);
CREATE INDEX appointments_guest ON appointments(guest_id);

-- In-app notification inbox (legacy users/{uid}/notifications).
CREATE TABLE notifications (
    user_id text NOT NULL REFERENCES accounts(id),
    id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    type text NOT NULL CHECK (length(type) BETWEEN 1 AND 60),
    title text NOT NULL CHECK (length(title) <= 180),
    body text NOT NULL CHECK (length(body) <= 2000),
    target jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(target)='object'),
    status text,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    PRIMARY KEY(user_id,id)
);
CREATE INDEX notifications_page ON notifications(user_id,created_at DESC,id DESC);
CREATE INDEX notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_expiry ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- Expo push devices. The token digest is the identity; a token can belong to
-- one account at a time.
CREATE TABLE push_tokens (
    token_hash bytea PRIMARY KEY,
    user_id text NOT NULL REFERENCES accounts(id),
    token text NOT NULL CHECK (length(token) <= 300),
    platform text NOT NULL CHECK (platform IN ('android','ios')),
    app_version text NOT NULL DEFAULT '' CHECK (length(app_version) <= 50),
    notification_mode text NOT NULL DEFAULT '' CHECK (length(notification_mode) <= 80),
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user ON push_tokens(user_id) WHERE enabled;

-- Push delivery queue. Rows are written in the same transaction as the event
-- (like, match, message, call, party change) so a rollback sends nothing.
CREATE TABLE push_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES accounts(id),
    dedupe_key text NOT NULL CHECK (length(dedupe_key) <= 300),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
    inbox boolean NOT NULL DEFAULT true,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    locked_until timestamptz,
    tickets jsonb,
    sent_at timestamptz,
    receipts_checked_at timestamptz,
    finished_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id,dedupe_key)
);
CREATE INDEX push_outbox_pending ON push_outbox(next_attempt_at) WHERE finished_at IS NULL AND sent_at IS NULL;
CREATE INDEX push_outbox_receipts ON push_outbox(sent_at) WHERE sent_at IS NOT NULL AND receipts_checked_at IS NULL;

CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id text NOT NULL REFERENCES accounts(id),
    reported_user_id text REFERENCES accounts(id),
    conversation_id text,
    message_id text,
    media_url text CHECK (media_url IS NULL OR length(media_url) <= 2048),
    message_text text CHECK (message_text IS NULL OR length(message_text) <= 2000),
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 100),
    details text NOT NULL DEFAULT '' CHECK (length(details) <= 2000),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','dismissed')),
    resolution jsonb,
    reviewed_by text REFERENCES accounts(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status ON reports(status,created_at DESC);

-- Public read-only campus content and remote app configuration.
CREATE TABLE spots (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
    data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_config (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
    data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every room always has both member rows, whichever writer created it
-- (matching, import, tests).
CREATE FUNCTION add_conversation_members() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO conversation_members(conversation_id,user_id)
        VALUES (NEW.id,NEW.member_a),(NEW.id,NEW.member_b) ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$;
CREATE TRIGGER conversations_members AFTER INSERT ON conversations
    FOR EACH ROW EXECUTE FUNCTION add_conversation_members();
