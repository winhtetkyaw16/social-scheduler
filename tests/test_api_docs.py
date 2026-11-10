"""Branded Swagger UI and self-hosted docs assets."""

from fastapi.testclient import TestClient

from app.main import app


def test_branded_docs_and_assets():
    client = TestClient(app)
    response = client.get("/docs")
    assert response.status_code == 200
    assert "/docs-assets/swagger-socialcastly.css" in response.text
    assert "social_studio_theme" in response.text
    assert f"v{app.version}" in response.text
    for asset_name in (
        "swagger-socialcastly.css",
        "swagger-ui.css",
        "swagger-ui-bundle.js",
        "socialcastly-lockup-light.png",
        "socialcastly-lockup-dark.png",
    ):
        assert client.get(f"/docs-assets/{asset_name}").status_code == 200, asset_name
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs/oauth2-redirect").status_code == 200
    assert client.get("/redoc").status_code == 200
