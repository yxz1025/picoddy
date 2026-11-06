"""Browser regression checks. Serve website/ on localhost:4178 first."""
import unittest
from playwright.sync_api import sync_playwright, expect


class WebsiteInteractions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 390, "height": 844})
        self.page = self.context.new_page()
        self.page.goto('http://127.0.0.1:4178', wait_until='networkidle')

    def tearDown(self):
        self.context.close()

    def test_mobile_demo_readability(self):
        page = self.page
        conversation = page.locator('.conversation').bounding_box()
        artifact = page.locator('.artifact').bounding_box()
        self.assertGreater(artifact['y'], conversation['y'] + conversation['height'] - 1)
        self.assertGreaterEqual(page.locator('#demo-request').evaluate('e => parseFloat(getComputedStyle(e).fontSize)'), 12)
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)

    def test_menu_dismissal_and_focus(self):
        page = self.page
        menu = page.locator('.menu-toggle')
        menu.click()
        page.locator('#navigation a').first.focus()
        page.keyboard.press('Escape')
        expect(menu).to_be_focused()
        expect(menu).to_have_attribute('aria-expanded', 'false')
        menu.click()
        page.mouse.click(5, 400)
        expect(menu).to_have_attribute('aria-expanded', 'false')

    def test_scenario_keyboard_and_rapid_selection(self):
        page = self.page
        page.locator('#tab-data').focus()
        page.keyboard.press('End')
        expect(page.locator('#tab-code')).to_be_focused()
        expect(page.locator('#demo-title')).to_have_text('搭建个人作品集')
        page.keyboard.press('ArrowRight')
        expect(page.locator('#tab-data')).to_have_attribute('aria-selected', 'true')
        page.evaluate("document.querySelector('#tab-slides').click(); document.querySelector('#tab-research').click()")
        expect(page.locator('#demo-title')).to_have_text('整理行业研究资料')
        expect(page.locator('.artifact-label')).to_have_text('RESEARCH NOTES')

    def test_resize_keeps_navigation_focus_visible(self):
        page = self.page
        page.set_viewport_size({'width': 1440, 'height': 900})
        page.locator('#navigation a').first.focus()
        page.set_viewport_size({'width': 390, 'height': 844})
        expect(page.locator('.menu-toggle')).to_be_focused()

    def test_copy_success_and_failure(self):
        page = self.page
        page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async () => {}}})")
        page.locator('#copy-command').click()
        expect(page.locator('#copy-command')).to_contain_text('已复制')
        page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async () => {throw Error('denied')}}})")
        page.locator('#copy-command').click()
        expect(page.locator('#copy-status')).to_contain_text('手动复制')
        expect(page.locator('#copy-command')).to_be_enabled()

    def test_reduced_motion_and_faq(self):
        page = self.page
        page.emulate_media(reduced_motion='reduce')
        page.locator('#tab-slides').click()
        self.assertEqual(page.locator('.demo-content').evaluate('e => e.getAnimations().length'), 0)
        summary = page.locator('.faq summary').first
        summary.click()
        expect(page.locator('.faq details').first).to_have_attribute('open', '')
        summary.click()
        expect(page.locator('.faq details').first).not_to_have_attribute('open', '')

    def test_layout_matrix_and_motion(self):
        page = self.page
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        for width in (320, 390, 600, 768, 1024, 1440, 1920):
            page.set_viewport_size({'width': width, 'height': 1000})
            page.goto('http://127.0.0.1:4178', wait_until='networkidle')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width, str(width))
            for key in ('data', 'research', 'slides', 'code'):
                page.locator('#tab-' + key).click()
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width, str((width, key)))
            if width in (390, 1440):
                page.screenshot(path=f'/private/tmp/website-{width}.png', full_page=True)
        page.emulate_media(reduced_motion='no-preference')
        summary = page.locator('.faq summary').first
        summary.click()
        page.wait_for_timeout(260)
        summary.click()
        page.wait_for_timeout(40)
        summary.click()
        page.wait_for_timeout(260)
        expect(page.locator('.faq details').first).to_have_attribute('open', '')
        page.locator('#scenarios').scroll_into_view_if_needed()
        expect(page.locator('#navigation a[href="#scenarios"]')).to_have_attribute('aria-current', 'location')
        self.assertEqual(errors, [])

    def test_record_interaction_flow(self):
        context = self.browser.new_context(
            viewport={'width': 390, 'height': 844},
            record_video_dir='/private/tmp/website-motion',
            record_video_size={'width': 390, 'height': 844})
        page = context.new_page()
        page.goto('http://127.0.0.1:4178', wait_until='networkidle')
        page.locator('.menu-toggle').click()
        page.wait_for_timeout(220)
        page.keyboard.press('Escape')
        page.locator('#tab-research').click()
        page.wait_for_timeout(220)
        page.locator('#tab-slides').click()
        page.wait_for_timeout(220)
        page.locator('.workbench').screenshot(path='/private/tmp/website-mobile-demo.png')
        summary = page.locator('.faq summary').first
        summary.click()
        page.wait_for_timeout(260)
        summary.click()
        page.wait_for_timeout(220)
        page.screenshot(path='/private/tmp/website-faq.png')
        video = page.video
        context.close()
        print('Motion recording:', video.path())


if __name__ == '__main__':
    unittest.main(verbosity=2)
