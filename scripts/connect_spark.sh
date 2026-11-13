#!/usr/bin/env bash
set -euo pipefail

spark_host="${1:-spark11.local}"
echo "Opening a private Ollama tunnel to user11@$spark_host."
echo "Enter the Spark password when SSH asks. The password is not saved."
echo "Keep this terminal open while using the app. Ctrl+C closes the tunnel."
echo "If .local lookup fails, rerun with the Spark IP: bash scripts/connect_spark.sh SPARK_IP"

exec ssh -N -T \
  -o ExitOnForwardFailure=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:11435:127.0.0.1:11434 \
  "user11@$spark_host"
