import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const cli = process.env.FACTORY_FCTL_BIN ?? "fctl";
const project = process.env.FACTORY_PROJECT_ID;
const options = process.argv.slice(2);
const enable = options.includes("--enable");
if (options.some(option => option !== "--enable") || !/^prj_[A-Za-z0-9]+$/.test(project ?? "")) {
  throw new Error("Set FACTORY_PROJECT_ID to the fctl project ID. Optional flag: --enable.");
}

function call(args, json = true) {
  try {
    const output = execFileSync(cli, args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    return json ? JSON.parse(output) : output.trim();
  } catch {
    throw new Error(`fctl failed for ${args.slice(0, 2).join(" ")}. Check CLI authentication, project access and server version.`);
  }
}

if (call(["--version"], false) !== "fctl 0.39.0") throw new Error("Use the fctl 0.39.0 CLI.");

const repo = "design4pro/money-tracker.online";
const profiles = [
  {key: "PARITY", access: "comment", cron: "0 9 * * 1"},
  {key: "TRIAGE", access: "triage", event: true},
  {key: "MAINTAINER_TRIAGE", access: "triage"},
  {key: "PLAN", access: "triage"},
  {key: "IMPLEMENT", access: "push"},
  {key: "OPS", access: "read"},
  {key: "RETRO", access: "read"},
];
const schedules = (...args) => call(["schedules", ...args, "-p", project, "--json"]);
const current = schedules("list");
if (!Array.isArray(current.schedules)) throw new Error("Unexpected schedule list");
if (current.unheard?.some(event => event.kind === "issue_opened")) {
  if (enable) throw new Error("The instance cannot receive native issue-opened events.");
  process.stderr.write("Native issue-opened events are unavailable. Keep schedules paused until setup is complete.\n");
}

const ids = {};
const existing = [];
for (const profile of profiles) {
  const short = profile.key.toLowerCase().replaceAll("_", "-");
  const name = `money-tracker-online-factory-${short}-v1`;
  const path = fileURLToPath(new URL(`../profiles/v1/${short}.md`, import.meta.url));
  const prompt = readFileSync(path, "utf8").trim();
  const found = current.schedules.filter(schedule => schedule.name === name);
  if (found.length > 1) throw new Error(`Resolve duplicate schedules named ${name} before setup.`);
  const schedule = found[0];
  const when = profile.cron ? ["--cron", profile.cron] : profile.event ?
    ["--on", "issue-opened", "--repo", repo, "--label", "factory:parity", "--by", "agents", "--max-per-hour", "3", "--max-per-day", "10"] :
    ["--when-asked"];
  const flags = ["--task-file", path, "--agent", "codex", "--base", "main", "--github", profile.access, "--tz", "Europe/Warsaw", ...when];
  const expectedEvent = profile.event && schedule?.event?.kind === "issue_opened" && schedule.event.by === "agents" &&
    Array.isArray(schedule.event.repos) && schedule.event.repos.length === 1 && schedule.event.repos[0] === repo &&
    Array.isArray(schedule.event.labels) && schedule.event.labels.length === 1 && schedule.event.labels[0] === "factory:parity" &&
    !schedule.event.branches?.length && schedule.event.max_per_hour === 3 && schedule.event.max_per_day === 10;
  const drift = schedule && (schedule.prompt?.trim() !== prompt || schedule.agent_kind !== "codex" || schedule.base_branch !== "main" ||
    schedule.github_access !== profile.access || schedule.timezone !== "Europe/Warsaw" || (schedule.cron ?? undefined) !== profile.cron ||
    schedule.at || (profile.event ? !expectedEvent : schedule.event));
  if (drift && schedule.enabled) throw new Error(`Pause ${name} before reconciling its drift.`);
  const result = schedule ? drift ? schedules("edit", schedule.id, ...flags) : schedule :
    schedules("add", name, ...flags, "--paused");
  if (!/^sch_[A-Za-z0-9]+$/.test(result.id ?? "") || result.project_id !== project || (schedule && result.id !== schedule.id)) throw new Error(`Unexpected identity for ${name}`);
  ids[`${profile.key}_SCHEDULE_ID`] = result.id;
  existing.push({id: result.id, enabled: result.enabled, created: !schedule});
}

if (enable) {
  if (existing.some(schedule => schedule.created)) {
    process.stderr.write("New schedules are paused. Finish setup and run again with --enable.\n");
    process.exitCode = 1;
  } else {
    for (const schedule of existing.filter(schedule => !schedule.enabled)) schedules("resume", schedule.id);
  }
}
process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
