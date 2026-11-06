/** Executed inside the isolated widget, following 参考设计's foreignObject + canvas overlay capture. */
export const WIDGET_CAPTURE_SCRIPT = `
async function captureWidget(requestId){
 try{
  var root=document.getElementById('widget-root'),box=root.getBoundingClientRect();
  var width=Math.ceil(Math.max(box.width,root.scrollWidth)),height=Math.ceil(Math.max(box.height,root.scrollHeight));
  if(!width||!height||height>16384||width>16384)throw Error('Widget capture dimensions are invalid');
  var clone=root.cloneNode(true),originals=[root].concat(Array.from(root.querySelectorAll('*'))),copies=[clone].concat(Array.from(clone.querySelectorAll('*'))),overlays=[];
  originals.forEach(function(el,i){var style=getComputedStyle(el);for(var k=0;k<style.length;k++){var name=style[k];copies[i].style.setProperty(name,style.getPropertyValue(name));}});
  Array.from(root.querySelectorAll('canvas')).forEach(function(canvas,i){var rect=canvas.getBoundingClientRect();overlays.push({url:canvas.toDataURL('image/png'),x:rect.left-box.left,y:rect.top-box.top,w:rect.width,h:rect.height});var copy=clone.querySelectorAll('canvas')[i];copy.style.visibility='hidden';});
  clone.querySelectorAll('script').forEach(function(el){el.remove();});
  var payload='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><foreignObject width="100%" height="100%">'+new XMLSerializer().serializeToString(clone)+'</foreignObject></svg>';
  function load(url){return new Promise(function(resolve,reject){var image=new Image();image.onload=function(){resolve(image);};image.onerror=function(){reject(Error('Widget image could not be rendered'));};image.src=url;});}
  var image=await load('data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(payload))));
  var scale=Math.min(3,4096/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  var ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--color-background-primary')||'#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
  for(var overlay of overlays){var layer=await load(overlay.url);ctx.drawImage(layer,overlay.x,overlay.y,overlay.w,overlay.h);}
  send({type:'widget:capture-result',requestId:requestId,dataUrl:canvas.toDataURL('image/png')});
 }catch(error){send({type:'widget:capture-result',requestId:requestId,error:String(error.message||error)});}
}
`;

export async function captureWidgetPng(frame: HTMLIFrameElement): Promise<Blob> {
  const requestId = crypto.randomUUID();
  const widgetId = frame.dataset.widgetId;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const originalWidth = frame.style.width;
    const originalHeight = frame.style.height;
    frame.dataset.capturing = "true";
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("可视化图片导出超时")); }, 15000);
    function cleanup() {
      clearTimeout(timer); window.removeEventListener("message", onMessage);
      frame.style.width = originalWidth; frame.style.height = originalHeight;
      delete frame.dataset.capturing;
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow || event.data?.__widgetId !== widgetId || event.data?.requestId !== requestId) return;
      if (event.data.type === "widget:capture-ready") {
        const {width, height} = event.data;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384) {
          cleanup(); reject(new Error("可视化尺寸超出图片导出范围")); return;
        }
        frame.style.width = `${Math.ceil(width)}px`; frame.style.height = `${Math.ceil(height)}px`;
        requestAnimationFrame(() => requestAnimationFrame(() => frame.contentWindow?.postMessage({type:"widget:capture",__widgetId:widgetId,requestId}, "*")));
        return;
      }
      if (event.data.type !== "widget:capture-result") return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else if (typeof event.data.dataUrl === "string" && event.data.dataUrl.startsWith("data:image/png;base64,")) resolve(event.data.dataUrl);
      else reject(new Error("可视化图片数据无效"));
    }
    window.addEventListener("message", onMessage);
    frame.contentWindow?.postMessage({type:"widget:capture-prepare",__widgetId:widgetId,requestId}, "*");
  });
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
  return new Blob([bytes], {type:"image/png"});
}
