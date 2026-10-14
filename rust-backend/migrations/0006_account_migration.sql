-- Imported Firebase identities keep their UID. A legacy password is verified
-- once against Firebase Auth at the person's next sign-in and then replaced by
-- a native Argon2id hash; no password material is exported or imported.
ALTER TABLE accounts
    ADD COLUMN legacy_password boolean NOT NULL DEFAULT false,
    ADD COLUMN google_subject text UNIQUE CHECK (google_subject IS NULL OR length(google_subject) BETWEEN 1 AND 255),
    ADD COLUMN display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 200),
    ADD COLUMN last_sign_in_at timestamptz;
CREATE INDEX accounts_legacy_password ON accounts(email) WHERE legacy_password AND password_hash IS NULL;

-- One-time codes for confirming destructive account actions. Only a digest is
-- stored; the mail worker reads the code from the scrubbed outbox payload.
CREATE TABLE account_otps (
    user_id text NOT NULL REFERENCES accounts(id),
    purpose text NOT NULL CHECK (purpose IN ('delete_account')),
    code_hash bytea NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,purpose)
);

-- Campus email migration for legacy non-campus (for example Gmail) accounts.
-- The new address becomes the account email only after its link is opened.
ALTER TABLE auth_challenges DROP CONSTRAINT IF EXISTS auth_challenges_kind_check;
ALTER TABLE auth_challenges ADD CONSTRAINT auth_challenges_kind_check
    CHECK (kind IN ('verify_email','reset_password','change_email'));
ALTER TABLE auth_challenges ADD COLUMN new_email text CHECK (new_email IS NULL OR new_email = lower(new_email));
