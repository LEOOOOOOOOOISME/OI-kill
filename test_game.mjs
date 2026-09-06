// OI杀 自动化冒烟测试: 4 玩家开局 -> 自动走回合 -> 检测异常/卡死/状态错乱
// Node 24+ (全局 WebSocket/fetch)。运行: node test_game.mjs [迭代tick数]
const ITER = parseInt(process.argv[2] || '700', 10);
const BASE = 'http://localhost:8080';
const WS_URL = 'ws://localhost:8080';
const PWD = 'pass1234';
const SUF = Date.now().toString(36);
const NAMES = ['u'+SUF+'a','u'+SUF+'b','u'+SUF+'c','u'+SUF+'d'];

function xorEnc(json, key){ const b=Buffer.from(json,'utf8'), kb=Buffer.from(key,'utf8'); const o=Buffer.alloc(b.length); for(let i=0;i<b.length;i++) o[i]=b[i]^kb[i%kb.length]; return o.toString('base64'); }
function xorDec(b64, key){ const b=Buffer.from(b64,'base64'), kb=Buffer.from(key,'utf8'); const o=Buffer.alloc(b.length); for(let i=0;i<b.length;i++) o[i]=b[i]^kb[i%kb.length]; return o.toString('utf8'); }

async function api(path, method='GET', body=null, token=''){
  const h={ 'User-Agent':'tester' };
  if(token) h['Cookie']='session='+token;
  if(body) h['Content-Type']='application/x-www-form-urlencoded';
  const r = await fetch(BASE+path, { method, headers:h, body: body?new URLSearchParams(body).toString():undefined });
  return JSON.parse(await r.text());
}
async function register(name){ await api('/api/register','POST',{u:name,p:PWD}); }
async function login(name){ const j = await api('/api/login','POST',{u:name,p:PWD}); if(!j.ok) throw new Error('login fail '+name); return j.token; }
async function meKey(token){ const j = await api('/api/me','GET',null,token); return j.key; }

class Client {
  constructor(name, token, key){ this.name=name; this.token=token; this.key=key; this.state=null; this.errors=[]; this.states=0; this.ws=null; this.ready=false; }
  connect(){
    return new Promise((res, rej)=>{
      // Node/undici WebSocket 握手不带 URL query, 用 Cookie 头传 token
      this.ws = new WebSocket(WS_URL, { headers: { Cookie: 'session='+this.token } });
      this.ws.onopen = ()=>{ this.ready=true; res(); };
      this.ws.onerror = (e)=>{ rej(new Error(this.name+' ws error')); };
      this.ws.onmessage = (ev)=>{
        try {
          const txt = xorDec(ev.data, this.key);
          const j = JSON.parse(txt);
          if(j.type==='state'){ this.state = j; this.states++; }
          else if(j.type==='error'){ this.errors.push(j.msg||'err'); }
        } catch(e){ this.errors.push('parse:'+e.message); }
      };
      this.ws.onclose = ()=>{ this.ready=false; };
    });
  }
  send(obj){ if(this.ws && this.ws.readyState===1) this.ws.send(xorEnc(JSON.stringify(obj), this.key)); }
  joinRoom(){ this.send({type:'join_room'}); }
  play(cardIdx, targets){ this.send({type:'use_card', card_index:cardIdx, targets:targets||[]}); }
  respond(obj){ this.send(Object.assign({type:'response'}, obj)); }
  skip(){ this.send({type:'skip_phase'}); }
  close(){ try{ this.ws.close(); }catch(e){} }
}

