const versionId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export async function deploymentResult(worker, response, allowMissing = false) {
  const data = await response.json().catch(() => null);
  // Cloudflare 10007 identifies the missing Worker. An arbitrary 404 does not.
  if (allowMissing && response.status === 404 && data?.success === false &&
      Array.isArray(data.errors) && data.errors.length === 1 && data.errors[0]?.code === 10007) {
    return { deployments: [] };
  }
  if (!response.ok || data?.success !== true) {
    throw new Error(`${worker}: Cloudflare deployment API returned ${response.status}`);
  }
  return data.result;
}

export function activeDeployment(worker, result) {
  if (!Array.isArray(result?.deployments)) throw new Error(`${worker}: invalid deployment list`);
  if (result.deployments.length === 0) return null;
  const current = result.deployments[0];
  const version = current?.versions?.[0];
  if (!current?.id || !Array.isArray(current.versions) || current.versions.length !== 1 ||
      version?.percentage !== 100 || !versionId.test(version.version_id)) {
    throw new Error(`${worker}: expected a single active Worker version`);
  }
  return { deployment: current.id, version: version.version_id };
}

export function requireCutoverApproval(stage, snapshots, expected, approvedSha, complete) {
  const missing = Object.values(snapshots).some(snapshot => snapshot === null);
  if (stage === 'production' && (missing || complete !== 'true') && approvedSha !== expected) {
    throw new Error('Production bootstrap requires operator approval for this exact SHA');
  }
}

export function requireNoPublicRoutes(worker, config) {
  if (config.route || config.routes?.length) {
    throw new Error(`${worker}: initial production deployment must leave public routes and custom domains unchanged`);
  }
}
