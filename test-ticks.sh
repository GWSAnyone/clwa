#!/bin/bash
# CLWA E2E Test Runner — runs N ticks with live summary + final stats
COUNT=${1:-80}
API="http://localhost:3000/api"
LOGFILE="test-run.jsonl"

> "$LOGFILE"

echo "=== CLWA E2E Test — $COUNT ticks ==="
echo ""

for i in $(seq 1 $COUNT); do
  result=$(curl -s -X POST $API/tick)
  echo "$result" >> "$LOGFILE"

  # One-line summary per tick
  summary=$(echo "$result" | bun -e "
    const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    if(d.error){console.log('ERROR: '+d.error);process.exit(0);}
    const t=d.time||{};
    let parts=['T'+String(d.tickNumber).padStart(3)+' D'+d.gameDay+' '+((t.hour||'??:??')+' '+(t.period||'')).padEnd(16)];

    if(d.conversation){
      const c=d.conversation;
      const names=c.lines?.map(l=>l.speakerName)||[];
      const uniq=[...new Set(names)];
      const topic=c.topic?' ['+c.topic+']':'';
      const group=c.topicGroup?' ('+c.topicGroup+')':'';
      parts.push('CONV: '+uniq.join(' ↔ ')+topic+group+' imp:'+c.importance);
    }
    if(d.goalActions?.length){
      for(const g of d.goalActions){
        if(g.action==='completed') parts.push('DONE: '+g.ownerName+' '+g.goalType);
        else if(g.interaction) parts.push('TALK: '+g.ownerName+' → '+g.interaction.targetName);
        else if(g.description) parts.push(g.ownerName+': '+g.action);
      }
    }
    if(d.movements?.length){
      for(const m of d.movements) parts.push('MOVE: '+(m.agentName||m.agentId)+' → '+m.to);
    }
    if(d.approaches?.length){
      for(const a of d.approaches) parts.push('APPROACH: '+a.npcName);
    }
    if(d.idleReason) parts.push('(idle)');
    console.log(parts.join(' | '));
  " 2>/dev/null)
  echo "$summary"
done

echo ""
echo "=== Summary ($COUNT ticks) ==="
echo ""

# Analyze all collected tick results
bun -e "
const fs=require('fs');
const lines=fs.readFileSync('$LOGFILE','utf8').trim().split('\\n').filter(Boolean);
const ticks=lines.map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);

// Conversations
const convs=ticks.filter(t=>t.conversation);
const convPairs=convs.map(t=>{
  const names=t.conversation.lines?.map(l=>l.speakerName)||[];
  return [...new Set(names)].sort().join(' ↔ ');
});
const pairCounts={};
convPairs.forEach(p=>pairCounts[p]=(pairCounts[p]||0)+1);

console.log('--- CONVERSATIONS: '+convs.length+'/'+ticks.length+' ticks ---');
Object.entries(pairCounts).sort((a,b)=>b[1]-a[1]).forEach(([p,c])=>console.log('  '+c+'x '+p));

// Importance distribution
const imps=convs.map(t=>t.conversation.importance);
if(imps.length){
  const avg=(imps.reduce((a,b)=>a+b,0)/imps.length).toFixed(1);
  const min=Math.min(...imps);
  const max=Math.max(...imps);
  console.log('  Importance: avg='+avg+' min='+min+' max='+max);
}

// Topic diversity
const groups={};
convs.forEach(t=>{
  const g=t.conversation.topicGroup||'unknown';
  groups[g]=(groups[g]||0)+1;
});
const total=convs.length||1;
console.log('  Topic diversity:');
Object.entries(groups).sort((a,b)=>b[1]-a[1]).forEach(([g,c])=>{
  const pct=((c/total)*100).toFixed(0);
  console.log('    '+g.padEnd(14)+c+'x ('+pct+'%)');
});
console.log('');

// Goal actions
const goals=ticks.flatMap(t=>t.goalActions||[]);
const goalTypes={};
goals.forEach(g=>{
  const key=g.ownerName+' '+g.goalType+' ('+g.action+')';
  goalTypes[key]=(goalTypes[key]||0)+1;
});
console.log('--- GOAL ACTIONS: '+goals.length+' ---');
Object.entries(goalTypes).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([k,v])=>console.log('  '+v+'x '+k));
console.log('');

// Crime events (from goal types)
const crimes=goals.filter(g=>['steal','kill','attack','vigilante','blackmail','flee'].some(c=>g.goalType?.includes(c)));
if(crimes.length){
  console.log('--- CRIMES ---');
  crimes.forEach(g=>console.log('  T'+ticks.find(t=>(t.goalActions||[]).includes(g))?.tickNumber+' '+g.ownerName+': '+g.goalType+' ('+g.action+')'));
} else {
  console.log('--- CRIMES: none ---');
}
console.log('');

// Movements
const moves=ticks.flatMap(t=>(t.movements||[]).map(m=>({...m,tick:t.tickNumber})));
console.log('--- MOVEMENTS: '+moves.length+' ---');
const movers={};
moves.forEach(m=>{movers[m.agentName||m.agentId]=(movers[m.agentName||m.agentId]||0)+1});
Object.entries(movers).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  '+v+'x '+k));
console.log('');

// Approaches
const approaches=ticks.flatMap(t=>t.approaches||[]);
if(approaches.length){
  console.log('--- APPROACHES: '+approaches.length+' ---');
  approaches.forEach(a=>console.log('  '+a.npcName+': '+a.displayText));
}

// Idle ticks
const idles=ticks.filter(t=>t.idleReason);
console.log('--- IDLE TICKS: '+idles.length+'/'+ticks.length+' ---');
console.log('');
console.log('Full output saved to: $LOGFILE');
" 2>/dev/null

echo ""
echo "=== Run test-report.sh for full state snapshot ==="
