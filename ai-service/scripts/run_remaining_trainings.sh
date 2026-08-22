#!/usr/bin/env bash
#
# Trains everything that still has no model, three at a time.
#
# This is a file on disk rather than a command typed into a shell for one
# reason: a run started from an editor's terminal dies with that
# terminal. Five trainings were lost that way, one of them thirteen hours
# in. Registered as a Windows scheduled task, this survives the editor,
# the terminal, and a sign out.
#
# Every job resumes from its own best.weights.h5 when one is there, so a
# second interruption costs the epochs since the last improvement rather
# than the whole run.
#
# Progress is appended to progress.log next to the models, so anybody can
# read where it got to without asking the process.

set -u

cd "$(dirname "$0")/.." || exit 1

PYTHON=./.venv/Scripts/python.exe
PROGRESS=models/progress.log

log() {
  echo "[$(date '+%m-%d %H:%M')] $*" >> "$PROGRESS"
}

run_one() {
  region=$1
  dataset=$2
  name=$3
  log_file="models/${name}_train.log"

  if [ -f "models/$name/${name}_model.keras" ]; then
    log "skip $name (already trained)"
    return
  fi

  log "start $name"

  "$PYTHON" scripts/train_region_3d.py "$region" \
    --dataset "$dataset" --epochs 30 --resume \
    --output-name "$name" > "$log_file" 2>&1

  if [ -f "models/$name/${name}_model.keras" ]; then
    log "done  $name  $(grep -oE 'auc=[0-9.]+' "$log_file" | tail -1)"
  else
    log "FAIL  $name  (see $log_file)"
  fi
}

lane_a() {
  run_one abdomen patches_pancreas       abdomen_3d_pancreas_tumour
  run_one chest   nodule3d_64            chest_3d_nodule3d_64
  run_one abdomen m3d_0018_colon_cancer  abdomen_3d_colon_cancer_m3d
}

lane_b() {
  run_one abdomen patches_hepatic_vessel   abdomen_3d_hepatic_vessel_tumour
  run_one head    vessel3d_64              head_3d_vessel3d_64
  run_one abdomen m3d_0017_pancreas_lesion abdomen_3d_pancreas_lesion_m3d
}

lane_c() {
  run_one abdomen     adrenal3d_64 abdomen_3d_adrenal3d_64
  run_one abdomen     organ3d_64   abdomen_3d_organ3d_64
  run_one multi_organ msd_router   multi_organ_3d_router
}

log "=== queue started ==="

lane_a &
lane_b &
lane_c &
wait

log "=== all training finished ==="
