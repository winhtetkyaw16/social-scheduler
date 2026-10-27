"""Registration, login, and refresh-token renewal."""

from uuid import uuid4


def test_register_login_and_refresh(client):
    email = f"user-{uuid4().hex[:8]}@example.com"
    password = "a-long-password"
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Ada Lovelace",
            "workspace_name": "Analytical Engines",
            "email": email,
            "password": password,
        },
    )
    assert registered.status_code == 201
    created = registered.json()
    assert created["email"] == email
    assert "password" not in created
    assert "password_hash" not in created

    logged_in = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert logged_in.status_code == 200
    tokens = logged_in.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 30 * 60

    me = client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200

    rejected = client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {tokens['refresh_token']}"})
    assert rejected.status_code == 401

    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    next_tokens = refreshed.json()
    assert next_tokens["access_token"]
    assert next_tokens["access_token"] != tokens["refresh_token"]
    again = client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {next_tokens['access_token']}"})
    assert again.status_code == 200

    bad = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401
