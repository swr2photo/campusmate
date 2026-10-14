-- Run AFTER migrations with the schema owner on the intended native database.
-- These are NOLOGIN capability roles, not credentials. Bind separate API and
-- mail login identities to them using your deployment operator, never the app.
BEGIN;
DO $$ BEGIN
    BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='campusmate_api') THEN
        CREATE ROLE campusmate_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END;
    BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='campusmate_mail') THEN
        CREATE ROLE campusmate_mail NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO campusmate_api,campusmate_mail;
GRANT SELECT ON public.accounts,public.profiles,public.entitlements,public.sessions,
    public.auth_challenges,public.blocks,public.decisions,public.action_receipts,
    public.conversations,public.encrypted_messages,public.encryption_devices,
    public.rate_limits,public.discovery_snapshots,public.matching_history TO campusmate_api;
GRANT INSERT,UPDATE ON public.accounts,public.profiles TO campusmate_api;
GRANT INSERT,UPDATE,DELETE ON public.sessions,public.auth_challenges,public.blocks,
    public.decisions,public.action_receipts,public.conversations,public.encrypted_messages,
    public.encryption_devices,public.rate_limits,public.discovery_snapshots,
    public.matching_history TO campusmate_api;
GRANT USAGE ON SEQUENCE public.decisions_sequence_seq,public.matching_history_sequence_seq,
    public.encrypted_messages_sequence_seq TO campusmate_api;
GRANT INSERT ON public.outbox TO campusmate_api;
GRANT SELECT(id,kind,user_id,created_at) ON public.outbox TO campusmate_api;
GRANT EXECUTE ON FUNCTION public.scrub_auth_outbox() TO campusmate_api;

-- Photo verification is processed by the API/sweeper. Lifecycle identifiers,
-- consent and reference pins are immutable after insert. The mail worker has
-- no reason to read verification state or reference metadata.
REVOKE ALL ON public.face_verification_attempts,public.user_photo_verifications,
    public.identity_review_requests,public.identity_verification_audit_events,
    public.identity_alternative_requests
    FROM PUBLIC,campusmate_api,campusmate_mail;
GRANT SELECT ON public.face_verification_attempts,public.user_photo_verifications,
    public.identity_review_requests,public.identity_alternative_requests TO campusmate_api;
GRANT INSERT(id,user_id,aws_region,challenge,reference_source,reference_key,reference_sha256,
    consent_version,consented_at,policy_version,state,expires_at)
    ON public.face_verification_attempts TO campusmate_api;
GRANT UPDATE(state,failure_code,finished_at,updated_at,reference_purge_after,
    reference_deleted_at,aws_session_id,expires_at,evidence_key,evidence_stored)
    ON public.face_verification_attempts TO campusmate_api;
GRANT INSERT(user_id,latest_attempt_id,verified_reference_source,verified_reference_sha256,
    status,method,policy_version,verified_at,revoked_at,revoke_reason,updated_at)
    ON public.user_photo_verifications TO campusmate_api;
GRANT UPDATE(latest_attempt_id,verified_reference_source,verified_reference_sha256,
    status,method,policy_version,verified_at,revoked_at,revoke_reason,updated_at)
    ON public.user_photo_verifications TO campusmate_api;
GRANT INSERT(attempt_id,user_id,note) ON public.identity_review_requests TO campusmate_api;
GRANT UPDATE(note,status,decided_by,decided_at,viewed_by,viewed_at)
    ON public.identity_review_requests TO campusmate_api;
GRANT INSERT(user_id,reason,note) ON public.identity_alternative_requests TO campusmate_api;
GRANT UPDATE(note,status,resolved_by,resolved_at)
    ON public.identity_alternative_requests TO campusmate_api;
GRANT INSERT(user_id,attempt_id,event_type,actor_type,actor_id,policy_version)
    ON public.identity_verification_audit_events TO campusmate_api;
GRANT USAGE ON TYPE public.face_attempt_state TO campusmate_api;

-- Platform tables added with the full migration (chat state, notifications,
-- parties, calls, media accounting, membership, administration).
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conversation_members,public.message_views,
    public.message_renditions,public.appointments,public.notifications,public.push_tokens,
    public.push_outbox,public.reports,public.spots,public.app_config,public.parties,
    public.party_members,public.party_requests,public.group_chats,public.group_members,
    public.group_epochs,public.group_messages,public.group_reads,public.calls,
    public.revenuecat_events,public.admin_audit,public.app_versions,public.account_otps
    TO campusmate_api;
GRANT INSERT,UPDATE,DELETE ON public.entitlements TO campusmate_api;
GRANT USAGE ON SEQUENCE public.group_messages_sequence_seq TO campusmate_api;
-- The API may set new_email on change-email challenges it creates.
GRANT SELECT(user_id,purpose,code_hash,expires_at,used_at) ON public.account_otps TO campusmate_mail;
GRANT SELECT(new_email) ON public.auth_challenges TO campusmate_mail;

GRANT SELECT(id,email,email_verified,suspended,deleted_at) ON public.accounts TO campusmate_mail;
GRANT SELECT(user_id,kind,token_hash,expires_at,used_at) ON public.auth_challenges TO campusmate_mail;
GRANT SELECT ON public.outbox TO campusmate_mail;
GRANT UPDATE(payload,attempts,next_attempt_at,lease_id,locked_until,finished_at,
    last_error_code,delivered_at) ON public.outbox TO campusmate_mail;
COMMIT;
