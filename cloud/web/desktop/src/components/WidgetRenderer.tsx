import { randomUUID } from "../../../src/lib/uuid";
// 参考设计-compatible isolated SVG/HTML visualizer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WidgetData } from "../store/useStore";
import { useStore } from "../store/useStore";
import { inlineWidgetImages } from "./widgetImages";
import { WIDGET_CAPTURE_SCRIPT } from "./widgetCapture";
import { tokens } from "../store/appStore";
import { buildWidgetDocument, isSvgWidget, MAX_WIDGET_HEIGHT, sanitizeWidgetSvg, widgetBaseCss, widgetThemeCss } from "./widgetDocument";

function currentThemeCss(dark: boolean): string {
  const styles = getComputedStyle(document.documentElement);
  const names = new Set<string>(Array.from(styles).filter(name => name.startsWith("--")));
  for (const match of tokens.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
  return widgetThemeCss(name => styles.getPropertyValue(name), dark, [...names]);
}

function WidgetFrame({ widget, onRuntimeError }: { widget: WidgetData; onRuntimeError: (message: string) => void }) {
  const theme = useStore(s => s.theme);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const id = useRef(`widget-${randomUUID()}`).current;
  const [height, setHeight] = useState(220);
  const [ready, setReady] = useState(false);
  const [preparedCode, setPreparedCode] = useState<string | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setReady(false); setPreparedCode(null); setLoadingIndex(0);
    void inlineWidgetImages(widget.widget_code).then(code => { if (!cancelled) setPreparedCode(code); }).catch(error => { if (!cancelled) onRuntimeError(String(error.message || error)); });
    return () => { cancelled = true; };
  }, [widget.widget_code, onRuntimeError]);
  useEffect(() => {
    if (ready) return;
    const timer = window.setInterval(() => setLoadingIndex(i => i + 1), 1400);
    return () => clearInterval(timer);
  }, [ready]);
  const dark = theme === "dark";

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.__widgetId !== id) return;
      const data = event.data;
      if (data.type === "widget:ready") setReady(true);
      if (!iframeRef.current?.dataset.capturing && typeof data.__widgetHeight === "number" && Number.isFinite(data.__widgetHeight) && data.__widgetHeight > 0) {
        setHeight(Math.min(Math.max(Math.ceil(data.__widgetHeight), 20), MAX_WIDGET_HEIGHT));
      }
      if (typeof data.__widgetError === "string" && data.__widgetError.trim()) onRuntimeError(data.__widgetError.trim().slice(0, 400));
      const userInteracting = navigator.userActivation.isActive && document.activeElement === iframeRef.current;
      if (userInteracting && typeof data.__widgetPrompt === "string" && data.__widgetPrompt.trim()) {
        // User clicks inside the widget; reuse the normal conversation send path.
        void useStore.getState().sendMessage(data.__widgetPrompt.trim().slice(0, 500));
      }
      if (userInteracting && typeof data.__widgetLink === "string") {
        try {
          const url = new URL(data.__widgetLink);
          if (["https:", "http:"].includes(url.protocol)) window.open(url.href, "_blank", "noopener,noreferrer");
        } catch { /* Ignore invalid widget links. */ }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, onRuntimeError]);

  const srcdoc = useMemo(() => {
    const bridge = `<script>(function(){
      var id=${JSON.stringify(id)},pending=false;
      function send(data){data.__widgetId=id;parent.postMessage(data,'*');}
      function resize(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;var root=document.getElementById('widget-root');if(root)send({__widgetHeight:Math.max(root.scrollHeight,root.getBoundingClientRect().height)});});}
      ${WIDGET_CAPTURE_SCRIPT}
      window.sendPrompt=function(text){if(navigator.userActivation?.isActive&&typeof text==='string')send({__widgetPrompt:text.slice(0,500)});};
      window.openLink=function(url){try{var target=new URL(url);if(navigator.userActivation?.isActive&&['https:','http:'].includes(target.protocol))send({__widgetLink:target.href});}catch(error){}};
      window.addEventListener('error',function(e){send({__widgetError:e.message||'Widget resource failed to load'});});
      window.addEventListener('unhandledrejection',function(e){send({__widgetError:String(e.reason&&e.reason.message||e.reason)});});
      window.addEventListener('message',function(e){if(e.source!==parent||e.data?.__widgetId!==id)return;var d=e.data;if(d.type==='widget:capture-prepare'){var root=document.getElementById('widget-root'),box=root.getBoundingClientRect();send({type:'widget:capture-ready',requestId:d.requestId,width:Math.max(800,root.scrollWidth,Math.ceil(box.width)),height:Math.ceil(Math.max(root.scrollHeight,box.height))});return;}if(d.type==='widget:capture'){void captureWidget(d.requestId);return;}if(d.type==='widget:theme'){document.documentElement.className=d.dark?'dark':'light';document.getElementById('widget-theme').textContent=d.css;document.getElementById('widget-base').textContent=d.base;window.dispatchEvent(new Event('widget:theme'));resize();}});
      window.addEventListener('load',function(){var root=document.getElementById('widget-root');if(window.ResizeObserver&&root)new ResizeObserver(resize).observe(root);resize();if(document.fonts)document.fonts.ready.then(resize);send({type:'widget:ready'});});
      document.addEventListener('click',function(e){var node=e.target.closest('[data-widget-prompt]');if(node)window.sendPrompt(node.getAttribute('data-widget-prompt'));var link=e.target.closest('a[href]');if(link){e.preventDefault();var href=link.getAttribute('href');if(href.startsWith('#')){document.getElementById(href.slice(1))?.scrollIntoView();}else window.openLink(href);}},true);
      window.addEventListener('resize',resize);
    })();</script>`;
    const initialDark = useStore.getState().theme === "dark";
    return buildWidgetDocument(preparedCode ?? "", currentThemeCss(initialDark), initialDark, bridge, location.origin);
  }, [preparedCode, id]);

  // Update the theme without recreating the iframe or losing interactive state.
  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage({type:"widget:theme",__widgetId:id,dark,css:currentThemeCss(dark),base:widgetBaseCss(dark)}, "*");
  }, [dark, id, ready]);

  const messages = widget.loading_messages?.length ? widget.loading_messages : ["正在渲染可视化…"];
  return <div style={{position:"relative"}}>
    {preparedCode !== null && <iframe data-widget-id={id} ref={iframeRef} className="widget-iframe" sandbox="allow-scripts" title={widget.title} src="/widget-host.html" onLoad={() => iframeRef.current?.contentWindow?.postMessage({ type: "widget:init", html: srcdoc }, "*")} style={{height,visibility:ready ? "visible" : "hidden"}} />}
    {!ready && <div className="widget-loading" role="status" aria-live="polite" style={preparedCode !== null ? {position:"absolute",inset:0} : undefined}><span className="widget-loading-spinner"/><span>{messages[loadingIndex % messages.length]}</span></div>}
  </div>;
}

export default function WidgetRenderer({ widget }: { widget: WidgetData }) {
  const [error, setError] = useState("");
  useEffect(() => setError(""), [widget.widget_code]);
  const handleError = useCallback((message: string) => setError(message), []);
  const invalid = useMemo(() => isSvgWidget(widget.widget_code) && !sanitizeWidgetSvg(widget.widget_code), [widget.widget_code]);
  if (error || invalid) return <div className="widget-error" role="alert"><strong>可视化内容渲染失败</strong><span>{error || "SVG 内容无法解析"}</span><span>可使用卡片右上角复制或下载原始代码。</span></div>;
  return <div className="widget-body"><WidgetFrame widget={widget} onRuntimeError={handleError} /></div>;
}
