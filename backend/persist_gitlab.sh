#!/bin/sh
set -eu
[ -z "${GITLAB_PUSH_TOKEN:-}" ] && { echo "No push token; history only in pipeline artifact."; exit 0; }
git config user.email deer-intel-bot@example.invalid
git config user.name "Deer Intel Bot"
git add data/deer_intelligence.sqlite public/observations.json public/deer_profiles.json || true
git diff --cached --quiet && exit 0
git commit -m "Update deer intelligence history [skip ci]"
git remote set-url origin "https://oauth2:${GITLAB_PUSH_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
git push origin "HEAD:${CI_DEFAULT_BRANCH}"
