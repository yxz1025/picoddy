#!/usr/bin/env python3
"""UI-only SkillHub managed-auth smoke test with browser API mocks.

No shared secret, real SkillHub account, database, or backend is accessed.
Run through webapp-testing's with_server.py on port 5193.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


BASE_URL = "http://127.0.0.1:5193"
OWNER_ID = "10000000-0000-4000-8000-000000000001"
SESSION_ID = "20000000-0000-4000-8000-000000000002"
MODEL_ID = "30000000-0000-4000-8000-000000000003"


def envelope(value: object) -> str:
    return json.dumps({"data": value}, ensure_ascii=False)


def run() -> None:
    unexpected_api: list[str] = []
    seen_api: list[str] = []
    page_errors: list[str] = []

    namespace = {
        "id": 1,
        "slug": "office",
        "displayName": "办公效率",
        "status": "ACTIVE",
        "description": "办公技能与专家",
        "type": "PUBLIC",
    }
    version = {"id": 11, "version": "1.0.0", "status": "PUBLISHED"}
    skill = {
        "id": 21,
        "slug": "weekly-report",
        "displayName": "周报助手",
        "summary": "将工作记录整理为结构清晰的周报。",
        "status": "ACTIVE",
        "downloadCount": 88,
        "namespace": "office",
        "updatedAt": "2026-10-13T03:00:00.000Z",
        "headlineVersion": version,
        "publishedVersion": version,
    }
    expert = {
        **skill,
        "id": 31,
        "slug": "retail-analyst",
        "displayName": "零售分析专家",
        "summary": "分析门店、商品与库存经营表现。",
    }

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
        seen_api.append(f"{method} {path}")

        if method == "GET" and path == "/api/auth/me":
            json_response(route, {
                "id": OWNER_ID,
                "email": "ui@example.test",
                "name": "SkillHub UI 审查员",
                "subject": "skillhub.ui.reviewer",
                "avatar": "",
                "sessionId": SESSION_ID,
                "loggedInAt": "2026-10-13T02:00:00.000Z",
                "expiresAt": "2026-10-13T12:00:00.000Z",
            })
        elif method == "GET" and path == "/api/models":
            json_response(route, [{
                "id": MODEL_ID,
                "name": "UI Mock Model",
                "provider": "openai",
                "model": "ui-mock-model",
                "isDefault": True,
                "apiKeyConfigured": True,
                "createdAt": "2026-10-13T02:00:00.000Z",
            }])
        elif method == "GET" and path == "/api/preferences":
            json_response(route, {
                "agentSystemPrompt": "",
                "customInstructions": "",
                "language": "zh-CN",
                "fontSize": "14",
            })
        elif method == "GET" and path in (
            "/api/workspaces", "/api/conversations", "/api/runs",
            "/api/skills", "/api/experts", "/api/connectors",
        ):
            json_response(route, [])
        elif method == "POST" and path == "/api/skillhub/auth/ensure":
            json_response(route, {"authenticated": True})
        elif method == "GET" and path == "/api/skillhub/namespaces":
            json_response(route, [namespace])
        elif method == "GET" and path == "/api/skillhub/experts":
            json_response(route, [expert])
        elif method == "GET" and path == "/api/skillhub/skills":
            json_response(route, [skill])
        elif method == "GET" and path == "/api/skillhub/experts/office/retail-analyst":
            json_response(route, {
                **expert,
                "ownerDisplayName": "PICODDY SkillHub",
                "subscriptionCount": 12,
                "avatarPath": "",
                "tags": ["零售", "分析"],
                "quickPrompts": ["分析本周销售"],
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
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.route(f"{BASE_URL}/api/**", handle_api)
        page.goto(BASE_URL, wait_until="networkidle")

        page.get_by_role("button", name="专家·技能·连接器").click()
        panel = page.locator(".expert-panel")
        panel.wait_for(state="visible")
        panel.get_by_text("零售分析专家", exact=True).wait_for(timeout=5_000)

        body_text = panel.inner_text()
        assert "配置技能市场" not in body_text
        assert "共享密钥" not in body_text
        assert panel.locator('input[type="password"]').count() == 0
        assert panel.get_by_text("SkillHub 接口不存在", exact=False).count() == 0

        panel.get_by_role("button", name="查看零售分析专家详情").click()
        panel.get_by_text("PICODDY SkillHub", exact=True).wait_for(timeout=5_000)
        panel.get_by_role("button", name="关闭专家详情").click()

        panel.get_by_role("button", name="技能", exact=True).click()
        panel.get_by_text("周报助手", exact=True).wait_for(timeout=5_000)
        page.screenshot(path="/tmp/skillhub-managed-auth.png", full_page=True)
        browser.close()

    assert seen_api.count("POST /api/skillhub/auth/ensure") >= 1, seen_api
    assert "GET /api/skillhub/experts" in seen_api, seen_api
    assert "GET /api/skillhub/skills" in seen_api, seen_api
    assert "GET /api/skillhub/namespaces" in seen_api, seen_api
    assert not any("auth/config" in item for item in seen_api), seen_api
    assert not unexpected_api, f"Unexpected API calls: {unexpected_api}"
    assert not page_errors, f"Browser page errors: {page_errors}"
    assert Path("/tmp/skillhub-managed-auth.png").is_file()
    print("PASS: SkillHub managed-auth UI smoke (mock API; no secret/backend/DB)")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise
