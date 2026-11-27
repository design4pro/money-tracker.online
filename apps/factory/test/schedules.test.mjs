import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

test("reconciliation updates paused triage and Retro in place and preserves native Monday parity", async () => {
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
    ];
    const schedules = await Promise.all(profiles.map(async ([name, access, trigger]) => ({
      id: `sch_${name}`, project_id: "prj_Synthetic", name: `money-tracker-online-factory-${name}-v1`,
      agent_kind: "codex", base_branch: "main", github_access: access, timezone: "Europe/Warsaw",
      enabled: false, ...trigger,
      prompt: (await readFile(new URL(`../profiles/v1/${name}.md`, import.meta.url), "utf8")).trim(),
    })));
    const fake = join(directory, "fctl");
    const log = join(directory, "calls.jsonl");
    await writeFile(fake, `#!${process.execPath}
import {appendFileSync} from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("fctl 0.39.0");
else if (args[0] === "schedules" && args[1] === "list") console.log(${JSON.stringify(JSON.stringify({schedules}))});
else if (args[0] === "schedules" && args[1] === "edit" && ["sch_triage", "sch_retro"].includes(args[2])) console.log(JSON.stringify({
  id: args[2], project_id: "prj_Synthetic", enabled: false,
}));
else process.exitCode = 1;
`, {mode: 0o700});

    const output = execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/reconcile-schedules.mjs", import.meta.url))], {
      encoding: "utf8", env: {...process.env, FACTORY_FCTL_BIN: fake, FACTORY_PROJECT_ID: "prj_Synthetic"},
    });
    const ids = JSON.parse(output);
    assert.equal(ids.TRIAGE_SCHEDULE_ID, "sch_triage");
    assert.equal(ids.RETRO_SCHEDULE_ID, "sch_retro");
    assert.equal(ids.PARITY_SCHEDULE_ID, "sch_parity");
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[2].slice(0, 3), ["schedules", "edit", "sch_triage"]);
    assert.deepEqual(calls[2].slice(calls[2].indexOf("--on"), -3), [
      "--on", "issue-opened", "--repo", "design4pro/money-tracker.online",
      "--label", "factory:parity,type: feature", "--by", "writers", "--max-per-hour", "3", "--max-per-day", "10",
    ]);
    assert.equal(calls[2][calls[2].indexOf("--github") + 1], "triage");
    assert.deepEqual(calls[3].slice(0, 3), ["schedules", "edit", "sch_retro"]);
    assert.ok(calls[3].includes("--when-asked"));
    assert.equal(calls[3][calls[3].indexOf("--github") + 1], "read");
    assert.ok(!calls[3].includes("--cron"));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
