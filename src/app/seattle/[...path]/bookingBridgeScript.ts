// Script injected by the /seattle reverse proxy into every proxied ActiveNet
// HTML page. When the page runs inside the BookingSheet iframe it reports
// navigation + checkout completion to the parent window via postMessage.
// Outside an iframe (window.parent === window) it does nothing but log.
//
// Ships as a raw string into a foreign page, so it must be dependency-free
// ES5-ish and self-contained. The regexes MUST stay in sync with FUNNEL_RE /
// CONFIRM_RE / receipt parsing in src/lib/bookingBridge.ts. Every signal is
// also console.logged with a [tf-bridge] prefix so the discovery run can
// capture real checkout shapes from Safari/Chrome web inspector.
//
// SECURITY: a bridge message never books or saves anything by itself — it
// only tells the parent sheet what the user did so the parent can pre-fill a
// user-confirmed save. Messages are posted with an explicit targetOrigin.

export const BOOKING_BRIDGE_SCRIPT = `<script>(function(){
if(window.parent===window){/* not framed: log-only */}
var SRC='tf-booking-bridge';
var ORIGIN=location.origin;
var FUNNEL=/onlinecart|checkout|payment/i;
var CONFIRM=/confirmation|receipt|reservation\\/complete/i;
var RECEIPT_KEY=/receipt[_-]?(number|no|num|id)|receipt[_-]?header[_-]?id/i;
function send(msg){
  msg.source=SRC;
  try{console.log('[tf-bridge]',msg.type,msg.path||'',msg.receiptNumber||'');}catch(e){}
  try{window.parent.postMessage(msg,ORIGIN);}catch(e){}
}
function curPath(){return location.pathname+location.search;}
function nav(){send({type:'nav',path:curPath()});}
// Find the first receipt-like scalar anywhere in a parsed JSON tree.
function findReceipt(node){
  var stack=[node],seen=[];
  while(stack.length){
    var n=stack.pop();
    if(!n||typeof n!=='object')continue;
    if(seen.indexOf(n)!==-1)continue;
    seen.push(n);
    if(Object.prototype.toString.call(n)==='[object Array]'){
      for(var i=0;i<n.length;i++)stack.push(n[i]);
      continue;
    }
    for(var k in n){
      if(!Object.prototype.hasOwnProperty.call(n,k))continue;
      var v=n[k];
      if(RECEIPT_KEY.test(k)&&(typeof v==='string'||typeof v==='number')&&String(v)!==''&&String(v)!=='0'){
        return String(v);
      }
      stack.push(v);
    }
  }
  return null;
}
// Inspect a checkout/cart/payment REST response body for a completion signal.
function inspect(url,text){
  if(!/\\/seattle\\/rest\\//.test(url)||!FUNNEL.test(url))return;
  var json;try{json=JSON.parse(text);}catch(e){return;}
  var code=json&&json.headers&&json.headers.response_code;
  var receipt=findReceipt(json);
  // Treat a receipt in the body, or an explicit success code, as complete.
  if(receipt||code==='0000'){
    var summary;try{summary=JSON.stringify(json).slice(0,2048);}catch(e){}
    var out={type:'checkout-complete',path:curPath()};
    if(receipt)out.receiptNumber=receipt;
    if(summary)out.rawSummary=summary;
    send(out);
  }
}
// --- Navigation breadcrumbs (SPA uses pushState/replaceState) ---
var op=history.pushState,orr=history.replaceState;
history.pushState=function(){var r=op.apply(this,arguments);setTimeout(nav,0);return r;};
history.replaceState=function(){var r=orr.apply(this,arguments);setTimeout(nav,0);return r;};
window.addEventListener('popstate',nav);
// Also poll, in case a route change slips past the wrappers.
var last=curPath();
setInterval(function(){var p=curPath();if(p!==last){last=p;nav();}},1000);
// --- fetch() interception ---
if(window.fetch){
  var of=window.fetch;
  window.fetch=function(){
    var args=arguments;
    return of.apply(this,args).then(function(res){
      try{
        var u=(res&&res.url)||(typeof args[0]==='string'?args[0]:(args[0]&&args[0].url))||'';
        if(/\\/seattle\\/rest\\//.test(u)&&FUNNEL.test(u)){
          res.clone().text().then(function(t){inspect(u,t);}).catch(function(){});
        }
      }catch(e){}
      return res;
    });
  };
}
// --- XMLHttpRequest interception ---
var oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u){this.__tfUrl=u;return oo.apply(this,arguments);};
XMLHttpRequest.prototype.send=function(){
  var xhr=this;
  xhr.addEventListener('load',function(){
    try{
      var u=xhr.__tfUrl||'';
      if(/\\/seattle\\/rest\\//.test(u)&&FUNNEL.test(u)){inspect(u,xhr.responseText);}
    }catch(e){}
  });
  return os.apply(this,arguments);
};
// --- Confirmation-page fallback: scan the DOM for a receipt number ---
function scanConfirmation(){
  if(!CONFIRM.test(curPath()))return;
  var m=(document.body&&document.body.innerText||'').match(/receipt\\s*(?:number|#|no\\.?)?\\s*[:#]?\\s*([A-Za-z0-9-]{3,})/i);
  send({type:'checkout-complete',path:curPath(),receiptNumber:m?m[1]:undefined});
}
document.addEventListener('DOMContentLoaded',function(){nav();scanConfirmation();});
if(document.readyState!=='loading'){nav();scanConfirmation();}
})();</script>`;
