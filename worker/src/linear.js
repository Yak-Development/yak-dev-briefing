// ─── Linear GraphQL API Layer ─────────────────────────────────────

const LINEAR_API = "https://api.linear.app/graphql";

async function gql(apiKey, query, variables = {}) {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data;
}

// ─── Queries ──────────────────────────────────────────────────────

export async function fetchActiveIssues(apiKey, teamKey) {
  const data = await gql(
    apiKey,
    `query($teamKey: String!) {
      issues(
        filter: {
          team: { key: { eq: $teamKey } }
          state: { type: { in: ["backlog", "unstarted", "started"] } }
        }
        first: 100
      ) {
        nodes {
          id identifier title description
          priority priorityLabel dueDate
          state { id name type }
          project { id name }
          assignee { id name }
          labels { nodes { id name } }
          url createdAt updatedAt
        }
      }
    }`,
    { teamKey }
  );
  return data.issues.nodes;
}

export async function fetchWorkflowStates(apiKey, teamKey) {
  const data = await gql(
    apiKey,
    `query($teamKey: String!) {
      workflowStates(filter: { team: { key: { eq: $teamKey } } }) {
        nodes { id name type }
      }
    }`,
    { teamKey }
  );
  return data.workflowStates.nodes;
}

export async function fetchTeamId(apiKey, teamKey) {
  const data = await gql(
    apiKey,
    `query($teamKey: String!) {
      teams(filter: { key: { eq: $teamKey } }) {
        nodes { id name }
      }
    }`,
    { teamKey }
  );
  return data.teams.nodes[0]?.id;
}

export async function fetchLabels(apiKey) {
  const data = await gql(
    apiKey,
    `query {
      issueLabels(first: 250) {
        nodes { id name }
      }
    }`
  );
  return data.issueLabels.nodes;
}

export async function fetchProjects(apiKey) {
  const data = await gql(
    apiKey,
    `query {
      projects(first: 100) {
        nodes { id name state }
      }
    }`
  );
  return data.projects.nodes;
}

export async function fetchMembers(apiKey, teamKey) {
  const data = await gql(
    apiKey,
    `query($teamKey: String!) {
      teams(filter: { key: { eq: $teamKey } }) {
        nodes { members { nodes { id name displayName } } }
      }
    }`,
    { teamKey }
  );
  return data.teams.nodes[0]?.members?.nodes || [];
}

// ─── Mutations ────────────────────────────────────────────────────

export async function updateIssue(apiKey, issueId, input) {
  const data = await gql(
    apiKey,
    `mutation($issueId: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $issueId, input: $input) {
        issue {
          id identifier title dueDate
          state { name }
          priority priorityLabel
          assignee { name }
          labels { nodes { name } }
          project { name }
        }
      }
    }`,
    { issueId, input }
  );
  return data.issueUpdate.issue;
}

export async function createIssue(apiKey, input) {
  const data = await gql(
    apiKey,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue { id identifier title url dueDate state { name } }
      }
    }`,
    { input }
  );
  return data.issueCreate.issue;
}

export async function createComment(apiKey, issueId, body) {
  const data = await gql(
    apiKey,
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        comment { id body }
      }
    }`,
    { issueId, body }
  );
  return data.commentCreate.comment;
}

export async function createProject(apiKey, name, teamIds, description) {
  const input = { name, teamIds };
  if (description) input.description = description;
  const data = await gql(
    apiKey,
    `mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        project { id name }
      }
    }`,
    { input }
  );
  return data.projectCreate.project;
}

export async function createLabel(apiKey, teamId, name) {
  const data = await gql(
    apiKey,
    `mutation($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) {
        issueLabel { id name }
      }
    }`,
    { input: { name, teamId } }
  );
  return data.issueLabelCreate.issueLabel;
}
