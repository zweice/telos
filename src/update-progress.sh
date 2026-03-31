#!/bin/bash
# Auto-update KPIs and Telos progress after shipping to a task
# Usage: ./update-progress.sh <task-id> <progress%> [kpi-name] [kpi-value]
TASK_ID=$1
PROGRESS=$2
KPI_NAME=$3
KPI_VALUE=$4

cd ~/code/macrohard/telos

if [ -n "$PROGRESS" ]; then
  node src/cli.js update $TASK_ID --progress $PROGRESS 2>/dev/null
  echo "✅ Progress: ${PROGRESS}%"
fi

if [ -n "$KPI_NAME" ] && [ -n "$KPI_VALUE" ]; then
  node src/kpi.js set $TASK_ID $KPI_NAME $KPI_VALUE 2>/dev/null
  echo "✅ KPI: $KPI_NAME = $KPI_VALUE"
fi

# Re-export viz data
node src/cli.js viz 2>/dev/null | tail -1
