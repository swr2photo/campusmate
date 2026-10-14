#!/usr/bin/env python3
"""Move scoped staging service configuration without displaying secret values.

Inventory reads local key names and optional GCP version metadata only. Publish
captures whitelisted values in memory, then writes one short-lived private AWS
CLI input file. Import resolves the encrypted bundle only through the pinned
official asm-exec wrapper and sends Fly secrets through stdin. No delivery,
deployment, production switchover, or AWS secret-read API is performed here.
"""

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from contextlib import contextmanager
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "artifacts/tooling/aws-secrets-manager/references/asm-exec"
WRAPPER_SHA256 = "05a9f8164b63b286bcf88bf4223c95b799e0ecaada45ddcd805567f57b20299f"
BUNDLE_ENV = "CAMPUSMATE_STAGING_SERVICE_BUNDLE"
PREFIX = "campusmate/staging/services/"
EXPECTED_AWS_REGION = "ap-southeast-7"
EXPECTED_AWS_PROJECT = "502731779521"
EXPECTED_GCP_PROJECT = "campusmate-7f1ab"
EXPECTED_ORGANIZATION = "o-0yiwm4s86j"
EXPECTED_MAIL_HOST = "ep-young-bonus-b3777j39-pooler.c-4.ap-southeast-1.aws.neon.tech"
EXPECTED_EMAIL_ORIGIN = "https://campusmate-backend-502731779521.fly.dev"
STAGING_APPS = {
    "api": "campusmate-backend-502731779521",
    "mail": "campusmate-mail-staging-502731779521",
}
SECRET_IDS = {component: PREFIX + component for component in STAGING_APPS}
KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
REGION = re.compile(r"^[a-z]{2}(?:-[a-z0-9]+)+-\d+$")
APP = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
GCP_API = (
    "GOOGLE_PLACES_API_KEY", "REVENUECAT_SECRET_API_KEY",
    "REVENUECAT_WEBHOOK_AUTHORIZATION", "R2_UPLOAD_SIGNING_KEY",
)
GCP_MAIL = ("CAMPUSMATE_NEON_SCHEMA_CHECK_MAIL", "CAMPUSMATE_ADMIN_SMTP_CONFIG")
LOCAL_API = (
    "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL",
    "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET",
)
LIVEKIT_KEYS = LOCAL_API[:3]
API_CONFIG = ("R2_WORKER_ORIGIN", "CAMPUSMATE_PLUS_ENABLED", "REVENUECAT_PROJECT_ID")
LOCAL_CONFIG = API_CONFIG + ("CAMPUSMATE_R2_WORKER_DOMAIN",)
SMTP_KEYS = (
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "CAMPUS_EMAIL_FROM",
    "CAMPUS_EMAIL_FROM_NAME", "RESEND_API_KEY",
)
MAIL_CONFIG = ("DATABASE_URL", "NATIVE_AUTH_EMAIL_ORIGIN", "APP_ENV")


class SafeError(Exception):
    """Only fixed, value-free codes may escape secret-handling functions."""


def emit(value):
    print(json.dumps(value, sort_keys=True))


class Provider:
    def run(self, args, *, stdin=None, env=None, timeout=120):
        executable = shutil.which(args[0])
        if not executable:
            raise SafeError("required-command-unavailable")
        command = [executable, *args[1:]]
        # Execute gcloud's actual Python entrypoint, never a Windows batch
        # interpreter: even metadata arguments must not become shell code.
        if os.name == "nt" and executable.lower().endswith((".cmd", ".bat")):
            sdk = Path(executable).resolve().parents[1]
            entrypoint = sdk / "lib/gcloud.py"
            bundled = sdk / "platform/bundledpython/python.exe"
            if args[0] != "gcloud" or not entrypoint.is_file():
                raise SafeError("native-command-entrypoint-required")
            command = [str(bundled) if bundled.is_file() else sys.executable,
                       str(entrypoint), *args[1:]]
        try:
            return subprocess.run(command, input=stdin, capture_output=True,
                                  env=env, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise SafeError("provider-command-failed") from None

    def checked(self, args, **kwargs):
        result = self.run(args, **kwargs)
        if result.returncode:
            # Provider errors sometimes echo payloads. Never forward either
            # stdout, stderr, or the exception text to the operator/agent.
            raise SafeError("provider-command-rejected")
        return result.stdout


def decode_json(raw):
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError, TypeError):
        raise SafeError("provider-json-invalid") from None


