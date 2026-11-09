import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/basic-languages/monaco.contribution.js';
import 'monaco-editor/language/json/monaco.contribution.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import { codeLanguage } from '../../utils/codeLanguage';

// Package the worker locally so previews also work offline in Electron.
(self as typeof self & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_id, label) => label === 'json' ? new JsonWorker() : new EditorWorker(),
};

export default function CodePreview({ text, filePath }: { text: string; filePath: string }) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [wrapped, setWrapped] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const theme = () => document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs';
    const model = monaco.editor.createModel(text, codeLanguage(filePath));
    const instance = monaco.editor.create(container.current, {
      model, theme: theme(), readOnly: true, domReadOnly: true,
      automaticLayout: true, minimap: { enabled: false }, lineNumbers: 'on',
      wordWrap: 'on', folding: true, scrollBeyondLastLine: false,
      fontSize: 13, lineHeight: 21, fontFamily: 'Menlo, Monaco, Consolas, monospace',
      padding: { top: 12, bottom: 12 }, renderLineHighlight: 'none',
      bracketPairColorization: { enabled: true }, guides: { indentation: true },
      ariaLabel: '代码文件预览（只读）',
    });
    editor.current = instance;
    setWrapped(true);
    setCopied(false);
    setCopyError(false);
    const observer = new MutationObserver(() => monaco.editor.setTheme(theme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      instance.dispose();
      model.dispose();
      editor.current = null;
    };
  }, [text, filePath]);

  return <div className="preview-code">
    <div className="preview-code-toolbar">
      <span>{codeLanguage(filePath)} · 只读</span>
      <button type="button" onClick={() => { void editor.current?.getAction('actions.find')?.run(); }}>查找</button>
      <button type="button" aria-pressed={wrapped} onClick={() => {
        editor.current?.updateOptions({ wordWrap: wrapped ? 'off' : 'on' });
        setWrapped(!wrapped);
      }}>自动换行</button>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false); }
        catch { setCopyError(true); }
      }}>{copied ? '已复制' : '复制'}</button>
      <span role="status">{copyError ? '复制失败，请选中代码后复制' : ''}</span>
    </div>
    <div className="preview-code-editor" ref={container} />
  </div>;
}
