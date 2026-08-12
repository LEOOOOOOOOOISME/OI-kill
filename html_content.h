#pragma once
#include <string>

// ==================== 登录页 ====================
const std::string LOGIN_HTML = R"raw(<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OI杀 - 登录</title>
<style>
body{background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);color:#e0f0ff;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
.card{background:rgba(20,30,45,.92);border:1px solid #3b5e8c;border-radius:14px;padding:36px;width:340px;text-align:center;box-shadow:0 0 30px rgba(0,200,255,.15);}
h1{color:#ffd700;letter-spacing:2px;margin-bottom:4px;}
.tag{color:#7fd0ff;font-size:.85em;margin-bottom:18px;}
input{width:100%;background:#0f1a28;border:1px solid #355;color:#e0f0ff;padding:11px;margin:7px 0;border-radius:6px;font-family:monospace;box-sizing:border-box;}
.btn{width:100%;background:#1f6fb0;color:#fff;border:none;padding:12px;margin:6px 0;border-radius:6px;cursor:pointer;font-family:monospace;font-size:1em;}
.btn:hover{background:#2a8edb;}
.btn.secondary{background:#1f4a6b;}
.switch{margin-top:14px;color:#9fc0dd;font-size:.85em;}
.switch a{color:#ffd700;cursor:pointer;text-decoration:underline;}
.msg{color:#ff6b6b;min-height:18px;font-size:.85em;margin-top:8px;}
</style></head><body>
<div class="card">
<h1>OI杀</h1>
<div class="tag">OI KILL 竞争向桌游</div>
<input id="u" placeholder="用户名" maxlength="20" autocomplete="username"><input id="p" type="password" placeholder="密码" maxlength="32" autocomplete="current-password">
<div id="msg" class="msg"></div>
<button class="btn" onclick="doLogin()">登 录</button>
<button class="btn secondary" onclick="doRegister()">注 册</button>
<div class="switch">没有账号? 点上方"注 册"创建</div>
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
*{box-sizing:border-box;}
body{background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);color:#e0f0ff;font-family:'Courier New',monospace;margin:0;min-height:100vh;}
.top{background:rgba(10,18,30,.9);padding:10px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2e4a6b;}
.top h2{color:#ffd700;margin:0;}
.user{font-size:.9em;color:#9fc0dd;}
.user b{color:#ffd700;}
.lobby{max-width:1000px;margin:24px auto;padding:0 16px;}
.panel{background:rgba(20,30,45,.9);border-radius:12px;padding:20px;margin-bottom:18px;border:1px solid #3b5e8c;}
.panel h3{margin:0 0 14px;color:#7fd0ff;border-bottom:1px solid #2e4a6b;padding-bottom:8px;}
input,select,button{font-family:monospace;}
button{cursor:pointer;}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0;}
.inp{background:#0f1a28;border:1px solid #355;color:#e0f0ff;padding:9px;border-radius:6px;}
.btn{background:#1f6fb0;color:#fff;border:none;padding:9px 14px;border-radius:6px;font-family:monospace;}
.btn:hover{background:#2a8edb;}
.btn.red{background:#a03;}.btn.red:hover{background:#c04;}
.btn.green{background:#1e8a5a;}.btn.green:hover{background:#24ab70;}
.btn.gold{background:#b8860b;}.btn.gold:hover{background:#d39e1a;}
table{width:100%;border-collapse:collapse;margin-top:8px;}
td,th{padding:9px;border-bottom:1px solid #2e4a6b;font-size:.9em;text-align:left;}
tr:hover{background:rgba(50,90,130,.15);}
.pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.78em;}
.pub{background:#1e8a5a;}.priv{background:#b8860b;}
.empty{color:#6b8db3;text-align:center;padding:18px;}

/* 游戏区 */
#game{display:none;}
#board{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;padding:14px;}
.player-slot{background:rgba(20,30,45,.92);border:1px solid #355;border-radius:12px;padding:12px;width:200px;text-align:center;cursor:pointer;position:relative;}
.player-slot.active{box-shadow:0 0 14px #2a9d6f;border-color:#2a9d6f;}
.player-slot.dead{opacity:.45;filter:grayscale(1);}
.pname{font-weight:bold;font-size:1.05em;}
.hp{color:#ff6b6b;}
.eq{font-size:.8em;color:#9fc0dd;min-height:14px;}
#my-hand{background:rgba(13,21,33,.95);padding:12px;display:flex;gap:8px;overflow-x:auto;min-height:110px;margin:10px 0;}
.card{background:#1e3048;border:2px solid #3b5e8c;border-radius:6px;width:85px;min-width:85px;padding:6px;cursor:pointer;text-align:center;transition:transform .12s;position:relative;}
.card.red{border-color:#c0392b;}.card.black{border-color:#2c3e50;}
.card.evolved{border-color:gold;box-shadow:0 0 10px gold;}
.card:hover{transform:scale(1.08);}
.card.sel{border-color:#ffd700;outline:2px solid #ffd700;}
#prompt{background:#11203a;padding:12px;margin:8px;border-radius:8px;min-height:44px;text-align:center;}
#log{background:#0a101c;padding:10px;height:130px;overflow-y:auto;font-size:.82em;border-top:1px solid #2e4a6b;}
#log div{border-bottom:1px dashed #1a2a42;padding:2px 0;}
#event-bar{background:#131b2e;padding:9px;text-align:center;font-size:1.15em;border-bottom:1px solid #2e3e5c;color:#ffd700;}
.notice{color:#6bdb9f;font-size:.85em;margin-top:8px;}
.chatbox{display:flex;flex-direction:column;}
.chatlines{background:#0a101c;height:120px;overflow-y:auto;font-size:.82em;border:1px solid #2e4a6b;border-radius:6px;padding:6px;margin-top:6px;}
.chatlines div{border-bottom:1px dashed #1a2a42;padding:2px 0;word-break:break-all;}
.chatlines .me{color:#7fd0ff;}
.chatlines .sys{color:#ffd700;}
.chatinput{display:flex;gap:6px;margin-top:6px;}
.chatinput input{flex:1;background:#0f1a28;border:1px solid #355;color:#e0f0ff;padding:8px;border-radius:6px;font-family:monospace;}
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
  </div>
</div>

<!-- 游戏 -->
<div id="game">
  <div id="event-bar"></div>
  <div id="board"></div>
  <div id="my-hand"></div>
  <div id="prompt"></div>
  <div style="text-align:center;padding:6px">
    <button class="btn green" onclick="skipPhase()">结束出牌</button>
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
let state={},selectedCard=null,selectedTarget=null,ws=null,key='',uname='';
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
  .then(r=>r.json()).then(j=>{ if(j.ok){alert('创建成功 房间#'+j.room_id+'! 已自动加入');loadLobby();} else alert(j.msg||'创建失败'); })
  .catch(()=>{alert('网络错误, 请重试');});
}

function joinRoom(id){
  let pwd=prompt('输入房间密码(无密码留空):');
  if(pwd===null)return;
  fetch(api+'/api/join_room',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'room_id='+id+'&pwd='+encodeURIComponent(pwd||'')})
  .then(r=>r.json()).then(j=>{ if(j.ok){alert('加入成功 房间#'+id+'!');startGame();} else alert(j.msg||'加入失败'); })
  .catch(()=>{alert('网络错误, 请重试');});
}

let inGame=false,chatJoined={lobby:false,room:false};
function startGame(){
  document.getElementById('lobby').style.display='none';
  document.getElementById('game').style.display='block';
  inGame=true;
  if(ws&&ws.readyState===1){ send({type:'join_room'}); }
  else connectWS(true);
}

function connectWS(join){
  let proto=location.protocol==='https:'?'wss://':'ws://';
  ws=new WebSocket(proto+location.host+'/ws');
  ws.onopen=()=>{ if(join) send({type:'join_room'}); };
  ws.onmessage=ev=>{
    try{
      let data=JSON.parse(dec(ev.data));
      if(data.type==='state'){ state=data; render(); }
      else if(data.type==='chat'){ appendChat(data); }
      else if(data.type==='error'){ alert(data.msg); }
      else if(data.type==='end'){ inGame=false; alert(data.msg); }
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
  div.textContent=m.from+'：'+m.text;
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
  // 若对应聊天区未显示过, 记首次标识
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
  document.getElementById('event-bar').textContent='事件: '+(state.event||'无')+(state.game_over?' | '+state.winner:'');
  let board='';
  state.players.forEach(p=>{
    let cls='player-slot'+(p.id==state.current_turn?' active':'')+(p.alive?'':' dead');
    let eq=(p.weapon?esc(p.weapon)+' ':'')+(p.armor?esc(p.armor):'');
    board+='<div class="'+cls+'" onclick="pickTarget('+p.id+')">'+
      '<div class="pname">'+esc(p.name)+'</div><div>'+esc(p.profession)+'</div>'+
      '<div class="hp">'+p.hp+'/'+p.max_hp+'</div>'+
      '<div class="eq" style="min-height:16px">'+eq+'</div>'+
      '<div>手牌:'+p.hand_count+' '+(p.identity==='?'?'?':esc(p.identity))+(p.awakened?' 【觉醒】':'')+
      (p.depression?' 颓废x'+p.depression:'')+'</div></div>';
  });
  document.getElementById('board').innerHTML=board;
  let hand='';
  if(state.my_hand&&state.my_hand.length){
    state.my_hand.forEach((c,i)=>{
      let cls='card '+(c.suit==='heart'||c.suit==='diamond'?'red':'black')+(c.evolved?' evolved':'')+(selectedCard===i?' sel':'');
      hand+='<div class="'+cls+'" onclick="pickCard('+i+')">'+esc(c.name)+'<br>'+esc(c.suit)+''+esc(c.number)+'</div>';
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
    else p='等待响应...';
    pd.innerHTML=p;
  } else pd.innerHTML='';
  let lg=document.getElementById('log');lg.innerHTML=(state.log||[]).map(l=>'<div>'+esc(l)+'</div>').join('');lg.scrollTop=lg.scrollHeight;
}
function pickCard(i){ if(selectedCard===i){selectedCard=null;render();return;} selectedCard=i; if(selectedTarget!==null)playAutomatically(); render(); }
function pickTarget(id){ if(state.pending&&state.pending.type==='WAIT_O2_TARGET'){send({type:'response',targets:[id]});return;} selectedTarget=id; if(selectedCard!==null)playAutomatically(); }
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
*{box-sizing:border-box;}
body{background:linear-gradient(135deg,#111,#1a1a2e);color:#eee;font-family:'Courier New',monospace;margin:0;padding:20px;}
h1{color:#ffd700;border-bottom:2px solid #ffd700;padding-bottom:8px;}
h2{color:#7fd0ff;margin-top:24px;}
.tabs{display:flex;gap:8px;margin:14px 0;}
.tab{background:#0f3460;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-family:monospace;}
.tab.on{background:#ffd700;color:#111;}
.section{display:none;}
.section.on{display:block;}
.panel{background:#16213e;border-radius:8px;padding:16px;margin:10px 0;border:1px solid #2a3a6b;}
button{background:#0f3460;color:white;border:none;padding:8px 14px;border-radius:5px;cursor:pointer;font-family:monospace;margin:3px;}
button.green{background:#1e8a5a;}button.red{background:#a03;}button.gold{background:#b8860b;}
input,select{background:#0a1428;border:1px solid #355;color:#eee;padding:7px;border-radius:4px;font-family:monospace;margin:3px;}
table{width:100%;border-collapse:collapse;margin-top:8px;}
td,th{padding:8px;border-bottom:1px solid #2a3a6b;text-align:left;font-size:.9em;}
.badge{display:inline-block;padding:2px 8px;border-radius:8px;font-size:.78em;}
.b-ad{background:#1e8a5a;}.b-u{background:#0f3460;}
.banned{color:#ff6b6b;}
.msg{color:#6bdb9f;font-size:.85em;min-height:18px;}
.logbox{background:#0a101c;padding:12px;height:300px;overflow-y:auto;font-size:.82em;border:1px solid #2a3a6b;border-radius:6px;}
.logbox div{border-bottom:1px dashed #1a2a42;padding:2px 0;}
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
let meRole='';
let api=location.protocol+'//'+location.host;
function apiPost(url,body){return fetch(api+url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body}).then(r=>r.json());}
window.addEventListener('load',()=>{
  fetch(api+'/api/me').then(r=>r.json()).then(j=>{
    if(!j.ok){location.href='/login';return;} meRole=j.role;
    document.getElementById('me').innerHTML='当前账号: <b>'+esc(j.username)+'</b> ('+roleName(j.role)+') <button class="red" onclick="location.href='/logout'">退出</button>';
    if(j.role==='user'){alert('仅管理员可访问此页面');location.href='/';return;}
    loadRooms();loadUsers();loadLogs();
  });
});
function showTab(name,btn){document.querySelectorAll('.section').forEach(s=>s.classList.remove('on'));document.getElementById('section-'+name).classList.add('on');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));btn.classList.add('on');}
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function roleName(r){return (r==='admin'||r==='superadmin')?'管理员':'玩家';}
function roleBadge(r){return r==='user'?'<span class="badge b-u">玩家</span>':'<span class="badge b-ad">管理员</span>';}
function msg(x){document.getElementById('opmsg').textContent=x;}

function createRoom(){
  let name=document.getElementById('name').value.trim(),pwd=document.getElementById('pwd').value;
  let pub=document.getElementById('pub').value==='public',num=document.getElementById('num').value;
  if(name.length>16){alert('房间名称过长');return;}
  apiPost('/api/create_room','num='+num+'&pub='+pub+'&pwd='+encodeURIComponent(pwd)+'&name='+encodeURIComponent(name)).then(j=>{alert(j.ok?('创建成功 #'+j.room_id):j.msg);loadRooms();});
}
function loadRooms(){
  fetch(api+'/api/admin/rooms').then(r=>r.json()).then(j=>{
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
  });
}
function closeRoom(id){apiPost('/api/admin/close_room','room_id='+id).then(()=>loadRooms());}
function changePub(id,pub){apiPost('/api/admin/set_public','room_id='+id+'&pub='+(pub?1:0)).then(()=>loadRooms());}
function setLimit(id){let n=prompt('新人数(3-9)');if(n)apiPost('/api/admin/set_limit','room_id='+id+'&limit='+n).then(()=>loadRooms());}

function loadUsers(){
  fetch(api+'/api/admin/users').then(r=>r.json()).then(j=>{
    let tb=document.getElementById('usersTab');
    tb.innerHTML='<tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>对局</th><th>胜场</th><th>操作</th></tr>';
    (j.users||[]).forEach(u=>{
      let tr=document.createElement('tr');
      tr.className=u.banned?'banned':'';
      tr.innerHTML='<td>'+esc(u.id)+'</td><td>'+esc(u.username)+'</td><td>'+roleBadge(u.role)+'</td><td>'+(u.banned?'被封禁':'正常')+'</td><td>'+esc(u.gamesPlayed)+'</td><td>'+esc(u.gamesWon)+'</td>'+
        '<td class="btnrow">'+
        '<button class="'+(u.banned?'green':'red')+'" onclick="toggleBan('+esc(u.id)+','+(u.banned?0:1)+')">'+(u.banned?'解封':'封禁')+'</button>'+
        '<button class="gold" onclick="promptReset('+esc(u.id)+')">重置密码</button></td>';
      tb.appendChild(tr);
    });
  });
}
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

