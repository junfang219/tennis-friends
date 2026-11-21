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
// --- Prefill: drive the ActiveNet reservation widget from tf_* URL params ---
// Best-effort DOM automation of a third-party SPA. Every step is bounded and
// wrapped; on any failure we post {type:'prefill',ok:false} and leave the page
// untouched so the user picks manually. Formatters MUST match the strings in
// src/lib/bookingBridge.ts (formatActiveNetClock / formatActiveNetDateLabel).
var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pad2(n){return n<10?'0'+n:''+n;}
function fmtClock(hhmm){var a=hhmm.split(':');var h=parseInt(a[0],10),m=parseInt(a[1],10);var s=h<12?'AM':'PM';var h12=h%12===0?12:h%12;return h12+':'+pad2(m)+' '+s;}
function fmtDateLabel(ymd){var a=ymd.split('-');return MONTHS[parseInt(a[1],10)-1]+' '+parseInt(a[2],10)+', '+parseInt(a[0],10);}
function qa(sel){return Array.prototype.slice.call(document.querySelectorAll(sel));}
function visible(el){return !!(el&&el.offsetParent!==null);}
function waitFor(getter,timeoutMs){
  return new Promise(function(resolve,reject){
    var start=Date.now();
    (function tick(){
      var el=null;try{el=getter();}catch(e){}
      if(el){resolve(el);return;}
      if(Date.now()-start>timeoutMs){reject(new Error('timeout'));return;}
      setTimeout(tick,150);
    })();
  });
}
function findByText(sel,txt){
  var els=qa(sel);
  for(var i=0;i<els.length;i++){if((els[i].textContent||'').trim()===txt&&visible(els[i]))return els[i];}
  return null;
}
function findDayRegion(dateLabel,monthTries){
  // Wait for the calendar to actually render (its day cells load async after
  // the picker opens) BEFORE deciding whether we need to page to another
  // month — otherwise we'd try month-nav before the nav button even exists.
  return waitFor(function(){
    return document.querySelector('[aria-label^="'+dateLabel+'"]')
      || document.querySelector('[aria-label*="go to next month"]');
  },8000).then(function(){
    return new Promise(function(resolve,reject){
      function attempt(remaining){
        waitFor(function(){return document.querySelector('[aria-label^="'+dateLabel+'"]');},1500)
          .then(resolve)
          .catch(function(){
            if(remaining<=0){reject(new Error('day not found'));return;}
            var next=document.querySelector('[aria-label*="go to next month"]:not([disabled])');
            if(!next){reject(new Error('no next month'));return;}
            next.click();
            setTimeout(function(){attempt(remaining-1);},600);
          });
      }
      attempt(monthTries);
    });
  });
}
function fire(el,type){el.dispatchEvent(new MouseEvent(type,{bubbles:true}));}
// ActiveNet persists the reservation selection in the session, so a reopened
// sheet can start with a stale date/time. The field-level "Delete all dates
// and times" control wipes it in one click (only present when a selection
// exists); do this before opening the picker so we add onto a clean slate.
function clearExisting(){
  return new Promise(function(resolve){
    try{
      var del=document.querySelector('[aria-label*="Delete all dates and times"]');
      if(del){fire(del,'mousedown');fire(del,'mouseup');del.click();}
    }catch(e){}
    setTimeout(resolve,500);
  });
}
// Bypass React's value tracker so setting an input's value fires its onChange.
function setNativeValue(el,value){
  var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
  if(d&&d.set){d.set.call(el,value);}else{el.value=value;}
}
// Set a start/end time. ActiveNet renders the field either as a native
// <input type="time"> (value is 24h "HH:mm") or a custom combobox whose
// dropdown opens on mousedown (options are li[role=option], 12h text). Handle
// both. hhmm24 is the 24h value; txt12 is its "h:mm AM/PM" form.
function setTime(which,hhmm24){
  return waitFor(function(){return document.querySelector('[aria-label*="'+which+'"]');},3000)
    .then(function(box){
      if(box.tagName==='INPUT'&&box.getAttribute('type')==='time'){
        setNativeValue(box,hhmm24);
        box.dispatchEvent(new Event('input',{bubbles:true}));
        box.dispatchEvent(new Event('change',{bubbles:true}));
        return new Promise(function(r){setTimeout(r,200);});
      }
      var txt12=fmtClock(hhmm24);
      if(box.focus)box.focus();fire(box,'mousedown');fire(box,'mouseup');fire(box,'click');
      return waitFor(function(){return findByText('[role="option"]',txt12);},3000)
        .then(function(opt){fire(opt,'mousedown');fire(opt,'mouseup');opt.click();return new Promise(function(r){setTimeout(r,200);});});
    });
}
function prefill(){
  var qs;try{qs=new URLSearchParams(location.search);}catch(e){return;}
  var date=qs.get('tf_date');
  if(!date)return; // no prefill requested for this page
  var startRaw=qs.get('tf_start'); // 24h "HH:mm"
  var endRaw=qs.get('tf_end');
  var dateLabel=fmtDateLabel(date);
  waitFor(function(){return document.querySelector('[aria-label*="Add dates and times"]');},9000)
    .then(function(){return clearExisting();})
    .then(function(){return waitFor(function(){return document.querySelector('[aria-label*="Add dates and times"]');},4000);})
    .then(function(trigger){trigger.click();return findDayRegion(dateLabel,2);})
    .then(function(){
      // Wait for the day's clickable slot to render (it's an <a role="button">
      // that loads with the availability data, after the region cell itself).
      // Re-query each poll so a React re-render doesn't hand us a stale node.
      return waitFor(function(){
        var r=document.querySelector('[aria-label^="'+dateLabel+'"]');
        return r&&r.querySelector('[role="button"],a');
      },5000);
    })
    .then(function(slot){
      slot.click();
      return startRaw?setTime('Start time',startRaw):null;
    })
    .then(function(){return endRaw?setTime('End time',endRaw):null;})
    .then(function(){return waitFor(function(){return findByText('button,[role="button"]','Apply');},4000);})
    .then(function(apply){apply.click();try{console.log('[tf-bridge] prefill ok');}catch(e){}send({type:'prefill',ok:true});})
    .catch(function(err){try{console.log('[tf-bridge] prefill fail',err&&err.message);}catch(e){}send({type:'prefill',ok:false});});
}
document.addEventListener('DOMContentLoaded',function(){nav();scanConfirmation();prefill();});
if(document.readyState!=='loading'){nav();scanConfirmation();prefill();}
})();</script>`;
