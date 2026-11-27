import {record} from "./contracts";
import type {Env, Json} from "./contracts";
import {bytes, digest} from "./signatures";

export type MaintainerIntake = {id: number; snapshot: string};

export function maintainerIdentity(issue: Json, env: Env, number: number, id: number): boolean {
  const author = record(issue.user);
  return issue.number === number && !issue.pull_request &&
    issue.repository_url === `https://api.github.com/repos/${env.REPO}` &&
    author.type === "User" && author.id === id;
}

export async function featureSnapshot(issue: Json): Promise<string | undefined> {
  if (issue.state !== "open" || typeof issue.title !== "string" ||
      (issue.body !== null && typeof issue.body !== "string") || !Array.isArray(issue.labels)) return;
  const classification = "type: feature";
  if (!issue.labels.some(label => record(label).name === classification)) return;
  return digest(bytes(JSON.stringify([issue.title, issue.body, classification])));
}
