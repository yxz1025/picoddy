const languages: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', go: 'go', rs: 'rust',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
  sh: 'shell', bash: 'shell', json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql',
  toml: 'ini', ini: 'ini', kt: 'kotlin', swift: 'swift',
};

export function codeLanguage(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? '';
  return languages[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';
}
