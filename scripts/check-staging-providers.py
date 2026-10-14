#!/usr/bin/env python3
"""Read-only provider authentication checks using an asm-exec resolved bundle.

Input is CAMPUSMATE_STAGING_SERVICE_BUNDLE with the same staging envelope used
by staging-services.py. No secret is fetched or written here. Output contains
only fixed service/status/reason labels. No email, room, customer, or purchase
is created. Run this process through the pinned asm-exec wrapper, not with
secret values supplied as command-line arguments.

Primary references:
https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
https://docs.livekit.io/reference/other/roomservice-api/
https://docs.livekit.io/frontends/reference/tokens-grants/
https://www.revenuecat.com/docs/api-v2/app
https://www.revenuecat.com/docs/api-v1/customers
https://resend.com/docs/api-reference/domains/list-domains
https://docs.python.org/3/library/smtplib.html
"""

import base64
import hashlib
import hmac
import json
import os
import re
import smtplib
import ssl
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import (
    HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener,
)


BUNDLE_ENV = "CAMPUSMATE_STAGING_SERVICE_BUNDLE"
TIMEOUT = 12
MAX_RESPONSE = 1024 * 1024
STAGING_APPS = {
    "api": "campusmate-backend-502731779521",
    "mail": "campusmate-mail-staging-502731779521",
}
SERVICES = ("places", "spotify", "livekit", "revenuecat", "email")
STATUSES = ("PASS", "FAIL", "NOT_CONFIGURED", "INCONCLUSIVE")
REASONS = (
    "MISSING_CONFIGURATION", "AUTHENTICATION_CHECK_FAILED", "INVALID_BUNDLE",
    "PROJECT_ID_REQUIRED", "READ_ONLY_PROBE_UNAVAILABLE",
)


