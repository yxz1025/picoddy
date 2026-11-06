import unittest
from pathlib import Path

from project_paths import get_project_config_dir


class ProjectPathsTest(unittest.TestCase):
    def test_unix_uses_pi_a_project_directory(self):
        self.assertEqual(
            get_project_config_dir("Darwin", {}, Path("/Users/demo")),
            Path("/Users/demo/.pi-a"),
        )

    def test_windows_uses_pi_a_local_app_data_directory(self):
        self.assertEqual(
            get_project_config_dir(
                "Windows",
                {"LOCALAPPDATA": "C:/Users/demo/AppData/Local"},
                Path("C:/Users/demo"),
            ),
            Path("C:/Users/demo/AppData/Local/Pi-a"),
        )

    def test_injected_environment_can_supply_test_config_directory(self):
        self.assertEqual(
            get_project_config_dir(
                "Darwin", {"PI_A_CONFIG_DIR": "/tmp/pi-a-test"}, Path("/Users/demo")
            ),
            Path("/tmp/pi-a-test"),
        )


if __name__ == "__main__":
    unittest.main()
