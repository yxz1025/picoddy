#!/usr/bin/env python3
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import validate_expert


class ValidateExpertSkillsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.expert_dir = self.root / 'multi-skill-expert'
        self._create_valid_expert()
        self.plugins_dir = patch(
            'validate_expert.get_expert_plugins_dir', return_value=self.root
        )
        self.plugins_dir.start()

    def tearDown(self):
        self.plugins_dir.stop()
        self.tmp.cleanup()

    def _create_valid_expert(self):
        plugin_dir = self.expert_dir / '.picoddy-plugin'
        agents_dir = self.expert_dir / 'agents'
        plugin_dir.mkdir(parents=True)
        agents_dir.mkdir()
        (self.expert_dir / 'README.md').write_text('# Expert\n', encoding='utf-8')
        (agents_dir / 'multi-skill-expert.md').write_text(
            '---\n'
            'name: multi-skill-expert\n'
            'description: A multi-skill expert.\n'
            'skills: [alpha, beta]\n'
            '---\n'
            'Follow the requested expert workflow.\n',
            encoding='utf-8',
        )
        for name in ('alpha', 'beta'):
            skill_dir = self.expert_dir / 'skills' / name
            skill_dir.mkdir(parents=True)
            (skill_dir / 'SKILL.md').write_text(
                f'---\nname: {name}\ndescription: Test skill\n---\n',
                encoding='utf-8',
            )
        self._write_plugin(['./skills/alpha', './skills/beta'])

    def _write_plugin(self, skills):
        plugin = {
            'schemaVersion': 2,
            'name': 'multi-skill-expert',
            'version': '1.0.0',
            'description': 'A multi-skill expert.',
            'agents': ['./agents/multi-skill-expert.md'],
            'skills': skills,
            'expertType': 'agent',
            'agentName': 'multi-skill-expert',
            'displayName': {'en': 'Multi Skill Expert', 'zh': '多技能专家'},
            'profession': {'en': 'Expert', 'zh': '专家'},
            'displayDescription': {
                'en': 'A test expert.',
                'zh': '这是一个用于验证多技能声明与本地文件结构一致性的测试专家包。',
            },
            'defaultInitPrompt': {'en': 'Help me', 'zh': '请帮助我'},
            'plugin': 'multi-skill-expert',
            'categoryId': '02-Engineering',
            'tags': [
                {'en': 'One', 'zh': '一'},
                {'en': 'Two', 'zh': '二'},
                {'en': 'Three', 'zh': '三'},
            ],
            'quickPrompts': [
                {'en': 'Help me', 'zh': '请帮助我'},
                {'en': 'Explain', 'zh': '解释'},
                {'en': 'Review', 'zh': '审查'},
            ],
        }
        (self.expert_dir / '.picoddy-plugin' / 'plugin.json').write_text(
            json.dumps(plugin, ensure_ascii=False), encoding='utf-8'
        )

    def _result(self):
        return validate_expert.validate_expert(self.expert_dir)

    def _agent_path(self):
        return self.expert_dir / 'agents' / 'multi-skill-expert.md'

    def test_accepts_two_declared_package_local_skills(self):
        self.assertTrue(self._result().is_valid, self._result().summary())

    def test_optional_metadata_lists(self):
        path = self.expert_dir / '.picoddy-plugin' / 'plugin.json'
        base = json.loads(path.read_text(encoding='utf-8'))
        for count in (None, 0, 1, 2, 3, 8):
            with self.subTest(count=count):
                plugin = dict(base)
                entries = None if count is None else [{'zh': '条目', 'en': 'Entry'}] * count
                plugin.update(tags=entries, quickPrompts=entries)
                path.write_text(json.dumps(plugin), encoding='utf-8')
                self.assertTrue(self._result().is_valid, self._result().summary())
        plugin = dict(base)
        for field in ('tags', 'quickPrompts', 'defaultInitPrompt'):
            plugin.pop(field)
        path.write_text(json.dumps(plugin), encoding='utf-8')
        self.assertTrue(self._result().is_valid, self._result().summary())

    def test_optional_metadata_rejects_invalid_items(self):
        path = self.expert_dir / '.picoddy-plugin' / 'plugin.json'
        base = json.loads(path.read_text(encoding='utf-8'))
        for field in ('tags', 'quickPrompts'):
            for value in ('invalid', [{}], [42]):
                with self.subTest(field=field, value=value):
                    path.write_text(json.dumps({**base, field: value}), encoding='utf-8')
                    self.assertFalse(self._result().is_valid)

    def test_accepts_explicit_empty_skills_without_skills_directory(self):
        shutil.rmtree(self.expert_dir / 'skills')
        self._write_plugin([])
        self._agent_path().write_text(
            '---\nname: multi-skill-expert\ndescription: A multi-skill expert.\n---\n'
            'Follow the requested expert workflow.\n',
            encoding='utf-8',
        )
        self.assertTrue(self._result().is_valid, self._result().summary())

    def test_accepts_todo_only_skills_without_skills_directory(self):
        shutil.rmtree(self.expert_dir / 'skills')
        self._write_plugin(['[TODO: optional skill]'])
        self._agent_path().write_text(
            '---\nname: multi-skill-expert\ndescription: A multi-skill expert.\n'
            'skills: []\n---\n'
            'Follow the requested expert workflow.\n',
            encoding='utf-8',
        )
        self.assertTrue(self._result().is_valid, self._result().summary())

    def test_rejects_agent_skills_when_plugin_skills_are_empty(self):
        shutil.rmtree(self.expert_dir / 'skills')
        self._write_plugin([])
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('skills must match' in error for error in result.errors))

    def test_rejects_agent_skills_when_plugin_skills_are_todo_only(self):
        shutil.rmtree(self.expert_dir / 'skills')
        self._write_plugin(['[TODO: optional skill]'])
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('skills must match' in error for error in result.errors))

    def test_rejects_duplicate_skill_paths_case_insensitively(self):
        self._write_plugin(['./skills/alpha', './skills/ALPHA'])
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('duplicate skill' in error for error in result.errors))

    def test_rejects_non_direct_skill_path(self):
        self._write_plugin(['./skills/alpha/nested', './skills/beta'])
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('must be exactly' in error for error in result.errors))

    def test_rejects_traversal_skill_path(self):
        self._write_plugin(['./skills/../alpha', './skills/beta'])
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('must be exactly' in error for error in result.errors))

    def test_rejects_symlink_anywhere_in_declared_skill_tree(self):
        target = self.expert_dir / 'outside.txt'
        target.write_text('outside', encoding='utf-8')
        link = self.expert_dir / 'skills' / 'alpha' / 'linked.txt'
        try:
            link.symlink_to(target)
        except (NotImplementedError, OSError):
            self.skipTest('platform cannot create symlinks')
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('symlink' in error for error in result.errors))

    def test_rejects_symlinked_skills_root(self):
        outside_skills = self.root / 'outside-skills'
        shutil.move(str(self.expert_dir / 'skills'), outside_skills)
        try:
            (self.expert_dir / 'skills').symlink_to(outside_skills, target_is_directory=True)
        except (NotImplementedError, OSError):
            self.skipTest('platform cannot create symlinks')
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('symlink' in error for error in result.errors))

    def test_rejects_nonordinary_entry_in_declared_skill_tree(self):
        fifo = self.expert_dir / 'skills' / 'alpha' / 'stream'
        try:
            os.mkfifo(fifo)
        except (AttributeError, NotImplementedError, OSError):
            self.skipTest('platform cannot create FIFOs')
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('non-ordinary' in error for error in result.errors))

    def test_rejects_plugin_and_main_agent_skill_mismatch(self):
        self._agent_path().write_text(
            '---\nname: multi-skill-expert\ndescription: A multi-skill expert.\n'
            "skills: ['beta', \"alpha\"]\n---\n",
            encoding='utf-8',
        )
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('skills must match' in error for error in result.errors))

    def test_rejects_plugin_skill_path_outside_expert_skills_directory(self):
        self._write_plugin(['./other/alpha', './skills/beta'])
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('must be exactly' in error for error in result.errors))

    def test_rejects_symlink_root_skill_markdown(self):
        skill_md = self.expert_dir / 'skills' / 'alpha' / 'SKILL.md'
        target = self.expert_dir / 'real-skill.md'
        target.write_text(skill_md.read_text(encoding='utf-8'), encoding='utf-8')
        skill_md.unlink()
        try:
            skill_md.symlink_to(target)
        except (NotImplementedError, OSError):
            self.skipTest('platform cannot create symlinks')
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('symlink' in error for error in result.errors))

    def test_rejects_directory_at_root_skill_markdown_path(self):
        skill_md = self.expert_dir / 'skills' / 'alpha' / 'SKILL.md'
        skill_md.unlink()
        skill_md.mkdir()
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('root-level ordinary SKILL.md' in error for error in result.errors))

    def test_rejects_missing_root_skill_markdown(self):
        (self.expert_dir / 'skills' / 'alpha' / 'SKILL.md').unlink()
        result = self._result()
        self.assertFalse(result.is_valid)
        self.assertTrue(any('root-level ordinary SKILL.md' in error for error in result.errors))


if __name__ == '__main__':
    unittest.main()
