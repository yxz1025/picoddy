#!/usr/bin/env python3
"""UI-only API-key model settings smoke test with browser API mocks.

No .env, database, saved credentials, or real model provider is accessed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


BASE_URL = "http://127.0.0.1:5192"
OWNER_ID = "10000000-0000-4000-8000-000000000001"
SESSION_ID = "20000000-0000-4000-8000-000000000002"
MODEL_RESOURCE_ID = "30000000-0000-4000-8000-000000000003"
FAKE_KEY = "ui-fake-key-not-a-secret"


def envelope(value: object) -> str:
    return json.dumps({"data": value}, ensure_ascii=False)


def run() -> None:
    models: list[dict[str, object]] = []
    unexpected_api: list[str] = []
    browser_errors: list[str] = []
    catalog_requests: list[dict[str, object]] = []
    create_requests: list[dict[str, object]] = []
    connection_requests: list[dict[str, object]] = []

    def json_response(route: Route, value: object, status: int = 200) -> None:
        route.fulfill(
            status=status,
            content_type="application/json; charset=utf-8",
            body=envelope(value),
        )

    def handle_api(route: Route) -> None:
        request = route.request
        path = urlparse(request.url).path
        method = request.method

        if method == "GET" and path == "/api/auth/me":
            json_response(route, {
                "id": OWNER_ID,
                "email": "ui@example.test",
                "name": "模型设置审查员",
                "subject": "model.settings.reviewer",
                "avatar": "",
                "sessionId": SESSION_ID,
                "loggedInAt": "2026-10-13T01:00:00.000Z",
                "expiresAt": "2026-10-13T12:00:00.000Z",
            })
        elif method == "GET" and path == "/api/models":
            json_response(route, models)
        elif method == "POST" and path == "/api/models":
            body = request.post_data_json
            create_requests.append(body)
            model = {
                "id": MODEL_RESOURCE_ID,
                "name": body["name"],
                "provider": body["provider"],
                "model": body["model"],
                "isDefault": False,
                "apiKeyConfigured": True,
                "createdAt": "2026-10-13T01:05:00.000Z",
            }
            models.append(model)
            json_response(route, model, 201)
        elif method == "GET" and path == "/api/preferences":
            json_response(route, {
                "agentSystemPrompt": "",
                "customInstructions": "",
                "language": "zh-CN",
                "fontSize": "14",
            })
        elif method == "GET" and path in ("/api/workspaces", "/api/conversations", "/api/runs"):
            json_response(route, [])
        elif method == "POST" and path == "/api/providers/openai/models":
            catalog_requests.append(request.post_data_json)
            json_response(route, {
                "ok": True,
                "models": [{
                    "id": "gpt-4.1",
                    "name": "GPT 4.1",
                    "features": ["text"],
                }],
            })
        elif method == "POST" and path == "/api/settings/test-connection":
            connection_requests.append(request.post_data_json)
            json_response(route, {
                "ok": True,
                "latencyMs": 18,
                "message": "Mock connection succeeded",
            })
        else:
            unexpected_api.append(f"{method} {path}")
            route.fulfill(
                status=501,
                content_type="application/json; charset=utf-8",
                body=json.dumps({
                    "error": {
                        "code": "UI_MOCK_UNHANDLED",
                        "message": f"Unhandled UI mock: {method} {path}",
                    }
                }),
            )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.on(
            "console",
            lambda message: browser_errors.append(f"console.{message.type}: {message.text}")
            if message.type == "error"
            else None,
        )
        page.route(f"{BASE_URL}/api/**", handle_api)
        page.goto(BASE_URL, wait_until="networkidle")

        page.get_by_title("设置").click()
        modal = page.locator(".settings-modal-panel")
        modal.wait_for(state="visible")
        modal.get_by_text("模型配置中心", exact=True).wait_for()
        assert modal.get_by_text("ChatGPT", exact=False).count() == 0
        assert modal.get_by_text("订阅", exact=False).count() == 0

        openai = modal.locator(".provider-model-card").filter(has_text="OpenAI")
        assert openai.count() == 1
        key_input = openai.locator('input[type="password"]')
        key_input.fill(FAKE_KEY)
        key_input.press("Tab")

        model_select = openai.locator("select")
        model_select.locator('option[value="gpt-4.1"]').wait_for(
            state="attached", timeout=5_000
        )
        model_select.select_option("gpt-4.1")
        openai.get_by_role("button", name="保存模型与 Key").click()
        openai.get_by_text("模型与 Key 已保存", exact=False).wait_for(timeout=5_000)
        assert openai.get_by_text("GPT 4.1", exact=True).count() >= 1

        openai.get_by_role("button", name="测试连接").click()
        openai.get_by_text("Mock connection succeeded", exact=False).wait_for(timeout=5_000)
        page.screenshot(path="/tmp/model-settings-api-key.png", full_page=True)
        page.reload(wait_until="networkidle")
        page.get_by_title("设置").click()
        reopened = page.locator(".settings-modal-panel .provider-model-card").filter(has_text="OpenAI")
        reopened.get_by_text("GPT 4.1", exact=True).wait_for()
        assert reopened.locator('input[type="password"]').input_value() == ""
        assert reopened.get_by_role("button", name="测试连接").is_enabled()
        browser.close()

    assert catalog_requests == [{"apiKey": FAKE_KEY}], catalog_requests
    assert create_requests == [{
        "name": "GPT 4.1",
        "provider": "openai",
        "model": "gpt-4.1",
        "apiKey": FAKE_KEY,
    }], create_requests
    assert connection_requests == [{
        "provider": "openai",
        "resourceId": MODEL_RESOURCE_ID,
        "modelId": "gpt-4.1",
    }], connection_requests
    assert not any("subscription" in item.lower() for item in unexpected_api), unexpected_api
    assert not unexpected_api, f"Unexpected API calls: {unexpected_api}"
    assert not browser_errors, f"Browser errors: {browser_errors}"
    assert Path("/tmp/model-settings-api-key.png").is_file()
    print("PASS: API-key model settings UI smoke (mock API; no real provider/DB/.env)")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise
