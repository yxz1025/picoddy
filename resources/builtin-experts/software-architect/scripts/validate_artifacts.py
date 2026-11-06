#!/usr/bin/env python3
"""Read-only checks for explicitly indexed engineering Markdown artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


BLOCK = re.compile(r'^```artifact-check\s*\n(.*?)^```\s*$', re.M | re.S)
TYPES = {'impact', 'spec', 'design', 'tasks', 'review', 'questions', 'coordination', 'handoff'}


def validate(manifest, roots):
    findings = []
    documents = {}
    tasks = {}

    def report(level, code, location, message):
        findings.append(dict(level=level, code=code, location=location, message=message))

    def resolve(repo, relative):
        if repo not in roots:
            raise ValueError('仓库未提供本地映射: ' + repo)
        if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
            raise ValueError('必须使用非空仓库相对路径')
        root = Path(roots[repo]).resolve()
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise ValueError('路径超出已登记仓库')
        return path

    requirement = manifest['requirement_id']
    expected = set(manifest['acceptance_ids'])
    if not manifest['artifacts']:
        report('error', 'EMPTY_SCOPE', 'manifest', '校验范围为空')
    if not expected:
        report('unverified', 'NO_ACCEPTANCE_BASELINE', 'manifest', '缺少验收编号基线，不能证明覆盖完整')
    for entry in manifest['artifacts']:
        repo, relative = entry['repo_id'], entry['path']
        location = repo + ':' + relative
        key = (repo, relative)
        if key in documents:
            report('error', 'DUPLICATE_ARTIFACT', location, '产物登记重复')
            continue
        try:
            path = resolve(repo, relative)
            raw = path.read_bytes()
            content = raw.decode('utf-8-sig')
        except (OSError, ValueError, UnicodeError) as exc:
            report('error', 'ARTIFACT_UNREADABLE', location, str(exc))
            continue
        blocks = BLOCK.findall(content)
        if not blocks:
            report('unverified', 'NO_METADATA', location, '未提供 artifact-check 数据块，不推断校验通过')
            continue
        if len(blocks) != 1:
            report('error', 'MULTIPLE_METADATA', location, '每份产物必须恰有一个数据块')
            continue
        try:
            data = json.loads(blocks[0])
            check_metadata(data)
        except (ValueError, TypeError, KeyError) as exc:
            report('error', 'INVALID_METADATA', location, str(exc))
            continue
        documents[key] = (data, hashlib.sha256(raw).hexdigest())
        if data['requirement_id'] != requirement or data['repo_id'] != repo:
            report('error', 'IDENTITY_MISMATCH', location, '需求或仓库编号与清单不一致')
        kind = data['document_type']
        if kind != entry['document_type']:
            report('error', 'TYPE_MISMATCH', location, '产物类型与清单不一致')
        name = (requirement + '-' + kind if kind in {'questions', 'coordination'}
                else requirement + '-' + repo + '-' + kind) + '.md'
        if path.name != name:
            report('error', 'FILENAME_MISMATCH', location, '预期文件名: ' + name)
        unknown = set(data['acceptance_ids']) - expected
        if unknown:
            report('error', 'UNKNOWN_ACCEPTANCE', location, '未登记验收编号: ' + ', '.join(sorted(unknown)))
        for ref in data['references']:
            if ref['state'] == 'planned':
                report('unverified', 'PLANNED_REFERENCE', location, '拟新增对象: ' + ref['path'])
                continue
            try:
                target = resolve(ref['repo_id'], ref['path'])
                if not target.is_file():
                    raise ValueError('引用文件不存在: ' + ref['path'])
                if 'sha256' in ref and hashlib.sha256(target.read_bytes()).hexdigest() != ref['sha256']:
                    report('error', 'STALE_REFERENCE', location, '引用快照已变化: ' + ref['path'])
            except (OSError, ValueError) as exc:
                report('error', 'REFERENCE_UNREADABLE', location, str(exc))
        for task in data['tasks']:
            tid = task['id']
            if tid in tasks:
                report('error', 'DUPLICATE_TASK', location, '任务编号重复: ' + tid)
            else:
                tasks[tid] = (task, location)
            if not set(task['acceptance_ids']).issubset(expected):
                report('error', 'UNKNOWN_ACCEPTANCE', location, '任务引用未知验收编号: ' + tid)
            if not task['acceptance_ids']:
                report('error', 'TASK_NO_ACCEPTANCE', location, '任务缺少验收映射: ' + tid)

    for kind in manifest['coverage_types']:
        covered = set()
        for data, _ in documents.values():
            if data['document_type'] == kind:
                if kind == 'tasks':
                    covered.update(a for t in data['tasks'] for a in t['acceptance_ids'])
                else:
                    covered.update(data['acceptance_ids'])
        missing = expected - covered
        if missing:
            report('error', 'COVERAGE_GAP', kind, '未映射验收编号: ' + ', '.join(sorted(missing)))

    for key, (data, _) in documents.items():
        for ref in data['references']:
            if ref['state'] != 'existing' or 'version' not in ref:
                continue
            target = documents.get((ref['repo_id'], ref['path']))
            if target is None:
                report('unverified', 'VERSION_UNVERIFIED', ':'.join(key), '引用版本无法核对: ' + ref['path'])
            elif target[0]['version'] != ref['version']:
                report('error', 'VERSION_MISMATCH', ':'.join(key), '引用版本已不一致: ' + ref['path'])

    for tid, (task, location) in tasks.items():
        for dep in task['depends_on']:
            if dep not in tasks:
                report('error', 'UNKNOWN_DEPENDENCY', location, tid + ' 依赖未登记任务: ' + dep)
    # Iterative graph traversal avoids recursion limits on large task sets.
    state = {}
    for start in tasks:
        stack = [(start, False)]
        while stack:
            tid, leaving = stack.pop()
            if leaving:
                state[tid] = 2
                continue
            if state.get(tid) == 1:
                report('error', 'DEPENDENCY_CYCLE', tasks[tid][1], '任务存在循环依赖: ' + tid)
                continue
            if state.get(tid) == 2:
                continue
            state[tid] = 1
            stack.append((tid, True))
            stack.extend((dep, False) for dep in tasks[tid][0]['depends_on'] if dep in tasks)
    return {
        'status': 'failed' if any(f['level'] == 'error' for f in findings) else
                  'incomplete' if findings else 'passed',
        'checked_artifacts': len(documents),
        'findings': findings,
        'limits': ['仅校验清单和结构化数据；不证明正文语义、代码行为、人工审批真实性或业务验收通过。'],
    }


def strings(value):
    return isinstance(value, list) and all(isinstance(x, str) and x.strip() for x in value)


def check_metadata(data):
    if not isinstance(data, dict):
        raise ValueError('数据块必须为 JSON 对象')
    for field in ('requirement_id', 'repo_id', 'document_type', 'version'):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError('缺少非空字符串字段: ' + field)
    if data['document_type'] not in TYPES:
        raise ValueError('不支持的产物类型')
    if not strings(data.get('acceptance_ids')):
        raise ValueError('acceptance_ids 必须为字符串数组')
    for field in ('references', 'tasks'):
        if not isinstance(data.get(field), list):
            raise ValueError(field + ' 必须为数组')
    for ref in data['references']:
        if not isinstance(ref, dict) or not all(isinstance(ref.get(k), str) and ref[k].strip() for k in ('repo_id', 'path', 'state')):
            raise ValueError('引用必须包含 repo_id/path/state')
        if ref['state'] not in {'existing', 'planned'}:
            raise ValueError('引用状态必须为 existing/planned')
        for field in ('version', 'sha256'):
            if field in ref and (not isinstance(ref[field], str) or not ref[field].strip()):
                raise ValueError('引用 ' + field + ' 必须为非空字符串')
        if 'sha256' in ref and not re.fullmatch('[0-9a-f]{64}', ref['sha256']):
            raise ValueError('sha256 必须为 64 位小写十六进制')
    if data['tasks'] and data['document_type'] != 'tasks':
        raise ValueError('任务正文只能登记在 tasks 产物中')
    for task in data['tasks']:
        if not isinstance(task, dict) or not isinstance(task.get('id'), str) or not task['id'].strip():
            raise ValueError('任务必须包含非空 id')
        if not strings(task.get('acceptance_ids')) or not strings(task.get('depends_on')):
            raise ValueError('任务必须包含 acceptance_ids/depends_on 字符串数组')


def check_manifest(data):
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('清单 schema_version 必须为 1')
    if not isinstance(data.get('requirement_id'), str) or not data['requirement_id'].strip():
        raise ValueError('清单缺少 requirement_id')
    if not strings(data.get('acceptance_ids')) or not strings(data.get('coverage_types')):
        raise ValueError('清单必须提供 acceptance_ids/coverage_types 数组')
    if not set(data['coverage_types']).issubset({'spec', 'design', 'tasks'}):
        raise ValueError('coverage_types 只支持 spec/design/tasks')
    if not isinstance(data.get('artifacts'), list):
        raise ValueError('清单缺少 artifacts 数组')
    for entry in data['artifacts']:
        if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) and entry[k].strip() for k in ('repo_id', 'path', 'document_type')):
            raise ValueError('产物登记必须包含 repo_id/path/document_type')
        if entry['document_type'] not in TYPES:
            raise ValueError('清单含不支持的产物类型')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--repo', action='append', default=[], metavar='ID=PATH')
    args = parser.parse_args()
    try:
        roots = {}
        for mapping in args.repo:
            repo, separator, path = mapping.partition('=')
            if not separator or not repo or not path or repo in roots:
                raise ValueError('--repo 必须是唯一的 ID=PATH')
            roots[repo] = path
        manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
        check_manifest(manifest)
        result = validate(manifest, roots)
    except (OSError, ValueError, TypeError) as exc:
        print(json.dumps({'status': 'invalid_input', 'message': str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return {'passed': 0, 'failed': 1, 'incomplete': 3}[result['status']]


if __name__ == '__main__':
    sys.exit(main())
