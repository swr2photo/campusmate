-- Run on the intended CampusMate branch AFTER migrations and runtime-grants.sql.
-- SQL-created roles do not automatically inherit Neon's privileged neon_superuser.
-- These new LOGIN identities have NO password until a trusted operator assigns
-- distinct, randomly generated SCRAM credentials. Never use these roles as owners.
-- Review this file before execution; it does not connect to Neon itself.
BEGIN;
DO $$
DECLARE role_name text;
BEGIN
    IF current_database() <> 'campusmate' THEN
        RAISE EXCEPTION 'CampusMate database required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='campusmate_api')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='campusmate_mail') THEN
        RAISE EXCEPTION 'Apply runtime-grants.sql first';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['campusmate_api_login','campusmate_mail_login'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
            EXECUTE format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname=role_name
            AND (NOT r.rolcanlogin OR NOT r.rolinherit OR r.rolsuper OR r.rolcreatedb
                 OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)) THEN
            RAISE EXCEPTION 'Existing runtime identity is unsafe';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles r JOIN pg_roles parent
            ON pg_has_role(r.oid,parent.oid,'MEMBER') AND r.oid<>parent.oid
            WHERE r.rolname=role_name AND parent.rolname <>
                CASE role_name WHEN 'campusmate_api_login' THEN 'campusmate_api' ELSE 'campusmate_mail' END) THEN
            RAISE EXCEPTION 'Existing runtime identity has unrelated membership';
        END IF;
    END LOOP;
END $$;
GRANT campusmate_api TO campusmate_api_login;
GRANT campusmate_mail TO campusmate_mail_login;
GRANT CONNECT ON DATABASE campusmate TO campusmate_api_login,campusmate_mail_login;

-- PgBouncer transaction pooling cannot retain session SET commands. Set these
-- defaults on each actual LOGIN role, scoped to this database. A fresh connection
-- must report statement_timeout source "database user" to pass readiness checks.
ALTER ROLE campusmate_api_login IN DATABASE campusmate SET statement_timeout='5s';
ALTER ROLE campusmate_mail_login IN DATABASE campusmate SET statement_timeout='5s';
ALTER ROLE campusmate_api_login IN DATABASE campusmate SET lock_timeout='2s';
ALTER ROLE campusmate_mail_login IN DATABASE campusmate SET lock_timeout='2s';
ALTER ROLE campusmate_api_login IN DATABASE campusmate SET idle_in_transaction_session_timeout='10s';
ALTER ROLE campusmate_mail_login IN DATABASE campusmate SET idle_in_transaction_session_timeout='10s';
COMMIT;
