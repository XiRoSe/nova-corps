/**
 * Nova Railway Manager
 *
 * Manages per-user Nova agent environments on Railway via their GraphQL API.
 * Handles the full lifecycle: fork repo -> create service -> configure env vars
 * -> attach volume -> generate domain -> monitor -> teardown.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentServiceConfig {
  /** Extra environment variables to pass to the agent container */
  extraVars?: Record<string, string>;
}

export interface CreateAgentResult {
  serviceId: string;
  serviceName: string;
  domain: string;
}

export interface ServiceStatus {
  serviceId: string;
  status: string;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

// ---------------------------------------------------------------------------
// Low-level Railway GraphQL client
// ---------------------------------------------------------------------------

async function railwayGql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = requireEnv("RAILWAY_API_TOKEN");

  const res = await fetch(RAILWAY_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Railway API HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors?.length) {
    throw new Error(`Railway API error: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// GitHub: fork the agent template repo for a user
// ---------------------------------------------------------------------------

async function forkAgentRepo(userId: string): Promise<{ owner: string; repo: string }> {
  const token = requireEnv("GITHUB_TOKEN");

  const sourceOwner = "XiRoSe";
  const sourceRepo = "nova-agent";
  const forkName = `nova-agent-${userId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30)}`;

  const res = await fetch(`https://api.github.com/repos/${sourceOwner}/${sourceRepo}/forks`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ name: forkName }),
  });

  if (!res.ok) {
    // 202 Accepted is success for forks; but if the fork already exists GitHub
    // returns 422. In that case, try to look up the existing fork.
    if (res.status === 422) {
      // Fork already exists — resolve the owner from the authenticated user
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!userRes.ok) throw new Error("Failed to resolve GitHub user for existing fork");
      const userData = (await userRes.json()) as { login: string };
      return { owner: userData.login, repo: forkName };
    }
    const text = await res.text();
    throw new Error(`GitHub fork failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { owner: { login: string }; name: string };
  return { owner: data.owner.login, repo: data.name };
}

// ---------------------------------------------------------------------------
// Railway: create a service connected to the forked GitHub repo
// ---------------------------------------------------------------------------

async function createRailwayService(
  projectId: string,
  serviceName: string,
  repoFullName: string,
): Promise<string> {
  const data = await railwayGql<{
    serviceCreate: { id: string };
  }>(
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id }
    }`,
    {
      input: {
        projectId,
        name: serviceName,
        source: { repo: repoFullName },
      },
    },
  );

  return data.serviceCreate.id;
}

// ---------------------------------------------------------------------------
// Railway: upsert environment variables on the service
// ---------------------------------------------------------------------------

