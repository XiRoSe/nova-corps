/**
 * Auto-provisions Nova Agent containers on Railway per company.
 * Each company gets one container that hosts all their agents.
 *
 * Usage:
 *   import { getContainerUrl, initProvisioner } from "./container-provisioner.js";
 *   await initProvisioner(db);  // call on server startup
 *   const url = getContainerUrl(companyId);  // fast sync lookup
 */

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "a360a856-7f3d-4098-a346-1644ed0fe5d0";
const RAILWAY_ENV_ID = process.env.RAILWAY_ENVIRONMENT_ID || "92b318f0-be2c-4da0-bf68-5805710b3ee6";
const NOVA_AGENT_REPO = process.env.NOVA_AGENT_REPO || "XiRoSe/nova-agent";

// In-memory registry: companyId → container URL
const containerUrls = new Map<string, string>();
const provisioningInProgress = new Set<string>();
let dbRef: any = null;

/**
 * Initialize the provisioner — loads existing container URLs from DB.
 * Call once on server startup.
 */
export async function initProvisioner(db: any): Promise<void> {
  dbRef = db;
  try {
    const { novaEnvironments } = await import("@paperclipai/db/schema");
    const rows = await db.select().from(novaEnvironments);
    for (const row of rows) {
      if (row.railwayUrl && row.status === "running") {
        containerUrls.set(row.userId, row.railwayUrl); // userId stores companyId
      }
    }
    console.log(`[provisioner] Loaded ${containerUrls.size} container URL(s)`);
  } catch (err) {
    console.error("[provisioner] Failed to load containers from DB:", err);
  }
}

/**
 * Get container URL for a company. Fast synchronous lookup.
 * Returns null if no container is available (triggers async provisioning).
 */
export function getContainerUrl(companyId: string): string | null {
  // Env var override — single-container mode for simple setups
  const envUrl = process.env.NOVA_CONTAINER_URL;
  if (envUrl) return envUrl;

  // Check in-memory registry
  const url = containerUrls.get(companyId);
  if (url) return url;

  // Trigger async provisioning if not already in progress
  if (!provisioningInProgress.has(companyId) && dbRef && process.env.RAILWAY_API_TOKEN) {
    provisioningInProgress.add(companyId);
    provisionContainer(companyId).catch((err) => {
      console.error(`[provisioner] Failed for ${companyId}:`, err);
      provisioningInProgress.delete(companyId);
    });
  }

  return null;
}

async function checkContainerHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function railwayQuery(token: string, query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || "Railway API error");
  return data.data;
}

/**
 * Provision a new Nova Agent container on Railway for a company.
 */
async function provisionContainer(companyId: string): Promise<void> {
  const db = dbRef;
  const token = process.env.RAILWAY_API_TOKEN!;
  const { novaEnvironments } = await import("@paperclipai/db/schema");
  const { eq } = await import("drizzle-orm");

  console.log(`[provisioner] Starting container provisioning for company ${companyId}`);

  // Create DB record first (status: provisioning)
  const [env] = await db.insert(novaEnvironments).values({
    userId: companyId, // Using userId field to store companyId
    status: "provisioning",
  }).returning();

  try {
    // Step 1: Create a new Railway service connected to nova-agent repo
    const serviceName = `nova-agents-${companyId.slice(0, 8)}`;
    const createResult = await railwayQuery(token, `
      mutation($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }
    `, {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        name: serviceName,
        source: { repo: NOVA_AGENT_REPO },
      },
    });

    const serviceId = createResult.serviceCreate.id;
    console.log(`[provisioner] Created Railway service ${serviceId} (${serviceName})`);

    // Step 2: Set environment variables
    const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
    const paperclipUrl = process.env.PAPERCLIP_PUBLIC_API_URL || "";

    // Set variables one by one (Railway API limitation)
    for (const [key, value] of Object.entries({
      ANTHROPIC_API_KEY: anthropicKey,
      ASSISTANT_NAME: "Nova",
      NOVA_COMPANY_ID: companyId,
      PAPERCLIP_API_URL: paperclipUrl,
    })) {
      await railwayQuery(token, `
        mutation($input: VariableCollectionUpsertInput!) {
          variableCollectionUpsert(input: $input)
        }
      `, {
        input: {
          projectId: RAILWAY_PROJECT_ID,
          environmentId: RAILWAY_ENV_ID,
          serviceId,
          variables: { [key]: value },
        },
      });
    }

    console.log(`[provisioner] Set environment variables for ${serviceName}`);

    // Step 3: Create a persistent volume
    try {
      await railwayQuery(token, `
        mutation($input: VolumeCreateInput!) {
          volumeCreate(input: $input) {
            id
          }
        }
      `, {
        input: {
          projectId: RAILWAY_PROJECT_ID,
          environmentId: RAILWAY_ENV_ID,
          serviceId,
          mountPath: "/data",
        },
      });
      console.log(`[provisioner] Created volume at /data for ${serviceName}`);
    } catch (err) {
      console.warn(`[provisioner] Volume creation failed (may already exist):`, err);
    }

    // Step 4: Generate a domain
    const domainResult = await railwayQuery(token, `
      mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          domain
        }
      }
    `, {
      input: {
        serviceId,
        environmentId: RAILWAY_ENV_ID,
      },
    });

    const domain = domainResult.serviceDomainCreate.domain;
    const containerUrl = `https://${domain}`;
    console.log(`[provisioner] Container URL: ${containerUrl}`);

    // Step 5: Update DB record
    await db
      .update(novaEnvironments)
      .set({
        railwayServiceId: serviceId,
        railwayServiceName: serviceName,
        railwayUrl: containerUrl,
        status: "provisioning", // Will become "running" after health check passes
        updatedAt: new Date(),
      })
      .where(eq(novaEnvironments.id, env.id));

    // Step 6: Poll for health (service needs time to build and deploy)
    console.log(`[provisioner] Waiting for container to be ready...`);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 10_000)); // 10s intervals
      const healthy = await checkContainerHealth(containerUrl);
      if (healthy) {
        await db
          .update(novaEnvironments)
          .set({ status: "running", updatedAt: new Date() })
          .where(eq(novaEnvironments.id, env.id));
        containerUrls.set(companyId, containerUrl);
        provisioningInProgress.delete(companyId);
        console.log(`[provisioner] Container ready for company ${companyId}: ${containerUrl}`);
        return;
      }
      console.log(`[provisioner] Health check ${i + 1}/30 for ${serviceName}...`);
    }

    console.error(`[provisioner] Container failed to become healthy after 5 minutes`);
    provisioningInProgress.delete(companyId);
    await db
      .update(novaEnvironments)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(novaEnvironments.id, env.id));
  } catch (err) {
    console.error(`[provisioner] Provisioning failed for company ${companyId}:`, err);
    provisioningInProgress.delete(companyId);
    await db
      .update(novaEnvironments)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(novaEnvironments.id, env.id));
  }
}
