import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/delivery.yml', import.meta.url), 'utf8');
const preflight = workflow.split('        run: |\n')[1].split('\n  deploy-staging:')[0]
  .replace(/^ {10}/gm, '');
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const repo = 'fixture/repository';

test('Delivery awaits completed main CI and rejected events cannot enter the release group', () => {
  assert.match(workflow, /\n  workflow_run:\n    workflows: \[CI\]\n    branches: \[main\]\n    types: \[completed\]/);
  assert.doesNotMatch(workflow, /\n  push:/);
  const concurrency = workflow.split('\nconcurrency:')[1].split('\njobs:')[0];
  for (const guard of [
    "github.ref == 'refs/heads/main'", 'github.ref_protected', 'inputs.head == github.sha',
    "workflow_run.name == 'CI'", "workflow_run.status == 'completed'",
    "workflow_run.event == 'push'", "workflow_run.conclusion == 'success'",
    'workflow_run.head_repository.full_name == github.repository', "workflow_run.head_branch == 'main'",
    "workflow_run.path == '.github/workflows/ci.yml'", 'workflow_run.head_sha == github.sha',
  ]) assert.ok(concurrency.includes(guard), guard);
  assert.match(concurrency, /'pilot-delivery' \|\| format\('pilot-delivery-ignored-\{0\}', github.run_id\)/);
});

test('Delivery preflight binds automatic completion and manual retry to exact successful CI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-trigger-'));
  const eventPath = join(directory, 'event.json');
  const calls = join(directory, 'gh.log');
  try {
    writeFileSync(join(directory, 'gh'), `#!/bin/bash
      set -eu
      echo "$2" >> "$GH_TEST_CALLS"
      mock_jq() { printf '%s\\n' "$1" | jq -r "$3"; }
      case "$2" in
        */git/ref/heads/main) printf '%s\\n' "\${SIM_TIP:-$GITHUB_SHA}" ;;
        */actions/workflows/ci.yml/runs?*) mock_jq "$SIM_MANUAL_RUNS" "$3" "$4" ;;
        */actions/runs/765/attempts/2/jobs) mock_jq "$SIM_JOBS" "$3" "$4" ;;
        *) exit 90 ;;
      esac
    `, {mode: 0o700});
    const trustedRun = {
      name: 'CI', id: 765, run_attempt: 2, status: 'completed', conclusion: 'success',
      event: 'push', path: '.github/workflows/ci.yml', head_branch: 'main', head_sha: sha,
      head_repository: {full_name: repo},
    };
    const verify = {name: 'verify', status: 'completed', conclusion: 'success', head_sha: sha};
    const run = ({event = 'workflow_run', payload = {}, overrides = {}, jobs = [verify]} = {}) => {
      writeFileSync(eventPath, JSON.stringify({workflow_run: {...trustedRun, ...payload}}));
      writeFileSync(calls, '');
      return spawnSync('bash', ['-eo', 'pipefail', '-c', preflight], {env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_REPOSITORY: repo,
        GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: sha, RETRY_SHA: sha,
        GH_TEST_CALLS: calls, SIM_MANUAL_RUNS: JSON.stringify({workflow_runs: [trustedRun]}),
        SIM_JOBS: JSON.stringify({jobs}), ...overrides,
      }}).status;
    };
    assert.equal(run(), 0);
    assert.equal(run({event: 'workflow_dispatch'}), 0);
    assert.equal(run({event: 'workflow_dispatch', overrides: {RETRY_SHA: other}}), 1);
    for (const payload of [
      {event: 'pull_request'}, {conclusion: 'failure'}, {head_sha: other}, {head_branch: 'feature'},
      {head_repository: {full_name: 'fork/repository'}}, {path: '.github/workflows/other.yml'},
    ]) {
      assert.notEqual(run({payload}), 0);
      assert.equal(readFileSync(calls, 'utf8'), '');
    }
    assert.equal(run({overrides: {SIM_TIP: other}}), 1);
    assert.equal(run({jobs: [{...verify, conclusion: 'failure'}]}), 1);
    assert.equal(run({jobs: [{...verify, head_sha: other}]}), 1);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
