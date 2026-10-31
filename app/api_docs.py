"""Branded (SocialCastly) Swagger UI for /docs, served with self-hosted assets."""

import json
from html import escape
from pathlib import Path

from fastapi import FastAPI
from fastapi.openapi.docs import get_swagger_ui_oauth2_redirect_html
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

DOCS_ASSETS_DIR = Path(__file__).resolve().parent / "static" / "docs"
DOCS_ASSETS_URL = "/docs-assets"
# Same key the SPA uses (frontend/src/main.jsx THEME_KEY) so docs follow the app theme.
THEME_STORAGE_KEY = "social_studio_theme"


def _docs_html(app: FastAPI, oauth2_redirect_url: str) -> str:
    a = DOCS_ASSETS_URL
    openapi_url = app.openapi_url or "/openapi.json"
    title = escape(f"{app.title} · API")
    version = escape(app.version or "")
    key = json.dumps(THEME_STORAGE_KEY)
    cfg = json.dumps(
        {
            "url": openapi_url,
            "dom_id": "#swagger-ui",
            "layout": "BaseLayout",
            "deepLinking": True,
            "docExpansion": "list",
            "defaultModelsExpandDepth": -1,
            "persistAuthorization": True,
            "showExtensions": True,
            "showCommonExtensions": True,
        }
    )
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<script>(function(){{var K={key},t=new URLSearchParams(location.search).get('theme');
if(t!=='dark'&&t!=='light'){{try{{t=localStorage.getItem(K)}}catch(e){{}}}}
if(t!=='dark'&&t!=='light'){{t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}}
document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('dark',t==='dark');
window.tt=function(){{var n=document.documentElement.dataset.theme==='dark'?'light':'dark';
document.documentElement.dataset.theme=n;document.documentElement.classList.toggle('dark',n==='dark');
try{{localStorage.setItem(K,n)}}catch(e){{}}}};}})();</script>
<link rel="stylesheet" href="{a}/swagger-ui.css">
<link rel="stylesheet" href="{a}/swagger-socialcastly.css">
</head><body>
<header class="sc-head"><img class="l" src="{a}/socialcastly-lockup-light.png" alt="socialcastly"><img class="d" src="{a}/socialcastly-lockup-dark.png" alt="socialcastly"><span class="tag">API</span><span class="ver">v{version}</span><span class="sp"></span><a href="{escape(openapi_url)}">openapi.json</a><button type="button" onclick="tt()">◐ Theme</button></header>
<div id="swagger-ui"></div>
<script src="{a}/swagger-ui-bundle.js"></script>
<script>var c={cfg};c.oauth2RedirectUrl=location.origin+{json.dumps(oauth2_redirect_url)};window.ui=SwaggerUIBundle(c);</script>
</body></html>"""


def install_branded_docs(app: FastAPI, docs_url: str = "/docs") -> None:
    """Register branded /docs, /docs/oauth2-redirect and the docs asset mount.

    Create the app with ``docs_url=None`` so FastAPI does not add its default /docs.
    """
    oauth2_redirect_url = app.swagger_ui_oauth2_redirect_url or f"{docs_url}/oauth2-redirect"
    app.mount(DOCS_ASSETS_URL, StaticFiles(directory=str(DOCS_ASSETS_DIR)), name="docs-assets")

    @app.get(docs_url, include_in_schema=False)
    def swagger_ui_docs() -> HTMLResponse:
        return HTMLResponse(_docs_html(app, oauth2_redirect_url))

    @app.get(oauth2_redirect_url, include_in_schema=False)
    def swagger_ui_redirect() -> HTMLResponse:
        return get_swagger_ui_oauth2_redirect_html()
