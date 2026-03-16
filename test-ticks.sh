#!/bin/bash
COUNT=${1:-40}
for i in $(seq 1 $COUNT); do
  curl -s -X POST http://localhost:3000/api/tick > /dev/null
  echo "tick $i done"
done
echo "=== All $COUNT ticks complete ==="
curl -s http://localhost:3000/api/time
