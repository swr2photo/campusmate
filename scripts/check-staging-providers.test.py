"""Offline provider contract, readiness, and redaction checks."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("providers", Path(__file__).with_name("check-staging-providers.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SENTINEL = "synthetic-secret-must-not-escape"


def envelope(component="api", values=None):
    return {MODULE.BUNDLE_ENV: json.dumps({
        "schemaVersion": 1, "environment": "staging", "component": component,
        "targetApp": MODULE.STAGING_APPS[component], "values": values or {},
    })}


class ProviderContracts(unittest.TestCase):
    def test_missing_configuration_cannot_pass_readiness(self):
        for component in ("api", "mail"):
            with patch.dict("os.environ", envelope(component), clear=True), patch.object(MODULE.sys, "argv", ["check"]):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(MODULE.main(), 1)
            self.assertIn("NOT_CONFIGURED", output.getvalue())

    def test_wrong_target_is_rejected_before_network(self):
        environ = envelope()
        bundle = json.loads(environ[MODULE.BUNDLE_ENV])
        bundle["targetApp"] = "campusmate-production"
        environ[MODULE.BUNDLE_ENV] = json.dumps(bundle)
        with patch.object(MODULE, "http_json") as network:
            self.assertEqual(MODULE.run(environ), {"status": "FAIL", "reason": "INVALID_BUNDLE"})
            network.assert_not_called()

    def test_places_query_uses_bounded_field_mask(self):
        with patch.object(MODULE, "http_json", return_value=(200, {})) as request:
            self.assertEqual(MODULE.places({"GOOGLE_PLACES_API_KEY": SENTINEL})["status"], "PASS")
        args, kwargs = request.call_args
        self.assertEqual(args[0], "https://places.googleapis.com/v1/places:autocomplete")
        self.assertEqual(kwargs["headers"]["X-Goog-FieldMask"], "suggestions.placePrediction.placeId")
        self.assertEqual(kwargs["body"]["includedRegionCodes"], ["th"])

    def test_livekit_only_lists_rooms_with_short_lived_list_grant(self):
        with patch.object(MODULE, "http_json", return_value=(200, {})) as request:
            result = MODULE.livekit({"LIVEKIT_API_KEY": "fixture-key", "LIVEKIT_API_SECRET": SENTINEL,
                                     "LIVEKIT_URL": "wss://campusmate-jmt5sy3c.livekit.cloud"})
        self.assertEqual(result["status"], "PASS")
        args, kwargs = request.call_args
        self.assertTrue(args[0].endswith("/twirp/livekit.RoomService/ListRooms"))
        self.assertEqual(kwargs["body"], {})
        encoded = kwargs["headers"]["Authorization"].split(".")[1]
        claims = json.loads(MODULE.base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        self.assertEqual(claims["video"], {"roomList": True})
        self.assertLessEqual(claims["exp"] - claims["nbf"], 65)

    def test_revenuecat_never_probes_customer_creation_endpoint(self):
        with patch.object(MODULE, "http_json", return_value=(403, None)) as request:
            result = MODULE.revenuecat({"REVENUECAT_SECRET_API_KEY": SENTINEL, "REVENUECAT_PROJECT_ID": "fixture"})
        self.assertEqual(result["status"], "INCONCLUSIVE")
        args, kwargs = request.call_args
        self.assertEqual(args[0], "https://api.revenuecat.com/v2/projects/fixture/apps?limit=1")
        self.assertNotIn("body", kwargs)

    def test_spotify_uses_client_credentials_without_printing_access_token(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = json.dumps({"access_token": SENTINEL,
                                                "token_type": "Bearer", "expires_in": 3600}).encode()
        opener = MagicMock()
        opener.open.return_value = response
        output = io.StringIO()
        with patch.object(MODULE, "build_opener", return_value=opener), contextlib.redirect_stdout(output):
            result = MODULE.spotify({"SPOTIFY_CLIENT_ID": "fixture", "SPOTIFY_CLIENT_SECRET": SENTINEL})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://accounts.spotify.com/api/token")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, b"grant_type=client_credentials")
        self.assertEqual(result, {"service": "spotify", "status": "PASS"})
        self.assertNotIn(SENTINEL, output.getvalue())

    def test_provider_redirects_cannot_forward_credentials(self):
        request = MODULE.Request("https://api.example.test", headers={"Authorization": SENTINEL})
        self.assertIsNone(MODULE.NoRedirect().redirect_request(
            request, None, 302, "redirect", {}, "https://other.example.test"))

    def test_provider_exceptions_and_inconclusive_checks_fail_without_leaking(self):
        for result in (RuntimeError(SENTINEL), MODULE.label("places", "INCONCLUSIVE", "READ_ONLY_PROBE_UNAVAILABLE")):
            mocked = {"side_effect": result} if isinstance(result, Exception) else {"return_value": result}
            with patch.dict("os.environ", envelope(), clear=True), patch.object(MODULE.sys, "argv", ["check"]), patch.object(MODULE, "places", **mocked):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(MODULE.main(), 1)
                self.assertNotIn(SENTINEL, output.getvalue())

    def test_smtp_check_authenticates_without_sending_email(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        smtp = connection.__enter__.return_value
        smtp.ehlo.return_value = (250, b"ok")
        smtp.login.return_value = (235, b"ok")
        smtp.noop.return_value = (250, b"ok")
        with patch.object(MODULE.smtplib, "SMTP", return_value=connection):
            result = MODULE.email({"SMTP_USER": "fixture@example.test", "SMTP_PASS": SENTINEL,
                                   "SMTP_HOST": "smtp.example.test", "SMTP_PORT": "587"})
        self.assertEqual(result["status"], "PASS")
        smtp.starttls.assert_called_once()
        for method in ("sendmail", "send_message", "mail", "rcpt", "data"):
            getattr(smtp, method).assert_not_called()


if __name__ == "__main__":
    unittest.main()
