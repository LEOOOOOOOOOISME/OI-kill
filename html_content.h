#pragma once
#include <string>

// ==================== 登录页 ====================
const std::string LOGIN_HTML = R"raw(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OI杀 - 登录</title>
<style>
:root{
  --bg0:#0b1023;--bg1:#161b36;--bg2:#1e2449;--ink:#e8ecfb;--mut:#9aa7d8;
  --acc:#ffce54;--acc2:#5eead4;--line:#2c3463;--red:#ff5c7a;--grn:#34d399;
}
*{box-sizing:border-box;}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, rgba(94,120,255,.25), transparent 60%),
    radial-gradient(900px 520px at 110% 110%, rgba(255,206,84,.16), transparent 55%),
    linear-gradient(160deg,var(--bg0),#0d1228 45%,#101735);
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
  background:linear-gradient(135deg,rgba(255,206,84,.55),transparent 40%,transparent 60%,rgba(94,234,213,.5));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
.logo{width:72px;height:72px;margin:0 auto 12px;border-radius:18px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#ffce54,#ff9a3c);box-shadow:0 10px 26px rgba(255,180,60,.35);font-weight:800;font-size:34px;color:#241800;}
h1{margin:6px 0 2px;font-size:30px;letter-spacing:6px;font-weight:800;color:#fff;
  text-shadow:0 2px 12px rgba(255,206,84,.35);}
.tag{color:#aebdf2;font-size:.82rem;letter-spacing:2px;margin:0 0 22px;text-transform:uppercase;}
.field{position:relative;margin:10px 0;}
.field input{display:block;width:100%;background:rgba(10,13,30,.7);border:1px solid var(--line);color:var(--ink);
  padding:13px 14px;border-radius:12px;font-size:.95rem;outline:none;transition:border-color .2s,box-shadow .2s;}
.field input:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(255,206,84,.16);}
.btn{width:100%;border:none;border-radius:12px;padding:13px;font-size:.98rem;font-weight:700;cursor:pointer;
  transition:transform .12s,box-shadow .2s,filter .2s;margin-top:10px;background:#f8fafc;color:#151a38;
  box-shadow:0 8px 22px rgba(255,206,84,.28);}
.btn:hover{transform:translateY(-2px);filter:brightness(1.05);}
.btn.secondary{margin-top:8px;background:transparent;color:#c7d2fe;border:1px solid var(--line);box-shadow:none;}
.btn.secondary:hover{border-color:var(--acc2);color:#fff;}
.switch{margin-top:16px;color:#8b99d8;font-size:.82rem;}
.switch a{color:#ffce54;cursor:pointer;text-decoration:none;font-weight:600;}
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
<div class="switch">没有账号? 填写上方信息后点击 <b>注册</b> 即可创建</div>
</div>
<script>
let api=(location.protocol==='https:'?'https://':'http://')+location.host;
function safe(s){return s==null?'':String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
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
  --acc:#ffce54;--acc2:#5eead4;--line:#2c3463;--red:#ff5c7a;--grn:#34d399;
}
*{box-sizing:border-box;}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, rgba(94,120,255,.18), transparent 60%),
    radial-gradient(900px 520px at 110% 110%, rgba(255,206,84,.12), transparent 55%),
    linear-gradient(160deg,var(--bg0),#0d1228 45%,#101735);
  color:var(--ink);font-family:'Segoe UI',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  margin:0;min-height:100vh;background-attachment:fixed;}
.top{background:rgba(13,17,40,.85);padding:12px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);backdrop-filter:blur(10px);position:sticky;top:0;z-index:50;}
.top h2{margin:0;font-size:22px;letter-spacing:4px;color:#fff;text-shadow:0 2px 10px rgba(255,206,84,.3);}
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
.btn:hover{transform:translateY(-1px);filter:brightness(1.06);box-shadow:0 6px 16px rgba(255,206,84,.25);}
.btn.red{background:var(--red);color:#fff;}.btn.red:hover{box-shadow:0 6px 16px rgba(255,92,122,.3);}
.btn.green{background:var(--grn);color:#06281c;}.btn.green:hover{box-shadow:0 6px 16px rgba(52,211,153,.3);}
.btn.gold{background:linear-gradient(135deg,#ffce54,#ff9a3c);color:#241800;}.btn.gold:hover{box-shadow:0 6px 16px rgba(255,170,60,.35);}
table{width:100%;border-collapse:collapse;margin-top:8px;}
td,th{padding:11px;border-bottom:1px solid var(--line);font-size:.9em;text-align:left;}
th{color:#8b99d8;font-weight:600;font-size:.82em;letter-spacing:1px;text-transform:uppercase;}
tr:hover{background:rgba(120,140,255,.07);}
.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.76em;font-weight:700;}
.pub{background:rgba(52,211,153,.15);color:#5eead4;border:1px solid rgba(52,211,153,.35);}
.priv{background:rgba(255,206,84,.12);color:#ffce54;border:1px solid rgba(255,206,84,.35);}
.empty{color:#6b7fb5;text-align:center;padding:20px;}

/* 游戏区 */
#game{display:none;}
#board{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;padding:20px;}
.player-slot{background:linear-gradient(160deg,rgba(30,38,74,.95),rgba(16,20,44,.97));border:1px solid var(--line);border-radius:18px;padding:16px 12px;width:196px;text-align:center;cursor:pointer;position:relative;transition:transform .18s,box-shadow .18s,border-color .18s;}
.player-slot:hover{transform:translateY(-4px);box-shadow:0 14px 30px rgba(0,0,0,.45),0 0 0 1px rgba(120,140,255,.25);}
.player-slot.active{border-color:var(--grn);box-shadow:0 0 22px rgba(52,211,153,.25),0 10px 24px rgba(0,0,0,.4);}
.player-slot.me{border-color:var(--acc);box-shadow:0 0 18px rgba(255,206,84,.18);}
.player-slot.dead{opacity:.45;filter:grayscale(1);}
.pname{font-weight:800;font-size:1.08em;color:#fff;}
.me-tag{color:var(--acc2);font-size:.72em;border:1px solid var(--acc2);border-radius:6px;padding:1px 6px;margin-left:4px;}
.pclass{font-size:.82em;color:var(--mut);margin:3px 0;}
.hp{color:var(--red);font-weight:800;}
.eq{font-size:.76em;color:#c3b8ff;min-height:16px;margin-top:4px;}
.eitem{margin-right:4px;display:inline-block;}
.pinfo{font-size:.76em;color:var(--mut);margin-top:4px;}
.targetmark{position:absolute;top:8px;right:10px;font-size:1.15em;}
#my-hand{background:rgba(8,12,30,.9);padding:16px 12px;display:flex;gap:12px;overflow-x:auto;min-height:132px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);}
.card{background:linear-gradient(165deg,#232b56,#151a38);border:2px solid #4a5aa8;border-radius:12px;width:92px;min-width:92px;padding:9px 5px;cursor:pointer;text-align:center;transition:transform .15s,box-shadow .15s;position:relative;color:var(--ink);box-shadow:0 4px 12px rgba(0,0,0,.35);}
.card.red{border-color:#d9534f;background:linear-gradient(165deg,#4a2430,#2c1520);}
.card.black{border-color:#4a5aa8;}
.card.evolved{border-color:var(--acc);box-shadow:0 0 14px rgba(255,206,84,.55);}
.card:hover{transform:translateY(-7px);box-shadow:0 14px 26px rgba(0,0,0,.55);}
.card.sel{border-color:var(--acc);outline:2px solid var(--acc);transform:translateY(-9px);box-shadow:0 0 18px rgba(255,206,84,.4);}
.cnum{font-size:.76em;color:var(--mut);}
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
</style></head><body>
<div class="top"><h2>OI杀</h2><div class="user">账号: <b id="uname">-</b> <span id="role"></span> <button class="btn" onclick="logout()">退出</button></div></div>

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
        <input id="newPwd" class="inp" placeholder="房间密码(私密可留空)" maxlength="16" style="width:170px">
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
      <h3 style="cursor:pointer" onclick="toggleHelp()">📖 玩法提示 <span style="float:right">▾</span></h3>
      <div id="helpBody" style="font-size:.86em;color:var(--mut);line-height:1.7;">
        <b style="color:#c9d4ff">目标：</b>击败敌对阵营。<b style="color:#c9d4ff">Au选手(主公)</b>与<b style="color:#c9d4ff">Ag选手</b>要消灭<b style="color:#ff8ba0">反贼</b>；<b style="color:#ffce54">摸鱼怪(内奸)</b>要活到最后。<br>
        <b style="color:#c9d4ff">回合流程：</b>摸牌(2张) → 出牌(AC攻击/功能牌/装备) → 弃牌至体力值。<br>
        <b style="color:#c9d4ff">基本牌：</b>AC代码=攻击(可被WA闪避)、WA=闪避、RE=回复1体力。<br>
        <b style="color:#c9d4ff">出牌：</b>点击一张手牌选中，再点击一名玩家作为目标；装备牌点击即装备。<br>
        <b style="color:#c9d4ff">进化：</b>攻击命中/成功闪避等会获得进化机会，可把基础牌升级为更强效果。<br>
        <b style="color:#c9d4ff">评测机事件：</b>每轮随机触发，毒瘤(AC伤害-1无视WA)/暴力(AC伤害+1但自损1)/慈善(AC不限次数)/随机(AC目标判定)。<br>
        <b style="color:#c9d4ff">觉醒：</b>满足条件时职业觉醒，获得强力一次性效果（界面会显示✨已觉醒）。<br>
        <b style="color:#c9d4ff">注意：</b>房间<b style="color:#ffce54">满员后</b>对局才正式开始；中途退出会重置槽位。<br>
      </div>
    </div>
  </div>
</div>

<!-- 游戏 -->
<div id="game">
  <div id="event-bar"></div>
  <div id="skillinfo" style="padding:6px 14px;background:rgba(20,26,58,.7);border-bottom:1px solid var(--line);font-size:.82em;color:var(--mut);"></div>
  <div id="board"></div>
  <div id="my-hand"></div>
  <div id="prompt"></div>
  <div id="gamebtns">
    <button class="btn green" onclick="skipPhase()">结束出牌</button>
    <button class="btn gold" id="btnAkioi" style="display:none" onclick="useSkill('akioi')">AKIOI</button>
    <button class="btn gold" id="btnChuYuanTi" style="display:none" onclick="startSkillTarget('chuyuanti')">出原题</button>
    <button class="btn gold" id="btnZhiBo" style="display:none" onclick="startSkillTarget('zhibo')">直播</button>
    <button class="btn red" onclick="leaveRoom()">退出房间</button>
  </div>
  <div id="log"></div>
  <div class="panel chatbox" style="margin:8px;">
    <h3 style="font-size:1em;margin:0 0 4px">游戏内消息</h3>
    <div class="chatlines" id="roomChat"></div>
    <div class="chatinput">
      <input id="roomChatInput" placeholder="发送游戏内消息..." maxlength="200" onkeydown="if(event.key==='Enter')sendChat('room')">
      <button class="btn green" onclick="sendChat('room')">发送</button>
    </div>
  </div>
</div>

<script>
let state={},selectedCard=null,selectedTarget=null,ws=null,key='',uname='',myId=-1;
let api=location.protocol+'//'+location.host;
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// 角色显示: 不区分 superadmin, 仅显示 "管理员" 或 "玩家"
function roleName(r){return (r==='admin'||r==='superadmin')?'管理员':'玩家';}

window.addEventListener('load',()=>{
  fetch(api+'/api/me').then(r=>r.json()).then(j=>{
    if(!j.ok){alert(j.msg||'未登录');location.href='/login';return;}
    uname=j.username; document.getElementById('uname').textContent=uname;
    let rl=document.createElement('span');rl.textContent='('+roleName(j.role)+')';document.getElementById('role').appendChild(rl);
    if(j.role==='admin'||j.role==='superadmin'){let b=document.createElement('button');b.className='btn';b.textContent='管理后台';b.onclick=()=>window.open('/admin');document.getElementById('role').appendChild(b);}
    key=j.key||'';
    loadLobby();
    connectWS(false); // 大厅也建立连接以接收大厅消息, 但暂不加入房间
  }).catch(()=>{location.href='/login';});
});

function logout(){ fetch(api+'/api/logout').then(()=>location.href='/login'); }
function toggleHelp(){ let b=document.getElementById('helpBody'); if(b){ b.style.display = (b.style.display==='none')?'':'none'; } }

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
        '<td><button class="btn green" onclick="joinRoom('+esc(r.id)+')">加入</button></td>';
      tb.appendChild(tr);
    });
  }).catch(()=>{});
}

function createRoom(){
  let name=document.getElementById('newName').value.trim();
  let num=parseInt(document.getElementById('newNum').value);
  let pub=document.getElementById('newPub').value==='public';
  let pwd=document.getElementById('newPwd').value;
  if(name.length>16){alert('房间名称过长');return;}
  fetch(api+'/api/create_room',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'name='+encodeURIComponent(name)+'&num='+num+'&pub='+pub+'&pwd='+encodeURIComponent(pwd)})
  .then(r=>r.json()).then(j=>{ if(j.ok){enterRoom(j.room_id);} else alert(j.msg||'创建失败'); })
  .catch(()=>{alert('网络错误, 请重试');});
}

function joinRoom(id){
  let pwd=prompt('输入房间密码(无密码留空):');
  if(pwd===null)return;
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
      else if(data.type==='end'){ inGame=false; } // 已退出房间, leaveRoom() 已处理界面切换, 不再弹窗
    }catch(e){}
  };
  ws.onclose=()=>{ ws=null; if(inGame||document.getElementById('game').style.display==='block'){ setTimeout(()=>connectWS(true),2000); }
     else if(document.getElementById('lobby').style.display!=='none'){ setTimeout(()=>connectWS(false),2000); } };
}

// 聊天消息展示 (含 XSS 转义)
function appendChat(m){
  let box = m.scope==='room' ? document.getElementById('roomChat') : document.getElementById('lobbyChat');
  if(!box) return;
  let who = m.from===uname ? 'me' : '';
  let div=document.createElement('div');
  div.className=who;
  div.innerHTML='<span class="who">'+esc(m.from)+'：</span>'+esc(m.text);
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
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
  let ev='事件: '+(state.event||'无');
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
      '<div class="hp">'+(p.alive?('❤️'+p.hp+'/'+p.max_hp):'💀 阵亡')+'</div>'+
      '<div class="eq">'+eq+'</div>'+
      '<div class="pinfo">手牌:'+p.hand_count+(p.awakened?' ·觉醒':'')+(p.depression?' ·颓废x'+p.depression:'')+'</div>'+
      (state.game_over?'':'<div class="targetmark">'+(state.target_mark&&state.target_mark===p.id?'🎯':'')+'</div>')+
      '</div>';
  });
  document.getElementById('board').innerHTML=board;
  let hand='';
  if(state.my_hand&&state.my_hand.length){
    state.my_hand.forEach((c,i)=>{
      let cls='card '+(c.suit==='heart'||c.suit==='diamond'?'red':'black')+(c.evolved?' evolved':'')+(selectedCard===i?' sel':'');
      hand+='<div class="'+cls+'" onclick="pickCard('+i+')">'+esc(c.name)+'<br><span class="cnum">'+esc(c.suit)+''+esc(c.number)+'</span></div>';
    });
  }
  document.getElementById('my-hand').innerHTML=hand||'<div style="color:#6b8db3;align-self:center">(空手牌)</div>';
  let pd=document.getElementById('prompt');
  if(state.pending){
    let t=state.pending.type,p='';
    if(t==='response_wa'){ p='请打出【WA】应答: '+state.pending.valid_cards.map(i=>'<button class="btn" onclick="respond('+i+')">手牌'+i+'</button>').join('')+' <button class="btn red" onclick="respond(-1)">放弃</button>'; }
    else if(t==='evolution_select'){ p='选择进化: '+state.pending.context.candidates.map(c=>'<button class="btn gold" onclick="evoSelect('+c.id+')">'+esc(c.name)+'→'+esc(c.evo)+'</button>').join(''); }
    else if(t==='WAIT_O2_CARD'){ p='使用AC代码: '+state.pending.valid_cards.map(i=>'<button class="btn" onclick="respond('+i+')">手牌'+i+'</button>').join(''); }
    else if(t==='WAIT_O2_TARGET'){ p='O3优化! 选择攻击目标(点击玩家)'; selectedTarget=null; }
    else if(t==='WAIT_LIVE_TARGET'){ p='选择要偷取的手牌: 请点击目标玩家的手牌区域'; }
    else if(t==='WAIT_DUEL_SELF'){ p='出AC! 请打出AC代码: '+state.pending.valid_cards.map(i=>'<button class="btn" onclick="respond('+i+')">手牌'+i+'</button>').join(''); }
    else if(t==='WAIT_EXAM_AC'){ p='模拟赛！请打出AC代码应对: '+state.pending.valid_cards.map(i=>'<button class="btn" onclick="respond('+i+')">手牌'+i+'</button>').join('')+' <button class="btn red" onclick="respond(-1)">放弃(受1伤)</button>'; }
    else if(t==='WAIT_JUDGE_COLOR'){ p='手动测评：将下一次判定花色强制为 <button class="btn" onclick="judgeColor(\'red\')">红色</button> <button class="btn" onclick="judgeColor(\'black\')">黑色</button>'; }
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
  let me=state.players&&state.players[myId]?state.players[myId]:null;
  let ba=document.getElementById('btnAkioi'),by=document.getElementById('btnChuYuanTi'),bz=document.getElementById('btnZhiBo');
  if(ba)ba.style.display=(me&&me.profession==='神犇'&&me.alive&&!state.pending)?'':'none';
  if(by)by.style.display=(me&&me.profession==='毒瘤出题人'&&me.alive&&!state.pending)?'':'none';
  if(bz)bz.style.display=(me&&me.profession==='女装大佬'&&me.alive&&!state.pending)?'':'none';
  let lg=document.getElementById('log');lg.innerHTML=(state.log||[]).map(l=>'<div>'+esc(l)+'</div>').join('');lg.scrollTop=lg.scrollHeight;
  // 职业技能提示
  let skills={
    '萌新':'被动·问问题(成为目标摸1)·觉醒:我还能学!',
    '蒟蒻':'被动·抱大腿·主动·退役(濒死自救)·觉醒:退役是不可能的',
    '划水怪':'被动·随缘·主动·摸鱼·觉醒:终极摸鱼',
    '神犇':'被动·碾压·主动·AKIOI(弃2牌多出2杀)·觉醒:AK全场',
    '毒瘤出题人':'被动·卡常·主动·出原题(弃2同花色)·觉醒:全员卡常',
    '退役选手':'被动·回忆·主动·挣扎·觉醒:老兵不死',
    '金牌教练':'被动·集训·主动·谈心·专属·模拟赛·觉醒:名师出高徒',
    '女装大佬':'被动·女装·主动·直播·专属·女装直播·觉醒:公开处刑',
    '传奇Au选手':'被动·不败·主动·封神·觉醒:传奇不朽'
  };
  let si=document.getElementById('skillinfo');
  if(si&&me&&skills[me.profession]){ si.innerHTML='<b>'+esc(me.profession)+'</b> — '+esc(skills[me.profession])+(me.awakened?' <span style="color:var(--acc)">✨已觉醒</span>':''); }
}
let skillTargetMode=null;
function useSkill(skill){ send({type:'use_skill',skill:skill}); }
function startSkillTarget(skill){ skillTargetMode=skill; document.getElementById('prompt').innerHTML='<div class="ptitle">🎯 '+ (skill==='chuyuanti'?'出原题：点击一名玩家作为目标':'选择目标') +'</div>'; render(); }
function judgeColor(c){ send({type:'response',color:c}); }
function depression(c){ send({type:'response',choice:c}); }
function pickCard(i){ if(selectedCard===i){selectedCard=null;render();return;} selectedCard=i; if(selectedTarget!==null)playAutomatically(); render(); }
function pickTarget(id){
  if(skillTargetMode){ send({type:'use_skill',skill:skillTargetMode,targets:[id]}); skillTargetMode=null; render(); return; }
  if(state.pending&&state.pending.type==='WAIT_O2_TARGET'){send({type:'response',targets:[id]});return;}
  selectedTarget=id; if(selectedCard!==null)playAutomatically(); }
function playAutomatically(){
  if(selectedTarget===null)return;
  if(state.pending&&state.pending.type==='WAIT_LIVE_TARGET'){ send({type:'response',card_index:selectedCard}); }
  else send({type:'use_card',card_index:selectedCard,targets:[selectedTarget]});
  selectedCard=null;selectedTarget=null;render();
}
function send(obj){ if(ws&&ws.readyState===1) ws.send(enc(JSON.stringify(obj))); }
function respond(idx){ send({type:'response',card_index:idx}); }
function evoSelect(id){ send({type:'response',evo_card_id:id}); }
function skipPhase(){ send({type:'skip_phase'}); }
function leaveRoom(){
  send({type:'leave_room'});
  inGame=false;
  document.getElementById('game').style.display='none';
  document.getElementById('lobby').style.display='block';
  document.getElementById('roomChat').innerHTML='';
  loadLobby();
}
</script></body></html>
)raw";

// ==================== 管理页 ====================

const std::string ADMIN_HTML = R"raw(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OI杀 管理控制台</title>
<style>
:root{
  --bg0:#0b1023;--bg1:#161b36;--bg2:#1e2449;--ink:#e8ecfb;--mut:#9aa7d8;
  --acc:#ffce54;--acc2:#5eead4;--line:#2c3463;--red:#ff5c7a;--grn:#34d399;
}
*{box-sizing:border-box;}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, rgba(94,120,255,.18), transparent 60%),
    radial-gradient(900px 520px at 110% 110%, rgba(255,206,84,.12), transparent 55%),
    linear-gradient(160deg,var(--bg0),#0d1228 45%,#101735);
  color:var(--ink);font-family:'Segoe UI',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;padding:24px;min-height:100vh;background-attachment:fixed;}
h1{margin:4px 0 0;font-size:26px;letter-spacing:3px;color:#fff;text-shadow:0 2px 12px rgba(255,206,84,.3);}
h2{color:#c9d4ff;margin-top:6px;font-size:15px;letter-spacing:1px;font-weight:700;}
.tabs{display:flex;gap:8px;margin:16px 0;}
.tab{background:rgba(30,36,73,.85);color:#c9d4ff;border:1px solid var(--line);padding:11px 20px;border-radius:12px;cursor:pointer;font-weight:700;transition:all .15s;}
.tab:hover{border-color:var(--acc);}
.tab.on{background:linear-gradient(135deg,#ffce54,#ff9a3c);color:#241800;border-color:transparent;box-shadow:0 8px 20px rgba(255,170,60,.3);}
.section{display:none;}
.section.on{display:block;animation:fade .25s ease;}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.panel{background:linear-gradient(165deg,rgba(30,36,73,.9),rgba(18,22,49,.94));border-radius:16px;padding:20px;margin:14px 0;border:1px solid rgba(120,140,255,.18);box-shadow:0 14px 40px rgba(0,0,0,.35);}
button{background:rgba(120,140,255,.14);color:#dfe5ff;border:1px solid var(--line);padding:9px 16px;border-radius:10px;cursor:pointer;font-weight:600;transition:all .15s;margin:3px;}
button:hover{border-color:var(--acc);color:#fff;transform:translateY(-1px);}
button.green{background:rgba(52,211,153,.15);color:#5eead4;border-color:rgba(52,211,153,.35);}
button.red{background:rgba(255,92,122,.15);color:#ff8ba0;border-color:rgba(255,92,122,.4);}
button.gold{background:linear-gradient(135deg,#ffce54,#ff9a3c);color:#241800;border:none;}
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
  : r==='superadmin'?'<span class="badge b-ad" style="background:#d39e1a">超级管理员</span>'
  : '<span class="badge b-u">玩家</span>';}
function msg(x){document.getElementById('opmsg').textContent=x;}

function createRoom(){
  let name=document.getElementById('name').value.trim(),pwd=document.getElementById('pwd').value;
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

