(function(root){
'use strict';
const defaults={RU:'wind',NR:'wind',BR:'wind',TF:'ifind'},key='rubber.chart.sources.v1';
function normalize(value={}){return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,['wind','ifind'].includes(value?.[k])?value[k]:v]));}
function load(){try{return normalize(JSON.parse(localStorage.getItem(key)||'{}'));}catch{return {...defaults};}}
function save(value){const selected=normalize(value);localStorage.setItem(key,JSON.stringify(selected));return selected;}
function labels(selected){const result={cup:'杯胶'};for(const [k,label] of Object.entries({RU:'RU',NR:'NR',BR:'BR',TF:'SICOM'}))result[k]=label+' · '+(selected[k]==='ifind'?'iFinD':'WIND');result.NR_TF=result.NR+' − '+result.TF;result.RU_NR=result.RU+' − '+result.NR;return result;}
function project(state,preferences){
 const selected=normalize(preferences);
 const rows=state.rows.map(row=>{
  const result={...row};
  for(const group of ['raw','cny','usd','spread']){
   const original=row[group]||{};
   result[group]=Object.fromEntries(Object.entries(original).filter(([k])=>!k.startsWith('ifind_')));
   if(group!=='spread')for(const product of Object.keys(defaults)){
    const value=original[(selected[product]==='ifind'?'ifind_':'')+product];result[group][product]=Number.isFinite(value)?value:null;
   }
  }
  const diff=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
  result.spread.NR_TF=diff(result.cny.NR,result.cny.TF);result.spread.RU_NR=diff(result.cny.RU,result.cny.NR);
  result.product_sources={...selected};return result;
 });
 const quotes=(state.quotes||[]).filter(q=>{
  const product=Object.keys(defaults).find(p=>q.code?.startsWith(p));
  return (q.vendor||'wind')===(product?selected[product]:'wind');
 });
 return {...state,rows,quotes,chart_sources:selected};
}
const api={defaults,normalize,load,save,labels,project};
if(typeof module!=='undefined')module.exports=api;root.ChartSources=api;
})(typeof window==='undefined'?{}:window);
