-- Delivery claims are short transactions; network calls never hold a row lock.
ALTER TABLE outbox
    ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN lease_id uuid,
    ADD COLUMN locked_until timestamptz,
    ADD COLUMN finished_at timestamptz,
    ADD COLUMN last_error_code text;
-- Add a dispatch index while retaining the original created-at index.
CREATE INDEX outbox_dispatch_pending ON outbox(next_attempt_at,created_at)
    WHERE delivered_at IS NULL AND finished_at IS NULL;

-- The API may scrub cancelled secrets without permission to read email tokens.
-- Fixed SQL, no caller input, and fully qualified objects prevent search-path
-- substitution. Only the separately provisioned API role receives EXECUTE.
CREATE FUNCTION public.scrub_auth_outbox() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
    WITH cleaned AS (
        UPDATE public.outbox o SET payload='{}'::jsonb,
            finished_at=COALESCE(finished_at,now()),lease_id=NULL,locked_until=NULL,
            last_error_code=COALESCE(last_error_code,'challenge-cancelled-or-expired')
        WHERE kind IN ('verify_email','reset_password') AND payload<>'{}'::jsonb
          AND (locked_until IS NULL OR locked_until<now())
          AND (finished_at IS NOT NULL OR delivered_at IS NOT NULL OR NOT EXISTS(
              SELECT 1 FROM public.auth_challenges c JOIN public.accounts a ON a.id=c.user_id
              WHERE c.user_id=o.user_id AND c.kind=o.kind
                AND c.token_hash=sha256(convert_to(o.payload->>'token','UTF8'))
                AND c.used_at IS NULL AND c.expires_at>now()
                AND NOT a.suspended AND a.deleted_at IS NULL
                AND a.email=o.payload->>'email'
          )) RETURNING id
    ) SELECT count(*) FROM cleaned;
$$;
REVOKE ALL ON FUNCTION public.scrub_auth_outbox() FROM PUBLIC;
