import React from "react";
import { createRoot } from "react-dom/client";
import WidgetRenderer from "../src/components/WidgetRenderer";
import { useStore } from "../src/store/useStore";
import * as widgetDocument from "../src/components/widgetDocument";
import * as widgetImages from "../src/components/widgetImages";
import * as widgetExport from "../src/components/widgetExport";
import "../src/components/ChatArea.css";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 260" role="img"><title>订单处理流程</title><style>.custom{stroke-width:2;stroke:var(--text-3);fill:none}</style><defs><marker id="arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker><pattern id="dots" patternUnits="userSpaceOnUse" width="8" height="8"><circle cx="2" cy="2" r="1" fill="var(--text-3)"/></pattern></defs><path class="custom" d="M220 112H450" marker-end="url(#arrow)"/><g class="node c-blue"><rect x="40" y="84" width="180" height="56" rx="8"/><text class="th" x="130" y="117" text-anchor="middle">接收订单</text></g><g class="node c-teal" onclick="sendPrompt('查看订单校验详情')"><rect x="460" y="84" width="180" height="56" rx="8"/><text class="th" x="550" y="117" text-anchor="middle">校验与处理</text></g><rect x="40" y="175" width="600" height="36" rx="8" fill="url(#dots)"/><text class="ts" x="340" y="242" text-anchor="middle">订单流程 · 独立沙箱 · 等比缩放</text></svg>`;
const html = `<img id="local-image" src="/private/tmp/widget-test.png" width="16" height="16" alt="本地图片"/><h2>订单增长模拟</h2><label>增长倍数 <input id="growth" type="range" min="1" max="5" value="2"/></label><p id="value">200</p><div style="height:120px"><canvas id="chart" width="600" height="120" role="img" aria-label="订单增长">订单增长图表</canvas></div><button id="next">下一步</button><span id="step">1</span><a id="external-link" href="HTTPS://example.com/widget">查看说明</a><script>sendPrompt("automatic request");var slider=document.getElementById('growth'),value=document.getElementById('value'),ctx=document.getElementById('chart').getContext('2d');function draw(){value.textContent=slider.value*100;ctx.clearRect(0,0,600,120);ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--color-text-info');ctx.fillRect(0,10,slider.value*100,90)}slider.oninput=draw;window.addEventListener('widget:theme',draw);draw();document.getElementById('next').onclick=function(){document.getElementById('step').textContent=Number(document.getElementById('step').textContent)+1}</script>`;
const vars = `--bg:#fff;--bg-subtle:#f5f5f5;--text:#1a1a1a;--text-2:#666;--text-3:#999;--border:#ddd;--accent:#378add;--green:#0f6e56;--red:#a32d2d;--amber:#854f0b;--font:system-ui;`;
document.documentElement.style.cssText = vars;
useStore.setState({theme:"light"});
const prompts: string[] = [];
const openedLinks: string[] = [];
window.open = ((url: string) => { openedLinks.push(url); return null; }) as typeof window.open;
useStore.setState({sendMessage: async text => {prompts.push(text);return true;}});
Object.assign(window, { widgetDocument, widgetExport, widgetImages, fixtureSvg:svg, fixtureHtml:html, prompts, openedLinks, setWidgetTheme:(dark:boolean)=>{
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.documentElement.style.cssText=dark?vars.replace('--bg:#fff','--bg:#1a1a1a').replace('--text:#1a1a1a','--text:#e0e0e0').replace('--bg-subtle:#f5f5f5','--bg-subtle:#2a2a2a'):vars;
  useStore.setState({theme:dark?'dark':'light'});
}});
function App(){return <main style={{maxWidth:900,margin:"24px auto",fontFamily:"system-ui"}}><h1>参考设计 可视化回归样例</h1><div style={{width:"100%"}}><WidgetRenderer widget={{title:"订单流程 A",widget_code:svg}}/><WidgetRenderer widget={{title:"订单流程 B",widget_code:svg.replace('c-blue','c-coral')}}/><WidgetRenderer widget={{title:"增长交互",widget_code:html,module:"chart"}}/></div></main>}
createRoot(document.getElementById("root")!).render(<App/>);
