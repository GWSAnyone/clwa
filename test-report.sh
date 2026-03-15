#!/bin/bash
# CLWA State Report — shows full world state after simulation

API="http://localhost:3000/api"

echo "=== CLWA State Report ==="
echo ""

# Time
echo "--- TIME ---"
curl -s $API/time | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('Day '+d.gameDay+' | '+d.hour+' ('+d.period+') | Tick '+d.totalTicks)"
echo ""

# NPC States
echo "--- NPC STATUS ---"
curl -s $API/agents | node -e "
const agents=JSON.parse(require('fs').readFileSync(0,'utf8'));
agents.forEach(a=>console.log(
  a.name.padEnd(20),
  'status:',a.status.padEnd(10),
  'alive:',String(a.alive).padEnd(5),
  'mood:',a.mood?.toFixed(2).padStart(6),
  'loc:',a.location
))"
echo ""

# Events timeline
echo "--- EVENTS ---"
curl -s $API/events | node -e "
const events=JSON.parse(require('fs').readFileSync(0,'utf8'));
events.forEach(e=>{
  const sub=(e.subjectName||'?').padEnd(18);
  const obj=(e.objectName||'-').padEnd(18);
  console.log('Day'+e.gameDay, e.type?.padEnd(25), sub, '→', obj)
})"
echo ""

# Beliefs (all NPCs)
echo "--- BELIEFS ---"
curl -s $API/agents | node -e "
const agents=JSON.parse(require('fs').readFileSync(0,'utf8'));
const ids=agents.map(a=>a.id);
Promise.all(ids.map(id=>
  fetch('$API/beliefs/'+id).then(r=>r.json()).then(beliefs=>({id,beliefs}))
)).then(results=>{
  results.forEach(({id,beliefs})=>{
    if(beliefs.length===0)return;
    console.log(id+':');
    beliefs.forEach(b=>console.log('  ['+b.source+'] '+b.eventType+': '+(b.subject||'null')+' → '+(b.object||'-')+' (conf:'+b.confidence?.toFixed(2)+')'));
  })
})" 2>/dev/null
echo ""

# Goals summary
echo "--- GOALS ---"
curl -s $API/goals | node -e "
const goals=JSON.parse(require('fs').readFileSync(0,'utf8'));
const summary={};
goals.forEach(g=>{
  const key=g.ownerId+' '+g.type+' '+g.state;
  summary[key]=(summary[key]||0)+1;
});
Object.entries(summary).sort().forEach(([k,v])=>console.log('  '+v+'x',k))"
echo ""

# Evidence
echo "--- EVIDENCE ---"
curl -s $API/evidence | node -e "
const ev=JSON.parse(require('fs').readFileSync(0,'utf8'));
if(ev.length===0){console.log('  (none)')}else{
ev.forEach(e=>console.log(
  '  ['+e.category+']',(e.subjectName||'?').padEnd(15),
  'weight:'+e.weight,'active:'+e.active,
  'discovered:'+JSON.stringify(e.discoveredBy)
))}"
echo ""
echo "=== Report Complete ==="
