-- In-app bug reports and feedback (shake to report). Screenshots are kept
-- privately in the row, never at a public URL, are removed with the account,
-- and are cleared when an admin resolves or dismisses the report.
CREATE TABLE app_feedback (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('bug', 'feedback')),
    message text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 2000),
    app_version text NOT NULL DEFAULT '' CHECK (char_length(app_version) <= 32),
    app_build text NOT NULL DEFAULT '' CHECK (char_length(app_build) <= 32),
    platform text NOT NULL DEFAULT '' CHECK (platform IN ('', 'ios', 'android', 'web')),
    os_version text NOT NULL DEFAULT '' CHECK (char_length(os_version) <= 32),
    screen text NOT NULL DEFAULT '' CHECK (char_length(screen) <= 120),
    screenshot bytea CHECK (screenshot IS NULL OR octet_length(screenshot) <= 409600),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'resolved', 'dismissed')),
    admin_note text NOT NULL DEFAULT '' CHECK (char_length(admin_note) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_feedback_status_created ON app_feedback (status, created_at DESC, id DESC);
CREATE INDEX app_feedback_user_created ON app_feedback (user_id, created_at DESC);
