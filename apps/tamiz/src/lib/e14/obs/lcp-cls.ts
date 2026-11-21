// Observabilidad de LCP/CLS: script inline (pre-hidratación) + instalador del
// observer del lado cliente.

/** Fuente JS inyectada en <head> ANTES de hidratar (mide LCP/CLS real). */
export const SCRIPT_LCP_CLS = `(function(){try{
var lcp=0,cls=0,po;
if(window.PerformanceObserver){
po=new PerformanceObserver(function(list){
for(var i=0;i<list.getEntries().length;i++){
var e=list.getEntries()[i];
if(e.entryType==='largest-contentful-paint')lcp=e.startTime;
if(e.entryType==='layout-shift'&&!e.hadRecentInput)cls+=e.value;
}});
po.observe({type:'largest-contentful-paint',buffered:true});
po.observe({type:'layout-shift',buffered:true});
}
window.__e14LcpCls={lcp:function(){return lcp},cls:function(){return cls}};
window.dispatchEvent(new CustomEvent('e14-lcp-cls'));
}catch(e){/* la medición jamás rompe la app */}})();`;

let instalado = false;

/** Idempotente: lee la medición del script inline y la reporta. */
export function instalarObserverLcpCls(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  const reportar = () => {
    const m = (window as Window & { __e14LcpCls?: { lcp(): number; cls(): number } }).__e14LcpCls;
    if (m) console.debug('[obs] lcp/cls', { lcp: Math.round(m.lcp()), cls: Math.round(m.cls() * 1000) / 1000 });
  };
  if ((window as Window & { __e14LcpCls?: unknown }).__e14LcpCls) reportar();
  else window.addEventListener('e14-lcp-cls', reportar, { once: true });
}
