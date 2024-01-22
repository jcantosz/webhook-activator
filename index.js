// Import required libraries
const fs = require("fs");
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const core = require("@actions/core");

// Get action inputs
const targetOrgs = core.getInput("target_orgs").split(/[,\n]+/);

const targetPAT = core.getInput("target_github_pat");

const targetAppId = core.getInput("target_github_app_id") || sourceAppId;
const targetAppPrivateKey = core.getInput("target_github_app_private_key") || sourceAppPrivateKey;
const targetAppInstallationId = core.getInput("target_github_app_installation_id") || sourceAppInstallationId;
const targetAPIUrl = core.getInput("target_github_api_url") || sourceAPIUrl;

let failedActivations = [];

core.info(`isDebug? ${core.isDebug()}`);

// Create Octokit instances for source and target
const octokit = createOctokitInstance(
  targetPAT,
  targetAppId,
  targetAppPrivateKey,
  targetAppInstallationId,
  targetAPIUrl
);

// Function to create Octokit instance
function createOctokitInstance(PAT, appId, appPrivateKey, appInstallationId, apiUrl) {
  // Prefer app auth to PAT if both are available
  if (appId && appPrivateKey && appInstallationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: appId,
        privateKey: appPrivateKey,
        installationId: appInstallationId,
      },
      baseUrl: apiUrl,
      log: core.isDebug() ? console : null,
    });
  } else {
    return new Octokit({
      auth: PAT,
      baseUrl: apiUrl,
      log: core.isDebug() ? console : null,
    });
  }
}

async function getOrgRepos(org) {
  const repos = await octokit.request("GET /orgs/{org}/repos", {
    org: org,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return repos.data.map(({ name }) => name);
}

function getWebhookFields(data) {
  return data.map((obj) => {
    return { hook_id: obj.id, active: obj.active };
  });
}

async function getOrgWebhooks(org) {
  const webhook = await octokit.request("GET /orgs/{org}/hooks", {
    org: org,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  return getWebhookFields(webhook.data);
}

async function activateOrgWebhook(hook_id, org) {
  // just do this synchronously so we dont have to track promises completing before exiting
  try {
    await octokit.request("PATCH /orgs/{org}/hooks/{hook_id}", {
      org: org,
      hook_id: hook_id,
      active: true,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    failedActivations.push(`Org hook ${org}:${hook_id}`);
    console.error(`ERROR: ${error}`);
  }
}

async function activateAllOrgWebhooks(org) {
  const webhooks = await getOrgWebhooks(org);
  for (const webhook of webhooks) {
    // skip webhooks that are already active
    if (!webhook.active) {
      console.log(`Activating webhook "${webhook.hook_id}" for org "${org}"`);
      await activateOrgWebhook(webhook.hook_id, org);
    } else {
      console.log(`Skipping webhook "${webhook.hook_id}" for org "${org}" (already active)`);
    }
  }
}

async function getRepoWebhooks(owner, repo) {
  const webhook = await octokit.request("GET /repos/{owner}/{repo}/hooks", {
    owner: owner,
    repo: repo,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return getWebhookFields(webhook.data);
}

async function activateRepoWebhook(hook_id, org, repo) {
  try {
    await octokit.request("PATCH /repos/{owner}/{repo}/hooks/{hook_id}", {
      owner: org,
      repo: repo,
      hook_id: hook_id,
      active: true,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    failedActivations.push(`Repo hook ${org}/${repo}:${hook_id}`);
    console.error(`ERROR: ${error}`);
  }
}

async function activateAllRepoWebhooks(org, repo) {
  const webhooks = await getRepoWebhooks(org, repo);

  for (const webhook of webhooks) {
    // skip webhooks that are already active
    if (!webhook.active) {
      console.log(`Activating webhook "${webhook.hook_id}" for "${org}/${repo}"`);
      await activateRepoWebhook(webhook.hook_id, org, repo);
    } else {
      console.log(`Skipping webhook "${webhook.hook_id}" for "${org}/${repo}" (already active)`);
    }
  }
}

async function main() {
  try {
    for (const org of targetOrgs) {
      console.log(`Activating webhooks for org:"${org}`);
      await activateAllOrgWebhooks(org);
      console.log("");
      const repos = await getOrgRepos(org);
      console.log("Processing repo webhooks");
      for (const repo of repos) {
        console.log(`Activating webhooks for repo "${org}/${repo}`);
        await activateAllRepoWebhooks(org, repo);
      }
    }
  } finally {
    if (failedActivations.length) {
      console.log("Failed to active webhooks:");
      for (failure of failedActivations) {
        console.log(`\t${failure}`);
      }
    }
  }
}

main();