def local_keys(path):
    """Do not parse, retain, or return the right-hand side during inventory."""
    if not path.exists():
        return []
    found = set()
    try:
        with path.open(encoding="utf-8-sig") as source:
            for line in source:
                match = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=", line)
                if match and match[1] in LOCAL_API + LOCAL_CONFIG:
                    found.add(match[1])
    except (OSError, UnicodeError):
        raise SafeError("local-key-inventory-failed") from None
    return sorted(found)


def load_local_values(paths):
    result = {}
    for path in paths:
        if not path.exists():
            continue
        try:
            with path.open(encoding="utf-8-sig") as source:
                for line in source:
                    match = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$", line)
                    if not match or match[1] not in LOCAL_API + LOCAL_CONFIG:
                        continue
                    value = match[2].strip()
                    if value.startswith(("'", '"')):
                        quote = value[0]
                        end = value.find(quote, 1)
                        tail = value[end + 1:].strip() if end >= 0 else ""
                        if end < 0 or (tail and not tail.startswith("#")):
                            raise SafeError("local-env-quoted-value-invalid")
                        value = value[1:end]
                    else:
                        value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
                    # No shell evaluation, expansion or ambiguous escapes.
                    if "${" in value or "$(" in value or "\\" in value or "{{resolve:" in value:
                        raise SafeError("local-env-expansion-not-supported")
                    result[match[1]] = value
        except (OSError, UnicodeError):
            raise SafeError("local-env-load-failed") from None
    return result


def gcp_versions(provider, project, secret):
    raw = provider.checked(["gcloud", "secrets", "versions", "list", secret,
                            "--project", project, "--format=json(name,state)", "--quiet"])
    versions = decode_json(raw)
    if not isinstance(versions, list):
        raise SafeError("gcp-version-metadata-invalid")
    numbers = []
    for version in versions:
        name = version.get("name", "") if isinstance(version, dict) else ""
        number = name.rsplit("/", 1)[-1]
        if number.isdigit() and version.get("state") == "ENABLED":
            numbers.append(int(number))
    return sorted(numbers)


def gcp_value(provider, project, secret):
    versions = gcp_versions(provider, project, secret)
    if not versions:
        raise SafeError("gcp-enabled-version-missing")
    raw = provider.checked(["gcloud", "secrets", "versions", "access", str(versions[-1]),
                            "--secret", secret, "--project", project, "--quiet"])
    try:
        return raw.decode("utf-8").rstrip("\r\n")
    except UnicodeError:
        raise SafeError("gcp-secret-encoding-invalid") from None


def https_origin(value):
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname and "." in parsed.hostname
                 and not parsed.username and not parsed.password and not parsed.query
                 and not parsed.fragment and parsed.path in ("", "/")
                 and parsed.port in (None, 443))
    except ValueError:
        valid = False
    if not valid or any(c.isspace() for c in value):
        raise SafeError("https-origin-invalid")
    return value.rstrip("/")


