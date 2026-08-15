#pragma once
#include <string>

// ==================== 登录页 ====================
const std::string LOGIN_HTML = R"raw(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OI杀 - 登录</title>
<style>
:root{
  --bg0:#0b1023;--bg1:#161b36;--bg2:#1e2449;--ink:#e8ecfb;--mut:#9aa7d8;
  --acc:#4ec9b0;--acc2:#5eead4;--line:#2c3463;--red:#ff5c7a;--grn:#34d399;
  --glow1:rgba(94,120,255,.25);--glow2:rgba(78,201,176,.16);--bgDeep1:#0d1228;--bgDeep2:#101735;
}
/* ===== 暖色主题: 夕阳机房 (#0815-8 #0816-1) ===== */
body.warm{
  --bg0:#241a10;--bg1:#3a2b18;--bg2:#4a3820;--ink:#f0e6d4;--mut:#c9b896;
  --acc:#e0a458;--acc2:#f5c98a;--line:#5a4630;--red:#ff9a6b;--grn:#7fc97f;
  --glow1:rgba(224,164,88,.22);--glow2:rgba(255,150,80,.12);--bgDeep1:#2a1f12;--bgDeep2:#201708;
}
body.warm .card{background:linear-gradient(165deg,rgba(74,56,32,.92),rgba(40,30,16,.95));border-color:rgba(224,164,88,.35);}
*{box-sizing:border-box;}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, var(--glow1), transparent 60%),
    radial-gradient(900px 520px at 110% 110%, var(--glow2), transparent 55%),
    linear-gradient(160deg,var(--bg0),var(--bgDeep1) 45%,var(--bgDeep2));
  color:var(--ink);font-family:'Segoe UI',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  display:flex;align-items:center;justify-content:center;height:100vh;margin:0;overflow:hidden;
}
body::before{content:'';position:fixed;inset:0;background-image:
  radial-gradient(rgba(255,255,255,.055) 1px,transparent 1px);background-size:26px 26px;pointer-events:none;}