async function setServiceVariables(
  projectId: string,
  serviceId: string,
  environmentId: string,
  variables: Record<string, string>,
): Promise<void> {
  await railwayGql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId,
        serviceId,
        environmentId,
        variables,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Railway: look up the default (production) environment for a project
// ---------------------------------------------------------------------------

async function getDefaultEnvironmentId(projectId: string): Promise<string> {
  const data = await railwayGql<{
    project: { environments: { edges: Array<{ node: { id: string; name: string } }> } };
  }>(
    `query($projectId: String!) {
      project(id: $projectId) {
        environments { edges { node { id name } } }
      }
    }`,
    { projectId },
  );

  const envs = data.project.environments.edges;
  const prod = envs.find((e) => e.node.name === "production") ?? envs[0];
  if (!prod) throw new Error("No environments found in Railway project");
  return prod.node.id;
}

// ---------------------------------------------------------------------------
// Railway: create a persistent volume on the service
// ---------------------------------------------------------------------------

async function createVolume(
  projectId: string,
  serviceId: string,
  environmentId: string,
): Promise<string> {
  const data = await railwayGql<{
    volumeCreate: { id: string };
  }>(
    `mutation($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id }
    }`,
    {
      input: {
        projectId,
        serviceId,
        environmentId,
        mountPath: "/data",
      },
    },
  );

  return data.volumeCreate.id;
}

// ---------------------------------------------------------------------------
// Railway: generate a public domain for the service
// ---------------------------------------------------------------------------

async function generateDomain(
  serviceId: string,
  environmentId: string,
): Promise<string> {
  const data = await railwayGql<{
    serviceDomainCreate: { domain: string };
  }>(
    `mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }`,
    {
      input: {
        serviceId,
        environmentId,
      },
    },
  );

  return data.serviceDomainCreate.domain;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Provision a full Nova agent environment on Railway for a user.
 *
 * 1. Fork the XiRoSe/nova-agent repo on GitHub
 * 2. Create a Railway service linked to the fork
 * 3. Set agent environment variables
 * 4. Create a /data persistent volume
 * 5. Generate a public domain
 */
export async function createAgentService(
  userId: string,
  envId: string,
  config: AgentServiceConfig = {},
): Promise<CreateAgentResult> {
  const projectId = requireEnv("RAILWAY_PROJECT_ID");

  // 1. Fork repo
  const fork = await forkAgentRepo(userId);
  const repoFullName = `${fork.owner}/${fork.repo}`;

  // 2. Create Railway service
  const serviceName = `nova-agent-${userId.slice(0, 12)}`;
  const serviceId = await createRailwayService(projectId, serviceName, repoFullName);

  // 3. Resolve default environment
  const environmentId = await getDefaultEnvironmentId(projectId);

  // 4. Set env vars on the service
  const envVars: Record<string, string> = {
    ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY"),
    REPLICATE_API_TOKEN: requireEnv("REPLICATE_API_TOKEN"),
    NOVA_USER_ID: userId,
    NOVA_ENV_ID: envId,
    DATA_DIR: "/data",
    ...config.extraVars,
  };
  await setServiceVariables(projectId, serviceId, environmentId, envVars);

  // 5. Persistent volume
  await createVolume(projectId, serviceId, environmentId);

  // 6. Public domain
  const domain = await generateDomain(serviceId, environmentId);

  return { serviceId, serviceName, domain };
}

/**
 * Query Railway for the current status of a service.
 */
export async function getServiceStatus(serviceId: string): Promise<ServiceStatus> {
  const data = await railwayGql<{
    service: {
      id: string;
      status: string;
      serviceDomains: { edges: Array<{ node: { domain: string } }> };
    };
  }>(
    `query($serviceId: String!) {
      service(id: $serviceId) {
        id
        status
        serviceDomains { edges { node { domain } } }
      }
    }`,
    { serviceId },
  );

  const svc = data.service;
  const domainEdge = svc.serviceDomains.edges[0];

  return {
    serviceId: svc.id,
    status: svc.status,
    url: domainEdge ? domainEdge.node.domain : null,
  };
}

/**
 * Delete a Railway service (full teardown).
 */
export async function deleteAgentService(serviceId: string): Promise<void> {
  await railwayGql(
    `mutation($id: String!) {
      serviceDelete(id: $id)
    }`,
    { id: serviceId },
  );
}

/**
 * Restart a Railway service by triggering a redeployment.
 */
export async function restartAgentService(serviceId: string): Promise<void> {
  const projectId = requireEnv("RAILWAY_PROJECT_ID");
  const environmentId = await getDefaultEnvironmentId(projectId);

  await railwayGql(
    `mutation($input: ServiceInstanceRedeployInput!) {
      serviceInstanceRedeploy(input: $input)
    }`,
    {
      input: {
        serviceId,
        environmentId,
      },
    },
  );
}

/**
 * Update environment variables on an existing agent service.
 */
export async function updateServiceVars(
  serviceId: string,
  vars: Record<string, string>,
): Promise<void> {
  const projectId = requireEnv("RAILWAY_PROJECT_ID");
  const environmentId = await getDefaultEnvironmentId(projectId);

  await setServiceVariables(projectId, serviceId, environmentId, vars);
}
