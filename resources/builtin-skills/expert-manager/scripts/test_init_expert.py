#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

import init_expert


class InitExpertTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.plugins_dir = Path(self.tmp.name) / "plugins"

    def tearDown(self):
        self.tmp.cleanup()

    def run_init(self, *args):
        return init_expert.main(list(args), expected_plugins_dir=self.plugins_dir)

    def test_initializes_only_agent_package(self):
        result = self.run_init("growth-expert", "--path", str(self.plugins_dir))
        self.assertEqual(result, 0)

        plugin = json.loads(
            (self.plugins_dir / "growth-expert" / ".picoddy-plugin" / "plugin.json").read_text()
        )
        self.assertEqual(plugin["expertType"], "agent")
        self.assertEqual(plugin["skills"], [])
        self.assertNotIn("members", plugin)
        self.assertNotIn("teamInfo", plugin)
        self.assertNotIn("avatar", plugin)
        self.assertTrue((self.plugins_dir / "growth-expert" / "skills").is_dir())
        self.assertTrue((self.plugins_dir / "growth-expert" / "license" / "LICENSE.txt").is_file())
        agent = (self.plugins_dir / "growth-expert" / "agents" / "growth-expert.md").read_text()
        self.assertIn("skills: []", agent)

    def test_rejects_removed_team_flag(self):
        result = self.run_init(
            "growth-team", "--type", "team", "--path", str(self.plugins_dir)
        )
        self.assertNotEqual(result, 0)


if __name__ == "__main__":
    unittest.main()
