import base64, hashlib, hmac, json
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.endpoints.meta_callbacks import parse_signed_request


def _sr(secret, data):
    payload = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{sig}.{payload}"


def test_parse_signed_request():
    assert parse_signed_request(_sr("s", {"user_id": "1"}), "s") == {"user_id": "1"}
    assert parse_signed_request(_sr("s", {"user_id": "1"}), "other") is None


def test_meta_routes():
    c = TestClient(app)
    for p in ("threads", "facebook", "instagram"):
        assert c.post(f"/api/v1/accounts/{p}/uninstall", data={"signed_request": "x.y"}).status_code == 200
        r = c.post(f"/api/v1/accounts/{p}/delete", data={"signed_request": "x.y"})
        assert r.status_code == 200 and "confirmation_code" in r.json()
        assert c.get(f"/api/v1/accounts/{p}/data-deletion").status_code == 200