def validate_values(values, component, expected_mail_host=None):
    allowed = set(GCP_API + LOCAL_API + API_CONFIG if component == "api"
                  else SMTP_KEYS + MAIL_CONFIG)
    if not isinstance(values, dict) or not set(values).issubset(allowed):
        raise SafeError("bundle-keys-invalid")
    for key, value in values.items():
        if not KEY.fullmatch(key) or not isinstance(value, str) or not value:
            raise SafeError("bundle-value-empty-or-invalid")
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise SafeError("bundle-value-control-character")
    required = set(GCP_API + LOCAL_API[3:] + ("R2_WORKER_ORIGIN", "CAMPUSMATE_PLUS_ENABLED")) if component == "api" else set(MAIL_CONFIG + ("CAMPUS_EMAIL_FROM", "CAMPUS_EMAIL_FROM_NAME"))
    if not required.issubset(values):
        raise SafeError("bundle-required-key-missing")
    if component == "api":
        https_origin(values["R2_WORKER_ORIGIN"])
        if len(values["R2_UPLOAD_SIGNING_KEY"]) < 32 or len(values["REVENUECAT_WEBHOOK_AUTHORIZATION"]) < 24:
            raise SafeError("bundle-signing-key-too-short")
        if values["CAMPUSMATE_PLUS_ENABLED"] != "true":
            raise SafeError("bundle-membership-flag-invalid")
        present_livekit = set(LIVEKIT_KEYS).intersection(values)
        if present_livekit and present_livekit != set(LIVEKIT_KEYS):
            raise SafeError("bundle-livekit-group-incomplete")
        if present_livekit:
            try:
                url = urlsplit(values["LIVEKIT_URL"])
                valid = (url.scheme == "wss" and url.hostname and not url.username and not url.password
                         and url.path in ("", "/") and not url.query and not url.fragment
                         and url.port in (None, 443))
            except ValueError:
                valid = False
            if not valid:
                raise SafeError("bundle-livekit-url-invalid")
    else:
        https_origin(values["NATIVE_AUTH_EMAIL_ORIGIN"])
        if values["APP_ENV"] != "production":
            raise SafeError("bundle-mail-runtime-mode-invalid")
        if not values.get("RESEND_API_KEY"):
            if not all(values.get(k) for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS")):
                raise SafeError("bundle-smtp-credentials-missing")
            if values["SMTP_PORT"] not in ("465", "587"):
                raise SafeError("bundle-smtp-tls-port-required")
        try:
            url = urlsplit(values["DATABASE_URL"])
            valid = (url.scheme in ("postgres", "postgresql") and url.hostname == expected_mail_host
                     and unquote(url.username or "") == "campusmate_mail_login"
                     and bool(url.password) and url.path not in ("", "/")
                     and parse_qs(url.query) == {"sslmode": ["verify-full"]}
                     and "-pooler." in (url.hostname or "") and not url.fragment)
        except ValueError:
            valid = False
        if not expected_mail_host or not valid:
            raise SafeError("bundle-mail-staging-database-invalid")


def collect_bundle(args, provider):
    if args.gcp_project != EXPECTED_GCP_PROJECT:
        raise SafeError("gcp-project-mismatch")
    try:
        if args.repo.resolve() != ROOT.resolve():
            raise SafeError("workspace-root-mismatch")
    except OSError:
        raise SafeError("workspace-root-unavailable") from None
    if args.component == "api":
        local = load_local_values([args.repo / ".env", args.repo / "functions/.env"])
        values = {key: local[key] for key in LOCAL_API if local.get(key)}
        if not all(values.get(key) for key in LIVEKIT_KEYS):
            if not getattr(args, "defer_livekit", False):
                raise SafeError("livekit-secure-input-required")
            for key in LIVEKIT_KEYS:
                values.pop(key, None)
        values.update({key: gcp_value(provider, EXPECTED_GCP_PROJECT, key) for key in GCP_API})
        worker_origin = args.worker_origin or local.get("R2_WORKER_ORIGIN", "")
        if not worker_origin:
            domain = local.get("CAMPUSMATE_R2_WORKER_DOMAIN", "")
            worker_origin = domain if "://" in domain else "https://" + domain
        values["R2_WORKER_ORIGIN"] = https_origin(worker_origin)
        values["CAMPUSMATE_PLUS_ENABLED"] = "true"
        project = args.revenuecat_project_id or local.get("REVENUECAT_PROJECT_ID", "")
        if project:
            values["REVENUECAT_PROJECT_ID"] = project
    else:
        smtp = decode_json(gcp_value(provider, EXPECTED_GCP_PROJECT, GCP_MAIL[1]))
        if not isinstance(smtp, dict) or not set(smtp).issubset(SMTP_KEYS):
            raise SafeError("smtp-aggregate-keys-invalid")
        values = {key: str(value) for key, value in smtp.items()
                  if key in SMTP_KEYS and isinstance(value, (str, int))
                  and not isinstance(value, bool) and value != ""}
        values["DATABASE_URL"] = gcp_value(provider, EXPECTED_GCP_PROJECT, GCP_MAIL[0])
        values["NATIVE_AUTH_EMAIL_ORIGIN"] = https_origin(args.email_origin or "")
        values["APP_ENV"] = "production"  # TLS-enforcing runtime mode, still staging data.
    validate_values(values, args.component,
                    EXPECTED_MAIL_HOST if args.component == "mail" else None)
    return {"schemaVersion": 1, "environment": "staging", "component": args.component,
            "targetApp": STAGING_APPS[args.component], "values": values}


def aws_args(args, operation):
    return ["aws", *operation, "--profile", args.aws_profile, "--region", EXPECTED_AWS_REGION,
            "--output", "json", "--no-cli-pager"]


def validate_scope(args):
    if not args.apply:
        raise SafeError("explicit-apply-required")
    if (not REGION.fullmatch(args.aws_region)
            or args.aws_region != EXPECTED_AWS_REGION
            or args.confirmed_region != EXPECTED_AWS_REGION):
        raise SafeError("confirmed-selected-region-required")
    if (not re.fullmatch(r"\d{12}", args.expected_aws_project)
            or args.expected_aws_project != EXPECTED_AWS_PROJECT):
        raise SafeError("aws-project-id-invalid")
    target_app = STAGING_APPS[args.component]
    if (not APP.fullmatch(args.fly_app) or args.fly_app != target_app
            or args.confirmed_staging_app != target_app):
        raise SafeError("confirmed-staging-app-required")
    if args.secret_id != SECRET_IDS[args.component]:
        raise SafeError("staging-secret-id-required")
    if args.component == "mail":
        if getattr(args, "defer_livekit", False):
            raise SafeError("unexpected-livekit-deferral")
        if args.expected_mail_host != EXPECTED_MAIL_HOST:
            raise SafeError("expected-staging-mail-host-required")
        if getattr(args, "email_origin", EXPECTED_EMAIL_ORIGIN) != EXPECTED_EMAIL_ORIGIN:
            raise SafeError("expected-staging-email-origin-required")
    elif args.expected_mail_host:
        raise SafeError("unexpected-mail-host")
    if hasattr(args, "gcp_project") and args.gcp_project != EXPECTED_GCP_PROJECT:
        raise SafeError("gcp-project-mismatch")
    if hasattr(args, "repo"):
        try:
            if args.repo.resolve() != ROOT.resolve():
                raise SafeError("workspace-root-mismatch")
        except OSError:
            raise SafeError("workspace-root-unavailable") from None


def validate_import_scope(args):
    target_app = STAGING_APPS[args.component]
    if args.fly_app != target_app:
        raise SafeError("resolved-bundle-target-mismatch")
    if args.component == "mail":
        if args.expected_mail_host != EXPECTED_MAIL_HOST:
            raise SafeError("expected-staging-mail-host-required")
    elif args.expected_mail_host:
        raise SafeError("unexpected-mail-host")


def preflight(args, provider):
    validate_scope(args)
    identity = decode_json(provider.checked(aws_args(args, ["sts", "get-caller-identity"])))
    if not isinstance(identity, dict) or identity.get("Account") != EXPECTED_AWS_PROJECT:
        raise SafeError("aws-project-identity-mismatch")
    result = provider.run(aws_args(args, ["freetier", "get-account-plan-state"]))
    if not result.returncode:
        state = decode_json(result.stdout)
        if not isinstance(state, dict) or state.get("accountPlanType") != "PAID":
            raise SafeError("aws-paid-plan-required")
    else:
        # AWS Settings was inspected: advanced features are active. AWS requires
        # upgrading before activation. This explicit fallback handles missing
        # Free Tier metadata only; it must never turn an access-denied/free
        # response into permission to proceed. Verify the exact organization.
        # https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html
        if (b"ResourceNotFoundException" not in result.stderr
                or getattr(args, "verified_advanced_organization", None) != EXPECTED_ORGANIZATION):
            raise SafeError("aws-plan-verification-unavailable")
        organization = decode_json(provider.checked([
            "aws", "organizations", "describe-organization", "--profile", args.aws_profile,
            "--region", "ap-southeast-2", "--output", "json", "--no-cli-pager",
        ])).get("Organization", {})
        if organization.get("Id") != EXPECTED_ORGANIZATION or organization.get("FeatureSet") != "ALL":
            raise SafeError("verified-advanced-organization-mismatch")


def expected_tags(args):
    return {"Environment": "staging", "Project": "CampusMate",
            "Component": args.component, "FlyApp": STAGING_APPS[args.component]}


def describe_bundle(args, provider):
    result = provider.run(aws_args(args, ["secretsmanager", "describe-secret",
                                          "--secret-id", SECRET_IDS[args.component]]))
    if result.returncode:
        if b"ResourceNotFoundException" in result.stderr:
            return None
        raise SafeError("aws-secret-metadata-unavailable")
    metadata = decode_json(result.stdout)
    if not isinstance(metadata, dict) or not isinstance(metadata.get("Tags", []), list):
        raise SafeError("aws-secret-metadata-invalid")
    tags = {tag.get("Key"): tag.get("Value") for tag in metadata.get("Tags", [])
            if isinstance(tag, dict)}
    if any(tags.get(k) != v for k, v in expected_tags(args).items()):
        raise SafeError("existing-secret-staging-tags-mismatch")
    arn_prefix = f"arn:aws:secretsmanager:{EXPECTED_AWS_REGION}:{EXPECTED_AWS_PROJECT}:secret:"
    if (metadata.get("Name") != SECRET_IDS[args.component]
            or not metadata.get("ARN", "").startswith(arn_prefix)):
        raise SafeError("aws-secret-location-mismatch")
    return metadata


@contextmanager
def private_json_input(payload, provider):
    directory = Path(tempfile.mkdtemp(prefix="campusmate-staging-secrets-"))
    path = directory / "input.json"
    try:
        if os.name == "nt":
            raw = provider.checked(["whoami", "/user", "/fo", "csv", "/nh"])
            try:
                rows = list(csv.reader(io.StringIO(raw.decode("utf-8"))))
                sid = rows[0][1]
            except (ValueError, IndexError, UnicodeError):
                raise SafeError("private-temp-owner-unavailable") from None
            if not re.fullmatch(r"S-\d+(?:-\d+)+", sid):
                raise SafeError("private-temp-owner-invalid")
            provider.checked(["icacls", str(directory), "/inheritance:r", "/grant:r", f"*{sid}:(OI)(CI)F"])
        else:
            directory.chmod(0o700)
        descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(payload, output, separators=(",", ":"))
        yield path
    finally:
        try:
            if path.exists():
                path.unlink()
            directory.rmdir()
        except OSError:
            raise SafeError("private-secret-temp-cleanup-failed") from None


def publish(args, provider):
    preflight(args, provider)
    existing = describe_bundle(args, provider)
    bundle = collect_bundle(args, provider)
    payload = {"SecretString": json.dumps(bundle, separators=(",", ":")),
               "ClientRequestToken": str(uuid.uuid4())}
    if existing:
        operation = "put-secret-value"
        payload["SecretId"] = SECRET_IDS[args.component]
    else:
        operation = "create-secret"
        payload.update({"Name": SECRET_IDS[args.component],
                        "Description": "Scoped CampusMate staging service transport",
                        "Tags": [{"Key": k, "Value": v} for k, v in expected_tags(args).items()]})
    with private_json_input(payload, provider) as path:
        provider.checked(aws_args(args, ["secretsmanager", operation, "--cli-input-json", "file://" + str(path)]))
    emit({"status": "staging-bundle-published", "component": args.component,
          "secretId": SECRET_IDS[args.component], "keys": sorted(bundle["values"]),
          "livekitConfigured": all(key in bundle["values"] for key in LIVEKIT_KEYS) if args.component == "api" else None,
          "plaintextTemporaryFileRemoved": True})


def import_child(args, provider, environ=None):
    validate_import_scope(args)
    environ = dict(os.environ if environ is None else environ)
    raw = environ.pop(BUNDLE_ENV, "")
    bundle = decode_json(raw)
    if (not isinstance(bundle, dict) or set(bundle) != {"schemaVersion", "environment", "component", "targetApp", "values"}
            or type(bundle.get("schemaVersion")) is not int or bundle.get("schemaVersion") != 1
            or bundle.get("environment") != "staging"
            or bundle.get("component") != args.component
            or bundle.get("targetApp") != STAGING_APPS[args.component]):
        raise SafeError("resolved-bundle-scope-mismatch")
    values = bundle["values"]
    validate_values(values, args.component,
                    EXPECTED_MAIL_HOST if args.component == "mail" else None)
    # Fly accepts dotenv stdin. JSON strings safely retain spaces, quotes, '#',
    # and '='; controls/newlines are rejected before serialisation.
    payload = "".join(f"{key}={json.dumps(values[key], ensure_ascii=False)}\n" for key in sorted(values)).encode("utf-8")
    # Remove any inherited variables with those same secret names as well.
    for key in values:
        environ.pop(key, None)
    provider.checked(["fly", "secrets", "import", "--app",
                      STAGING_APPS[args.component], "--stage"],
                     stdin=payload, env=environ, timeout=180)
    emit({"status": "fly-secrets-staged", "component": args.component,
          "app": STAGING_APPS[args.component], "keys": sorted(values), "deployed": False})


def import_bundle(args, provider):
    preflight(args, provider)
    if describe_bundle(args, provider) is None:
        raise SafeError("staging-secret-not-found")
    try:
        digest = hashlib.sha256(args.asm_exec.read_bytes()).hexdigest()
    except OSError:
        raise SafeError("official-asm-exec-unavailable") from None
    if digest != WRAPPER_SHA256:
        raise SafeError("official-asm-exec-hash-mismatch")
    env = {k: v for k, v in os.environ.items() if "{{resolve:" not in v}
    # The wrapper otherwise prefers ambient static credentials over the
    # selected login profile. Force the same profile whose identity was checked.
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN"):
        env.pop(key, None)
    env.update({"AWS_PROFILE": args.aws_profile, "AWS_REGION": args.aws_region,
                "AWS_DEFAULT_REGION": args.aws_region,
                "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off",
                "AWS_SECRETS_MANAGER_AGENT_ENDPOINT": "http://localhost:2773",
                "ASM_EXEC_MCP_ENDPOINT": "https://aws-mcp.us-east-1.api.aws/mcp",
                BUNDLE_ENV: "{{resolve:secretsmanager:" + SECRET_IDS[args.component] + "}}"})
    # The dynamic reference goes through the exact unmodified official wrapper.
    # Child argv contains no resolved value; only its environment holds a bundle.
    command = [sys.executable, str(args.asm_exec), "--", sys.executable,
               str(Path(__file__).resolve()), "_import", "--component", args.component,
               "--fly-app", STAGING_APPS[args.component]]
    if args.component == "mail":
        command.extend(["--expected-mail-host", EXPECTED_MAIL_HOST])
    provider.checked(command, env=env, timeout=240)
    emit({"status": "fly-secrets-staged", "component": args.component,
          "app": STAGING_APPS[args.component], "deployed": False})


def inventory(args, provider):
    if args.gcp_project != EXPECTED_GCP_PROJECT:
        raise SafeError("gcp-project-mismatch")
    try:
        if args.repo.resolve() != ROOT.resolve():
            raise SafeError("workspace-root-mismatch")
    except OSError:
        raise SafeError("workspace-root-unavailable") from None
    files = {str(path.relative_to(args.repo)): local_keys(path)
             for path in (args.repo / ".env", args.repo / "functions/.env")}
    report = {"status": "key-inventory-only", "local": files,
              "requiredLocalKeys": list(LOCAL_API), "gcp": {}}
    if args.gcp_metadata:
        for secret in GCP_API + GCP_MAIL:
            try:
                versions = gcp_versions(provider, EXPECTED_GCP_PROJECT, secret)
                report["gcp"][secret] = {"enabledVersions": versions, "available": bool(versions)}
            except SafeError:
                report["gcp"][secret] = {"available": False, "status": "metadata-unavailable"}
    emit(report)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    inv = commands.add_parser("inventory", help="Print key names; optional GCP version metadata. Never reads payloads.")
    inv.add_argument("--repo", type=Path, default=ROOT)
    inv.add_argument("--gcp-project", default=EXPECTED_GCP_PROJECT)
    inv.add_argument("--gcp-metadata", action="store_true")
    for operation in ("publish", "import"):
        child = commands.add_parser(operation, help="Explicit staging-only " + operation + "; requires --apply.")
        child.add_argument("--component", choices=("api", "mail"), required=True)
        child.add_argument("--aws-profile", default="campusmate")
        child.add_argument("--aws-region", required=True)
        child.add_argument("--confirmed-region", required=True)
        child.add_argument("--expected-aws-project", default=EXPECTED_AWS_PROJECT)
        child.add_argument("--verified-advanced-organization", choices=(EXPECTED_ORGANIZATION,),
                           help="Use only after verifying advanced activation in AWS Settings; handles missing Free Tier metadata.")
        child.add_argument("--secret-id", required=True, help=PREFIX + "api or " + PREFIX + "mail")
        child.add_argument("--fly-app", required=True)
        child.add_argument("--confirmed-staging-app", required=True)
        child.add_argument("--expected-mail-host")
        child.add_argument("--apply", action="store_true")
        if operation == "publish":
            child.add_argument("--repo", type=Path, default=ROOT)
            child.add_argument("--gcp-project", default=EXPECTED_GCP_PROJECT)
            child.add_argument("--worker-origin")
            child.add_argument("--email-origin")
            child.add_argument("--revenuecat-project-id")
            child.add_argument("--defer-livekit", action="store_true",
                               help="Explicitly publish available services while awaiting secure LiveKit input; readiness still fails until configured.")
        else:
            child.add_argument("--asm-exec", type=Path, default=WRAPPER)
    internal = commands.add_parser("_import", help=argparse.SUPPRESS)
    internal.add_argument("--component", choices=("api", "mail"), required=True)
    internal.add_argument("--fly-app", required=True)
    internal.add_argument("--expected-mail-host")
    return result


def main(argv=None, provider=None):
    args = parser().parse_args(argv)
    provider = provider or Provider()
    try:
        if args.command == "inventory":
            inventory(args, provider)
        elif args.command == "publish":
            publish(args, provider)
        elif args.command == "import":
            import_bundle(args, provider)
        else:
            import_child(args, provider)
        return 0
    except SafeError as error:
        emit({"status": "failed", "code": str(error)})
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        # A traceback could include a payload. Unknown errors stay value-free.
        emit({"status": "failed", "code": "unexpected-operation-failure"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
