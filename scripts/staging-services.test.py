"""Synthetic provider tests. No cloud requests or real local env reads."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("staging_services", Path(__file__).with_name("staging-services.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SENTINEL = "synthetic-private-value-never-print-1234567890"


class FakeProvider(MODULE.Provider):
    def __init__(self, *, existing=False, wrong_project=False, free=False, fail_fly=False,
                 missing_plan=False, denied_plan=False, wrong_organization=False):
        self.calls = []
        self.existing = existing
        self.wrong_project = wrong_project
        self.free = free
        self.fail_fly = fail_fly
        self.missing_plan = missing_plan
        self.denied_plan = denied_plan
        self.wrong_organization = wrong_organization
        self.published = None
        self.private_path = None
        self.gcp_payloads = {key: SENTINEL for key in MODULE.GCP_API}
        self.gcp_payloads.update({
            MODULE.GCP_MAIL[0]: "postgres://campusmate_mail_login:" + SENTINEL + "@" + MODULE.EXPECTED_MAIL_HOST + "/campusmate?sslmode=verify-full",
            MODULE.GCP_MAIL[1]: json.dumps({"SMTP_HOST": "smtp.example.test", "SMTP_PORT": "587", "SMTP_USER": "synthetic@example.test", "SMTP_PASS": SENTINEL, "CAMPUS_EMAIL_FROM": "synthetic@example.test", "CAMPUS_EMAIL_FROM_NAME": "CampusMate", "RESEND_API_KEY": ""}),
        })

    def run(self, args, *, stdin=None, env=None, timeout=120):
        self.calls.append({"args": args, "stdin": stdin, "env": env})
        output = b"{}"
        error = b""
        code = 0
        if args[0] == "whoami":
            output = b'"fixture-user","S-1-5-21-1234"\r\n'
        elif args[0] == "gcloud":
            if args[3] == "list":
                name = args[4]
                output = json.dumps([
                    {"name": f"projects/fixture/secrets/{name}/versions/1", "state": "ENABLED"},
                    {"name": f"projects/fixture/secrets/{name}/versions/2", "state": "ENABLED"},
                    {"name": f"projects/fixture/secrets/{name}/versions/3", "state": "DISABLED"},
                ]).encode()
            else:
                assert args[3] == "access" and args[4] == "2"
                output = self.gcp_payloads[args[args.index("--secret") + 1]].encode()
        elif args[:3] == ["aws", "sts", "get-caller-identity"]:
            output = json.dumps({"Account": "000000000000" if self.wrong_project else MODULE.EXPECTED_AWS_PROJECT}).encode()
        elif args[:3] == ["aws", "freetier", "get-account-plan-state"]:
            output = json.dumps({"accountPlanType": "FREE" if self.free else "PAID"}).encode()
            if self.missing_plan:
                code, error = 1, b"ResourceNotFoundException"
            if self.denied_plan:
                code, error = 1, b"AccessDeniedException"
        elif args[:3] == ["aws", "organizations", "describe-organization"]:
            output = json.dumps({"Organization": {"Id": "wrong" if self.wrong_organization else MODULE.EXPECTED_ORGANIZATION,
                                                   "FeatureSet": "ALL"}}).encode()
        elif args[:3] == ["aws", "secretsmanager", "describe-secret"]:
            name = args[args.index("--secret-id") + 1]
            component = name.rsplit("/", 1)[-1]
            if self.existing:
                output = json.dumps({"Name": name, "ARN": "arn:aws:secretsmanager:" + MODULE.EXPECTED_AWS_REGION + ":" + MODULE.EXPECTED_AWS_PROJECT + ":secret:" + name + "-AbCdEf", "Tags": [{"Key": key, "Value": value} for key, value in {"Environment": "staging", "Project": "CampusMate", "Component": component, "FlyApp": MODULE.STAGING_APPS[component]}.items()]}).encode()
            else:
                code, error = 1, b"ResourceNotFoundException"
        elif args[:2] == ["aws", "secretsmanager"]:
            self.private_path = Path(args[args.index("--cli-input-json") + 1][7:])
            self.published = json.loads(self.private_path.read_text(encoding="utf-8"))
        elif args[0] == "fly" and self.fail_fly:
            code, error = 1, SENTINEL.encode()
        return types.SimpleNamespace(returncode=code, stdout=output, stderr=error)


def api_values():
    values = {key: SENTINEL for key in MODULE.GCP_API + MODULE.LOCAL_API}
    values.update({"LIVEKIT_URL": "wss://fixture.livekit.cloud", "R2_WORKER_ORIGIN": "https://uploads.example.test", "CAMPUSMATE_PLUS_ENABLED": "true"})
    return values


class StagingServicesTests(unittest.TestCase):
    def args(self, command="publish", component="api", repo=None):
        app = MODULE.STAGING_APPS[component]
        argv = [command, "--component", component,
                "--aws-region", MODULE.EXPECTED_AWS_REGION,
                "--confirmed-region", MODULE.EXPECTED_AWS_REGION,
                "--secret-id", MODULE.SECRET_IDS[component],
                "--fly-app", app, "--confirmed-staging-app", app, "--apply"]
        if repo:
            argv.extend(["--repo", str(repo)])
        if component == "mail":
            argv.extend(["--expected-mail-host", MODULE.EXPECTED_MAIL_HOST])
            if command == "publish":
                argv.extend(["--email-origin", MODULE.EXPECTED_EMAIL_ORIGIN])
        return MODULE.parser().parse_args(argv)

    def env_repo(self, directory):
        root = Path(directory)
        (root / "functions").mkdir()
        (root / ".env").write_text("UNRELATED_CREDENTIAL=" + SENTINEL + "\nLIVEKIT_API_KEY=" + SENTINEL + "\n", encoding="utf-8")
        content = "\n".join(f"{key}={SENTINEL}" for key in MODULE.LOCAL_API if key != "LIVEKIT_URL")
        content += '\nLIVEKIT_URL="wss://fixture.livekit.cloud" # comment\nCAMPUSMATE_R2_WORKER_DOMAIN=uploads.example.test\nREVENUECAT_PROJECT_ID=fixture-project\n'
        (root / "functions/.env").write_text(content, encoding="utf-8")
        return root

    def test_offline_inventory_returns_only_whitelisted_key_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.env_repo(directory)
            provider = FakeProvider()
            output = io.StringIO()
            with patch.object(MODULE, "ROOT", root):
                with contextlib.redirect_stdout(output):
                    status = MODULE.main(["inventory", "--repo", str(root)], provider)
            self.assertEqual(status, 0)
            self.assertEqual(provider.calls, [])
            self.assertNotIn(SENTINEL, output.getvalue())
            self.assertNotIn("UNRELATED_CREDENTIAL", output.getvalue())
            self.assertIn("CAMPUSMATE_R2_WORKER_DOMAIN", output.getvalue())

    def test_gcp_inventory_never_accesses_payloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            provider = FakeProvider()
            with patch.object(MODULE, "ROOT", root):
                with contextlib.redirect_stdout(io.StringIO()):
                    MODULE.main(["inventory", "--repo", directory, "--gcp-metadata"], provider)
            self.assertEqual(len(provider.calls), 6)
            self.assertTrue(all(call["args"][3] == "list" for call in provider.calls))

    def test_api_publish_captures_latest_enabled_versions_and_cleans_private_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.env_repo(directory)
            provider = FakeProvider()
            output = io.StringIO()
            with patch.object(MODULE, "ROOT", root):
                with contextlib.redirect_stdout(output):
                    MODULE.publish(self.args(repo=root), provider)
            self.assertFalse(provider.private_path.exists())
            self.assertFalse(provider.private_path.parent.exists())
            bundle = json.loads(provider.published["SecretString"])
            self.assertEqual(bundle["values"]["R2_WORKER_ORIGIN"], "https://uploads.example.test")
            self.assertEqual(bundle["values"]["REVENUECAT_PROJECT_ID"], "fixture-project")
            self.assertNotIn("UNRELATED_CREDENTIAL", bundle["values"])
            self.assertNotIn(SENTINEL, output.getvalue())
            self.assertFalse(any(SENTINEL in str(call["args"]) for call in provider.calls))

    def test_wrong_aws_identity_fails_before_any_payload_read_or_mutation(self):
        provider = FakeProvider(wrong_project=True)
        with self.assertRaisesRegex(MODULE.SafeError, "aws-project-identity-mismatch"):
            MODULE.publish(self.args(), provider)
        self.assertEqual(len(provider.calls), 1)

    def test_paid_plan_gate_precedes_payload_read_or_mutation(self):
        provider = FakeProvider(free=True)
        with self.assertRaisesRegex(MODULE.SafeError, "aws-paid-plan-required"):
            MODULE.publish(self.args(), provider)
        self.assertEqual(len(provider.calls), 2)

    def test_missing_plan_requires_preverified_advanced_organization(self):
        args = self.args()
        with self.assertRaisesRegex(MODULE.SafeError, "aws-plan-verification-unavailable"):
            MODULE.preflight(args, FakeProvider(missing_plan=True))
        args.verified_advanced_organization = MODULE.EXPECTED_ORGANIZATION
        MODULE.preflight(args, FakeProvider(missing_plan=True))
        with self.assertRaisesRegex(MODULE.SafeError, "verified-advanced-organization-mismatch"):
            MODULE.preflight(args, FakeProvider(missing_plan=True, wrong_organization=True))

    def test_advanced_fallback_never_accepts_free_or_denied_plan(self):
        args = self.args()
        args.verified_advanced_organization = MODULE.EXPECTED_ORGANIZATION
        for provider in (FakeProvider(free=True), FakeProvider(denied_plan=True)):
            with self.assertRaises(MODULE.SafeError):
                MODULE.preflight(args, provider)
            self.assertEqual(len(provider.calls), 2)

    def test_scope_rejects_region_app_and_production_secret_changes(self):
        for field, value in (("confirmed_region", "ap-southeast-2"), ("confirmed_staging_app", "different-app"), ("secret_id", "campusmate/production/services/api"), ("apply", False)):
            args = self.args()
            setattr(args, field, value)
            provider = FakeProvider()
            with self.assertRaises(MODULE.SafeError):
                MODULE.publish(args, provider)
            self.assertEqual(provider.calls, [])

    def test_scope_rejects_self_confirmed_wrong_region_project_and_app(self):
        cases = []
        region = self.args()
        region.aws_region = region.confirmed_region = "ap-southeast-2"
        cases.append(region)
        project = self.args()
        project.expected_aws_project = "028610956731"
        cases.append(project)
        app = self.args()
        app.fly_app = app.confirmed_staging_app = "campusmate-production"
        cases.append(app)
        for args in cases:
            provider = FakeProvider()
            with self.assertRaises(MODULE.SafeError):
                MODULE.publish(args, provider)
            self.assertEqual(provider.calls, [])

    def test_scope_rejects_wrong_gcp_project_workspace_and_mail_targets(self):
        cases = []
        gcp = self.args()
        gcp.gcp_project = "different-project"
        cases.append(gcp)
        with tempfile.TemporaryDirectory() as directory:
            repo = self.args(repo=Path(directory))
            provider = FakeProvider()
            with self.assertRaisesRegex(MODULE.SafeError, "workspace-root-mismatch"):
                MODULE.publish(repo, provider)
            self.assertEqual(provider.calls, [])
        mail_host = self.args(component="mail")
        mail_host.expected_mail_host = "production-pooler.example.test"
        cases.append(mail_host)
        mail_origin = self.args(component="mail")
        mail_origin.email_origin = "https://production.example.test"
        cases.append(mail_origin)
        for args in cases:
            provider = FakeProvider()
            with self.assertRaises(MODULE.SafeError):
                MODULE.publish(args, provider)
            self.assertEqual(provider.calls, [])

    def test_mail_bundle_flattens_smtp_and_restricts_database_identity(self):
        args = self.args(component="mail")
        bundle = MODULE.collect_bundle(args, FakeProvider())
        self.assertEqual(bundle["values"]["SMTP_PASS"], SENTINEL)
        self.assertNotIn("CAMPUSMATE_ADMIN_SMTP_CONFIG", bundle["values"])
        args.expected_mail_host = "production-pooler.example.test"
        with self.assertRaisesRegex(MODULE.SafeError, "bundle-mail-staging-database-invalid"):
            MODULE.validate_values(bundle["values"], "mail", args.expected_mail_host)

    def test_livekit_deferral_is_explicit_and_never_accepts_partial_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.env_repo(directory)
            with patch.object(MODULE, "ROOT", root), patch.object(MODULE, "load_local_values", return_value={
                "SPOTIFY_CLIENT_ID": SENTINEL, "SPOTIFY_CLIENT_SECRET": SENTINEL,
                "CAMPUSMATE_R2_WORKER_DOMAIN": "uploads.example.test",
                "LIVEKIT_API_KEY": SENTINEL,
            }):
                args = self.args(repo=root)
                with self.assertRaisesRegex(MODULE.SafeError, "livekit-secure-input-required"):
                    MODULE.collect_bundle(args, FakeProvider())
                args.defer_livekit = True
                bundle = MODULE.collect_bundle(args, FakeProvider())
                self.assertTrue(all(key not in bundle["values"] for key in MODULE.LIVEKIT_KEYS))
                self.assertIn("GOOGLE_PLACES_API_KEY", bundle["values"])
        values = api_values()
        del values["LIVEKIT_API_SECRET"]
        with self.assertRaisesRegex(MODULE.SafeError, "bundle-livekit-group-incomplete"):
            MODULE.validate_values(values, "api")

    def test_import_child_uses_stdin_and_scrubs_secret_environment(self):
        args = types.SimpleNamespace(component="api", fly_app=MODULE.STAGING_APPS["api"], expected_mail_host=None)
        bundle = {"schemaVersion": 1, "environment": "staging", "component": "api", "targetApp": args.fly_app, "values": api_values()}
        provider = FakeProvider()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            MODULE.import_child(args, provider, {MODULE.BUNDLE_ENV: json.dumps(bundle), "SPOTIFY_CLIENT_SECRET": SENTINEL, "PATH": "fixture"})
        call = provider.calls[0]
        self.assertIn("--stage", call["args"])
        self.assertIn(SENTINEL.encode(), call["stdin"])
        self.assertNotIn(SENTINEL, str(call["args"]))
        self.assertNotIn(MODULE.BUNDLE_ENV, call["env"])
        self.assertNotIn("SPOTIFY_CLIENT_SECRET", call["env"])
        self.assertNotIn(SENTINEL, output.getvalue())

    def test_import_child_rejects_multiline_injection_before_fly(self):
        args = types.SimpleNamespace(component="api", fly_app=MODULE.STAGING_APPS["api"], expected_mail_host=None)
        values = api_values()
        values["SPOTIFY_CLIENT_SECRET"] = "synthetic\nAWS_ROLE_ARN=attack"
        bundle = {"schemaVersion": 1, "environment": "staging", "component": "api", "targetApp": args.fly_app, "values": values}
        provider = FakeProvider()
        with self.assertRaisesRegex(MODULE.SafeError, "bundle-value-control-character"):
            MODULE.import_child(args, provider, {MODULE.BUNDLE_ENV: json.dumps(bundle)})
        self.assertEqual(provider.calls, [])

    def test_direct_import_rejects_non_staging_target_before_fly(self):
        args = types.SimpleNamespace(component="api", fly_app="campusmate-production",
                                     expected_mail_host=None)
        bundle = {"schemaVersion": 1, "environment": "staging", "component": "api",
                  "targetApp": "campusmate-production", "values": api_values()}
        provider = FakeProvider()
        with self.assertRaisesRegex(MODULE.SafeError, "resolved-bundle-target-mismatch"):
            MODULE.import_child(args, provider, {MODULE.BUNDLE_ENV: json.dumps(bundle)})
        self.assertEqual(provider.calls, [])

    def test_wrapper_uses_one_environment_reference_and_profile_credentials(self):
        provider = FakeProvider(existing=True)
        output = io.StringIO()
        with patch.dict("os.environ", {"AWS_ACCESS_KEY_ID": SENTINEL, "AWS_SECRET_ACCESS_KEY": SENTINEL}, clear=False):
            with contextlib.redirect_stdout(output):
                MODULE.import_bundle(self.args(command="import"), provider)
        call = provider.calls[-1]
        self.assertEqual(call["env"][MODULE.BUNDLE_ENV],
                         "{{resolve:secretsmanager:" + MODULE.SECRET_IDS["api"] + "}}")
        self.assertNotIn("AWS_ACCESS_KEY_ID", call["env"])
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", call["env"])
        self.assertIn(str(MODULE.WRAPPER), call["args"])
        self.assertNotIn(SENTINEL, output.getvalue())

    def test_private_file_removed_on_provider_failure(self):
        path = None
        with self.assertRaisesRegex(MODULE.SafeError, "synthetic-failure"):
            with MODULE.private_json_input({"synthetic": SENTINEL}, FakeProvider()) as current:
                path = current
                self.assertTrue(path.exists())
                raise MODULE.SafeError("synthetic-failure")
        self.assertFalse(path.exists())
        self.assertFalse(path.parent.exists())

    def test_no_direct_aws_secret_read_or_loopback_fetch_in_transport(self):
        source = Path(MODULE.__file__).read_text(encoding="utf-8")
        for forbidden in ("get-secret-value", "batch-get-secret-value", "GetSecretValue", "urlopen", "urllib.request"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
