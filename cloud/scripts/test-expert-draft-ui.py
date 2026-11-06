#!/usr/bin/env python3
"""UI-only expert draft panel smoke test with browser-level API mocks.

This intentionally does not exercise the cloud agent, database, or HTTP server.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


BASE_URL = "http://127.0.0.1:5191"
CONVERSATION_ID = "10000000-0000-4000-8000-000000000001"
DRAFT_ID = "20000000-0000-4000-8000-000000000002"
EXPERT_ID = "30000000-0000-4000-8000-000000000003"
MODEL_ID = "40000000-0000-4000-8000-000000000004"
USER_ID = "50000000-0000-4000-8000-000000000005"


def envelope(value: object) -> str:
    return json.dumps({"data": value}, ensure_ascii=False)


def assert_unoccluded(locator, label: str) -> None:
    locator.scroll_into_view_if_needed()
    result = locator.evaluate(
        """element => {
          const rect = element.getBoundingClientRect();
          const pointX = rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1));
          const pointY = rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1));
          const hit = document.elementFromPoint(pointX, pointY);
          let clippedBy = null;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (!/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) continue;
            const bounds = parent.getBoundingClientRect();
            if (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
              clippedBy = parent.className || parent.tagName;
              break;
            }
          }
          return {
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            hit: hit ? (hit.className || hit.tagName) : null,
            hitBelongsToElement: Boolean(hit && (element === hit || element.contains(hit))),
            clippedBy,
          };
        }"""
    )
    assert result["hitBelongsToElement"], f"{label} is occluded: {result}"
    assert result["clippedBy"] is None, f"{label} is clipped: {result}"


def boxes_overlap(first: dict[str, float], second: dict[str, float]) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def run() -> None:
    published = False
    publish_body: dict[str, object] | None = None
    unexpected_api: list[str] = []
    seen_api: list[str] = []
    expert_binding_calls: list[str] = []
    browser_errors: list[str] = []

    profile = {
        "name": "零售分析专家",
        "prompt": "结合门店、商品与库存数据，给出可追溯的经营分析和行动建议。",
        "skillIds": [],
        "description": "面向零售运营团队的经营诊断专家。",
        "tags": ["零售", "分析", "运营"],
        "quickPrompts": ["分析本周销售", "检查库存风险", "生成行动计划"],
        "icon": "🛍️",
        "categoryId": "retail",
    }

    def draft() -> dict[str, object]:
        return {
            "id": DRAFT_ID,
            "conversationId": CONVERSATION_ID,
            "operation": "edit",
            "status": "published" if published else "valid",
            "revision": 3,
            "profile": profile,
            "expertId": EXPERT_ID,
            "baseRevision": "base-revision-1",
            "publishedRevision": "published-revision-2" if published else None,
            "validation": {
                "revision": 3,
                "valid": True,
                "errors": [],
                "warnings": [],
                "checkedAt": 1791792000000,
            },
            "publishedAt": 1791792000000 if published else None,
            "createdAt": 1791791000000,
            "updatedAt": 1791792000000,
        }

    def json_response(route: Route, value: object, status: int = 200) -> None:
        route.fulfill(
            status=status,
            content_type="application/json; charset=utf-8",
            body=envelope(value),
        )

    def handle_api(route: Route) -> None:
        nonlocal published, publish_body
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        method = request.method
        seen_api.append(f"{method} {path}")

        if method == "GET" and path == "/api/auth/me":
            json_response(route, {"id": USER_ID, "email": "ui@example.test", "name": "UI 审查员"})
        elif method == "GET" and path == "/api/models":
            json_response(route, [{
                "id": MODEL_ID,
                "name": "UI Mock Model",
                "provider": "openai",
                "model": "ui-mock-model",
                "isDefault": True,
                "apiKeyConfigured": True,
                "createdAt": "2026-10-12T08:00:00.000Z",
            }])
        elif method == "GET" and path == "/api/preferences":
            json_response(route, {"customInstructions": "", "language": "zh-CN", "fontSize": "14"})
        elif method == "GET" and path == "/api/workspaces":
            json_response(route, [])
        elif method == "GET" and path == "/api/conversations":
            json_response(route, [{
                "id": CONVERSATION_ID,
                "title": "创建专家：零售分析师",
                "category": "expert_creator",
                "expertOperation": "edit",
                "expertTargetId": EXPERT_ID,
                "expertTargetRevision": "base-revision-1",
                "createdAt": "2026-10-12T08:00:00.000Z",
                "updatedAt": "2026-10-12T08:10:00.000Z",
            }])
        elif method == "GET" and path == "/api/runs":
            json_response(route, [])
        elif method == "GET" and path == f"/api/conversations/{CONVERSATION_ID}/messages":
            json_response(route, [])
        elif method == "GET" and path == "/api/files":
            json_response(route, [])
        elif method == "GET" and path == f"/api/expert-drafts/by-conversation/{CONVERSATION_ID}":
            json_response(route, draft())
        elif method == "POST" and path == f"/api/expert-drafts/{DRAFT_ID}/validate":
            json_response(route, draft()["validation"])
        elif method == "POST" and path == f"/api/expert-drafts/{DRAFT_ID}/publish":
            publish_body = request.post_data_json
            published = True
            json_response(route, {
                "expertId": EXPERT_ID,
                "revision": "published-revision-2",
                "name": profile["name"],
            })
        elif method == "GET" and path == "/api/experts":
            json_response(route, [{
                "id": EXPERT_ID,
                **profile,
                "revision": "published-revision-2",
                "enabled": True,
            }])
        elif path == f"/api/conversations/{CONVERSATION_ID}/expert":
            expert_binding_calls.append(method)
            json_response(route, {
                "binding": {
                    "expertId": EXPERT_ID,
                    "revision": "published-revision-2",
                    "catalogSource": "installed",
                },
            })
        elif method == "GET" and path == "/api/skills":
            json_response(route, [])
        else:
            unexpected_api.append(f"{method} {path}")
            route.fulfill(
                status=501,
                content_type="application/json; charset=utf-8",
                body=json.dumps({"error": {"code": "UI_MOCK_UNHANDLED", "message": f"Unhandled UI mock: {method} {path}"}}),
            )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.on(
            "console",
            lambda message: browser_errors.append(f"console.{message.type}: {message.text}")
            if message.type == "error"
            else None,
        )
        page.route(f"{BASE_URL}/api/**", handle_api)

        page.goto(BASE_URL, wait_until="networkidle")
        conversation = page.get_by_text("创建专家：零售分析师", exact=True)
        try:
            conversation.wait_for(state="visible", timeout=8_000)
        except Exception:
            page.screenshot(path="/tmp/expert-draft-ui-load-failure.png", full_page=True)
            print(f"Loaded URL: {page.url}", file=sys.stderr)
            print(f"API calls: {seen_api}", file=sys.stderr)
            print(f"Browser errors: {browser_errors}", file=sys.stderr)
            print(f"Page text: {page.locator('body').inner_text()[:2000]}", file=sys.stderr)
            raise
        conversation.click()
        panel = page.get_by_role("complementary", name="专家草稿")
        panel.wait_for(state="visible")

        assert page.locator(".welcome-screen").count() == 0, "selected creator conversation still renders welcome"
        panel_title = panel.get_by_role("heading", name="专家草稿")
        assert_unoccluded(panel_title, "draft panel title")
        assert_unoccluded(panel.get_by_text("已通过", exact=True), "draft status")
        panel.get_by_text("零售分析专家", exact=True).wait_for()
        assert_unoccluded(panel.get_by_text("零售分析专家", exact=True), "draft profile name")
        panel_header_box = panel.locator(".skill-draft-header").bounding_box()
        chat_header_box = page.locator(".chat-header").bounding_box()
        assert panel_header_box and chat_header_box
        assert not boxes_overlap(panel_header_box, chat_header_box), (
            f"chat header overlaps draft header: chat={chat_header_box}, draft={panel_header_box}"
        )
        panel.get_by_text("正在修改已安装专家", exact=True).wait_for()
        panel.get_by_text("面向零售运营团队的经营诊断专家。", exact=True).wait_for()
        panel.get_by_text("零售 · 分析 · 运营", exact=True).wait_for()
        for prompt in profile["quickPrompts"]:
            panel.get_by_text(prompt, exact=True).wait_for()

        page.locator(".conversation-expert-trigger").click()
        page.get_by_role("option").filter(has_text="零售分析专家").click()
        reference_token = page.locator(
            '.composer-context-token[data-context-id="selected-expert"]'
        )
        reference_token.get_by_text("零售分析专家", exact=True).wait_for()
        assert not expert_binding_calls, (
            f"creator reference selection called active binding API: {expert_binding_calls}"
        )
        page.get_by_text("参考专家：零售分析专家", exact=True).wait_for(timeout=5_000)

        panel.screenshot(path="/tmp/expert-draft-panel.png")
        panel.get_by_role("button", name="确认发布").click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_text("更新专家", exact=True).wait_for()
        dialog.screenshot(path="/tmp/expert-draft-publish-dialog.png")
        dialog.get_by_role("button", name="确认发布").click()

        panel.get_by_text("已发布", exact=True).wait_for()
        assert publish_body == {
            "expectedRevision": 3,
            "baseRevision": "base-revision-1",
        }, publish_body
        assert panel.get_by_role("button", name="确认发布").count() == 0

        page.set_viewport_size({"width": 820, "height": 900})
        page.wait_for_timeout(200)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        assert "chat-workspace--creator" in page.locator(".chat-workspace").get_attribute("class").split()
        sections = panel.locator(".skill-draft-section")
        for index in range(sections.count()):
            section = sections.nth(index)
            section.scroll_into_view_if_needed()
            dimensions = section.evaluate(
                "element => ({clientHeight: element.clientHeight, scrollHeight: element.scrollHeight})"
            )
            assert dimensions["scrollHeight"] <= dimensions["clientHeight"] + 1, (
                f"draft section {index} clips content: {dimensions}"
            )
        for text in ("专家标识", "专家指令", "简介", "标签", "快捷提问", "生成行动计划"):
            assert_unoccluded(panel.get_by_text(text, exact=True), text)
        panel.locator(".skill-draft-content").evaluate("element => { element.scrollTop = 0; }")
        page.screenshot(path="/tmp/expert-draft-panel-narrow.png", full_page=True)

        browser.close()

    assert not unexpected_api, f"Unexpected API calls: {unexpected_api}"
    assert not browser_errors, f"Browser errors: {browser_errors}"
    for screenshot in (
        "/tmp/expert-draft-panel.png",
        "/tmp/expert-draft-publish-dialog.png",
        "/tmp/expert-draft-panel-narrow.png",
    ):
        assert Path(screenshot).is_file(), screenshot
    print("PASS: expert draft panel UI-only smoke (mock API; no Agent/DB integration)")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # noqa: BLE001 - standalone smoke script
        print(f"FAIL: {error}", file=sys.stderr)
        raise
