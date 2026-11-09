import { lazy, Suspense, useEffect, useState } from "react";

const CodePreview = lazy(() => import('./CodePreview'));

interface TextPreviewProps {
  filePath: string;
}

export default function TextPreview({ filePath }: TextPreviewProps) {
  const [state, setState] = useState<{
    loading: boolean;
    text?: string;
    error?: string;
  }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });

    fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setState(
          data.error
            ? { loading: false, error: data.error }
            : { loading: false, text: data.text ?? "" },
        );
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setState({ loading: false, error: error.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (state.loading) return <div className="preview-loading">加载中...</div>;
  if (state.error) return <div className="preview-error">预览失败: {state.error}</div>;

  return <Suspense fallback={<div className="preview-loading">正在加载代码预览...</div>}>
    <CodePreview text={state.text ?? ''} filePath={filePath} />
  </Suspense>;
}
