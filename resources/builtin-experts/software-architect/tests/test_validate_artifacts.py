import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/validate_artifacts.py'
spec = importlib.util.spec_from_file_location('validator', SCRIPT)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = dict(requirement_id='REQ-1', repo_id='api', document_type='tasks',
                         version='1', acceptance_ids=['A1'], references=[],
                         tasks=[dict(id='T1', acceptance_ids=['A1'], depends_on=[])])
        self.entry = dict(repo_id='api', path='docs/plans/REQ-1-api-tasks.md', document_type='tasks')
        self.manifest = dict(schema_version=1, requirement_id='REQ-1', acceptance_ids=['A1'],
                             coverage_types=['tasks'], artifacts=[self.entry])

    def write(self, data=None, entry=None):
        entry = entry or self.entry
        path = self.root / entry['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('# Example\n\n```artifact-check\n' + json.dumps(data or self.data) + '\n```\n', encoding='utf-8')
        return path

    def run_checks(self):
        validator.check_manifest(self.manifest)
        return validator.validate(self.manifest, {'api': self.root, 'web': self.root})

    def codes(self):
        return {f['code'] for f in self.run_checks()['findings']}

    def test_valid_and_read_only(self):
        path = self.write()
        before = path.read_bytes()
        self.assertEqual(self.run_checks()['status'], 'passed')
        self.assertEqual(before, path.read_bytes())

    def test_unknown_and_cyclic_dependencies(self):
        self.data['tasks'][0]['depends_on'] = ['T2', 'missing']
        self.data['tasks'].append(dict(id='T2', acceptance_ids=['A1'], depends_on=['T1']))
        self.write()
        self.assertTrue({'UNKNOWN_DEPENDENCY', 'DEPENDENCY_CYCLE'} <= self.codes())

    def test_diamond_is_not_cycle(self):
        self.data['tasks'] = [dict(id=t, acceptance_ids=['A1'], depends_on=d)
                              for t, d in [('a', ['b', 'c']), ('b', ['d']), ('c', ['d']), ('d', [])]]
        self.write()
        self.assertEqual(self.run_checks()['status'], 'passed')

    def test_coverage_uses_tasks_not_document_claim(self):
        self.data['tasks'] = []
        self.write()
        self.assertIn('COVERAGE_GAP', self.codes())

    def test_missing_planned_and_outside_references(self):
        self.data['references'] = [dict(repo_id='api', path=p, state=s) for p, s in
                                   [('missing.md', 'existing'), ('future.md', 'planned'), ('../outside.md', 'existing')]]
        self.write()
        self.assertTrue({'REFERENCE_UNREADABLE', 'PLANNED_REFERENCE'} <= self.codes())

    def test_cross_repo_stale_version_and_hash(self):
        entry = dict(repo_id='web', path='docs/REQ-1-web-design.md', document_type='design')
        data = copy.deepcopy(self.data)
        data.update(repo_id='web', document_type='design', version='2', tasks=[])
        self.write(data, entry)
        self.manifest['artifacts'].append(entry)
        self.data['references'] = [dict(repo_id='web', path=entry['path'], state='existing', version='1', sha256='0' * 64)]
        self.write()
        self.assertTrue({'VERSION_MISMATCH', 'STALE_REFERENCE'} <= self.codes())

    def test_legacy_document_is_unverified(self):
        self.write().write_text('# Legacy', encoding='utf-8')
        self.manifest['coverage_types'] = []
        self.assertEqual(self.run_checks()['status'], 'incomplete')

    def test_invalid_metadata(self):
        self.data['references'] = [None]
        self.write()
        self.assertIn('INVALID_METADATA', self.codes())

    def test_duplicate_task_and_identity(self):
        self.data['repo_id'] = 'wrong'
        self.data['tasks'] *= 2
        self.write()
        self.assertTrue({'DUPLICATE_TASK', 'IDENTITY_MISMATCH'} <= self.codes())

    def test_cli_exit_codes(self):
        self.write()
        manifest = self.root / 'check.json'
        manifest.write_text(json.dumps(self.manifest))
        command = [sys.executable, str(SCRIPT), str(manifest), '--repo', 'api=' + str(self.root)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.write().unlink()
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)
        manifest.write_text('{}')
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 2)
        manifest.write_text(json.dumps(self.manifest))
        self.manifest['coverage_types'] = []
        manifest.write_text(json.dumps(self.manifest))
        self.write().write_text('# Legacy')
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 3)


if __name__ == '__main__':
    unittest.main()