class SafeFailure(Exception):
    """Only constant codes are used; provider errors must never escape."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a key or signed JWT to a redirected destination.
        return None


def label(service, status, reason=None):
    if service not in SERVICES or status not in STATUSES or reason not in (None, *REASONS):
        raise SafeFailure()
    result = {"service": service, "status": status}
    if reason:
        result["reason"] = reason
    return result


def configured(values, key):
    value = values.get(key, "")
    return value if isinstance(value, str) and value.strip() else ""


def load_bundle(environ):
    try:
        bundle = json.loads(environ.get(BUNDLE_ENV, ""))
    except (TypeError, ValueError):
        raise SafeFailure() from None
    if (
        not isinstance(bundle, dict)
        or type(bundle.get("schemaVersion")) is not int
        or bundle["schemaVersion"] != 1
        or bundle.get("environment") != "staging"
        or bundle.get("component") not in ("api", "mail")
        or set(bundle) != {"schemaVersion", "environment", "component", "targetApp", "values"}
        or bundle.get("targetApp") != STAGING_APPS.get(bundle.get("component"))
        or not isinstance(bundle.get("values"), dict)
        or any(not isinstance(k, str) or not isinstance(v, str)
               for k, v in bundle["values"].items())
    ):
        raise SafeFailure()
    return bundle["component"], bundle["values"]


def http_json(url, *, headers=None, body=None):
    """Bounded verified HTTPS; no redirects, ambient proxies, or error text."""
    if urlsplit(url).scheme != "https":
        raise SafeFailure()
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(url, data=payload, headers={
        "Accept": "application/json", "User-Agent": "CampusMate-Staging-Check/1",
        **({"Content-Type": "application/json"} if payload is not None else {}),
        **(headers or {}),
    })
    opener = build_opener(ProxyHandler({}), NoRedirect(),
                          HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(request, timeout=TIMEOUT) as response:
            status = response.status
            raw = response.read(MAX_RESPONSE + 1)
    except HTTPError as error:
        status = error.code
        error.close()
        return status, None
    if len(raw) > MAX_RESPONSE:
        raise SafeFailure()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SafeFailure()
    return status, data


def places(values):
    key = configured(values, "GOOGLE_PLACES_API_KEY")
    if not key:
        return label("places", "NOT_CONFIGURED", "MISSING_CONFIGURATION")
    status, body = http_json(
        "https://places.googleapis.com/v1/places:autocomplete",
        headers={"X-Goog-Api-Key": key,
                 "X-Goog-FieldMask": "suggestions.placePrediction.placeId"},
        body={"input": "มหาวิทยาลัยสงขลานครินทร์", "includedRegionCodes": ["th"],
              "languageCode": "th"},
    )
    # An empty object is a valid protobuf response when no prediction matches.
    valid = status == 200 and isinstance(body, dict) and "error" not in body
    valid = valid and isinstance(body.get("suggestions", []), list)
    return label("places", "PASS" if valid else "FAIL",
                 None if valid else "AUTHENTICATION_CHECK_FAILED")


def spotify(values):
    client_id = configured(values, "SPOTIFY_CLIENT_ID")
    secret = configured(values, "SPOTIFY_CLIENT_SECRET")
    if not client_id or not secret:
        return label("spotify", "NOT_CONFIGURED", "MISSING_CONFIGURATION")
    authorization = base64.b64encode(f"{client_id}:{secret}".encode()).decode("ascii")
    # Spotify's token endpoint requires form encoding, unlike the JSON APIs.
    request = Request("https://accounts.spotify.com/api/token",
                      data=b"grant_type=client_credentials", headers={
                          "Authorization": "Basic " + authorization,
                          "Content-Type": "application/x-www-form-urlencoded",
                          "Accept": "application/json",
                      })
    opener = build_opener(ProxyHandler({}), NoRedirect(),
                          HTTPSHandler(context=ssl.create_default_context()))
    with opener.open(request, timeout=TIMEOUT) as response:
        status = response.status
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise SafeFailure()
    body = json.loads(raw)
    valid = (
        status == 200 and isinstance(body, dict)
        and isinstance(body.get("access_token"), str) and bool(body["access_token"])
        and str(body.get("token_type", "")).lower() == "bearer"
        and type(body.get("expires_in")) is int and body["expires_in"] > 0
    )
    return label("spotify", "PASS" if valid else "FAIL",
                 None if valid else "AUTHENTICATION_CHECK_FAILED")


def b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def livekit(values):
    key = configured(values, "LIVEKIT_API_KEY")
    secret = configured(values, "LIVEKIT_API_SECRET")
    origin = configured(values, "LIVEKIT_URL")
    if not key or not secret or not origin:
        return label("livekit", "NOT_CONFIGURED", "MISSING_CONFIGURATION")
    parsed = urlsplit(origin)
    if (
        parsed.scheme not in ("wss", "https") or parsed.username or parsed.password
        or parsed.path not in ("", "/") or parsed.query or parsed.fragment
        or parsed.port not in (None, 443) or not parsed.hostname
        or not parsed.hostname.endswith(".livekit.cloud")
    ):
        raise SafeFailure()
    now = int(time.time())
    header = b64url(b'{"alg":"HS256","typ":"JWT"}')
    claims = b64url(json.dumps({"iss": key, "nbf": now - 5, "exp": now + 60,
                               "video": {"roomList": True}}, separators=(",", ":")).encode())
    signed = header + "." + claims
    token = signed + "." + b64url(hmac.new(secret.encode(), signed.encode(), hashlib.sha256).digest())
    status, body = http_json(
        "https://" + parsed.hostname + "/twirp/livekit.RoomService/ListRooms",
        headers={"Authorization": "Bearer " + token}, body={},
    )
    valid = status == 200 and isinstance(body, dict) and "code" not in body
    valid = valid and isinstance(body.get("rooms", []), list)
    return label("livekit", "PASS" if valid else "FAIL",
                 None if valid else "AUTHENTICATION_CHECK_FAILED")


def revenuecat(values):
    key = configured(values, "REVENUECAT_SECRET_API_KEY")
    project = configured(values, "REVENUECAT_PROJECT_ID")
    if not key:
        return label("revenuecat", "NOT_CONFIGURED", "MISSING_CONFIGURATION")
    if not project:
        return label("revenuecat", "NOT_CONFIGURED", "PROJECT_ID_REQUIRED")
    # V1 GET /subscribers/{id} creates missing customers, so never probe it.
    # Both generations use sk_ keys; prefix inspection cannot establish version.
    status, body = http_json(
        "https://api.revenuecat.com/v2/projects/" + quote(project, safe="") + "/apps?limit=1",
        headers={"Authorization": "Bearer " + key},
    )
    if status == 403:
        # A valid V1 key or a V2 key without apps:read may reject this check.
        return label("revenuecat", "INCONCLUSIVE", "READ_ONLY_PROBE_UNAVAILABLE")
    valid = status == 200 and isinstance(body, dict) and isinstance(body.get("items"), list)
    return label("revenuecat", "PASS" if valid else "FAIL",
                 None if valid else "AUTHENTICATION_CHECK_FAILED")


def email(values):
    key = configured(values, "RESEND_API_KEY")
    if key:
        status, body = http_json("https://api.resend.com/domains?limit=1",
                                 headers={"Authorization": "Bearer " + key})
        if status == 403:
            # Sending-only keys cannot list domains; this does not prove failure
            # to send, and widening provider permissions is not part of a check.
            return label("email", "INCONCLUSIVE", "READ_ONLY_PROBE_UNAVAILABLE")
        valid = status == 200 and isinstance(body, dict) and isinstance(body.get("data"), list)
        return label("email", "PASS" if valid else "FAIL",
                     None if valid else "AUTHENTICATION_CHECK_FAILED")
    user = configured(values, "SMTP_USER") or configured(values, "GMAIL_SMTP_USER")
    password = (configured(values, "SMTP_PASS") or configured(values, "GMAIL_SMTP_PASS")
                or configured(values, "GMAIL_APP_PASSWORD"))
    if not user or not password:
        return label("email", "NOT_CONFIGURED", "MISSING_CONFIGURATION")
    host = configured(values, "SMTP_HOST") or "smtp.gmail.com"
    port = int(configured(values, "SMTP_PORT") or "587")
    if (port not in (465, 587) or len(host) > 253
            or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host)
            or "." not in host):
        raise SafeFailure()
    context = ssl.create_default_context()
    if port == 465:
        connection = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=context)
    else:
        connection = smtplib.SMTP(host, port, timeout=TIMEOUT)
    with connection as smtp:
        if smtp.ehlo()[0] != 250:
            raise SafeFailure()
        if port == 587:
            smtp.starttls(context=context)
            if smtp.ehlo()[0] != 250:
                raise SafeFailure()
        if smtp.login(user, password)[0] not in (235, 503):
            raise SafeFailure()
        if smtp.noop()[0] != 250:
            raise SafeFailure()
    return label("email", "PASS")


def run(environ=None):
    try:
        component, values = load_bundle(os.environ if environ is None else environ)
    except Exception:
        return {"status": "FAIL", "reason": "INVALID_BUNDLE"}
    checks = []
    probes = (("places", places), ("spotify", spotify), ("livekit", livekit),
              ("revenuecat", revenuecat)) if component == "api" else (("email", email),)
    for service, probe in probes:
        try:
            checks.append(probe(values))
        except Exception:
            # Exceptions can contain provider bodies, auth headers, hostnames,
            # user addresses, or tokens. Never stringify or print them.
            checks.append(label(service, "FAIL", "AUTHENTICATION_CHECK_FAILED"))
    return {"component": component, "checks": checks}


def main():
    if len(sys.argv) != 1:
        output = {"status": "FAIL", "reason": "INVALID_BUNDLE"}
    else:
        try:
            output = run()
        except BaseException:
            output = {"status": "FAIL", "reason": "AUTHENTICATION_CHECK_FAILED"}
    print(json.dumps(output, sort_keys=True))
    # Readiness succeeds only when every applicable authentication check passed.
    # Missing configuration and safe-probe limitations remain explicit blockers.
    return int(output.get("status") == "FAIL" or any(
        check["status"] != "PASS" for check in output.get("checks", [])
    ))


if __name__ == "__main__":
    sys.exit(main())
