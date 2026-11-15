/* ==========================================================
   PATAAL YATRI: site behaviour.
   The lists on the page are written into the HTML by the build
   (tools/build.mjs, from content.json). What this script still
   needs, such as the tunnel's images and the on-repeat list, the
   build hands over in the <script id="py-data"> block.
   ========================================================== */
(function(){
"use strict";
var PY={};
try{PY=JSON.parse(document.getElementById("py-data").textContent)||{};}catch(e){}
var RM=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var $=function(s,c){return (c||document).querySelector(s);};
var $$=function(s,c){return [].slice.call((c||document).querySelectorAll(s));};
var clamp=function(v,a,b){return v<a?a:v>b?b:v;};
var lerp=function(a,b,t){return a+(b-a)*t;};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};

var NIGHT="#0B0605",NIGHT2="#150B09",BLOOD2="#6B0E12",FLAME="#FF6A1F",HOT="#FFB02E",ALTA="#C4161C",ASH="233,224,210";
var ash=function(a){return "rgba("+ASH+","+a.toFixed(3)+")";};
var SCROLL={y:0,covered:false};

var TUN=PY.tunnel||{};
var ART=TUN.images||[];

/* =========================================================
   1. CANVAS HELPERS
   ========================================================= */
function sizeTo(cv,el,maxDpr){
  var dpr=Math.min(window.devicePixelRatio||1,maxDpr||2);
  var w=(el?el.clientWidth:window.innerWidth),h=(el?el.clientHeight:window.innerHeight);
  cv.width=Math.max(1,Math.round(w*dpr));cv.height=Math.max(1,Math.round(h*dpr));
  var g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  return {g:g,w:w,h:h};
}
function fnv(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rngOf(seed){var s=seed%2147483647;if(s<=0)s+=2147483646;return function(){s=s*16807%2147483647;return (s-1)/2147483646;};}
function shuffle(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var s=a[i];a[i]=a[j];a[j]=s;}return a;}

/* A drawn sleeve, for anything that has no art yet. Two motifs:
   the pit (looking straight down a stepped shaft) and the pyre. */
function drawSleeve(cv,key,lift){
  var g=cv.getContext("2d"),W=cv.width,H=cv.height,seed=fnv(key),r=rngOf(seed);
  g.fillStyle=lift?"#2B1613":NIGHT2;g.fillRect(0,0,W,H);
  if((seed>>>3)%2){
    var n=5+Math.floor(r()*4),dx=(r()-.5)*W*.05,dy=(r()-.5)*H*.05,lit=1+Math.floor(r()*(n-1));
    g.lineWidth=Math.max(1.5,W*.014);
    for(var q=0;q<n;q++){
      var f=q/n,inset=W*(.09+f*.37);
      g.strokeStyle=(q===lit)?(lift?ash(.98):FLAME):ash(.78-f*.5);
      g.strokeRect(inset+dx*q,inset+dy*q,W-inset*2,H-inset*2);
    }
    var c=W*.07;
    g.fillStyle=lift?ash(.9):ALTA;
    g.fillRect(W/2-c/2+dx*n,H/2-c/2+dy*n,c,c);
  }else{
    var m=16+Math.floor(r()*12),x0=W*.12,x1=W*.88,bw=(x1-x0)/m,base=H*.78;
    var skew=.5+r()*.85,peak=.6+r()*1.4,tilt=-.3+r()*.6,litAt=Math.floor(r()*m);
    for(var i=0;i<m;i++){
      var t=i/(m-1);
      var env=Math.pow(Math.sin(Math.PI*Math.pow(t,skew)),peak);
      var v=clamp(env*(.4+r()*.6)+tilt*(.5-t)*.5,.06,1);
      var bh=Math.max(3,v*H*.56);
      g.fillStyle=(i===litAt)?(lift?ash(.98):FLAME):ash(.2+v*.62);
      g.fillRect(x0+i*bw,base-bh,bw-Math.max(1.5,bw*.3),bh);
    }
    g.fillStyle=lift?ash(.5):ALTA;
    g.fillRect(x0,base+Math.max(2,H*.02),x1-x0,Math.max(2,H*.012));
  }
  if(lift){
    g.strokeStyle=ash(.3);g.lineWidth=Math.max(2,W*.012);
    g.strokeRect(g.lineWidth/2,g.lineWidth/2,W-g.lineWidth,H-g.lineWidth);
  }
}

/* =========================================================
   2. ART POOL: everything the tunnel can fly past.
   Drawn sleeves stand in until the images in /art arrive;
   from the first real image on, only real art is dealt.
   Every image is shrunk and washed once, up front, so the
   render loop is nothing but drawImage.
   ========================================================= */
var TINT=("tint" in TUN)?TUN.tint:"#E0321F";
var TILE=512;
var POOL=[],REAL=false,deck=0,onArt=null;

function bake(src,drawn){
  var w=src.naturalWidth||src.width,h=src.naturalHeight||src.height;
  if(!w||!h)return null;
  var k=Math.min(1,TILE/Math.max(w,h));
  var c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
  var g=c.getContext("2d"),W=c.width,H=c.height;
  g.drawImage(src,0,0,W,H);
  if(TINT){
    /* firelight: shadows stay black, mid-tones take the wash, highlights burn toward flame */
    g.globalCompositeOperation="saturation";g.fillStyle="#808080";g.fillRect(0,0,W,H);
    var hot=document.createElement("canvas");hot.width=W;hot.height=H;
    var hg=hot.getContext("2d");
    hg.drawImage(c,0,0);
    hg.globalCompositeOperation="multiply";hg.drawImage(c,0,0);     /* grey squared: only the highlights survive */
    hg.fillStyle=HOT;hg.fillRect(0,0,W,H);
    g.globalCompositeOperation="multiply";g.fillStyle=TINT;g.fillRect(0,0,W,H);
    g.globalCompositeOperation="lighter";g.globalAlpha=0.42;g.drawImage(hot,0,0);g.globalAlpha=1;
    /* put back the image's own transparency, which the fills painted over */
    g.globalCompositeOperation="destination-in";g.drawImage(src,0,0,W,H);
    g.globalCompositeOperation="source-over";
  }
  c._ar=W/H;c._drawn=!!drawn;
  return c;
}
function nextArt(){
  if(!POOL.length)return null;
  return POOL[(deck++)%POOL.length];
}
(function(){
  var seeds=(PY.seeds||[]).slice();
  while(seeds.length<10)seeds.push("pataal"+seeds.length);
  seeds.forEach(function(k){
    var c=document.createElement("canvas");c.width=c.height=300;
    drawSleeve(c,k,true);POOL.push(bake(c,true));
  });
  shuffle(POOL);

  var list=shuffle(ART.slice()),max=TUN.max||60;
  if(list.length>max)list.length=max;
  var at=0,busy=0;
  function pump(){
    while(busy<4&&at<list.length)load(list[at++]);
  }
  function load(item){
    busy++;
    var im=new Image();im.decoding="async";
    im.onload=function(){
      var c=null;try{c=bake(im);}catch(e){}
      if(c){
        if(!REAL){REAL=true;POOL.length=0;deck=0;}
        POOL.push(c);
        if(onArt)onArt(c,list.length);
      }
      busy--;pump();
    };
    im.onerror=function(){busy--;pump();};
    im.src=item;
  }
  pump();
})();

/* =========================================================
   3. THE TUNNEL: scrolling flies the camera down a shaft of
   art. Speed comes from scroll delta, so the page itself is
   the transport; a slow drift keeps it alive when nobody is
   moving. The pit at the far end glows hotter the further
   down the page you are, and embers rise through the shaft.
   ========================================================= */
(function(){
  var cv=$("#tunnel");if(!cv)return;
  /* a soft background layer: 1x is plenty and costs a quarter of the fill */
  var d=sizeTo(cv,null,1),g=d.g,W=d.w,H=d.h,glow=null;
  window.addEventListener("resize",function(){d=sizeTo(cv,null,1);g=d.g;W=d.w;H=d.h;glow=null;still();});

  var small=innerWidth<760;
  var Z_NEAR=110,Z_FAR=2300,COUNT=RM?16:(small?20:32);
  var tiles=[],camDelta=0,drift=0;

  function place(t,atFar){
    var ang=Math.random()*Math.PI*2;
    /* an annulus: the middle of the frame stays clear for the text */
    var rad=0.62+Math.random()*1.55;
    t.ax=Math.cos(ang)*rad;
    t.ay=Math.sin(ang)*rad*0.82;
    t.z=atFar?Z_FAR-Math.random()*260:Z_NEAR+Math.random()*(Z_FAR-Z_NEAR);
    t.s=0.34+Math.random()*Math.random()*0.62;
    t.rot=(Math.random()-0.5)*0.16;
    t.img=nextArt();
  }
  for(var i=0;i<COUNT;i++){tiles.push({});place(tiles[i]);}

  /* real art arriving: hand it to the tiles still showing a drawn sleeve, far ones first */
  onArt=function(c,expected){
    var drawn=tiles.filter(function(t){return t.img&&t.img._drawn;}).sort(function(a,b){return b.z-a.z;});
    var share=Math.max(1,Math.ceil(tiles.length/Math.max(1,expected)));
    for(var i=0;i<drawn.length&&i<share;i++)drawn[i].img=c;
    still();
  };

  var SPARKS=RM?0:(small?26:52),sparks=[];
  function seed(s,atFar){
    var ang=Math.random()*Math.PI*2,rad=0.12+Math.random()*2;
    s.ax=Math.cos(ang)*rad;
    s.ay=Math.sin(ang)*rad*0.82;
    s.z=atFar?Z_FAR-Math.random()*300:Z_NEAR+Math.random()*(Z_FAR-Z_NEAR);
    s.vy=0.0005+Math.random()*0.0016;
    s.ph=Math.random()*6.283;
    s.hot=Math.random()<0.3;
  }
  for(var k=0;k<SPARKS;k++){sparks.push({});seed(sparks[k]);}

  var order=[];
  function frame(now){
    if(!RM)requestAnimationFrame(frame);
    /* behind the opaque band there is nothing to see, so nothing is drawn */
    if(SCROLL.covered){camDelta*=0.86;return;}
    now=now||0;
    g.clearRect(0,0,W,H);
    var U=Math.min(W,H)*0.5,cx=W*0.5,cy=H*0.46;
    /* progress deepens the perspective: the further in, the wider the throw */
    var max=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    var prog=clamp(SCROLL.y/max,0,1);
    var F=640+prog*300;

    if(!glow){
      glow=g.createRadialGradient(cx,cy,0,cx,cy,Math.max(W,H)*0.6);
      glow.addColorStop(0,"rgba(255,122,40,.62)");
      glow.addColorStop(0.14,"rgba(214,38,26,.46)");
      glow.addColorStop(0.5,"rgba(110,14,16,.20)");
      glow.addColorStop(1,"rgba(11,6,5,0)");
    }
    g.globalAlpha=0.3+prog*0.7;
    g.fillStyle=glow;g.fillRect(0,0,W,H);

    drift=lerp(drift,RM?0:0.9,0.05);
    var step=RM?0:drift+camDelta*1.45;
    camDelta*=0.86;

    order.length=0;
    for(var i=0;i<tiles.length;i++){
      var t=tiles[i];
      t.z-=step;
      if(t.z<Z_NEAR){place(t,true);t.z=Z_FAR-Math.random()*120;}
      else if(t.z>Z_FAR){place(t,false);t.z=Z_NEAR+Math.random()*160;}
      order.push(t);
    }
    order.sort(function(a,b){return b.z-a.z;});

    for(var k=0;k<order.length;k++){
      var o=order[k];if(!o.img)o.img=nextArt();
      if(!o.img)continue;
      var kk=F/o.z;
      var size=o.s*U*kk*2.2;
      if(size<6)continue;
      var sx=cx+o.ax*U*kk*1.9;
      var sy=cy+o.ay*U*kk*1.9;
      if(sx+size<0||sx-size>W||sy+size<0||sy-size>H)continue;
      /* fade in from the far wall, and out again as it sweeps past the camera */
      var far=clamp((Z_FAR-o.z)/(Z_FAR*0.5),0,1);
      var near=clamp((o.z-Z_NEAR)/460,0,1);
      /* depth fog is folded into the alpha, so far tiles sink into the pit's glow */
      var a=far*near*(1-(1-far)*0.55);
      if(a<=0.01)continue;
      var ar=o.img._ar||1,w=ar>=1?size:size*ar,h=ar>=1?size/ar:size;
      g.globalAlpha=a;
      if(o.rot){
        g.save();g.translate(sx,sy);g.rotate(o.rot);
        g.drawImage(o.img,-w/2,-h/2,w,h);
        g.restore();
      }else{
        g.drawImage(o.img,sx-w/2,sy-h/2,w,h);
      }
    }

    if(sparks.length){
      g.globalCompositeOperation="lighter";
      for(var j=0;j<sparks.length;j++){
        var s=sparks[j];
        s.z-=step;s.ay-=s.vy;
        if(s.z<Z_NEAR){seed(s,true);}
        else if(s.z>Z_FAR){seed(s,false);s.z=Z_NEAR+Math.random()*200;}
        if(s.ay<-2.1)s.ay=2.1;
        var sk=F/s.z;
        var px=cx+s.ax*U*sk*1.9+Math.sin(now*0.0011+s.ph)*3*sk;
        var py=cy+s.ay*U*sk*1.9;
        if(px<0||px>W||py<0||py>H)continue;
        var sf=clamp((Z_FAR-s.z)/(Z_FAR*0.4),0,1),sn=clamp((s.z-Z_NEAR)/300,0,1);
        var sa=sf*sn*(0.5+0.5*Math.sin(now*0.004+s.ph*3));
        if(sa<=0.02)continue;
        var ss=clamp(sk*2.1,1.5,6);
        g.globalAlpha=sa;
        g.fillStyle=s.hot?HOT:FLAME;
        g.fillRect(px,py,ss,ss);
      }
      g.globalCompositeOperation="source-over";
    }
    g.globalAlpha=1;
  }
  /* with reduced motion the tunnel is a still field, redrawn only when it has to be */
  var queued=false;
  function still(){
    if(!RM||queued)return;
    queued=true;requestAnimationFrame(function(t){queued=false;frame(t);});
  }
  if(RM)frame(0);else requestAnimationFrame(frame);

  /* the page is the transport */
  var last=window.scrollY||0;
  window.addEventListener("scroll",function(){
    var y=window.scrollY||0;
    camDelta+=(y-last)*0.55;
    camDelta=clamp(camDelta,-70,70);
    last=y;
  },{passive:true});
})();

/* =========================================================
   4. LOADER: holds until the type has arrived
   ========================================================= */
(function(){
  var el=$("#load"),bar=$("#loadBar"),num=$("#loadNum"),lab=$("#loadLab"),
      word=$("#loadWord"),top=$("#bar"),done=false;
  document.body.classList.add("lock");
  function finish(){
    if(done)return;done=true;
    document.body.classList.remove("lock");
    el.classList.add("done");
    top.classList.add("up");
    $$(".rv").forEach(function(r){r.classList.add("in");});
    document.dispatchEvent(new CustomEvent("py:ready"));
  }
  if(RM){finish();return;}
  setTimeout(function(){word.classList.add("in");},60);

  var typeIn=true;
  if(document.fonts&&document.fonts.load){
    typeIn=false;
    var arrived=function(){typeIn=true;};
    Promise.all([
      document.fonts.load('1em "Anek Bangla"',"Pataal Yatri"),
      document.fonts.load('1em "Anek Bangla"',"পাতাল যাত্রী"),
      document.fonts.load('1em "Anek Devanagari"',"पाताल यात्री")
    ]).then(arrived,arrived);
    setTimeout(arrived,2800);
  }
  var labels=["Loading","Lighting the fire","Going down"];
  var t0=performance.now();
  (function step(now){
    var p=clamp((now-t0)/1150,0,1),e=1-Math.pow(1-p,3);
    if(!typeIn)e=Math.min(e,0.9);
    var v=Math.round(e*100);
    num.textContent=("00"+v).slice(-3);
    bar.style.width=(e*100)+"%";
    lab.textContent=labels[v>96?2:(v>45?1:0)];
    if(p<1||!typeIn)requestAnimationFrame(step);else setTimeout(finish,170);
  })(t0);
})();

/* =========================================================
   5. RELEASES: rows are in the HTML; this draws the sleeves
   for the ones without a cover (and under the ones with one,
   in case it fails to load)
   ========================================================= */
(function(){
  $$("canvas[data-sleeve]").forEach(function(cv){drawSleeve(cv,cv.dataset.sleeve);});
  $$(".rel-th img").forEach(function(im){
    function drop(){im.remove();}
    if(im.complete&&!im.naturalWidth)drop();else im.addEventListener("error",drop);
  });
  var y=$("#year");if(y)y.textContent=String(new Date().getFullYear());
})();

/* =========================================================
   8. ON REPEAT + THE CRATE
   ========================================================= */
(function(){
  var ROTATION=PY.onRepeat||[];
  var list=$("#rotlist"),crate=$("#crate");if(!list||!crate||!ROTATION.length)return;
  var capA=$("#crateA"),capB=$("#crateB"),redraw=$("#redraw");
  var SET=[],cards=[];

  function pick(){
    return shuffle(ROTATION.slice()).slice(0,6).map(function(t){
      return {a:t.artist,t:t.title,len:t.length,link:t.spotify,cover:t.cover};
    });
  }
  function layout(){
    var n=SET.length;
    cards.forEach(function(card,i){
      var t=(n===1?0:i/(n-1))-0.5;          /* -0.5 … 0.5 */
      card.dataset.x=(t*46).toFixed(2);
      card.dataset.r=(t*15).toFixed(2);
      card.style.zIndex=String(10+i);
      rest(card);
    });
  }
  function rest(card){
    card.style.transform="translateX(calc(-50% + "+card.dataset.x+"%)) rotate("+card.dataset.r+"deg)";
  }
  function stand(card){
    card.style.transform="translateX(calc(-50% + "+(card.dataset.x*0.30)+"%)) translateY(-13%) rotate(0deg) scale(1.05)";
  }

  function build(){
    list.innerHTML=SET.map(function(t,i){
      return '<article class="trk fade" data-i="'+i+'" tabindex="0" aria-label="'+esc(t.t)+' by '+esc(t.a)+'">'+
        '<span><h3 class="trk-t">'+esc(t.t)+'</h3><span class="trk-a">'+esc(t.a)+'</span></span>'+
        '<span class="trk-len">'+esc(t.len)+'</span>'+
        (t.link?'<a class="trk-go" href="'+esc(t.link)+'" target="_blank" rel="noopener" aria-label="Open '+esc(t.t)+' on Spotify">&#8599;</a>':'<span></span>')+
      '</article>';
    }).join("");
    /* rows built after the section has already been revealed should not stay hidden */
    if(list.closest(".sect").classList.contains("in"))$$(".trk",list).forEach(function(r){r.classList.add("in");});

    $$(".rec",crate).forEach(function(n){n.remove();});
    cards=SET.map(function(t,i){
      var d=document.createElement("div");
      d.className="rec";d.dataset.i=i;
      d.innerHTML='<div class="rec-in"><canvas width="420" height="420"></canvas><img alt=""><span class="rec-edge"></span></div>';
      crate.appendChild(d);
      drawSleeve($("canvas",d),t.a+t.t);
      /* the cover address was looked up at build time */
      if(t.cover){
        var img=$("img",d);
        img.onload=function(){img.classList.add("shown");};
        img.src=t.cover;
      }
      return d;
    });
    layout();
    wire();
    cue(SET.length-1);
  }

  function cue(i){
    $$(".trk",list).forEach(function(r){r.classList.toggle("on",+r.dataset.i===i);});
    cards.forEach(function(c,k){
      c.classList.toggle("cued",k===i);
      c.classList.toggle("dim",k!==i);
      c.style.zIndex=String(k===i?40:10+k);
      if(k===i)stand(c);else rest(c);
    });
    var t=SET[i];if(!t)return;
    capA.textContent=t.a;
    capB.textContent=t.t;
  }

  function wire(){
    $$(".trk",list).forEach(function(row){
      var i=+row.dataset.i;
      row.addEventListener("pointerenter",function(){cue(i);});
      row.addEventListener("focus",function(){cue(i);});
      row.addEventListener("keydown",function(e){
        if(e.target!==row)return;
        if(e.key==="Enter"){e.preventDefault();$(".trk-go",row).click();}
      });
    });
    cards.forEach(function(c){
      c.addEventListener("pointerenter",function(){cue(+c.dataset.i);});
    });
  }

  SET=pick();build();
  if(redraw)redraw.addEventListener("click",function(){SET=pick();build();});
  window.addEventListener("resize",layout);
})();

/* =========================================================
   9. REVEALS + SCROLL + HEADER
   ========================================================= */
(function(){
  function showAll(root){
    $$(".fade",root||document).forEach(function(e){e.classList.add("in");});
    $$(".rv",root||document).forEach(function(e){e.classList.add("in");});
  }
  function setup(){
    if(!("IntersectionObserver" in window)||RM){showAll();$$(".sect,.band,.foot").forEach(function(s){s.classList.add("in");});return;}
    var io=new IntersectionObserver(function(en){
      en.forEach(function(x){
        if(!x.isIntersecting)return;
        showAll(x.target);x.target.classList.add("in");io.unobserve(x.target);
      });
    },{rootMargin:"0px 0px -8% 0px",threshold:0.05});
    $$(".sect,.band,.foot").forEach(function(s){io.observe(s);});
  }
  if(document.body.classList.contains("lock"))document.addEventListener("py:ready",setup,{once:true});
  else setup();

  var bar=$("#bar"),fill=$("#railFill"),links=$$(".bar-nav a"),
      secs=links.map(function(a){return $(a.getAttribute("href"));}),
      opA=$("#band"),opB=$("#s04"),
      last=0,lastDir=0,tick=false;
  function run(){
    var y=window.scrollY||0;
    var max=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    if(fill)fill.style.height=(clamp(y/max,0,1)*100)+"%";
    /* header retracts on the way down, returns on the way up */
    if(y>140){
      if(y>last+4&&lastDir!==1){bar.classList.add("hide");lastDir=1;}
      else if(y<last-4&&lastDir!==-1){bar.classList.remove("hide");lastDir=-1;}
    }else{bar.classList.remove("hide");lastDir=0;}
    last=y;SCROLL.y=y;
    /* is the whole viewport inside the opaque band? then the tunnel can rest */
    if(opA&&opB)SCROLL.covered=opA.getBoundingClientRect().top<=0&&opB.getBoundingClientRect().bottom>=innerHeight;
    var best=-1;
    secs.forEach(function(s,i){if(s&&s.getBoundingClientRect().top<=innerHeight*0.36)best=i;});
    links.forEach(function(a,i){a.classList.toggle("active",i===best);});
    tick=false;
  }
  function ask(){if(tick)return;tick=true;requestAnimationFrame(run);}
  window.addEventListener("scroll",ask,{passive:true});
  window.addEventListener("resize",ask);
  run();
})();

/* =========================================================
   10. SCROLL-DRIVEN MOTION
   Everything here is tied to scroll position, not to a timer,
   so the page only moves while the reader does.
   ========================================================= */
(function(){
  if(RM)return;
  var name=$("#name"),heroBn=$(".hero-bn"),heroHi=$(".hero-hi"),slogan=$("#slogan"),heroFoot=$(".hero-foot"),
      crate=$("#crate"),bandQ=$(".band-q"),bandM=$(".band-m"),
      heads=$$(".head"),hero=$("#s00");
  var vh=innerHeight,heroH=hero?hero.offsetHeight:vh,geo=[],split=22;
  function measure(){
    vh=innerHeight;
    split=Math.min(22,innerWidth*0.03);   /* never further than the page margin */
    heroH=hero?hero.offsetHeight:vh;
    geo=[];
    function add(el,kind){
      if(!el)return;
      var keep=el.style.transform;el.style.transform="none";
      var r=el.getBoundingClientRect(),y=r.top+window.scrollY;
      el.style.transform=keep;
      geo.push({el:el,kind:kind,top:y,h:r.height});
    }
    heads.forEach(function(h){add(h,"head");});
    add(crate,"crate");
    add(bandQ,"band");
  }
  window.addEventListener("resize",measure);
  window.addEventListener("load",measure);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(measure);
  setTimeout(measure,300);setTimeout(measure,1600);

  /* entrance stagger, computed rather than hand-written */
  function stagger(sel,stepMs){
    $$(sel).forEach(function(el,i){el.style.transitionDelay=(i*stepMs)+"ms";});
  }
  stagger(".rel",55);stagger(".cb",60);stagger(".trk",45);

  function tick(){
    var y=window.scrollY||0;
    /* the hero pulls back as the tunnel takes over */
    if(y<heroH*1.1){
      var hp=clamp(y/(heroH*0.85),0,1);
      if(name){
        name.style.transform="translateY("+(-hp*72).toFixed(1)+"px) scale("+(1-hp*0.14).toFixed(3)+")";
        name.style.opacity=String(clamp(1-hp*1.25,0,1));
      }
      if(heroBn){
        heroBn.style.transform="translateY("+(-hp*90).toFixed(1)+"px)";
        heroBn.style.opacity=String(clamp(1-hp*1.6,0,1));
      }
      if(heroHi){
        heroHi.style.transform="translateY("+(-hp*58).toFixed(1)+"px)";
        heroHi.style.opacity=String(clamp(1-hp*1.55,0,1));
      }
      if(slogan){
        slogan.style.transform="translateY("+(-hp*44).toFixed(1)+"px)";
        slogan.style.opacity=String(clamp(1-hp*1.5,0,1));
      }
      if(heroFoot){
        heroFoot.style.transform="translateY("+(-hp*26).toFixed(1)+"px)";
        heroFoot.style.opacity=String(clamp(1-hp*1.15,0,1));
      }
    }
    /* parallax from cached geometry: no layout reads in the loop */
    for(var i=0;i<geo.length;i++){
      var gi=geo[i],top=gi.top-y;
      if(top+gi.h<-180||top>vh+180)continue;
      if(gi.kind==="head"){
        gi.el.style.transform="translateY("+(clamp((vh*0.5-top)/vh,-1,1)*-16).toFixed(1)+"px)";
      }else if(gi.kind==="crate"){
        gi.el.style.transform="translateY("+(clamp((vh*0.55-top-gi.h*0.5)/vh,-1.2,1.2)*38).toFixed(1)+"px)";
      }else{
        var bp=clamp((vh*0.6-top)/vh,-1,1)*split;
        gi.el.style.transform="translateX("+(-bp).toFixed(1)+"px)";
        if(bandM)bandM.style.transform="translateX("+bp.toFixed(1)+"px)";
      }
    }
    requestAnimationFrame(tick);
  }
  /* starts once the loader lifts, so the hero's entrance is seen rather than spent behind it */
  document.addEventListener("py:ready",function(){
    measure();
    /* once the entrance has played, the hero follows the scroll directly */
    setTimeout(function(){[heroBn,heroHi,slogan].forEach(function(e){if(e)e.style.transition="none";});},1400);
    requestAnimationFrame(tick);
  },{once:true});
})();

/* counts tick up the first time they are seen */
(function(){
  var nodes=$$("[data-count]");if(!nodes.length)return;
  function show(el,v){
    var pad=parseInt(el.dataset.pad||"0",10);
    el.textContent=pad?("0000"+v).slice(-pad):String(v);
  }
  function run(el){
    var target=parseFloat(el.dataset.count)||0;
    if(RM||!target){show(el,target);return;}
    var t0=performance.now(),dur=900;
    (function step(now){
      var p=clamp((now-t0)/dur,0,1),e=1-Math.pow(1-p,3);
      show(el,Math.round(target*e));
      if(p<1)requestAnimationFrame(step);
    })(t0);
  }
  if(!("IntersectionObserver" in window)){nodes.forEach(run);return;}
  var io=new IntersectionObserver(function(en){
    en.forEach(function(x){if(x.isIntersecting){run(x.target);io.unobserve(x.target);}});
  },{threshold:.4});
  nodes.forEach(function(n){io.observe(n);});
})();

/* =========================================================
   11. PORTRAIT: a real photo if content.json names one,
   otherwise a figure in halftone standing before the fire
   ========================================================= */
(function(){
  var cv=$("#portrait"),photo=$("#portraitImg");if(!cv)return;
  var d=null,f=0,alive=false,raf=0,stopped=false;
  if(PY.portrait&&photo){
    photo.onload=function(){photo.hidden=false;cv.hidden=true;stopped=true;};
    photo.src=PY.portrait;
  }
  function mass(x,y){
    var head=Math.exp(-(Math.pow((x-.5)/.155,2)+Math.pow((y-.265)/.165,2)));
    var neck=Math.exp(-(Math.pow((x-.5)/.075,2)+Math.pow((y-.44)/.075,2)));
    var shou=Math.exp(-(Math.pow((x-.5)/.36,2)+Math.pow((y-.78)/.20,2)));
    var body=Math.exp(-(Math.pow((x-.5)/.30,2)+Math.pow((y-1.02)/.26,2)));
    return head*1.30+neck*.95+shou*1.05+body*1.0;
  }
  function paint(){
    if(stopped){raf=0;return;}
    d=d||sizeTo(cv,cv.parentElement);
    if(!d||!d.w){raf=requestAnimationFrame(paint);return;}
    var g=d.g,W=d.w,H=d.h,C=Math.max(6,W/56);
    g.fillStyle=BLOOD2;g.fillRect(0,0,W,H);
    /* one band of fire, sitting behind the figure */
    g.fillStyle=FLAME;g.fillRect(0,H*0.60,W,H*0.075);
    var cols=Math.ceil(W/C),rows=Math.ceil(H/C);
    g.fillStyle=NIGHT;
    for(var cy=0;cy<rows;cy++)for(var cx=0;cx<cols;cx++){
      var fx=(cx+.5)/cols,fy=(cy+.5)/rows;
      var m=clamp(mass(fx,fy),0,1.3);
      var wob=Math.sin(cx*0.7+cy*0.4+f*0.012)*0.045;
      m=m+wob-0.24;
      if(m<=.02)continue;
      var rr=(m/1.02)*C*0.66;
      if(rr<=.28)continue;
      g.beginPath();g.arc(cx*C+C/2,cy*C+C/2,Math.min(rr,C*0.62),0,6.284);g.fill();
    }
    f++;
    if(alive&&!RM)raf=requestAnimationFrame(gate);else raf=0;
  }
  var skip=0;
  function gate(){
    if(++skip%3){if(alive&&!RM){raf=requestAnimationFrame(gate);return;}raf=0;return;}
    paint();
  }
  if("IntersectionObserver" in window){
    new IntersectionObserver(function(en){alive=en[0].isIntersecting;if(alive&&!raf)raf=requestAnimationFrame(gate);},{threshold:.05}).observe(cv);
  }else{alive=true;paint();}
  window.addEventListener("resize",function(){d=null;if(!raf)setTimeout(paint,60);});
  setTimeout(paint,80);
})();

/* =========================================================
   12. NAME FIT + CONTACT + MENU + ANCHORS
   ========================================================= */
(function(){
  var el=$("#name");if(!el)return;
  function fit(){
    el.style.fontSize="";
    var avail=el.parentElement.clientWidth,w=0;
    $$(".rvi",el).forEach(function(s){w=Math.max(w,s.scrollWidth);});
    if(w>avail&&avail>0){
      var cur=parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize=(cur*(avail/w)*0.99).toFixed(2)+"px";
    }
  }
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
  setTimeout(fit,60);window.addEventListener("resize",fit);
})();

(function(){
  var email=PY.email||"";
  var f=$("#form"),note=$("#note");if(!f)return;
  f.addEventListener("submit",function(e){
    e.preventDefault();
    var n=f.elements.name.value.trim(),m=f.elements.email.value.trim(),
        about=f.elements.type.value,msg=f.elements.msg.value.trim();
    note.classList.remove("ok","bad");
    if(!n||!/.+@.+\..+/.test(m)){
      note.classList.add("bad");
      note.textContent="Add your name and a working email address so there is somewhere to reply.";
      return;
    }
    if(!email){
      note.classList.add("bad");
      note.textContent="No contact address is set for this site yet.";
      return;
    }
    location.href="mailto:"+email+
      "?subject="+encodeURIComponent(about+", from "+n)+
      "&body="+encodeURIComponent((msg?msg+"\n\n":"")+n+"\n"+m);
    note.classList.add("ok");
    note.textContent="Email draft opened. Send it from your mail app.";
  });
})();

(function(){
  var btn=$("#menuBtn"),menu=$("#menu");if(!btn)return;
  var label=btn.querySelector("span");
  function close(){document.body.classList.remove("menu-open");btn.setAttribute("aria-expanded","false");label.textContent="Menu";}
  btn.addEventListener("click",function(){
    var open=document.body.classList.toggle("menu-open");
    btn.setAttribute("aria-expanded",open?"true":"false");
    label.textContent=open?"Close":"Menu";
  });
  $$("a",menu).forEach(function(a){a.addEventListener("click",close);});
  document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});
})();

$$('a[href^="#"]').forEach(function(a){
  a.addEventListener("click",function(e){
    var el=$(a.getAttribute("href"));if(!el)return;
    e.preventDefault();
    el.scrollIntoView({behavior:RM?"auto":"smooth",block:"start"});
  });
});
})();