.card{
  position:relative;width:360px;padding:38px 34px;text-align:center;border-radius:22px;
  background:linear-gradient(165deg,rgba(30,36,73,.92),rgba(18,22,49,.94));
  border:1px solid rgba(120,140,255,.22);backdrop-filter:blur(14px);
  box-shadow:0 24px 60px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.04) inset;
}
.card::before{content:'';position:absolute;inset:-1px;border-radius:22px;padding:1px;
  background:linear-gradient(135deg,rgba(78,201,176,.55),transparent 40%,transparent 60%,rgba(86,156,214,.5));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
.logo{width:72px;height:72px;margin:0 auto 12px;border-radius:18px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#4ec9b0,#569cd6);box-shadow:0 10px 26px rgba(78,201,176,.35);font-weight:800;font-size:34px;color:#241800;}
h1{margin:6px 0 2px;font-size:30px;letter-spacing:6px;font-weight:800;color:#fff;
  text-shadow:0 2px 12px rgba(78,201,176,.35);}
.tag{color:#aebdf2;font-size:.82rem;letter-spacing:2px;margin:0 0 22px;text-transform:uppercase;}
.field{position:relative;margin:10px 0;}
.field input{display:block;width:100%;background:rgba(10,13,30,.7);border:1px solid var(--line);color:var(--ink);
  padding:13px 14px;border-radius:12px;font-size:.95rem;outline:none;transition:border-color .2s,box-shadow .2s;}
.field input:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(78,201,176,.16);}
.btn{width:100%;border:none;border-radius:12px;padding:13px;font-size:.98rem;font-weight:700;cursor:pointer;
  transition:transform .12s,box-shadow .2s,filter .2s;margin-top:10px;background:#f8fafc;color:#151a38;
  box-shadow:0 8px 22px rgba(78,201,176,.28);}
.btn:hover{transform:translateY(-2px);filter:brightness(1.05);}
.btn.secondary{margin-top:8px;background:transparent;color:#c7d2fe;border:1px solid var(--line);box-shadow:none;}
.btn.secondary:hover{border-color:var(--acc2);color:#fff;}
.switch{margin-top:16px;color:#8b99d8;font-size:.82rem;}
.switch a{color:#4ec9b0;cursor:pointer;text-decoration:none;font-weight:600;}
.switch a:hover{text-decoration:underline;}
.msg{color:var(--red);min-height:20px;font-size:.85rem;margin-top:8px;font-weight:600;}
</style></head><body>
<div class="card">
<div class="logo">杀</div>
<h1>OI杀</h1>
<div class="tag">OI KILL · 算法对决</div>
<div class="field"><input id="u" placeholder="用户名" maxlength="20" autocomplete="username"></div>
<div class="field"><input id="p" type="password" placeholder="密码" maxlength="32" autocomplete="current-password"></div>
<div id="msg" class="msg"></div>
<button class="btn" onclick="doLogin()">登 录</button>
<button class="btn secondary" onclick="doRegister()">注 册</button>
<button class="btn secondary" id="btnTheme" onclick="toggleTheme()">🌙 冷色</button>
<div class="switch">没有账号? 填写上方信息后点击 <b>注册</b> 即可创建</div>
</div>
<script>
let api=(location.protocol==='https:'?'https://':'http://')+location.host;
function safe(s){return s==null?'':String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// ===== 双主题 (冷色/暖色) 持久化 (#0815-8) =====
function applyTheme(){ let warm=localStorage.getItem('oikill_theme')==='warm'; document.body.classList.toggle('warm',warm); let b=document.getElementById('btnTheme'); if(b) b.textContent = warm?'🌞 暖色':'🌙 冷色'; }
function toggleTheme(){ localStorage.setItem('oikill_theme', document.body.classList.contains('warm')?'cold':'warm'); applyTheme(); }
applyTheme();
function doLogin(){
  let un=document.getElementById('u').value.trim(), pa=document.getElementById('p').value;
  let m=document.getElementById('msg');
  if(!un||!pa){m.textContent='用户名和密码不能为空';return;}
  fetch(api+'/api/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'u='+encodeURIComponent(un)+'&p='+encodeURIComponent(pa)})
  .then(r=>r.json()).then(j=>{ if(j.ok){location.href='/';} else {m.textContent=safe(j.msg)||'登录失败: 用户名或密码错误';} })
  .catch(()=>{m.textContent='网络错误, 请重试';});
}
function doRegister(){
  let un=document.getElementById('u').value.trim(), pa=document.getElementById('p').value;
  let m=document.getElementById('msg');
  if(!un||!pa){m.textContent='用户名和密码不能为空';return;}
  fetch(api+'/api/register',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'u='+encodeURIComponent(un)+'&p='+encodeURIComponent(pa)})
  .then(r=>r.json()).then(j=>{ if(j.ok){m.textContent='注册成功, 请登录';} else {m.textContent=safe(j.msg)||'注册失败';} })
  .catch(()=>{m.textContent='网络错误, 请重试';});
}
</script></body></html>
)raw";

// ==================== 游戏页: 大厅 + 游戏 ====================
const std::string GAME_HTML = R"raw(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OI杀</title>
<style>
:root{
  --bg0:#0b1023;--bg1:#161b36;--bg2:#1e2449;--ink:#e8ecfb;--mut:#9aa7d8;
  --acc:#4ec9b0;--acc2:#5eead4;--line:#2c3463;--red:#ff5c7a;--grn:#34d399;
  --glow1:rgba(94,120,255,.18);--glow2:rgba(78,201,176,.12);--bgDeep1:#0d1228;--bgDeep2:#101735;
}
*{box-sizing:border-box;}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, var(--glow1), transparent 60%),
    radial-gradient(900px 520px at 110% 110%, var(--glow2), transparent 55%),
    linear-gradient(160deg,var(--bg0),var(--bgDeep1) 45%,var(--bgDeep2));
  color:var(--ink);font-family:'Segoe UI',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  margin:0;min-height:100vh;background-attachment:fixed;}
.top{background:rgba(13,17,40,.85);padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);backdrop-filter:blur(10px);position:sticky;top:0;z-index:50;}
.top h2{margin:0;font-size:22px;letter-spacing:4px;color:#fff;text-shadow:0 2px 10px rgba(78,201,176,.3);}
.user{font-size:.9em;color:var(--mut);display:flex;align-items:center;gap:10px;}
.user b{color:var(--acc);}
.lobby{max-width:1060px;margin:26px auto;padding:0 16px;}
.panel{background:linear-gradient(165deg,rgba(30,36,73,.9),rgba(18,22,49,.94));border-radius:18px;padding:22px;margin-bottom:20px;border:1px solid rgba(120,140,255,.18);box-shadow:0 14px 40px rgba(0,0,0,.35);}
.panel h3{margin:0 0 16px;color:#c9d4ff;font-size:15px;letter-spacing:1px;border-bottom:1px solid var(--line);padding-bottom:10px;font-weight:700;}
input,select,button{font-family:inherit;}
button{cursor:pointer;}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0;}
.inp{background:rgba(10,13,30,.7);border:1px solid var(--line);color:var(--ink);padding:10px 12px;border-radius:10px;outline:none;transition:border-color .2s;}
.inp:focus{border-color:var(--acc);}
.btn{background:#f8fafc;color:#151a38;border:none;padding:9px 16px;border-radius:10px;font-weight:700;transition:transform .12s,box-shadow .2s,filter .2s;}
.btn:hover{transform:translateY(-1px);filter:brightness(1.06);box-shadow:0 6px 16px rgba(78,201,176,.25);}
.btn.red{background:var(--red);color:#fff;}.btn.red:hover{box-shadow:0 6px 16px rgba(255,92,122,.3);}
.btn.green{background:var(--grn);color:#06281c;}.btn.green:hover{box-shadow:0 6px 16px rgba(52,211,153,.3);}
.btn.gold{background:linear-gradient(135deg,#4ec9b0,#569cd6);color:#241800;}.btn.gold:hover{box-shadow:0 6px 16px rgba(78,201,176,.35);}
table{width:100%;border-collapse:collapse;margin-top:8px;}
td,th{padding:11px;border-bottom:1px solid var(--line);font-size:.9em;text-align:left;}
th{color:#8b99d8;font-weight:600;font-size:.82em;letter-spacing:1px;text-transform:uppercase;}
tr:hover{background:rgba(120,140,255,.07);}
.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.76em;font-weight:700;}
.pub{background:rgba(52,211,153,.15);color:#5eead4;border:1px solid rgba(52,211,153,.35);}
.priv{background:rgba(78,201,176,.12);color:#4ec9b0;border:1px solid rgba(78,201,176,.35);}
.empty{color:#6b7fb5;text-align:center;padding:20px;}
/* ===== 玩法提示可读性 (#0816-3) ===== */
.hlp-sec{margin:10px 0;padding:10px 14px;background:rgba(10,13,30,.55);border-left:3px solid var(--acc);border-radius:8px;line-height:1.85;font-size:.88em;color:var(--mut);}
.hlp-t{color:var(--acc);font-weight:800;font-size:.95em;margin-bottom:4px;letter-spacing:1px;}
.hlp-sec b.k{color:var(--acc2);}
.hlp-sec .bad{color:var(--red);font-weight:700;}
.hlp-sec .good{color:var(--grn);font-weight:700;}
body.warm .hlp-sec{background:rgba(40,30,16,.6);}
/* ===== 卡片图鉴 (含彩蛋锁定 #0816-4) ===== */
.tp-group{font-weight:800;letter-spacing:2px;margin:16px 0 6px;padding-bottom:5px;border-bottom:2px solid var(--acc);font-size:.98em;color:#fff;}
.tp-card{display:flex;gap:10px;align-items:baseline;padding:7px 10px;border-bottom:1px dashed #222838;font-size:.87em;}
.tp-card .tp-name{color:var(--acc);font-weight:800;white-space:nowrap;min-width:96px;}
.tp-card .tp-desc{color:var(--mut);line-height:1.55;}
.tp-card.locked{opacity:.6;}
.tp-card.locked .tp-name{color:var(--mut);}
.tp-note{color:var(--mut);font-size:.82em;margin-top:6px;text-align:center;}
/* ===== 未满员等待界面 (#0816-7) ===== */
#waiting-panel{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:14px;padding:30px;text-align:center;}
#waiting-panel .w-ico{font-size:52px;}
#waiting-panel .w-txt{font-size:1.2em;font-weight:800;color:var(--acc);letter-spacing:2px;}
#waiting-panel .w-sub{color:var(--mut);font-size:.9em;}
#waiting-panel .w-list{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px;}
#waiting-panel .w-pill{background:rgba(30,38,74,.75);border:1px solid var(--line);border-radius:20px;padding:6px 14px;font-size:.85em;color:var(--ink);}
#waiting-panel .w-pill.host{border-color:var(--acc);color:var(--acc2);font-weight:700;}
/* ===== 游戏内大厅消息 (#0816-8) ===== */
.chatrow{display:flex;gap:10px;margin:8px;}
.chatcol{flex:1;min-width:0;display:flex;flex-direction:column;}
.chatcol h3{font-size:.95em;margin:0 0 4px;color:var(--mut);letter-spacing:1px;}
body.warm .chatlines{background:rgba(24,17,8,.9);}
#btnLobbyChat{margin-left:auto;}

/* 游戏区 */
#game{display:none;}
#board{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;padding:20px;}
.player-slot{background:linear-gradient(160deg,rgba(30,38,74,.95),rgba(16,20,44,.97));border:1px solid var(--line);border-radius:18px;padding:16px 12px;width:196px;text-align:center;cursor:pointer;position:relative;transition:transform .18s,box-shadow .18s,border-color .18s;}
.player-slot:hover{transform:translateY(-4px);box-shadow:0 14px 30px rgba(0,0,0,.45),0 0 0 1px rgba(120,140,255,.25);}
.player-slot.active{border-color:var(--grn);box-shadow:0 0 22px rgba(52,211,153,.25),0 10px 24px rgba(0,0,0,.4);}
.player-slot.me{border-color:var(--acc);box-shadow:0 0 18px rgba(78,201,176,.18);}
.player-slot.dead{opacity:.45;filter:grayscale(1);}
.pname{font-weight:800;font-size:1.08em;color:#fff;}
.me-tag{color:var(--acc2);font-size:.72em;border:1px solid var(--acc2);border-radius:6px;padding:1px 6px;margin-left:4px;}
.pclass{font-size:.82em;color:var(--mut);margin:3px 0;}
.hp{color:var(--red);font-weight:800;}
.eq{font-size:.76em;color:#c3b8ff;min-height:16px;margin-top:4px;}
.eitem{margin-right:4px;display:inline-block;}
.pinfo{font-size:.76em;color:var(--mut);margin-top:4px;}
.targetmark{position:absolute;top:8px;right:10px;font-size:1.15em;}
#my-hand{background:rgba(8,12,30,.9);padding:16px 12px;display:flex;gap:12px;overflow-x:auto;min-height:186px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);align-items:center;}
.card{background:linear-gradient(165deg,#232b56,#151a38);border:2px solid #4a5aa8;border-radius:12px;width:108px;min-width:108px;height:154px;padding:8px 6px;cursor:pointer;text-align:center;transition:transform .15s,box-shadow .15s;position:relative;color:var(--ink);box-shadow:0 4px 12px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;justify-content:space-between;}
.card.red{border-color:#d9534f;background:linear-gradient(165deg,#4a2430,#2c1520);}
.card.black{border-color:#4a5aa8;}
.card.evolved{border-color:var(--acc);box-shadow:0 0 14px rgba(78,201,176,.55);}
.card:hover{transform:translateY(-8px);box-shadow:0 16px 30px rgba(0,0,0,.55);}
.card.sel{border-color:var(--acc);outline:2px solid var(--acc);transform:translateY(-10px);box-shadow:0 0 18px rgba(78,201,176,.4);}
.card .csuit{font-size:1.05em;color:var(--acc2);font-weight:800;text-shadow:0 0 8px rgba(120,140,255,.4);}
.card .cname{font-size:.88em;font-weight:800;line-height:1.3;word-break:break-all;color:#fff;}
.card.red .cname{color:#ffd9d9;}
.card .ctype{font-size:1em;}
.card .cnum{font-size:.78em;color:var(--mut);}
.hand-group{display:flex;gap:10px;align-items:center;border-right:1px dashed var(--line);padding-right:12px;}
.hand-group .g-label{writing-mode:vertical-rl;font-size:.72em;color:var(--mut);letter-spacing:3px;font-weight:700;border-left:3px solid var(--acc);padding-left:4px;height:120px;display:flex;align-items:center;}
.card.disabled{opacity:.38;filter:grayscale(.75);cursor:not-allowed;transform:none!important;}
#prompt{background:rgba(20,26,58,.9);padding:16px;margin:12px 16px;border-radius:14px;min-height:52px;text-align:center;border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,.3);}
.ptitle{color:var(--acc);margin-bottom:10px;font-weight:800;font-size:1rem;letter-spacing:1px;}
#log{background:rgba(6,9,22,.85);padding:12px;height:140px;overflow-y:auto;font-size:.82em;border-top:1px solid var(--line);}
#log div{border-bottom:1px dashed #1c2547;padding:3px 0;}
#event-bar{background:linear-gradient(90deg,rgba(30,38,74,.95),rgba(40,52,98,.95));padding:13px;text-align:center;font-size:1.1em;border-bottom:1px solid var(--line);color:var(--acc);letter-spacing:1px;font-weight:700;box-shadow:0 4px 18px rgba(0,0,0,.25);}
#gamebtns{text-align:center;padding:10px;display:flex;gap:12px;justify-content:center;}
.notice{color:#7fe3c0;font-size:.85em;margin-top:10px;}
.chatbox{display:flex;flex-direction:column;}
.chatlines{background:rgba(6,9,22,.85);height:130px;overflow-y:auto;font-size:.82em;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:8px;}
.chatlines div{border-bottom:1px dashed #1c2547;padding:4px 0;word-break:break-all;}
.chatlines .me{color:#9fb8ff;}
.chatlines .sys{color:var(--acc);}
.chatlines .who{color:#8b99d8;font-weight:700;}
.chatinput{display:flex;gap:8px;margin-top:8px;}
.chatinput input{flex:1;background:rgba(10,13,30,.7);border:1px solid var(--line);color:var(--ink);padding:10px 12px;border-radius:10px;outline:none;}
.chatinput input:focus{border-color:var(--acc2);}
/* ===== 暖色主题: 夕阳机房 (#0815-8 #0816-1: 背景渐变同步暖色) ===== */
body.warm{
  --bg0:#241a10;--bg1:#3a2b18;--bg2:#4a3820;--ink:#f0e6d4;--mut:#c9b896;
  --acc:#e0a458;--acc2:#f5c98a;--line:#5a4630;--red:#ff9a6b;--grn:#7fc97f;
  --glow1:rgba(224,164,88,.20);--glow2:rgba(255,150,80,.12);--bgDeep1:#2a1f12;--bgDeep2:#201708;
}
body.warm .top{background:rgba(35,26,15,.9);}
body.warm .panel{background:linear-gradient(165deg,rgba(74,56,32,.9),rgba(40,30,16,.95));}
body.warm .player-slot{background:linear-gradient(160deg,rgba(74,56,32,.95),rgba(38,28,14,.97));}
body.warm .card{background:linear-gradient(165deg,#5a4626,#3a2c14);}
body.warm .card.red{border-color:#d98a4f;background:linear-gradient(165deg,#5a3030,#3a1c20);}
body.warm .card .cname{color:#fff0d8;}
body.warm .eq-slot{background:rgba(94,72,40,.75);border-color:#8a6a3a;}
body.warm #my-hand{background:rgba(30,22,10,.92);}
body.warm #my-equip{background:rgba(30,22,10,.92);}
body.warm #log{background:rgba(24,17,8,.9);}
body.warm #event-bar{background:linear-gradient(90deg,rgba(94,72,40,.95),rgba(74,56,32,.95));}
/* ===== 装备区/手牌区分开显示 (#0815-3) ===== */
#my-equip{background:rgba(10,14,34,.92);padding:12px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--line);min-height:70px;}
.eq-slot{display:flex;align-items:center;gap:8px;background:rgba(30,38,74,.75);border:1px dashed #4a5aa8;border-radius:10px;padding:7px 12px;font-size:.82em;min-width:170px;transition:all .2s;}
.eq-slot.filled{border-style:solid;border-color:var(--acc);box-shadow:0 0 12px rgba(78,201,176,.25);}
.eq-slot .lbl{color:var(--mut);font-size:.72em;}
.eq-slot .nm{color:#fff;font-weight:700;}
.eq-slot .empty-txt{color:#5a6a9a;font-style:italic;font-size:.78em;}
#hand-title{color:var(--mut);font-size:.78em;padding:8px 16px 2px;letter-spacing:1px;}
/* ===== 动效与音效支持 (#0815-5) ===== */
@keyframes cardFly{0%{transform:scale(1)}30%{transform:scale(1.15) translateY(-14px)}100%{transform:scale(1)}}
@keyframes dmgFlash{0%{box-shadow:0 0 0 rgba(255,60,60,0)}50%{box-shadow:0 0 28px 10px rgba(255,70,70,.8)}100%{box-shadow:0 0 0 rgba(255,60,60,0)}}
@keyframes healFloat{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-30px);opacity:0}}
@keyframes drawPulse{0%{transform:translateY(0)}50%{transform:translateY(-7px)}100%{transform:translateY(0)}}
@keyframes shakeX{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
@keyframes fxZoom{0%{opacity:0;transform:scale(.3)}20%{opacity:1;transform:scale(1.15)}45%{transform:scale(1)}70%{opacity:1}100%{opacity:0;transform:scale(1.4)}}
@keyframes glowPulse{0%,100%{box-shadow:0 0 6px rgba(78,201,176,.4)}50%{box-shadow:0 0 24px rgba(78,201,176,.9)}}
.player-slot.hit{animation:dmgFlash .65s ease;}
.player-slot.shake{animation:shakeX .4s ease;}
.player-slot.healglow{animation:glowPulse .9s ease;}
.card.just-played{animation:cardFly .5s ease;}
#fx-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;pointer-events:none;background:radial-gradient(circle,rgba(255,255,255,.16),rgba(0,0,0,.3));}
#fx-overlay.show{display:flex;animation:fxZoom 1s ease forwards;}
#fx-overlay .fx-txt{font-size:50px;font-weight:900;color:#fff;text-shadow:0 0 34px rgba(78,201,176,.95),0 4px 14px rgba(0,0,0,.7);letter-spacing:6px;text-align:center;padding:0 20px;}
#fx-overlay .fx-sub{font-size:18px;color:#ffe9c9;margin-top:10px;text-shadow:0 2px 10px rgba(0,0,0,.8);}
.top .tbtn{background:rgba(120,140,255,.14);color:#dfe5ff;border:1px solid var(--line);padding:6px 12px;border-radius:10px;cursor:pointer;font-size:.8em;font-weight:700;transition:all .15s;}
.top .tbtn:hover{border-color:var(--acc);color:#fff;}
</style></head><body>
<div class="top"><h2>OI杀 <span id="roomNameTop" style="display:none;font-size:14px;letter-spacing:1px;color:var(--acc);background:rgba(78,201,176,.12);padding:2px 10px;border-radius:10px;vertical-align:middle"></span></h2><div class="user">账号: <b id="uname">-</b> <span id="role"></span>
  <button class="tbtn" id="btnTheme" onclick="toggleTheme()">🌗 主题</button>
  <button class="tbtn" id="btnSnd" onclick="toggleSnd()">🔊 音效</button>
  <button class="btn" onclick="logout()">退出</button></div></div>

<!-- 大厅 -->
<div id="lobby">
  <div class="lobby">
    <div class="panel">
      <h3>创建房间</h3>
      <div class="row">
        <input id="newName" class="inp" placeholder="房间名称" maxlength="16" style="width:160px">
        <select id="newNum" class="inp">
          <option value="3">3人</option><option value="4" selected>4人</option><option value="5">5人</option>
          <option value="6">6人</option><option value="7">7人</option><option value="8">8人</option><option value="9">9人</option>
        </select>
        <select id="newPub" class="inp"><option value="public">公开</option><option value="private">私密</option></select>
        <input id="newPwd" class="inp" placeholder="房间密码" maxlength="16" style="width:170px">
        <button class="btn gold" onclick="createRoom()">创建房间</button>
      </div>
    </div>
    <div class="panel">
      <h3>房间列表</h3>
      <table id="roomTable"><tr><th>ID</th><th>名称</th><th>类型</th><th>人数</th><th>房主</th><th>状态</th><th>操作</th></tr></table>
      <div class="notice">点击刷新可刷新列表: <button class="btn" onclick="loadLobby()">刷新</button></div>
    </div>
    <div class="panel chatbox">
      <h3>大厅消息</h3>
      <div class="chatlines" id="lobbyChat"></div>
      <div class="chatinput">
        <input id="lobbyChatInput" placeholder="发送大厅消息..." maxlength="200" onkeydown="if(event.key==='Enter')sendChat('lobby')">
        <button class="btn green" onclick="sendChat('lobby')">发送</button>
      </div>
    </div>
    <div class="panel" id="helpPanel">
      <h3 style="cursor:pointer" onclick="toggleHelp()">📖 玩法提示 <span id="helpArrow" style="float:right">▾</span></h3>
      <div id="helpBody">
        <div class="hlp-sec"><div class="hlp-t">🎯 胜利目标</div>击败敌对阵营：<b class="k">Au选手（主公）</b>与<b class="k">Ag选手</b>要消灭<span class="bad">反贼</span>；<span class="bad">摸鱼怪（内奸）</span>要活到最后。</div>
        <div class="hlp-sec"><div class="hlp-t">🔄 回合流程</div>① 回合开始（判定延时锦囊） → ② <span class="good">摸牌 2 张</span> → ③ <span class="good">出牌</span>（做法假了攻击 / 锦囊 / 装备） → ④ 弃牌至体力值 → ⑤ 回合结束触发<span class="good">评测机事件</span>。</div>
        <div class="hlp-sec"><div class="hlp-t">⚔️ 基本牌</div><b class="k">做法假了</b>=攻击（可被 <b class="k">WA</b> 闪避，每回合默认 1 次）；<b class="k">WA</b>=闪避；<b class="k">CCF捐款</b>=回复 1 体力；<b class="k">咖啡</b>=下张攻击 +1 伤害 / 濒死自救。</div>
        <div class="hlp-sec"><div class="hlp-t">⏱️ 评测机裁决牌</div><b class="k">TLE</b>（禁主动技能）/ <b class="k">MLE</b>（手牌上限-2）/ <b class="k">CE</b>（禁锦囊），一回合后自动解除。</div>
        <div class="hlp-sec"><div class="hlp-t">🗡️ AOE 与反制</div><b class="k">数据加强</b>（全员出做法假了否则 1 伤）、<b class="k">评测机抽风</b>（全员出 WA 否则 1 伤），可用 <b class="k">特判</b> 逐人抵消；<b class="k">防火墙</b> 免疫 AOE 伤害。</div>
        <div class="hlp-sec"><div class="hlp-t">🧑‍💻 职业与觉醒</div>19 种职业各有技能与觉醒（满足条件自动触发，一局一次，界面显示 <b class="k">✨已觉醒</b>）；悬停手牌可查看卡牌功能。</div>
        <div class="hlp-sec"><div class="hlp-t">⚡ 评测机事件（每轮随机）</div><span class="bad">毒瘤</span>：AC 伤害-1 但无视 WA ｜ <span class="bad">暴力</span>：AC 伤害+1 但自损 1 ｜ <span class="good">慈善</span>：AC 不限次数 ｜ <span class="good">随机</span>：AC 目标判定（红桃闪避 / 黑桃+1）。</div>
        <div class="hlp-sec"><div class="hlp-t">📈 进化系统</div>攻击命中 / 成功闪避等会获得<span class="good">进化候选</span>，回合结束可选 1 张进化（每局最多 3 次），如 做法假了→实锤、WA→样例全过。</div>
        <div class="hlp-sec"><div class="hlp-t">⚠️ 注意事项</div>房间<span class="good">满员后</span>对局才正式开始；中途退出会重置槽位；同一账号仅允许<span class="bad">单设备登录</span>，新登录会顶掉旧连接。</div>
      </div>
    </div>
    <div class="panel" id="tupuPanel">
      <h3 style="cursor:pointer" onclick="toggleTupu()">🃏 卡牌图鉴 <span id="tupuArrow" style="float:right">▾</span></h3>
      <div id="tupuBody"></div>
    </div>
  </div>
</div>

<!-- 游戏 -->
<div id="game">
  <div id="event-bar"></div>
  <div id="skillinfo" style="padding:6px 14px;background:rgba(20,26,58,.7);border-bottom:1px solid var(--line);font-size:.82em;color:var(--mut);"></div>
  <!-- 未满员等待界面 (#0816-7): 仅保留 游戏内消息 -->
  <div id="waiting-panel" style="display:none">
    <div class="w-ico">🕐</div>
    <div class="w-txt" id="waitingTxt">等待玩家加入</div>
    <div class="w-sub" id="waitingSub">房间满员后自动开始对局</div>
    <div class="w-list" id="waitingList"></div>
    <button class="btn red" onclick="leaveRoom()">退出房间</button>
  </div>
  <div id="board"></div>
  <div id="cardtip" style="display:none;position:fixed;z-index:999;max-width:260px;background:rgba(10,13,24,.96);border:1px solid var(--acc);border-radius:10px;padding:10px 12px;font-size:.8rem;color:var(--ink);pointer-events:none;box-shadow:0 10px 26px rgba(0,0,0,.5);"></div>
  <div id="my-equip"></div>
  <div id="hand-title">🎴 手牌区</div>
  <div id="my-hand"></div>
  <div id="fx-overlay"><div class="fx-txt" id="fx-text"></div><div class="fx-sub" id="fx-sub"></div></div>
  <div id="prompt"></div>
  <div id="gamebtns">
    <button class="btn green" onclick="skipPhase()">结束出牌</button>
    <button class="btn gold" id="btnAkioi" style="display:none" onclick="useSkill('akioi')">AKIOI</button>
    <button class="btn gold" id="btnChuYuanTi" style="display:none" onclick="startSkillTarget('chuyuanti')">出原题</button>
    <button class="btn gold" id="btnZhiBo" style="display:none" onclick="startSkillTarget('zhibo')">直播</button>
    <button class="btn gold" id="btnKouHai" style="display:none" onclick="startSkillTarget('kouhai')">口嗨</button>
    <button class="btn gold" id="btnChaoTiJie" style="display:none" onclick="useSkill('chaotijie')">抄题解</button>
    <button class="btn gold" id="btnShuiQun" style="display:none" onclick="useSkill('shuiqun')">水群</button>
    <button class="btn gold" id="btnBaoLing" style="display:none" onclick="startSkillTarget('baoling')">爆零</button>
    <button class="btn gold" id="btnDianJi" style="display:none" onclick="useSkill('dianji')">奠基</button>
    <button class="btn" id="btnLobbyChat" onclick="toggleLobbyChat()">💬 大厅消息</button>
    <button class="btn red" onclick="leaveRoom()">退出房间</button>
  </div>
  <div id="log"></div>
  <!-- 游戏内消息 + 可选的大厅消息 (#0816-8) -->
  <div class="chatrow">
    <div class="chatcol panel" style="margin:0;">
      <h3>💬 游戏内消息</h3>
      <div class="chatlines" id="roomChat"></div>
      <div class="chatinput">
        <input id="roomChatInput" placeholder="发送游戏内消息..." maxlength="200" onkeydown="if(event.key==='Enter')sendChat('room')">
        <button class="btn green" onclick="sendChat('room')">发送</button>
      </div>
    </div>
    <div class="chatcol panel" id="lobbyChatCol" style="margin:0;display:none;">
      <h3>🌐 大厅消息 <span class="notice" style="font-size:.75em">游戏期间可见</span></h3>
      <div class="chatlines" id="gameLobbyChat"></div>
    </div>
  </div>
</div>

<script>
let state={},selectedCard=null,selectedTarget=null,ws=null,key='',uname='',myId=-1;
let easterUnlocked=[], lobbyMsgs=[], kickedFlag=false, loggedOut=false;
let lobbyChatOn = localStorage.getItem('oikill_lobbychat')!=='off'; // 游戏内查看大厅消息开关 (#0816-8)
let api=location.protocol+'//'+location.host;
// ===== 双主题 / 音效 / 动效 (#0815-5 #0815-6 #0815-8) =====
let soundOn = localStorage.getItem('oikill_snd')!=='off';
let lastLogLen = 0, lastHp = {}, lastGameOver = false;
function suitEmoji(s){ return s==='spade'?'♠':s==='club'?'♣':s==='heart'?'♥':s==='diamond'?'♦':(s||''); }
let actx=null;
function beep(f0,f1,dur,type,vol){ if(!soundOn) return; try{ if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)(); if(actx.state==='suspended') actx.resume(); let t=actx.currentTime; let o=actx.createOscillator(), g=actx.createGain(); o.type=type||'sine'; o.frequency.setValueAtTime(Math.max(1,f0),t); o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur); g.gain.setValueAtTime(vol||0.1,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur); o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+dur+0.03);}catch(e){} }
function snd(k){ let M={attack:()=>beep(320,90,.26,'square',.09),dodge:()=>beep(700,950,.12,'triangle',.09),heal:()=>beep(520,840,.2,'sine',.11),draw:()=>beep(980,1250,.07,'triangle',.07),equip:()=>beep(420,540,.1,'square',.06),judge:()=>{beep(660,660,.08,'sine',.09);setTimeout(()=>beep(880,880,.08,'sine',.09),100);},dead:()=>beep(230,55,.6,'sawtooth',.11),awaken:()=>{beep(523,523,.13,'sine',.11);setTimeout(()=>beep(659,659,.13,'sine',.11),130);setTimeout(()=>beep(784,784,.22,'sine',.11),260);},aoe:()=>{beep(170,55,.5,'sawtooth',.09);setTimeout(()=>beep(250,70,.4,'sawtooth',.07),170);},win:()=>{beep(523,523,.15,'sine',.11);setTimeout(()=>beep(659,659,.15,'sine',.11),150);setTimeout(()=>beep(784,784,.18,'sine',.11),300);setTimeout(()=>beep(1046,1046,.3,'sine',.11),450);},err:()=>beep(210,130,.22,'square',.07)}; if(M[k]) M[k](); }
function fx(text,sub,dur){ let ov=document.getElementById('fx-overlay'); if(!ov) return; document.getElementById('fx-text').textContent=text; document.getElementById('fx-sub').textContent=sub||''; ov.classList.add('show'); clearTimeout(ov._t); ov._t=setTimeout(()=>ov.classList.remove('show'), dur||1000); }
function applyTheme(){ let warm=localStorage.getItem('oikill_theme')==='warm'; document.body.classList.toggle('warm',warm); let b=document.getElementById('btnTheme'); if(b) b.textContent = warm?'🌞 暖色':'🌙 冷色'; }
function toggleTheme(){ localStorage.setItem('oikill_theme', document.body.classList.contains('warm')?'cold':'warm'); applyTheme(); }
function toggleSnd(){ soundOn=!soundOn; localStorage.setItem('oikill_snd', soundOn?'on':'off'); let b=document.getElementById('btnSnd'); if(b) b.textContent = soundOn?'🔊 音效':'🔇 音效'; }
function flashSlot(pid,cls){ let slots=document.querySelectorAll('#board .player-slot'); if(pid>=0&&pid<slots.length){ let el=slots[pid]; el.classList.add(cls); setTimeout(()=>el.classList.remove(cls), 900); } }
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// 角色显示: 不区分 superadmin, 仅显示 "管理员" 或 "玩家"
function roleName(r){return (r==='admin'||r==='superadmin')?'管理员':'玩家';}

window.addEventListener('load',()=>{
  applyTheme();
  let sb=document.getElementById('btnSnd'); if(sb) sb.textContent = soundOn?'🔊 音效':'🔇 音效';
  fetch(api+'/api/me').then(r=>r.json()).then(j=>{
    if(!j.ok){alert(j.msg||'未登录');location.href='/login';return;}
    uname=j.username; document.getElementById('uname').textContent=uname;
    easterUnlocked = j.easter_unlocked||[]; // 彩蛋图鉴解锁 (#0816-4)
    let rl=document.createElement('span');rl.textContent='('+roleName(j.role)+')';document.getElementById('role').appendChild(rl);
    if(j.role==='admin'||j.role==='superadmin'){let b=document.createElement('button');b.className='btn';b.textContent='管理后台';b.onclick=()=>window.open('/admin');document.getElementById('role').appendChild(b);}
    key=j.key||'';
    loadLobby();
    connectWS(false); // 大厅也建立连接以接收大厅消息, 但暂不加入房间
  }).catch(()=>{location.href='/login';});
});

function logout(){ loggedOut=true; if(ws){ try{ws.close();}catch(e){} ws=null; } fetch(api+'/api/logout').then(()=>location.href='/login'); }
function toggleHelp(){ let b=document.getElementById('helpBody'), a=document.getElementById('helpArrow'); if(!b) return; let open = b.style.display==='none'; b.style.display = open?'':'none'; if(a) a.textContent = open?'▾':'▲'; } // 折叠时箭头变正三角 (#0816-2)
function toggleTupu(){
  let b=document.getElementById('tupuBody'); if(!b) return;
  let a=document.getElementById('tupuArrow');
  let open = (b.style.display==='none'||b.innerHTML==='');
  if(!open){ b.style.display='none'; if(a) a.textContent='▲'; return; }
  b.style.display='';
  buildTupu(b);
  if(a) a.textContent='▾';
}
function buildTupu(b){
  let groups={ '🂠 基本牌':['做法假了','WA','CCF捐款','咖啡'], '✨ 进化牌':['实锤','样例全过','CCF金牌','WC对决','暴力抄袭','退学警告','O3优化','主席树','路径压缩','系统重构','浓缩咖啡','数据爆炸','评测机暴走','一票否决','模板库','评测机超频','root权限','剪枝优化','玄学大师','全员拉黑','金牌保护'],
    '⚔️ 武器':['树状数组','线段树','平衡树','莫队算法','评测机连发','管理员权限','双指针','冷数据','暴力枚举','手写快排','不死心','放手一搏','拔网线'], '🛡️ 防具':['并查集','记忆化搜索','玄学判题','黑名单','防火墙','AC保护'],
    '🐎 坐骑':['快速读入','内存屏障'], '🎴 锦囊':['对拍','爆零','停课集训','摸鱼','抄袭代码','请家长','O2优化','重构','模拟赛','女装直播','手动测评','封神','TLE','MLE','CE','骗分','申诉','玄学优化','卡评测机','板子','压轴题','数据加强','评测机抽风','CCF放水','题解大会','特判','找代打','链式前向星','UB','水群','断网','代码审计'],
    '🎉 彩蛋（游戏内触发后解锁）':['女装求AC','我样例过了！','评测机崩溃','原题大战','学长讲题','退役失败','面向数据编程','随机种子'] };
  let html='';
  for(let gk in groups){
    html+='<div class="tp-group">'+gk+'</div>';
    groups[gk].forEach(n=>{
      let isEaster = gk.indexOf('彩蛋')>=0;
      let locked = isEaster && easterUnlocked.indexOf(n)<0;
      let d = locked ? '尚未解锁：游戏中抽到/触发这张彩蛋牌后，图鉴会解锁它的效果说明。' : (CARD_INFO[n]||'');
      html+='<div class="tp-card'+(locked?' locked':'')+'"><span class="tp-name">'+(locked?'🔒 ':'')+esc(n)+'</span><span class="tp-desc">'+esc(d)+'</span></div>';
    });
  }
  html+='<div class="tp-note">彩蛋牌需在游戏内触发后解锁（按账号持久化保存）</div>';
  b.innerHTML=html;
}
// 回到大厅时刷新彩蛋解锁状态 (#0816-4)
function refreshEaster(){ fetch(api+'/api/me').then(r=>r.json()).then(j=>{ if(j.ok){ easterUnlocked = j.easter_unlocked||[]; let b=document.getElementById('tupuBody'); if(b&&b.style.display!=='none') buildTupu(b); } }).catch(()=>{}); }

function loadLobby(){
  fetch(api+'/api/lobby').then(r=>r.json()).then(j=>{
    let tb=document.getElementById('roomTable');
    tb.innerHTML='<tr><th>ID</th><th>名称</th><th>类型</th><th>人数</th><th>房主</th><th>状态</th><th>操作</th></tr>';
    if(!(j.rooms&&j.rooms.length)){let r2=document.createElement('tr');r2.innerHTML='<td colspan="7" class="empty">暂无房间</td>';tb.appendChild(r2);}
    (j.rooms||[]).forEach(r=>{
      let tr=document.createElement('tr');
      tr.innerHTML='<td>#'+esc(r.id)+'</td><td>'+esc(r.name)+'</td>'+
        '<td><span class="pill '+(r.is_public?'pub':'priv')+'">'+(r.is_public?'公开':'私密')+'</span></td>'+
        '<td>'+esc(r.joined)+'/'+esc(r.player_limit)+'</td><td>'+esc(r.host)+'</td>'+
        '<td>'+(r.started?'<b>进行中</b>':r.full?'已满':'<span class="pub">可加入</span>')+'</td>'+
        '<td><button class="btn green" onclick="joinRoom('+esc(r.id)+','+(r.is_public?1:0)+','+(r.has_password?1:0)+')">加入</button></td>';
      tb.appendChild(tr);
    });
  }).catch(()=>{});
}

function createRoom(){
  let name=document.getElementById('newName').value.trim();
  // 创建房间未填写名称时, 提示填写 (#0816-6)
  if(!name){
    let nm=prompt('请为房间填写一个名称：');
    if(nm===null) return;
    name=nm.trim();
    if(!name){ alert('房间名称不能为空'); return; }
    document.getElementById('newName').value=name;
  }
  let num=parseInt(document.getElementById('newNum').value);
  let pub=document.getElementById('newPub').value==='public';
  let pwd=document.getElementById('newPwd').value;
  if(name.length>16){alert('房间名称过长');return;}
  fetch(api+'/api/create_room',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'name='+encodeURIComponent(name)+'&num='+num+'&pub='+pub+'&pwd='+encodeURIComponent(pwd)})
  .then(r=>r.json()).then(j=>{ if(j.ok){enterRoom(j.room_id);} else alert(j.msg||'创建失败'); })
  .catch(()=>{alert('网络错误, 请重试');});
}

function joinRoom(id, isPublic, hasPwd){
  if(!hasPwd && isPublic){ doJoin(id,''); return; }   // 公开且无密码: 直接进
  let pwd=prompt('请输入房间密码(无密码直接确定):');
  if(pwd===null)return;
  doJoin(id,pwd||'');
}
function doJoin(id,pwd){
  fetch(api+'/api/join_room',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'room_id='+id+'&pwd='+encodeURIComponent(pwd||'')})
  .then(r=>r.json()).then(j=>{ if(j.ok){enterRoom(id);} else alert(j.msg||'加入失败'); })
  .catch(()=>{alert('网络错误, 请重试');});
}

// 进入游戏界面(隐藏大厅, 建立WS并join房间)
let pendingJoin=false;
function enterRoom(id){
  if(!ws||ws.readyState===3){ connectWS(true); }
  else if(ws.readyState===1){ send({type:'join_room'}); }
  else { pendingJoin=true; } // 连接建立后自动加入
  document.getElementById('lobby').style.display='none';
  document.getElementById('game').style.display='block';
  inGame=true;
}

let inGame=false;
function startGame(){
  document.getElementById('lobby').style.display='none';
  document.getElementById('game').style.display='block';
  inGame=true;
  if(ws&&ws.readyState===1){ send({type:'join_room'}); }
  else if(ws&&ws.readyState===0){ pendingJoin=true; }
  else connectWS(true);
}

function connectWS(join){
  let proto=location.protocol==='https:'?'wss://':'ws://';
  ws=new WebSocket(proto+location.host+'/ws');
  ws.onopen=()=>{ if(join||pendingJoin){ pendingJoin=false; send({type:'join_room'}); } };
  ws.onmessage=ev=>{
    try{
      let data=JSON.parse(dec(ev.data));
      if(data.type==='state'){ state=data; if(!state.players)state.players=[]; myId = (typeof state.my_id==='number')? state.my_id : -1; render(); }
      else if(data.type==='chat'){ appendChat(data); }
      else if(data.type==='error'){ let pd=document.getElementById('prompt'); if(pd) pd.innerHTML='<div class="ptitle">⚠️ '+esc(data.msg)+'</div>'; }
      else if(data.type==='kicked'){ // 顶号: 被强制下线 (#0816-9)
        kickedFlag=true;
        alert(data.msg||'你的账号已在其他设备登录，你已被强制下线');
        location.href='/login';
      }
      else if(data.type==='room_closed'){ // 房主退出, 房间被关闭 (#0815-9 #0816-5)
        alert(data.msg||'房间已关闭');
        inGame=false;
        document.getElementById('game').style.display='none';
        document.getElementById('lobby').style.display='block';
        document.getElementById('roomChat').innerHTML='';
        document.getElementById('gameLobbyChat').innerHTML='';
        let rn=document.getElementById('roomNameTop'); if(rn) rn.style.display='none';
        loadLobby();
        syncLobbyChat();
        refreshEaster();
      }
      else if(data.type==='end'){ inGame=false; } // 已退出房间, leaveRoom() 已处理界面切换, 不再弹窗
    }catch(e){}
  };
  ws.onclose=()=>{ ws=null; if(kickedFlag||loggedOut){ return; }
    // 会话已失效(顶号/服务端重启等)时直接回登录页, 避免无限重连 (#0816-9)
    fetch(api+'/api/me').then(r=>r.json()).then(j=>{
      if(!j.ok){ location.href='/login'; return; }
      if(inGame||document.getElementById('game').style.display==='block'){ setTimeout(()=>connectWS(true),2000); }
      else if(document.getElementById('lobby').style.display!=='none'){ setTimeout(()=>connectWS(false),2000); }
    }).catch(()=>{
      if(inGame||document.getElementById('game').style.display==='block'){ setTimeout(()=>connectWS(true),2000); }
      else if(document.getElementById('lobby').style.display!=='none'){ setTimeout(()=>connectWS(false),2000); }
    });
  };
}

// 聊天消息展示 (含 XSS 转义); 大厅消息在游戏内也可查看 (#0816-8)
function appendChat(m){
  let who = m.from===uname ? 'me' : '';
  if(m.scope==='lobby'){
    lobbyMsgs.push(m); if(lobbyMsgs.length>100) lobbyMsgs.shift();
    let inGameView = document.getElementById('game').style.display==='block';
    if(inGameView){
      if(lobbyChatOn) renderLobbyChat();
      return;
    }
    let box = document.getElementById('lobbyChat');
    if(box){ let div=document.createElement('div'); div.className=who; div.innerHTML='<span class="who">'+esc(m.from)+'：</span>'+esc(m.text); box.appendChild(div); box.scrollTop=box.scrollHeight; }
    return;
  }
  let box = document.getElementById('roomChat');
  if(!box) return;
  let div=document.createElement('div');
  div.className=who;
  div.innerHTML='<span class="who">'+esc(m.from)+'：</span>'+esc(m.text);
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
}
function renderLobbyChat(){
  let box=document.getElementById('gameLobbyChat'); if(!box) return;
  box.innerHTML=lobbyMsgs.map(m=>'<div class="'+(m.from===uname?'me':'')+'"><span class="who">'+esc(m.from)+'：</span>'+esc(m.text)+'</div>').join('');
  box.scrollTop=box.scrollHeight;
}
function toggleLobbyChat(){
  lobbyChatOn=!lobbyChatOn;
  localStorage.setItem('oikill_lobbychat', lobbyChatOn?'on':'off');
  let col=document.getElementById('lobbyChatCol'); if(col) col.style.display = lobbyChatOn?'':'none';
  let b=document.getElementById('btnLobbyChat'); if(b) b.textContent = lobbyChatOn?'💬 隐藏大厅消息':'💬 查看大厅消息';
  if(lobbyChatOn) renderLobbyChat();
}
function sendChat(scope){
  let input = scope==='room' ? document.getElementById('roomChatInput') : document.getElementById('lobbyChatInput');
  if(!input) return;
  let text=input.value.trim();
  if(!text)return;
  if(!ws||ws.readyState!==1){ alert('连接尚未就绪'); return; }
  send({type:'chat',scope:scope,text:text});
  input.value='';
}

// XOR 加密传输 (与服务器 xorCipher 严格对等: 按 UTF-8 原始字节异或)
// enc: utf8字节 ^= key字节, 再 base64;  dec: base64 解码后异或再 utf8 解码
function enc(s){
  let bytes = new TextEncoder().encode(s);
  let kb = new TextEncoder().encode(key);
  let bin='';
  for(let i=0;i<bytes.length;i++){ bin += String.fromCharCode(bytes[i] ^ kb[i%kb.length]); }
  return btoa(bin);
}
function dec(s){
  let bin=atob(s);
  let kb = new TextEncoder().encode(key);
  let arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++){ arr[i]=bin.charCodeAt(i) ^ kb[i%kb.length]; }
  return new TextDecoder().decode(arr);
}

function render(){
  // 未满员等待状态 (#0816-7)
  let joined=(state.players||[]).filter(x=>x.name!=='等待加入').length;
  let limit=(state.players||[]).length;
  let waiting = state.started!==true && !state.game_over;
  // 顶部导航栏显示房间名称 (#0816-6)
  let rn=document.getElementById('roomNameTop');
  if(rn){ if(state.room_name){ rn.textContent='🏠 '+state.room_name; rn.style.display=''; } else rn.style.display='none'; }
  let ev='⚡ 事件: '+(state.event||'无');
  if(state.event_desc) ev+=' — '+state.event_desc;
  if(state.round)ev+=' | 第'+state.round+'轮';
  if(state.current_turn>=0&&state.current_turn<state.players.length){ev+=' | 当前: '+esc(state.players[state.current_turn].name);}
  document.getElementById('event-bar').textContent=(state.game_over?('🎉 '+state.winner):ev)+(state.game_over?' 🏁':'');
  let board='';
  state.players.forEach(p=>{
    let cls='player-slot'+(p.id==state.current_turn?' active':'')+(p.alive?'':' dead')+(p.id===myId?' me':'');
    let eq='';
    if(p.weapon){eq+='<span class="eitem" title="武器">⚔️'+esc(p.weapon)+'</span>';}
    if(p.armor){eq+='<span class="eitem" title="防具">🛡️'+esc(p.armor)+'</span>';}
    if(p.mount_off){eq+='<span class="eitem" title="进攻马">🐴'+esc(p.mount_off)+'</span>';}
    if(p.mount_def){eq+='<span class="eitem" title="防御马">🛡️'+esc(p.mount_def)+'</span>';}
    board+='<div class="'+cls+'" onclick="pickTarget('+p.id+')">'+
      '<div class="pname">'+esc(p.name)+(p.id===myId?' <span class="me-tag">我</span>':'')+'</div>'+
      '<div class="pclass">'+esc(p.profession)+'</div>'+
      (p.identity&&p.identity!=='?'?'<div class="pident" style="font-size:.72em;color:var(--acc);">🎭 '+esc(p.identity)+'</div>':'')+
      '<div class="hp">'+(p.alive?('❤️'+p.hp+'/'+p.max_hp):'💀 阵亡')+'</div>'+
      '<div class="eq">'+eq+'</div>'+
      '<div class="pinfo">手牌:'+p.hand_count+(p.awakened?' ·✨觉醒':'')+(p.depression?' ·颓废x'+p.depression:'')+(p.chained?' ·🔗横置':'')+'</div>'+
      '</div>';
  });
  document.getElementById('board').innerHTML=board;
  // ===== 手牌区: 按 基本/锦囊/装备/彩蛋 分组, 大卡牌 + 花色/类型 emoji (#0815-3 #0815-4) =====
  let hand='';
  if(state.my_hand&&state.my_hand.length){
    let byType={};
    state.my_hand.forEach((c,i)=>{ (byType[c.type]=byType[c.type]||[]).push(i); });
    let groups=[['基本牌',[0,1,2]],['锦囊',[7]],['装备',[3,4,5,6]],['彩蛋',[8]]];
    groups.forEach(g=>{
      let label=g[0], types=g[1], idxs=[];
      types.forEach(t=>{ if(byType[t]) idxs=idxs.concat(byType[t]); });
      if(!idxs.length) return;
      let gh='<div class="hand-group"><div class="g-label">'+label+'</div>';
      idxs.forEach(i=>{
        let c=state.my_hand[i];
        let cls='card '+(c.suit==='heart'||c.suit==='diamond'?'red':'black')+(c.evolved?' evolved':'')+(selectedCard===i?' sel':'');
        let tIcon=(c.type===0)?'⚔️':(c.type===1)?'🛡️':(c.type===2)?'❤️':(c.type===7)?'🎴':(c.type>=3&&c.type<=6)?'⚙️':'🎉';
        gh+='<div class="'+cls+'" data-name="'+esc(c.name)+'" onmouseenter="showTip(this)" onmouseleave="hideTip()" onmousemove="moveTip(event)" onclick="pickCard('+i+')">'+
            '<div class="csuit">'+suitEmoji(c.suit)+'</div><div class="cname">'+esc(c.name)+(c.evolved?' ✨':'')+'</div>'+
            '<div class="ctype">'+tIcon+'</div><div class="cnum">'+esc(c.number)+'</div></div>';
      });
      gh+='</div>';
      hand+=gh;
    });
  }
  document.getElementById('my-hand').innerHTML=hand||'<div style="color:#6b8db3;align-self:center">(空手牌)</div>';
  // ===== 装备区: 四个固定栏位 (武器/防具/进攻坐骑/防御坐骑) (#0815-3) =====
  let meE=(state.players&&state.players[myId])?state.players[myId]:null;
  let eqz='';
  if(meE){
    let slot=(ic,lb,nm)=>{ let f=!!nm; return '<div class="eq-slot'+(f?' filled':'')+'" title="'+lb+'">'+(f?('<span class="lbl">'+ic+'</span><span class="nm">'+esc(nm)+'</span>'):('<span class="lbl">'+ic+'</span><span class="empty-txt">空</span>'))+'</div>'; };
    eqz=slot('⚔️','武器',meE.weapon)+slot('🛡️','防具',meE.armor)+slot('🐎','进攻坐骑',meE.mount_off)+slot('🛡️','防御坐骑',meE.mount_def);
  }
  document.getElementById('my-equip').innerHTML=eqz;
  let pd=document.getElementById('prompt');
  if(state.pending){
    let t=state.pending.type,p='';
    // 待响应按钮: 显示手牌名称而非编号 (#0815-1)
    let cardBtn=(i)=>{
      if(i===-1) return '<button class="btn" onclick="respond(-1)">🔮 玄学判题(判定)</button>';
      if(i===-2) return '<button class="btn" onclick="respond(-2)">⚔️ 手写快排(响应)</button>';
      let c=(state.my_hand||[]).find(h=>h.index===i);
      return '<button class="btn" onclick="respond('+i+')">'+(c?esc(c.name):('手牌'+i))+'</button>';
    };
    let handBtns=(list)=>(list||[]).map(h=>'<button class="btn" onclick="respond('+h.index+')">'+suitEmoji(h.suit)+' '+esc(h.name)+'</button>').join('');
    if(t==='response_wa'){ p='请打出【WA】应答: '+state.pending.valid_cards.map(cardBtn).join('')+' <button class="btn red" onclick="respond(-2)">放弃</button>'; }
    else if(t==='evolution_select'){ p='选择进化: '+state.pending.context.candidates.map(c=>'<button class="btn gold" onclick="evoSelect('+c.id+')">'+esc(c.name)+'→'+esc(c.evo)+'</button>').join('')+' <button class="btn red" onclick="evoSelect(-1)">放弃</button>'; }
    else if(t==='WAIT_O2_CARD'){ p='选择一张【做法假了】打出: '+state.pending.valid_cards.map(cardBtn).join(''); }
    else if(t==='WAIT_O2_TARGET'){ p='O2优化！选择攻击目标(点击玩家)'; selectedTarget=null; }
    else if(t==='WAIT_LIVE_TARGET'){ p='选择要偷取的手牌: '+handBtns(state.pending.hand_info); }
    else if(t==='WAIT_DUEL_SELF'){ p='对拍！请打出【做法假了】: '+state.pending.valid_cards.map(cardBtn).join(''); }
    else if(t==='WAIT_EXAM_AC'){ p='模拟赛！请打出【做法假了】应对: '+state.pending.valid_cards.map(cardBtn).join('')+' <button class="btn red" onclick="respond(-1)">放弃(受1伤)</button>'; }
    else if(t==='WAIT_JUDGE_COLOR'){ p='手动测评：将下一次判定花色强制为 <button class="btn" onclick="judgeColor(\'red\')">♥ 红色</button> <button class="btn" onclick="judgeColor(\'black\')">♠ 黑色</button>'; }
    else if(t==='AOE_AC'){ p='【数据加强】请打出【做法假了】应对: '+state.pending.valid_cards.map(cardBtn).join('')+' <button class="btn red" onclick="respond(-1)">放弃(受1伤)</button>'; }
    else if(t==='AOE_WA'){ p='【评测机抽风】请打出【WA】应对: '+state.pending.valid_cards.map(cardBtn).join('')+' <button class="btn red" onclick="respond(-1)">放弃(受1伤)</button>'; }
    else if(t==='WAIT_AUDIT_REVEAL'){ p='【代码审计】请选择要展示的手牌: '+handBtns(state.pending.hand_info); }
    else if(t==='WAIT_HARVEST'){ p='【题解大会】请选择1张题解: '+(state.pending.context.harvest_cards||[]).map((n,i)=>'<button class="btn" onclick="respond('+i+')">'+esc(n)+'</button>').join('')+' <button class="btn red" onclick="respond(-1)">放弃(随机)</button>'; }
    else if(t==='WAIT_CHAOTIJIE'){ p='【抄题解】请选择要取的牌: '+(state.pending.context.cards||[]).map((n,i)=>'<button class="btn" onclick="respond('+i+')">'+esc(n)+'</button>').join('')+' <button class="btn red" onclick="respond(-1)">放弃</button>'; }
    else if(t==='WAIT_DEPRESSION'){ p='颓废标记：<button class="btn" onclick="depression(\'heal\')">回复1体力</button> <button class="btn" onclick="depression(\'draw\')">摸2牌</button> <button class="btn red" onclick="depression(\'none\')">不使用</button>'; }
    else p='等待响应...';
    pd.innerHTML='<div class="ptitle">🎯 需要你的响应</div>'+p;
  } else {
    // 游戏提示 (无待响应操作时显示)
    let joined=(state.players||[]).filter(x=>x.name!=='等待加入').length;
    let limit=(state.players||[]).length;
    let hint='';
    if(state.game_over){ hint='🏁 '+esc(state.winner||'游戏结束')+' — 点击【退出房间】返回大厅'; }
    else if(joined<limit){ hint='🕐 等待玩家加入 ('+joined+'/'+limit+')，满员后自动开始…'; }
    else if(state.current_turn===myId){
      hint = (state.phase===3) ? '🎮 轮到你出牌：点击手牌选择卡牌，再点击目标玩家使用；或点击【结束出牌】'
                               : '⏳ 你的回合进行中，请稍候…';
    } else {
      let who=(state.players&&state.players[state.current_turn])?state.players[state.current_turn].name:'?';
      hint='⏳ 等待 '+esc(who)+' 行动…';
    }
    pd.innerHTML='<div style="color:var(--mut);line-height:1.5">'+hint+'</div>';
  }
  // 显示职业主动技能按钮
  // BUG-306: 游戏结束时禁用所有操作按钮
  if(state.game_over){ let gb=document.getElementById('gamebtns'); if(gb) gb.style.display='none'; }
  let me=state.players&&state.players[myId]?state.players[myId]:null;
  let ba=document.getElementById('btnAkioi'),by=document.getElementById('btnChuYuanTi'),bz=document.getElementById('btnZhiBo');
  if(ba)ba.style.display=(me&&me.profession==='神犇'&&me.alive&&!state.pending)?'':'none';
  if(by)by.style.display=(me&&me.profession==='毒瘤出题人'&&me.alive&&!state.pending)?'':'none';
  if(bz)bz.style.display=(me&&me.profession==='女装大佬'&&me.alive&&!state.pending)?'':'none';
  let bk=document.getElementById('btnKouHai'),bc=document.getElementById('btnChaoTiJie'),bq=document.getElementById('btnShuiQun'),bl=document.getElementById('btnBaoLing'),bd=document.getElementById('btnDianJi');
  if(bk)bk.style.display=(me&&me.profession==='键盘侠'&&me.alive&&!state.pending)?'':'none';
  if(bc)bc.style.display=(me&&me.profession==='抄题解选手'&&me.alive&&!state.pending)?'':'none';
  if(bq)bq.style.display=(me&&me.profession==='水群怪'&&me.alive&&!state.pending)?'':'none';
  if(bl)bl.style.display=(me&&me.profession==='爆零选手'&&me.alive&&!state.pending)?'':'none';
  if(bd)bd.style.display=(me&&me.profession==='图灵奖得主'&&me.alive&&!state.pending)?'':'none';
  let lg=document.getElementById('log');lg.innerHTML=(state.log||[]).map(l=>'<div>'+esc(l)+'</div>').join('');lg.scrollTop=lg.scrollHeight;
  // 职业技能提示
  let skills={
    '萌新':'被动·问问题(成为目标摸1)·觉醒:我还能学!',
    '蒟蒻':'被动·抱大腿·主动·退役(濒死自救)·觉醒:退役是不可能的',
    '划水怪':'被动·随缘·主动·摸鱼·觉醒:终极摸鱼',
    '神犇':'被动·碾压·主动·AKIOI(弃2牌多出2杀)·觉醒:AK全场',
    '毒瘤出题人':'被动·祖传卡常·主动·出原题(弃2同花色)·觉醒:全员卡常',
    '退役选手':'被动·回忆·主动·挣扎·觉醒:老兵不死',
    '金牌教练':'被动·集训·主动·谈心·专属·模拟赛·觉醒:名师出高徒',
    '女装大佬':'被动·女装·主动·直播·专属·女装直播·觉醒:公开处刑',
    '传奇Au选手':'被动·不败·主动·封神·觉醒:传奇不朽',
    '学长':'主动·讲题(弃1牌让目标摸1)·觉醒:听懂了就怪了',
    '评测姬':'被动·测评(受伤判定♥减伤)·主动·重测·觉醒:评测机之心',
    '打表狂魔':'主动·打表(弃2摸4)·觉醒:表过样例',
    '玄学选手':'被动·玄学(受伤判定♥免伤)·觉醒:玄学优化',
    '键盘侠':'主动·口嗨(弃1牌令目标弃1)·觉醒:网络暴力(可指定2名)',
    '抄题解选手':'主动·抄题解(弃1牌看牌堆顶3取1)·觉醒:Ctrl+C(看4取2)',
    '压线选手':'被动·压线过(致命伤变剩1血)·觉醒:卡线Au(上限+1)',
    '水群怪':'主动·水群(弃1摸2弃1)·觉醒:龙王(摸3)',
    '爆零选手':'主动·爆零(目标弃1或受1伤)·觉醒:稳定爆零(伤害+1)',
    '图灵奖得主':'被动·图灵完备(手牌上限+1)·主动·奠基(限定技上限+2)·觉醒:图灵机'
  };
  let si=document.getElementById('skillinfo');
  if(si&&me&&skills[me.profession]){ si.innerHTML='<b>'+esc(me.profession)+'</b> — '+esc(skills[me.profession])+(me.awakened?' <span style="color:var(--acc)">✨已觉醒</span>':''); }
  // ===== 未满员: 进入等待界面, 仅保留"游戏内消息" (#0816-7) =====
  let wp=document.getElementById('waiting-panel');
  if(waiting){
    wp.style.display='flex';
    document.getElementById('waitingTxt').textContent='等待玩家加入 ('+joined+'/'+limit+')';
    document.getElementById('waitingSub').textContent = (state.room_host===uname ? '你是房主，等待其他玩家加入后自动开始…' : '房间满员后自动开始对局…');
    document.getElementById('waitingList').innerHTML=(state.players||[]).map(p=>'<span class="w-pill'+(p.name===state.room_host?' host':'')+'">'+(p.name==='等待加入'?'⬜ 等待加入…':esc(p.name)+(p.name===state.room_host?' 👑':'')+(p.name===uname?'（我）':''))+'</span>').join('');
    ['event-bar','board','my-equip','hand-title','my-hand','prompt','gamebtns','log','skillinfo'].forEach(id=>{let el=document.getElementById(id); if(el) el.style.display='none';});
    // 等待界面仅保留"游戏内消息"
    let lc=document.getElementById('lobbyChatCol'); if(lc) lc.style.display='none';
  } else {
    wp.style.display='none';
    ['event-bar','board','my-equip','hand-title','my-hand','prompt','gamebtns','log','skillinfo'].forEach(id=>{let el=document.getElementById(id); if(el) el.style.display='';});
    // 游戏内大厅消息开关 (#0816-8)
    let lc=document.getElementById('lobbyChatCol'); if(lc) lc.style.display = lobbyChatOn?'':'none';
    let lcb=document.getElementById('btnLobbyChat'); if(lcb) lcb.textContent = lobbyChatOn?'💬 隐藏大厅消息':'💬 查看大厅消息';
  }
  // ===== 结算动效与音效: 对比新增日志触发 (#0815-5 #0815-6) =====
  let logs=state.log||[];
  if(lastLogLen>0){
    for(let i=lastLogLen;i<logs.length;i++){
      let L=logs[i]||'';
      let whoIn=()=>{ let p=(state.players||[]).find(x=>x.name!=='等待加入'&&L.indexOf(x.name)>=0); return p?p.id:-1; };
      if(L.indexOf('使用【数据加强】')>=0){ snd('aoe'); fx('📢 数据加强！','全员打出做法假了，否则受到伤害',1200); }
      else if(L.indexOf('使用【评测机抽风】')>=0){ snd('aoe'); fx('📢 评测机抽风！','全员打出WA，否则受到伤害',1200); }
      else if(L.indexOf('CCF 放水')>=0){ snd('heal'); fx('💧 CCF放水！','人人有分',1000); }
      else if(L.indexOf('题解大会')>=0){ snd('draw'); fx('📚 题解大会！','人人有题解抄',1000); }
      else if(L.indexOf('评测机崩溃')>=0){ snd('aoe'); fx('💥 评测机崩溃！','Ctrl+C都救不了你们',1300); }
      else if(L.indexOf('直播女装')>=0){ snd('aoe'); fx('📺 女装直播！','在线发牌',1100); }
      else if(L.indexOf('链式前向星传导')>=0){ snd('aoe'); fx('🔗 伤害传导！','链上节点一损俱损',1000); }
      else if(L.indexOf('觉醒')>=0){ snd('awaken'); fx('✨ 觉醒！','',1200); }
      else if(L.indexOf('进化了')>=0){ snd('awaken'); fx('🔥 进化！','',1100); }
      else if(L.indexOf(' 死亡')>=0){ snd('dead'); fx('💀 阵亡','',1100); }
      else if(L.indexOf(' 受到 ')>=0){ let pid=whoIn(); if(pid>=0) flashSlot(pid,'hit'); snd('attack'); }
      else if(L.indexOf('回复')>=0){ let pid=whoIn(); if(pid>=0) flashSlot(pid,'healglow'); snd('heal'); }
      else if(L.indexOf('判定')>=0){ snd('judge'); }
      else if(L.indexOf('装备了')>=0){ snd('equip'); }
      else if(L.indexOf(' 摸 ')>=0||L.indexOf('摸1')>=0||L.indexOf('摸2')>=0||L.indexOf('摸3')>=0||L.indexOf('摸4')>=0){ snd('draw'); }
    }
  }
  lastLogLen=logs.length;
  // 体力变化 → 受击/回复高亮
  let hpNow={}; (state.players||[]).forEach(p=>hpNow[p.id]=p.hp);
  for(let id in hpNow){ if(lastHp[id]!==undefined && hpNow[id]<lastHp[id]) flashSlot(parseInt(id),'hit'); }
  lastHp=hpNow;
  if(state.game_over && !lastGameOver){ lastGameOver=true; snd('win'); fx('🏁 '+esc(state.winner||'游戏结束'),'',1600); }
  if(!state.game_over) lastGameOver=false;
}
// 卡牌功能注释 (悬浮卡牌显示)
let CARD_INFO={
  '做法假了':'攻击牌：对1名攻击范围内角色造成1点伤害，目标可打出【WA】闪避。每回合默认限1次。',
  'WA':'防御牌：抵消一次【做法假了】攻击（我WA了，我认输）。',
  'CCF捐款':'回复牌：回复1点体力（向CCF捐款换1分）。',
  '实锤':'进化·做法假了：伤害+1；被WA抵消时你摸1张。',
  '样例全过':'进化·WA：抵消后摸1张并回复1点体力。',
  'CCF金牌':'进化·CCF捐款：额外回复1点体力并摸1张。',
  '树状数组':'武器(距离1)：攻击命中后可观看目标手牌。',
  '线段树':'武器(距离2)：攻击被WA抵消时你摸1张。',
  '平衡树':'武器(距离3)：攻击被WA抵消时可弃1张手牌强制命中。',
  '莫队算法':'武器(距离2)：攻击命中后，可额外攻击另一名可攻击目标1点伤害。',
  '并查集':'防具：受到攻击时可弃1张手牌当作【WA】闪避。',
  '记忆化搜索':'防具：受伤时判定，红桃则本次伤害-1。',
  '快速读入':'进攻坐骑：你计算与别人的距离-1。',
  '内存屏障':'防御坐骑：别人计算与你的距离+1。',
  '对拍':'锦囊：双方轮流出【做法假了】，没有的一方受1点伤害。',
  '爆零':'锦囊：弃置目标1张手牌（考试得0分）。',
  '停课集训':'锦囊：目标下回合跳过出牌阶段。',
  '摸鱼':'锦囊：摸2张牌。',
  '抄袭代码':'锦囊：获得目标1张装备牌（无装备则偷手牌）。',
  '请家长':'锦囊：目标弃1件装备，否则受1点伤害。',
  'O2优化':'锦囊：打出一张【做法假了】对目标造成2点伤害。',
  '重构':'锦囊：从弃牌堆随机获得1张牌。',
  '模拟赛':'锦囊(金牌教练)：目标须打出【做法假了】，否则受1点伤害。',
  '女装直播':'锦囊(女装大佬)：全场摸1，其他角色弃1，你获得其中1张。',
  '手动测评':'锦囊：选择"红/黑"，强制下一次判定花色。',
  '封神':'锦囊(传奇Au，一局一次)：至多2名目标各受1点伤害。',
  'TLE':'锦囊：目标本回合不能使用主动技能（超时！）。',
  'MLE':'锦囊：目标本回合手牌上限-2（内存超限！）。',
  'CE':'锦囊：目标本回合不能使用锦囊牌（编译错误！）。',
  '骗分':'锦囊：回复1点体力（骗到1分）。',
  '申诉':'锦囊：从弃牌堆获得1张牌（申诉找回分数）。',
  '玄学优化':'锦囊：目标摸2张（玄不改命，改的是数据）。',
  '卡评测机':'锦囊：目标受1点不可闪避的伤害。',
  '板子':'锦囊：摸2张并回复1点体力（掏出模板）。',
  '压轴题':'锦囊：目标摸1张再弃1张（只能写第一问）。',
  '女装求AC':'彩蛋：目标给你1张手牌，否则你回复1点体力。',
  '我样例过了！':'彩蛋：无【做法假了】摸2张；有则弃1张。',
  '评测机崩溃':'彩蛋：弃牌堆【做法假了】回牌堆重洗，全场失去1点体力。',
  '原题大战':'彩蛋：所有角色弃置点数最大的一张手牌。',
  '学长讲题':'彩蛋：目标摸2张，你从弃牌堆获得1张WA。',
  '退役失败':'彩蛋：1体力的角色回复1，满血角色受1点伤害。',
  '面向数据编程':'彩蛋：所有存活角色各摸1张（数据太水了）。',
  '随机种子':'彩蛋：摸2张再随机弃1张（玄学不可控）。',
  // ===== v3.0 新卡 =====
  '咖啡':'基本牌：本回合下一张【做法假了】伤害+1；或濒死时自救回复1点体力（咖啡续命）。',
  '浓缩咖啡':'进化·咖啡：伤害加成+2；濒死回复2点体力。',
  '数据加强':'AOE锦囊：所有其他角色各需打出【做法假了】，否则受到1点伤害（数据加强了，全员重写）。',
  '数据爆炸':'进化·数据加强：打不出牌的角色受2点伤害。',
  '评测机抽风':'AOE锦囊：所有其他角色各需打出【WA】，否则受到1点伤害（评测机抽风，全场WA）。',
  '评测机暴走':'进化·评测机抽风：打不出WA的角色受2点伤害。',
  'CCF放水':'锦囊：所有角色各回复1点体力（CCF大放水，人人有分）。',
  '题解大会':'锦囊：翻开等同存活人数的牌，从你开始轮流选择1张（题解大会，人人有抄）。',
  '特判':'锦囊：抵消一张锦囊牌对一名角色的效果（特判=出题人钦定）。',
  '一票否决':'进化·特判：抵消后你摸1张牌。',
  '找代打':'锦囊：令一名持械角色对其攻击范围内角色使用【做法假了】，否则你获得其武器。',
  '链式前向星':'锦囊：横置至多2名角色，横置角色受伤时其他横置角色各受等量伤害，然后重置；可重铸（弃此牌摸1）。',
  'UB':'延时锦囊：判定黑桃2~9受3点伤害，否则传给下家（未定义行为，随时爆炸）。',
  '水群':'延时锦囊：判定非红桃跳过出牌阶段（水群一时爽）。',
  '断网':'延时锦囊：判定非梅花跳过摸牌阶段（断网断电，摸不了题）。',
  '代码审计':'锦囊：目标展示1张手牌，你弃1张同花色手牌则对其造成1点伤害。',
  '评测机连发':'武器(距离1)：使用【做法假了】无次数限制（诸葛连弩）。',
  '评测机超频':'进化·评测机连发：无次数限制，攻击范围+1。',
  '管理员权限':'武器(距离2)：攻击无视防具（青釭剑）。',
  'root权限':'进化·管理员权限：无视防具；被WA抵消时可弃1张令其无效。',
  '双指针':'武器(距离2)：命中后目标手牌≥你则你摸1，否则目标弃1（雌雄双股剑）。',
  '冷数据':'武器(距离2)：造成伤害时可防止伤害，改为弃置目标2张牌（寒冰剑）。',
  '暴力枚举':'武器(距离3)：被WA抵消时可弃2张手牌强制命中（贯石斧）。',
  '剪枝优化':'进化·暴力枚举：强制命中只需弃1张。',
  '手写快排':'武器(距离3)：可将2张手牌当【做法假了】使用（丈八蛇矛）。',
  '模板库':'进化·手写快排：1张手牌即可当【做法假了】。',
  '不死心':'武器(距离3)：被WA抵消后可立即再对其使用1张【做法假了】（青龙偃月刀）。',
  '放手一搏':'武器(距离4)：若使用的【做法假了】是你最后1张手牌，可指定至多3名角色（方天画戟）。',
  '拔网线':'武器(距离5)：攻击命中时弃置目标1张坐骑（麒麟弓）。',
  '玄学判题':'防具：需要打出【WA】时可判定，红桃视为打出【WA】（八卦阵）。',
  '玄学大师':'进化·玄学判题：红桃或方块均视为打出【WA】。',
  '黑名单':'防具：黑色【做法假了】对你无效（仁王盾）。',
  '全员拉黑':'进化·黑名单：黑色做法假了无效；失去此防具时摸1张。',
  '防火墙':'防具：免疫【数据加强】【评测机抽风】的伤害；暴力评测机事件期间你受伤+1（藤甲）。',
  'AC保护':'防具：你每次受到伤害至多为1；失去此防具时回复1点体力（白银狮子）。',
  '金牌保护':'进化·AC保护：失去此防具时回复2点体力。'
};
function showTip(el){ let tip=document.getElementById('cardtip'); if(!tip) return; let n=el.getAttribute('data-name')||''; let d=CARD_INFO[n]||(n?('卡牌：'+n):''); if(d){ tip.innerHTML='<b style="color:var(--acc)">'+esc(n)+'</b><br>'+esc(d); tip.style.display='block'; } }
function hideTip(){ let tip=document.getElementById('cardtip'); if(tip) tip.style.display='none'; }
function moveTip(ev){ let tip=document.getElementById('cardtip'); if(tip&&tip.style.display!=='none'){ tip.style.left=Math.min(ev.clientX+14, window.innerWidth-280)+'px'; tip.style.top=(ev.clientY+16)+'px'; } }
let skillTargetMode=null;
function useSkill(skill){ send({type:'use_skill',skill:skill}); }
function startSkillTarget(skill){ skillTargetMode=skill; document.getElementById('prompt').innerHTML='<div class="ptitle">🎯 '+ (skill==='chuyuanti'?'出原题：点击一名玩家作为目标':(skill==='kouhai'?'口嗨：点击一名玩家作为目标':(skill==='baoling'?'爆零：点击一名玩家作为目标（可在底部选弃牌/伤害）':'选择目标'))) +'</div>'; render(); }
let baoLingMode='discard';
function setBaoLingMode(m){ baoLingMode=m; render(); }
function judgeColor(c){ send({type:'response',color:c}); }
function depression(c){ send({type:'response',choice:c}); }
// 无需选择目标、点击即可打出的牌 (装备同理); 神犇的黑色手牌默认当【做法假了】攻击, 仍需选目标
const NO_TARGET_CARDS=['摸鱼','重构','骗分','申诉','板子','手动测评','O2优化','评测机崩溃','我样例过了！','原题大战','退役失败','面向数据编程','随机种子','CCF捐款','咖啡','数据加强','评测机抽风','CCF放水','题解大会','女装直播','UB'];
function pickCard(i){
  if(selectedCard===i){selectedCard=null;render();return;}
  if(state.pending){ selectedCard=null; render(); return; } // 有待响应时请用弹出按钮
  let c=(state.my_hand||[])[i]; if(!c) return;
  let me=state.players&&state.players[myId];
  let isShen=me&&me.profession==='神犇';
  let isBlack=(c.suit==='spade'||c.suit==='club');
  let isEq=(c.type>=3&&c.type<=6);
  let auto = isEq || (NO_TARGET_CARDS.indexOf(c.name)>=0 && !(isShen&&isBlack&&!isEq));
  if(auto){ playCard(i, c.name==='UB'?[myId]:[]); return; }
  selectedCard=i; render();
}
function playCard(i,tg){ send({type:'use_card',card_index:i,targets:tg||[]}); snd('draw'); }
let daidangTargets=null;
function pickTarget(id){
  if(state.pending&&state.pending.type==='WAIT_O2_TARGET'){send({type:'response',targets:[id]});return;}
  if(state.pending&&state.pending.type==='WAIT_PUBLIC_EXEC'){send({type:'response',targets:[id]});return;}
  if(skillTargetMode){ let extra={}; if(skillTargetMode==='baoling') extra.mode=baoLingMode; send({type:'use_skill',skill:skillTargetMode,targets:[id],...extra}); skillTargetMode=null; render(); return; }
  if(selectedCard===null) return;
  // BUG-301: 找代打需要 2 个目标 (先选持械角色, 再选攻击目标)
  let cardName = (state.my_hand&&state.my_hand[selectedCard])?state.my_hand[selectedCard].name:'';
  if(cardName==='找代打'){
    if(daidangTargets===null){ daidangTargets=[id]; let pd=document.getElementById('prompt'); if(pd) pd.innerHTML='<div class="ptitle">🎯 找代打：再点击攻击目标（该角色的攻击范围内）</div>'; return; }
    send({type:'use_card',card_index:selectedCard,targets:[daidangTargets[0],id]});
    daidangTargets=null; selectedCard=null; render(); return;
  }
  // BUG-303: 多目标攻击卡(放手一搏/AK全场实锤) - 连续点击目标, 再次点击自己或结束确认
  let isMulti = (cardName==='放手一搏') || (cardName==='实锤' && state.ak_all_active);
  if(isMulti){
    if(!window.multiTargets) window.multiTargets=[];
    if(window.multiTargets.indexOf(id)<0) window.multiTargets.push(id);
    let pd=document.getElementById('prompt');
    if(pd) pd.innerHTML='<div class="ptitle">🎯 多目标攻击：已选 '+window.multiTargets.length+' 名（'+esc(cardName)+'）</div>'+
      '<button class="btn gold" onclick="confirmMulti()">确认攻击</button> <button class="btn red" onclick="cancelMulti()">取消</button>';
    return;
  }
  send({type:'use_card',card_index:selectedCard,targets:[id]});
  selectedCard=null; render();
}
function confirmMulti(){ if(!window.multiTargets||!window.multiTargets.length) return; send({type:'use_card',card_index:selectedCard,targets:window.multiTargets}); window.multiTargets=null; selectedCard=null; render(); }
function cancelMulti(){ window.multiTargets=null; selectedCard=null; render(); }
function send(obj){ if(ws&&ws.readyState===1) ws.send(enc(JSON.stringify(obj))); }
function respond(idx){ send({type:'response',card_index:idx}); }
function evoSelect(id){ send({type:'response',evo_card_id:id}); }
function skipPhase(){ send({type:'skip_phase'}); }
function syncLobbyChat(){
  let box=document.getElementById('lobbyChat'); if(!box) return;
  box.innerHTML=lobbyMsgs.map(m=>'<div class="'+(m.from===uname?'me':'')+'"><span class="who">'+esc(m.from)+'：</span>'+esc(m.text)+'</div>').join('');
  box.scrollTop=box.scrollHeight;
}
function leaveRoom(){
  send({type:'leave_room'});
  inGame=false;
  document.getElementById('game').style.display='none';
  document.getElementById('lobby').style.display='block';
  document.getElementById('roomChat').innerHTML='';
  document.getElementById('gameLobbyChat').innerHTML='';
  let rn=document.getElementById('roomNameTop'); if(rn) rn.style.display='none';
  loadLobby();
  syncLobbyChat();
  refreshEaster();
}
</script></body></html>
)raw";

// ==================== 管理页 ====================

const std::string ADMIN_HTML = R"raw(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OI杀 管理控制台</title>
<style>
:root{
  --bg0:#0b1023;--bg1:#161b36;--bg2:#1e2449;--ink:#e8ecfb;--mut:#9aa7d8;
  --acc:#4ec9b0;--acc2:#5eead4;--line:#2c3463;--red:#ff5c7a;--grn:#34d399;
}
*{box-sizing:border-box;}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, rgba(94,120,255,.18), transparent 60%),
    radial-gradient(900px 520px at 110% 110%, rgba(78,201,176,.12), transparent 55%),
    linear-gradient(160deg,var(--bg0),#0d1228 45%,#101735);
  color:var(--ink);font-family:'Segoe UI',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;padding:24px;min-height:100vh;background-attachment:fixed;}
h1{margin:4px 0 0;font-size:26px;letter-spacing:3px;color:#fff;text-shadow:0 2px 12px rgba(78,201,176,.3);}
h2{color:#c9d4ff;margin-top:6px;font-size:15px;letter-spacing:1px;font-weight:700;}
.tabs{display:flex;gap:8px;margin:16px 0;}
.tab{background:rgba(30,36,73,.85);color:#c9d4ff;border:1px solid var(--line);padding:11px 20px;border-radius:12px;cursor:pointer;font-weight:700;transition:all .15s;}
.tab:hover{border-color:var(--acc);}
.tab.on{background:linear-gradient(135deg,#4ec9b0,#569cd6);color:#241800;border-color:transparent;box-shadow:0 8px 20px rgba(78,201,176,.3);}
.section{display:none;}
.section.on{display:block;animation:fade .25s ease;}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.panel{background:linear-gradient(165deg,rgba(30,36,73,.9),rgba(18,22,49,.94));border-radius:16px;padding:20px;margin:14px 0;border:1px solid rgba(120,140,255,.18);box-shadow:0 14px 40px rgba(0,0,0,.35);}
button{background:rgba(120,140,255,.14);color:#dfe5ff;border:1px solid var(--line);padding:9px 16px;border-radius:10px;cursor:pointer;font-weight:600;transition:all .15s;margin:3px;}
button:hover{border-color:var(--acc);color:#fff;transform:translateY(-1px);}
button.green{background:rgba(52,211,153,.15);color:#5eead4;border-color:rgba(52,211,153,.35);}
button.red{background:rgba(255,92,122,.15);color:#ff8ba0;border-color:rgba(255,92,122,.4);}
button.gold{background:linear-gradient(135deg,#4ec9b0,#569cd6);color:#241800;border:none;}
input,select{background:rgba(10,13,30,.7);border:1px solid var(--line);color:var(--ink);padding:9px 12px;border-radius:10px;margin:3px;outline:none;transition:border-color .2s;}
input:focus,select:focus{border-color:var(--acc);}
table{width:100%;border-collapse:collapse;margin-top:8px;}
td,th{padding:10px;border-bottom:1px solid var(--line);text-align:left;font-size:.9em;}
th{color:#8b99d8;font-size:.8em;letter-spacing:1px;text-transform:uppercase;}
tr:hover{background:rgba(120,140,255,.07);}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.76em;font-weight:700;}
.b-ad{background:rgba(52,211,153,.15);color:#5eead4;border:1px solid rgba(52,211,153,.35);}
.b-u{background:rgba(120,140,255,.14);color:#b8c4ff;border:1px solid rgba(120,140,255,.3);}
.banned{color:#ff8ba0;}
.msg{color:#7fe3c0;font-size:.85em;min-height:18px;}
.logbox{background:rgba(6,9,22,.85);padding:12px;height:320px;overflow-y:auto;font-size:.82em;border:1px solid var(--line);border-radius:12px;}
.logbox div{border-bottom:1px dashed #1c2547;padding:3px 0;}
.btnrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
</style></head><body>
<h1>OI杀 管理控制台</h1>
<div class="tabs">
  <button class="tab on" onclick="showTab('rooms',this)">房间管理</button>
  <button class="tab" onclick="showTab('users',this)">用户管理</button>
  <button class="tab" onclick="showTab('logs',this)">日志</button>
  <button class="tab" onclick="showTab('admin',this)">管理员</button>
</div>
<div id="me"></div>

<div id="section-rooms" class="section on">
  <div class="panel">
    <h2>创建房间</h2>
    <select id="num"><option>3</option><option selected>4</option><option>5</option><option>6</option><option>7</option><option>8</option><option>9</option></select>
    <select id="pub"><option value="public">公开</option><option value="private">私密</option></select>
    <input id="pwd" placeholder="密码" maxlength="16"><input id="name" placeholder="房间名称" maxlength="16">
    <button class="gold" onclick="createRoom()">创建</button>
  </div>
  <div class="panel"><h2>房间列表</h2><table id="roomsTab"><tr><th>ID</th><th>名称</th><th>类型</th><th>人数</th><th>房主</th><th>状态</th><th>操作</th></tr></table></div>
</div>

<div id="section-users" class="section">
  <div class="panel"><h2>用户列表</h2><table id="usersTab"><tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>对局</th><th>胜场</th><th>操作</th></tr></table></div>
</div>

<div id="section-logs" class="section">
  <div class="panel">
    <h2>日志文件</h2><div id="logfiles"></div>
    <h2>最近日志</h2>
    <div class="logbox" id="recentLogs"></div>
    <div class="btnrow"><button onclick="loadLogs()">刷新日志</button></div>
  </div>
</div>

<div id="section-admin" class="section">
  <div class="panel">
    <h2>重置用户密码</h2>
    <div class="btnrow">
      <input id="resetUser" placeholder="用户账号" maxlength="20"><input id="resetPwd" placeholder="新密码" maxlength="32">
      <button class="gold" onclick="resetPassword()">重置密码</button>
    </div>
    <div class="msg" id="opmsg"></div>
  </div>
</div>

<script>
let meRole='', meName='';
let api=location.protocol+'//'+location.host;
let lastRoomsJson='', lastUsersJson='';
function apiPost(url,body){return fetch(api+url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).then(r=>r.json());}
window.addEventListener('load',()=>{
  fetch(api+'/api/me').then(r=>r.json()).then(j=>{
    if(!j.ok){location.href='/login';return;} meRole=j.role; meName=j.username;
    document.getElementById('me').innerHTML='当前账号: <b>'+esc(meName)+'</b> ('+roleName(meRole)+') <button class="red" onclick="fetch(api+\'/api/logout\').then(()=>location.href=\'/login\')">退出</button>';
    if(meRole==='user'){alert('仅管理员可访问此页面');location.href='/';return;}
    loadRooms();loadUsers();loadLogs();
    setInterval(()=>{ loadRooms(); loadUsers(); }, 4000); // 自动刷新
  });
});
function showTab(name,btn){document.querySelectorAll('.section').forEach(s=>s.classList.remove('on'));document.getElementById('section-'+name).classList.add('on');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));btn.classList.add('on');}
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function roleName(r){ if(r==='banneduser')return '封禁用户'; return (r==='admin'||r==='superadmin')?'管理员':'玩家'; }
function roleBadge(r){return r==='banneduser'?'<span class="badge b-ban" style="background:#a03">封禁用户</span>'
  : r==='admin'?'<span class="badge b-ad">管理员</span>'
  : r==='superadmin'?'<span class="badge b-ad" style="background:#ce9178">超级管理员</span>'
  : '<span class="badge b-u">玩家</span>';}
function msg(x){document.getElementById('opmsg').textContent=x;}

function createRoom(){
  let name=document.getElementById('name').value.trim(),pwd=document.getElementById('pwd').value;
  if(!name){ // 创建房间未填写名称时, 提示填写 (#0816-6)
    let nm=prompt('请为房间填写一个名称：');
    if(nm===null) return;
    name=nm.trim();
    if(!name){alert('房间名称不能为空');return;}
    document.getElementById('name').value=name;
  }
  let pub=document.getElementById('pub').value==='public',num=document.getElementById('num').value;
  if(name.length>16){alert('房间名称过长');return;}
  apiPost('/api/create_room','num='+num+'&pub='+pub+'&pwd='+encodeURIComponent(pwd)+'&name='+encodeURIComponent(name)).then(j=>{alert(j.ok?('创建成功 #'+j.room_id):j.msg);loadRooms();});
}
function loadRooms(){
  fetch(api+'/api/admin/rooms').then(r=>r.json()).then(j=>{
    // 数据未变化时不重建表格, 避免每4秒自动刷新导致界面闪烁
    let s=JSON.stringify(j);
    if(s===lastRoomsJson) return;
    lastRoomsJson=s;
    let tb=document.getElementById('roomsTab');
    tb.innerHTML='<tr><th>ID</th><th>名称</th><th>类型</th><th>人数</th><th>房主</th><th>状态</th><th>操作</th></tr>';
    (j.rooms||[]).forEach(r=>{
      let tr=document.createElement('tr');
      tr.innerHTML='<td>'+esc(r.id)+'</td><td>'+esc(r.room_name)+'</td><td>'+(r.is_public?'公开':'私密')+'</td><td>'+esc(r.player_count)+'/'+esc(r.limit)+'</td><td>'+esc(r.host)+'</td><td>'+(r.game_over?'结束':r.started?'进行中':'等待')+'</td><td>'+
        '<button class="red" onclick="closeRoom('+esc(r.id)+')">关闭</button>'+
        '<button onclick="changePub('+esc(r.id)+','+(r.is_public?0:1)+')">'+(r.is_public?'设私密':'设公开')+'</button>'+
        '<button onclick="setLimit('+esc(r.id)+')">改人数</button></td>';
      tb.appendChild(tr);
    });
  }).catch(()=>{});
}
function closeRoom(id){apiPost('/api/admin/close_room','room_id='+id).then(()=>loadRooms());}
function changePub(id,pub){apiPost('/api/admin/set_public','room_id='+id+'&pub='+(pub?1:0)).then(()=>loadRooms());}
function setLimit(id){let n=prompt('新人数(3-9)');if(n)apiPost('/api/admin/set_limit','room_id='+id+'&limit='+n).then(()=>loadRooms());}

function loadUsers(){
  fetch(api+'/api/admin/users').then(r=>r.json()).then(j=>{
    // 数据未变化时不重建表格, 避免自动刷新闪烁 (meName 在页面加载时已缓存)
    let s=JSON.stringify(j);
    if(s===lastUsersJson) return;
    lastUsersJson=s;
    let tb=document.getElementById('usersTab');
    tb.innerHTML='<tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>对局</th><th>胜场</th><th>操作</th></tr>';
    (j.users||[]).forEach(u=>{
      let isSelf = u.username===meName;
      let tr=document.createElement('tr');
      tr.className=u.banned?'banned':'';
      let roleSel='';
      if(meRole==='superadmin' && u.username!=='superadmin'){
        roleSel='<select onchange="setUserRole('+esc(u.id)+',this.value)">'+
          ['user','admin','banneduser'].map(r=>'<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+(r==='user'?'玩家':r==='admin'?'管理员':'封禁用户')+'</option>').join('')+
          '</select>';
      } else { roleSel=roleBadge(u.role); }
      tr.innerHTML='<td>'+esc(u.id)+'</td><td>'+esc(u.username)+'</td><td>'+roleSel+'</td><td>'+(u.banned?'<span style="color:#ff6b6b">已封禁</span>':'<span style="color:#6bdb9f">正常</span>')+'</td><td>'+esc(u.gamesPlayed)+'</td><td>'+esc(u.gamesWon)+'</td>'+
        '<td class="btnrow">'+
        (meRole==='superadmin' && !isSelf && u.username!=='superadmin'
          ? '<button class="'+(u.banned?'green':'red')+'" onclick="toggleBan('+esc(u.id)+','+(u.banned?0:1)+')">'+(u.banned?'解封':'封禁')+'</button>'
          : '')+
        '<button class="gold" onclick="promptReset('+esc(u.id)+')">重置密码</button></td>';
      tb.appendChild(tr);
    });
  }).catch(()=>{});
}
function setUserRole(id,role){apiPost('/api/admin/set_role','uid='+id+'&role='+role).then(()=>{msg('已更新角色');loadUsers();});}
function toggleBan(id,ban){apiPost('/api/admin/set_ban','uid='+id+'&ban='+ban).then(()=>loadUsers());}
function promptReset(id){let np=prompt('请输入新密码');if(np)apiPost('/api/admin/reset_pwd','uid='+id+'&pwd='+encodeURIComponent(np)).then(j=>msg(j.msg||''));}
function resetPassword(){let u=document.getElementById('resetUser').value,p=document.getElementById('resetPwd').value;if(!u||!p){msg('请填写账号和新密码');return;}apiPost('/api/admin/reset_pwd','username='+encodeURIComponent(u)+'&pwd='+encodeURIComponent(p)).then(j=>msg(j.msg||''));}

function loadLogs(){
  fetch(api+'/api/admin/logs').then(r=>r.json()).then(j=>{
    let lf=document.getElementById('logfiles');lf.innerHTML='<h3 style="color:#7fd0ff">日志文件:</h3>';
    (j.files||[]).forEach(f=>{let b=document.createElement('button');b.textContent=f;b.onclick=()=>viewLog(f);lf.appendChild(b);});
    let rl=document.getElementById('recentLogs');rl.innerHTML=(j.recent||[]).map(x=>'<div>'+esc(x)+'</div>').join('');
  });
}
function viewLog(name){fetch(api+'/api/admin/logfile?name='+encodeURIComponent(name)).then(r=>r.text()).then(t=>{document.getElementById('recentLogs').innerHTML=t.split('\n').map(x=>'<div>'+esc(x)+'</div>').join('');});}
</script></body></html>
)raw";

