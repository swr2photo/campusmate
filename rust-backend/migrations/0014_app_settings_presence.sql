CREATE TABLE user_app_settings (
    user_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
    public_username text UNIQUE,
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One lease per authenticated session family; backgrounding one phone must
-- not take another active phone offline. No client-supplied activity times.
CREATE TABLE user_presence (
    user_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    family_id uuid NOT NULL,
    online_until timestamptz NOT NULL,
    last_active_at timestamptz,
    PRIMARY KEY(user_id, family_id)
);
