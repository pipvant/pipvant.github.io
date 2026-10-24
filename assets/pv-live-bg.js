/* PIPVANT Live backgrounds (2026-10-24) — canvas engines for the three
   cross-device scenes: mist-platinum, petal-platinum, ribbon-gold.
   Unlike the 23 painted scenes (desktop-only by the 2026-10-22 founder
   decision), these render procedurally, so the same scene plays on phone
   and computer. The app owns placement: pvBgOverlayHTML() puts one
   <canvas class="bgs-live"> into the backdrop buffer's .bgs-fxwrap (and
   the fullscreen preview), and pvBgShow / pvBgFsRender call
   pvLiveBg.attach(key, canvas). The manager owns exactly one running
   engine: attach() always detaches the previous one first, and detach()
   is called whenever a buffer is cleared or the preview closes, so no
   engine ever draws invisibly. Motion freezes while the tab is hidden,
   while body carries .bgs-paused (pause setting) or .bgs-calm (Calm in
   Journal), and prefers-reduced-motion renders a single static frame. */
(function(){
  'use strict';
  var LIVE = {'mist-platinum': 1, 'petal-platinum': 1, 'ribbon-gold': 1};
  var cur = null;

  function reducedMotion(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch(e){ return false; }
  }
  function frozen(){
    try{
      if(document.hidden) return true;
      var b = document.body;
      if(b && (b.classList.contains('bgs-paused') || b.classList.contains('bgs-calm'))) return true;
    }catch(e){}
    return false;
  }

  /* ---------- mist-platinum: drifting silver mist bands + gold glint --- */
  function mistInit(s){
    s.bands = [
      {y: 0.16, h: 0.13, a: 0.16, sp: 0.011, ph: 0.0, depth: 8},
      {y: 0.36, h: 0.16, a: 0.20, sp: 0.008, ph: 2.1, depth: 16},
      {y: 0.58, h: 0.18, a: 0.22, sp: 0.006, ph: 4.2, depth: 26},
      {y: 0.80, h: 0.20, a: 0.18, sp: 0.009, ph: 1.2, depth: 38}
    ];
  }
  function mistDraw(s, ctx, w, h, t){
    var i, b, cx, cy, r, k, g;
    for(i = 0; i < s.bands.length; i++){
      b = s.bands[i];
      cx = w * (0.5 + 0.28 * Math.sin(t * b.sp * 6.28 + b.ph) + s.px * b.depth / w);
      cy = h * b.y;
      r = Math.max(w * 0.42, 120);
      /* gradient is created AFTER the transform, in band space (0,0,r),
         so it stays centred on the ellipse it fills */
      k = (h * b.h) / r * 1.6;
      ctx.save();
      ctx.scale(1.6, k);
      ctx.translate(cx / 1.6, cy / k);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,' + b.a.toFixed(3) + ')');
      g.addColorStop(0.6, 'rgba(226,230,230,' + (b.a * 0.6).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(226,230,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    /* faint gold glint that follows the pointer, slowly */
    var gx = w * (0.5 + s.px * 0.06), gy = h * 0.42;
    var gr = Math.max(w * 0.22, 90);
    var gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    gg.addColorStop(0, 'rgba(212,175,55,' + (0.055 + 0.02 * Math.sin(t * 0.5)).toFixed(3) + ')');
    gg.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 6.2832); ctx.fill();
  }

  /* ---------- petal-platinum: falling pale-pink + silver petals --------- */
  function petalInit(s){
    var area = s.w * s.h, n = Math.round(area / 45000);
    if(n < 12) n = 12; if(n > 30) n = 30;
    s.petals = [];
    var cols = ['232,162,180', '210,214,216', '255,255,255', '232,162,180'];
    for(var i = 0; i < n; i++){
      s.petals.push({
        x: Math.random(), y: Math.random(),
        fall: 0.018 + Math.random() * 0.030,
        sway: 0.5 + Math.random() * 0.9, ph: Math.random() * 6.28,
        rot: Math.random() * 6.28, rs: (Math.random() - 0.5) * 2.0,
        size: 3 + Math.random() * 4.5,
        col: cols[i % cols.length], a: 0.28 + Math.random() * 0.32
      });
    }
  }
  function petalDraw(s, ctx, w, h, t, dt){
    var sc = w >= 768 ? 1 : 0.7, i, p;
    for(i = 0; i < s.petals.length; i++){
      p = s.petals[i];
      p.y += p.fall * dt;
      p.x += (Math.sin(t * p.sway + p.ph) * 0.010 + s.px * 0.006) * dt;
      p.rot += p.rs * dt;
      if(p.y > 1.05){ p.y = -0.05; p.x = Math.random(); }
      if(p.x > 1.05) p.x -= 1.10; if(p.x < -0.05) p.x += 1.10;
      var sz = p.size * sc;
      ctx.save();
      ctx.translate(p.x * w, p.y * h);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, sz, sz * 0.55, 0, 0, 6.2832);
      ctx.fillStyle = 'rgba(' + p.col + ',' + p.a.toFixed(3) + ')';
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- ribbon-gold: flowing gold ribbons, pointer trail ---------- */
  function ribbonInit(s){
    s.ribbons = [
      {base: 0.26, amp: 46, wl: 0.9, sp: 0.22, ph: 0.0, th: 15, col: '212,175,55', a: 0.50, edge: '232,201,106'},
      {base: 0.52, amp: 60, wl: 1.3, sp: 0.16, ph: 2.0, th: 10, col: '232,201,106', a: 0.38, edge: '244,222,150'},
      {base: 0.76, amp: 40, wl: 0.7, sp: 0.28, ph: 4.0, th: 7, col: '154,163,171', a: 0.30, edge: '200,208,214'}
    ];
    s.lastMove = 0;
  }
  function ribbonDraw(s, ctx, w, h, t){
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    var idle = Math.min(1, (now - s.lastMove) / 2600);
    var infl = 1 - idle;
    var pxPos = (s.px + 1) / 2 * w, pyPos = (s.py + 1) / 2 * h;
    var step = 14, r, x, y, i, top = [], bot = [];
    for(r = 0; r < s.ribbons.length; r++){
      var rb = s.ribbons[r], th = rb.th * (w >= 768 ? 1 : 0.7);
      top.length = 0; bot.length = 0;
      for(x = -20; x <= w + 20; x += step){
        var wave = Math.sin((x / w) * (6.2832 / rb.wl) + t * rb.sp * 6.28 + rb.ph) * rb.amp;
        var bend = 0;
        if(infl > 0.01){
          var dx = (x - pxPos) / (w * 0.26);
          bend = (pyPos - h * rb.base) * Math.exp(-dx * dx) * 0.55 * infl;
        }
        y = h * rb.base + wave + bend;
        top.push([x, y - th / 2]); bot.push([x, y + th / 2]);
      }
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      for(i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
      for(i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + rb.col + ',' + rb.a.toFixed(3) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1] + th / 2);
      for(i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1] + th / 2);
      ctx.strokeStyle = 'rgba(' + rb.edge + ',0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  var DRAW = {'mist-platinum': [mistInit, mistDraw], 'petal-platinum': [petalInit, petalDraw], 'ribbon-gold': [ribbonInit, ribbonDraw]};

  function resize(s){
    var cv = s.canvas;
    var w = cv.clientWidth || window.innerWidth || 0;
    var h = cv.clientHeight || window.innerHeight || 0;
    if(!w || !h) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if(cv.width !== bw || cv.height !== bh){ cv.width = bw; cv.height = bh; }
    s.w = w; s.h = h; s.dpr = dpr;
    return true;
  }

  function frame(ts){
    if(!cur) return;
    var s = cur;
    if(!s.canvas.isConnected){ detach(); return; }
    if(frozen()){
      s.raf = requestAnimationFrame(frame);
      return;
    }
    if(!resize(s)){ s.raf = requestAnimationFrame(frame); return; }
    var t = (ts - s.t0) / 1000;
    var dt = Math.min(0.05, (ts - s.last) / 1000 || 0.016);
    s.last = ts;
    s.px += (s.tx - s.px) * 0.06;
    s.py += (s.ty - s.py) * 0.06;
    var ctx = s.ctx;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    s.draw(s, ctx, s.w, s.h, t, dt);
    s.raf = requestAnimationFrame(frame);
  }

  function onMove(ev){
    if(!cur) return;
    var x, y;
    if(ev.touches && ev.touches.length){ x = ev.touches[0].clientX; y = ev.touches[0].clientY; }
    else{ x = ev.clientX; y = ev.clientY; }
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    cur.tx = (x / w) * 2 - 1;
    cur.ty = (y / h) * 2 - 1;
    cur.lastMove = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  }
  function onResize(){ if(cur) resize(cur); }
  function onVis(){
    if(!cur) return;
    if(document.hidden){ if(cur.raf){ cancelAnimationFrame(cur.raf); cur.raf = 0; } }
    else if(!cur.raf){ cur.last = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0; cur.raf = requestAnimationFrame(frame); }
  }

  function attach(key, canvas){
    detach();
    if(!key || !LIVE[key] || !canvas) return;
    var ctx = null;
    try{ ctx = canvas.getContext('2d'); }catch(e){ return; }
    if(!ctx) return;
    var s = {
      key: key, canvas: canvas, ctx: ctx, raf: 0,
      w: 0, h: 0, dpr: 1, t0: 0, last: 0,
      px: 0, py: 0, tx: 0, ty: 0, lastMove: 0
    };
    var pair = DRAW[key];
    if(!resize(s)) return;
    cur = s;
    pair[0](s);
    if(reducedMotion()){
      /* one static frame, no loop */
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, s.w, s.h);
      pair[1](s, ctx, s.w, s.h, 1.5, 0.016);
      return;
    }
    s.draw = pair[1];
    s.t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    s.last = s.t0;
    window.addEventListener('pointermove', onMove, {passive: true});
    window.addEventListener('touchmove', onMove, {passive: true});
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    s.raf = requestAnimationFrame(frame);
  }

  function detach(){
    if(!cur) return;
    var s = cur; cur = null;
    if(s.raf) cancelAnimationFrame(s.raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
    try{ s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height); }catch(e){}
  }

  window.pvLiveBg = {
    attach: attach,
    detach: detach,
    isLive: function(k){ return !!LIVE[k]; }
  };
})();
