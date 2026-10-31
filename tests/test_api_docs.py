from fastapi.testclient import TestClient

from app.main import app


def test_branded_docs_and_assets():
    c = TestClient(app)
    r = c.get("/docs")
    assert r.status_code == 200
    assert "/docs-assets/swagger-socialcastly.css" in r.text
    assert "social_studio_theme" in r.text
    assert f"v{app.version}" in r.text
    for p in ("swagger-socialcastly.css", "swagger-ui.css", "swagger-ui-bundle.js",
              "socialcastly-lockup-light.png", "socialcastly-lockup-dark.png"):
        assert c.get(f"/docs-assets/{p}").status_code == 200, p
    assert c.get("/openapi.json").status_code == 200
    assert c.get("/docs/oauth2-redirect").status_code == 200
    assert c.get("/redoc").status_code == 200