async function main(){
  for(const n of NAMES) await register(n).catch(()=>{});
  const clients=[];
  for(const n of NAMES){ const tk = await login(n); const k = await meKey(tk); const c = new Client(n,tk,k); await c.connect(); clients.push(c); }
  const room = await api('/api/create_room','POST',{num:'4',pub:'1',name:'test'}, clients[0].token);
  if(!room.ok) throw new Error('create_room fail '+JSON.stringify(room));
  for(let i=1;i<4;i++){ const r = await api('/api/join_room','POST',{room_id:room.room_id}, clients[i].token); if(!r.ok) throw new Error('join fail '+JSON.stringify(r)); }
  await new Promise(r=>setTimeout(r,300));
  for(const c of clients) c.joinRoom();
  await new Promise(r=>setTimeout(r,1200));

  const sleep = ms=>new Promise(r=>setTimeout(r,ms));
  const pendSeen = new Map();        // 同一 pending 出现次数 (防重复响应)
  const handAtPlay = new Map();      // 最近 play 时的手牌签名 (静默失败检测)
  let noProgress = 0, lastLogTail = '', gameOver = null;

  for(let tick=0; tick<ITER; tick++){
    await sleep(400);
    let acted = false;
    for(const c of clients){
      const st = c.state; if(!st) continue;
      if(st.game_over && !gameOver) gameOver = {winner:st.winner, round:st.round};
      const hsig = (st.my_hand||[]).map(h=>h.name+'#'+h.index).join('|');
      // 静默失败检测: play 后 3 tick 手牌未变 -> 强制 skip
      if(handAtPlay.has(c.name)){
        const rec = handAtPlay.get(c.name);
        if(hsig !== rec.sig){ handAtPlay.delete(c.name); }
        else if(tick - rec.t > 3){ handAtPlay.delete(c.name); if(st.current_turn===st.my_id && st.phase===3){ c.skip(); acted=true; } }
      }
      // 1) 响应 pending
      if(st.pending){
        const p = st.pending, vc = p.valid_cards||[];
        const pk = c.name+':'+p.type;
        pendSeen.set(pk, (pendSeen.get(pk)||0)+1);
        if(pendSeen.get(pk) > 3){ if(!c.errors.includes('STUCK:'+p.type)) c.errors.push('STUCK:'+p.type); continue; }
        const R = o=>{ c.respond(o); return true; };
        switch(p.type){
          case 'response_wa': R(vc.length?{card_index:vc[0]}:{card_index:-2}); acted=true; break;
          case 'AOE_AC': case 'AOE_WA': R(vc.length?{card_index:vc[0]}:{card_index:-1}); acted=true; break;
          case 'WAIT_DEPRESSION': R({choice:'none'}); acted=true; break;
          case 'evolution_select': R({evo_card_id:(p.context&&p.context.candidates&&p.context.candidates.length)?p.context.candidates[0].id:-1}); acted=true; break;
          case 'WAIT_O2_CARD': R(vc.length?{card_index:vc[0]}:{card_index:-1}); acted=true; break;
          case 'WAIT_O2_TARGET': { const tg=st.can_attack_targets||[]; R(tg.length?{targets:[tg[0]]}:{targets:[]}); acted=true; break; }
          case 'WAIT_DUEL_SELF': case 'WAIT_DUEL_TARGET': R(vc.length?{card_index:vc[0]}:{card_index:-1}); acted=true; break;
          case 'WAIT_EXAM_AC': R(vc.length?{card_index:vc[0]}:{card_index:-1}); acted=true; break;
          case 'WAIT_JUDGE_COLOR': R({color:'red'}); acted=true; break;
          case 'WAIT_HARVEST': case 'WAIT_CHAOTIJIE': R({card_index:0}); acted=true; break;
          case 'WAIT_LIVE_TARGET': R({card_index:0}); acted=true; break;
          case 'WAIT_PUBLIC_EXEC': { const tg=(st.players||[]).find(p=>p.alive&&p.id!==st.my_id); R({targets:[tg?tg.id:0]}); acted=true; break; }
          case 'WAIT_AUDIT_REVEAL': R({card_index:0}); acted=true; break;
          case 'WAIT_TJ': R({card_index:-1}); acted=true; break;
          case 'WAIT_COLD_DATA': R({force:false}); acted=true; break;
          case 'WAIT_MODUI': R({force:false}); acted=true; break;
          case 'WAIT_SUIYUAN': R({choice:'suiyuan'}); acted=true; break;
          case 'WAIT_FORCE_HIT': case 'WAIT_BU_SI_XIN': R({force:false}); acted=true; break;
          case 'WAIT_DAIDANG_WA': R(vc.length?{card_index:vc[0]}:{card_index:-1}); acted=true; break;
          default: if(!c.errors.includes('unknown:'+p.type)) c.errors.push('unknown:'+p.type); break;
        }
        continue;
      }
      for(const k of [...pendSeen.keys()]) if(k.startsWith(c.name+':')) pendSeen.delete(k);
      // 2) 出牌阶段自动出牌
      if(st.current_turn===st.my_id && st.phase===3 && !st.pending && (st.players||[]).length>=4){
        const hand = st.my_hand||[]; const me = (st.players||[])[st.my_id];
        if(!handAtPlay.has(c.name)) handAtPlay.set(c.name, {sig: hsig, t: tick});
        let played=false;
        for(const card of hand){
          if(card.type>=3&&card.type<=6){ c.play(card.index, []); played=true; break; }
          if(card.name==='摸鱼'){ c.play(card.index, []); played=true; break; }
          if(card.name==='咖啡'){ c.play(card.index, []); played=true; break; }
          if(card.name==='CCF捐款' && me && me.hp<me.max_hp){ c.play(card.index, []); played=true; break; }
          if(card.name==='做法假了' && st.can_attack_targets && st.can_attack_targets.length){ c.play(card.index, [st.can_attack_targets[0]]); played=true; break; }
          if(['板子','重构','申诉','骗分','手动测评','数据加强','评测机抽风','CCF放水','题解大会','面向数据编程','随机种子','原题大战','我样例过了！','退役失败','评测机崩溃'].indexOf(card.name)>=0){ c.play(card.index, []); played=true; break; }
          const prof = me?me.profession:'';
          if(card.name==='女装直播' && prof==='女装大佬'){ c.play(card.index, []); played=true; break; }
          if(card.name==='封神' && prof==='传奇Au选手'){ const t=(st.players||[]).find(p=>p.alive&&p.id!==st.my_id); if(t){ c.play(card.index, [t.id]); played=true; break; } }
          if(card.name==='模拟赛' && prof==='金牌教练'){ const t=(st.players||[]).find(p=>p.alive&&p.id!==st.my_id); if(t){ c.play(card.index, [t.id]); played=true; break; } }
          if(['对拍','爆零','抄袭代码','请家长','TLE','MLE','CE','卡评测机','压轴题','玄学优化','停课集训','代码审计','水群','断网','女装求AC','学长讲题'].indexOf(card.name)>=0){
            const t=(st.players||[]).find(p=>p.alive&&p.id!==st.my_id);
            if(t){ c.play(card.index, [t.id]); played=true; break; }
          }
          if(card.name==='链式前向星'){ const t=(st.players||[]).find(p=>p.alive&&p.id!==st.my_id); if(t){ c.play(card.index, [t.id]); played=true; break; } }
        }
        if(!played){ c.skip(); played=true; }
        if(played) acted=true;
      }
    }
    const s0 = clients[0].state;
    const curTail = s0 ? ((s0.log||[]).slice(-1)[0]||'') : '';
    if(curTail !== lastLogTail){ lastLogTail = curTail; noProgress = 0; } else noProgress++;
    if(gameOver){ console.log('GAME OVER 回合='+gameOver.round+' 胜者='+gameOver.winner); break; }
    if(noProgress > 45){
      console.log('WARN: 无日志进展 45 tick — 现场转储');
      const cur = clients.find(c=>c.state && c.state.current_turn===c.state.my_id && c.state.phase===3);
      for(const c of clients){ const s=c.state; if(!s) continue; console.log('  [p]', c.name, 'my_id=',s.my_id,'turn=',s.current_turn,'phase=',s.phase,'pending=',s.pending?s.pending.type:'无','hand=',(s.my_hand||[]).map(h=>h.name).join(','),'states=',c.states,'err=',c.errors.slice(-3).join('|')); }
      console.log('  [log-tail]'); for(const line of ((s0&&s0.log)||[]).slice(-10)) console.log('   ',line);
      break;
    }
  }
  console.log('==== 测试汇总 ====');
  const sts = clients.map(c=>c.state).filter(Boolean);
  for(const s of sts){
    const nm = s.players&&s.players[s.my_id]?s.players[s.my_id].name:'?';
    console.log('玩家', s.my_id, nm, 'hp=', (s.players||[]).map(p=>p.alive?p.hp+'/'+p.max_hp:'X').join(' '), '回合=', s.round, 'phase=', s.phase, '事件=', s.event);
  }
  let errs=[];
  for(const c of clients) if(c.errors.length) errs.push(c.name+': '+c.errors.slice(0,6).join(' | '));
  console.log('错误:', errs.length? errs : '无');
  clients.forEach(c=>c.close());
  process.exit(0);
}
main().catch(e=>{ console.error('TEST CRASH:', e.message); process.exit(3); });
