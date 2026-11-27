import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

test("reconciliation adds paused maintainer triage and preserves native parity schedules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-schedules-"));
  try {
    const profiles = [
      ["parity", "comment", {cron: "0 9 * * 1"}],
      ["triage", "triage", {event: {kind: "issue_opened", by: "agents",
        repos: ["design4pro/money-tracker.online"], labels: ["factory:parity"], max_per_hour: 3, max_per_day: 10}}],
      ["plan", "triage", {}],
      ["implement", "push", {}],
      ["ops", "read", {}],
      ["retro", "read", {cron: "0 10 * * 5"}],
      ["staging-ui", "comment", {cron: "0 * * * *", prompt: "Rollout hold"}],
    ];
    const schedules = await Promise.all(profiles.map(async ([name, access, trigger]) => ({
      id: `sch_${name.replaceAll("-", "")}`, project_id: "prj_Synthetic", name: `money-tracker-online-factory-${name}-v1`,
      agent_kind: "codex", base_branch: "main", github_access: access, timezone: "Europe/Warsaw",
      enabled: false, ...trigger,
      prompt: trigger.prompt ?? (await readFile(new URL(`../profiles/v1/${name}.md`, import.meta.url), "utf8")).trim(),
    })));
    const fake = join(directory, "fctl");
    const log = join(directory, "calls.jsonl");
    await writeFile(fake, `#!${process.execPath}
import {appendFileSync} from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("fctl 0.39.0");
else if (args[0] === "schedules" && args[1] === "list") {
  const schedules = ${JSON.stringify(schedules)};
  if (process.env.TEST_STAGE_MODE) {
    for (const schedule of schedules) {
      if (["sch_plan", "sch_implement"].includes(schedule.id)) schedule.prompt = "Pre-staging prompt";
    }
    if (process.env.TEST_STAGE_MODE === "missing") schedules.pop();
    if (process.env.TEST_STAGE_MODE === "active") schedules.at(-1).enabled = true;
  }
  console.log(JSON.stringify({schedules}));
}
else if (args[0] === "schedules" && args[1] === "add" && args[2] === "money-tracker-online-factory-maintainer-triage-v1") console.log(JSON.stringify({
  id: "sch_MaintainerTriage", project_id: "prj_Synthetic", enabled: false,
}));
else if (args[0] === "schedules" && args[1] === "add" && args[2] === "money-tracker-online-factory-staging-ui-v1") console.log(JSON.stringify({
  id: "sch_StagingNew", project_id: "prj_Synthetic", enabled: false,
}));
else if (args[0] === "schedules" && args[1] === "edit" &&
  ["sch_retro", "sch_plan", "sch_implement", "sch_triage", "sch_stagingui"].includes(args[2])) console.log(JSON.stringify({
  id: args[2], project_id: "prj_Synthetic", enabled: false,
}));
else process.exitCode = 1;
`, {mode: 0o700});

    const script = fileURLToPath(new URL("../scripts/reconcile-schedules.mjs", import.meta.url));
    const settings = {...process.env, FACTORY_FCTL_BIN: fake, FACTORY_PROJECT_ID: "prj_Synthetic"};
    const run = (flags = [], env = {}) => JSON.parse(execFileSync(process.execPath, [script, ...flags], {
      encoding: "utf8", env: {...settings, ...env}, stdio: ["ignore", "pipe", "pipe"],
    }));
    const readCalls = async () => (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const ids = run();
    assert.equal(ids.TRIAGE_SCHEDULE_ID, "sch_triage");
    assert.equal(ids.RETRO_SCHEDULE_ID, "sch_retro");
    assert.equal(ids.PARITY_SCHEDULE_ID, "sch_parity");
    const calls = await readCalls();
    assert.equal(calls.length, 4);
    assert.equal(ids.MAINTAINER_TRIAGE_SCHEDULE_ID, "sch_MaintainerTriage");
    assert.deepEqual(calls[2].slice(0, 3), ["schedules", "add", "money-tracker-online-factory-maintainer-triage-v1"]);
    assert.ok(calls[2].includes("--when-asked"));
    assert.ok(calls[2].includes("--paused"));
    assert.ok(!calls[2].includes("--on"));
    assert.equal(calls[2][calls[2].indexOf("--github") + 1], "triage");
    assert.deepEqual(calls[3].slice(0, 3), ["schedules", "edit", "sch_retro"]);
    assert.ok(calls[3].includes("--when-asked"));
    assert.equal(calls[3][calls[3].indexOf("--github") + 1], "read");
    assert.ok(!calls[3].includes("--cron"));

    const staging = {TEST_STAGE_MODE: "existing", TRIAGE_SCHEDULE_ID: "sch_triage",
      FACTORY_STAGING_APP_HEALTH_URL: "https://app.example.invalid/health",
      FACTORY_STAGING_WORKER_HEALTH_URL: "https://factory.example.invalid/health"};
    await writeFile(log, "");
    assert.deepEqual(run(["--staging-ui-downstream"], staging), {
      PLAN_SCHEDULE_ID: "sch_plan", IMPLEMENT_SCHEDULE_ID: "sch_implement",
    });
    assert.deepEqual((await readCalls()).slice(2).map(args => args.slice(1, 3)), [
      ["edit", "sch_plan"], ["edit", "sch_implement"],
    ]);

    for (const mode of ["existing", "missing"]) {
      await writeFile(log, "");
      const result = run(["--staging-ui"], {...staging, TEST_STAGE_MODE: mode});
      assert.deepEqual(result, {PLAN_SCHEDULE_ID: "sch_plan", IMPLEMENT_SCHEDULE_ID: "sch_implement",
        TRIAGE_SCHEDULE_ID: "sch_triage", STAGING_UI_SCHEDULE_ID: mode === "existing" ? "sch_stagingui" : "sch_StagingNew"});
      const edits = (await readCalls()).slice(2);
      assert.equal(edits.length, 4);
      const [, , triage, discovery] = edits;
      const flag = (args, name) => args[args.indexOf(name) + 1];
      assert.deepEqual(triage.slice(1, 3), ["edit", "sch_triage"]);
      assert.equal(flag(triage, "--on"), "issue-opened");
      assert.equal(flag(triage, "--by"), "agents");
      assert.equal(flag(triage, "--label"), "factory:staging-ui");
      assert.deepEqual(discovery.slice(1, 3), mode === "existing" ? ["edit", "sch_stagingui"] :
        ["add", "money-tracker-online-factory-staging-ui-v1"]);
      assert.equal(discovery.includes("--paused"), mode === "missing");
      assert.equal(flag(discovery, "--cron"), "0 * * * *");
      assert.equal(flag(discovery, "--agent"), "codex");
      assert.equal(flag(discovery, "--base"), "main");
      assert.equal(flag(discovery, "--tz"), "Europe/Warsaw");
      assert.equal(flag(discovery, "--github"), "comment");
      assert.match(flag(discovery, "--task"), /ledger-transaction-direction-filter/);
      assert.match(flag(discovery, "--task"), /transactions-filters\.spec\.ts#L144/);
      assert.ok(flag(discovery, "--task").includes(staging.FACTORY_STAGING_WORKER_HEALTH_URL));
    }
    for (const changed of [{TRIAGE_SCHEDULE_ID: "sch_Wrong"}, {TEST_STAGE_MODE: "active"}]) {
      await writeFile(log, "");
      assert.throws(() => run(["--staging-ui"], {...staging, ...changed}), /Command failed/);
      assert.deepEqual((await readCalls()).map(args => args[0] === "schedules" ? args[1] : args[0]), ["--version", "list"]);
    }
    await writeFile(log, "");
    assert.throws(() => run(["--staging-ui", "--enable"], staging), /Command failed/);
    assert.equal(await readFile(log, "utf8"), "");

  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
