// ─── Claude Tool Definitions & Handlers ───────────────────────────

import {
  updateIssue,
  createIssue as createLinearIssue,
  createComment,
  createProject as createLinearProject,
  createLabel,
} from "./linear.js";

// ─── Tool Schemas (sent to Claude) ───────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "update_issue_status",
    description:
      "Update the status/state of a Linear issue. Use when the user says they finished, started, paused, or want to move a task to a different state.",
    input_schema: {
      type: "object",
      properties: {
        issue_identifier: {
          type: "string",
          description: "The issue identifier, e.g. 'YAK-42'",
        },
        status: {
          type: "string",
          description:
            "The exact workflow state name to move to. Must match one of the available states provided in your context.",
        },
      },
      required: ["issue_identifier", "status"],
    },
  },
  {
    name: "update_issue_priority",
    description: "Change the priority of a Linear issue.",
    input_schema: {
      type: "object",
      properties: {
        issue_identifier: {
          type: "string",
          description: "The issue identifier, e.g. 'YAK-42'",
        },
        priority: {
          type: "number",
          description:
            "Priority level: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low",
        },
      },
      required: ["issue_identifier", "priority"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a Linear issue.",
    input_schema: {
      type: "object",
      properties: {
        issue_identifier: {
          type: "string",
          description: "The issue identifier, e.g. 'YAK-42'",
        },
        comment: {
          type: "string",
          description: "The comment text to add",
        },
      },
      required: ["issue_identifier", "comment"],
    },
  },
  {
    name: "add_label",
    description:
      "Add a label to a Linear issue. Creates the label if it doesn't exist yet. Good for marking things as blocked, urgent, bug, etc.",
    input_schema: {
      type: "object",
      properties: {
        issue_identifier: {
          type: "string",
          description: "The issue identifier, e.g. 'YAK-42'",
        },
        label_name: {
          type: "string",
          description: "The label name to add (e.g. 'Blocked', 'Bug', 'Urgent')",
        },
      },
      required: ["issue_identifier", "label_name"],
    },
  },
  {
    name: "create_issue",
    description:
      "Create a new Linear issue/task in the team workspace. Can optionally include subtasks (child issues) and a due date.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The issue title",
        },
        description: {
          type: "string",
          description: "Optional longer description of the issue",
        },
        project_name: {
          type: "string",
          description: "Optional — name of an existing project to add this issue to",
        },
        priority: {
          type: "number",
          description:
            "Priority: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low. Defaults to 0.",
        },
        status: {
          type: "string",
          description:
            "Initial workflow state name. Defaults to the team's default state (usually 'Todo' or 'Backlog').",
        },
        due_date: {
          type: "string",
          description:
            "Due date in YYYY-MM-DD format, e.g. '2026-03-01'. Optional.",
        },
        subtasks: {
          type: "array",
          description:
            "Optional list of subtasks to create as child issues under this parent. Each subtask inherits the parent's project and team.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "The subtask title",
              },
              description: {
                type: "string",
                description: "Optional description for the subtask",
              },
              due_date: {
                type: "string",
                description: "Optional due date for the subtask in YYYY-MM-DD format",
              },
              priority: {
                type: "number",
                description:
                  "Priority: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.",
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["title"],
    },
  },
  {
    name: "create_project",
    description: "Create a new Linear project.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The project name",
        },
        description: {
          type: "string",
          description: "Optional project description",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "assign_issue",
    description: "Assign (or reassign) a Linear issue to a team member.",
    input_schema: {
      type: "object",
      properties: {
        issue_identifier: {
          type: "string",
          description: "The issue identifier, e.g. 'YAK-42'",
        },
        assignee_name: {
          type: "string",
          description: "The name (or part of the name) of the team member to assign to",
        },
      },
      required: ["issue_identifier", "assignee_name"],
    },
  },
  {
    name: "update_due_date",
    description:
      "Set or change the due date on an existing Linear issue. Can also clear the due date.",
    input_schema: {
      type: "object",
      properties: {
        issue_identifier: {
          type: "string",
          description: "The issue identifier, e.g. 'YAK-42'",
        },
        due_date: {
          type: "string",
          description:
            "The due date in YYYY-MM-DD format, e.g. '2026-03-01'. Pass null or empty string to clear the due date.",
        },
      },
      required: ["issue_identifier", "due_date"],
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────────────

/**
 * Execute a tool call and return a result object for Claude.
 *
 * @param {string} toolName
 * @param {object} input - The parsed input from Claude's tool_use block
 * @param {object} ctx   - Shared context: { apiKey, teamId, teamKey, issues, states, labels, projects, members }
 */
export async function executeTool(toolName, input, ctx) {
  try {
    switch (toolName) {
      case "update_issue_status":
        return await handleUpdateStatus(input, ctx);
      case "update_issue_priority":
        return await handleUpdatePriority(input, ctx);
      case "add_comment":
        return await handleAddComment(input, ctx);
      case "add_label":
        return await handleAddLabel(input, ctx);
      case "create_issue":
        return await handleCreateIssue(input, ctx);
      case "create_project":
        return await handleCreateProject(input, ctx);
      case "assign_issue":
        return await handleAssignIssue(input, ctx);
      case "update_due_date":
        return await handleUpdateDueDate(input, ctx);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: `Tool "${toolName}" failed: ${err.message}` };
  }
}

// ─── Individual Handlers ─────────────────────────────────────────

function findIssue(identifier, issues) {
  const upper = identifier.toUpperCase();
  return issues.find((i) => i.identifier === upper);
}

async function handleUpdateStatus(input, ctx) {
  const issue = findIssue(input.issue_identifier, ctx.issues);
  if (!issue) return { error: `Issue ${input.issue_identifier} not found in active issues.` };

  const state = ctx.states.find(
    (s) => s.name.toLowerCase() === input.status.toLowerCase()
  );
  if (!state)
    return {
      error: `State "${input.status}" not found. Available: ${ctx.states.map((s) => s.name).join(", ")}`,
    };

  const updated = await updateIssue(ctx.apiKey, issue.id, { stateId: state.id });
  return {
    success: true,
    issue: updated.identifier,
    title: updated.title,
    new_status: updated.state.name,
  };
}

async function handleUpdatePriority(input, ctx) {
  const issue = findIssue(input.issue_identifier, ctx.issues);
  if (!issue) return { error: `Issue ${input.issue_identifier} not found in active issues.` };

  const updated = await updateIssue(ctx.apiKey, issue.id, { priority: input.priority });
  return {
    success: true,
    issue: updated.identifier,
    title: updated.title,
    new_priority: updated.priorityLabel,
  };
}

async function handleAddComment(input, ctx) {
  const issue = findIssue(input.issue_identifier, ctx.issues);
  if (!issue) return { error: `Issue ${input.issue_identifier} not found in active issues.` };

  const comment = await createComment(ctx.apiKey, issue.id, input.comment);
  return {
    success: true,
    issue: issue.identifier,
    comment_preview: comment.body.substring(0, 100),
  };
}

async function handleAddLabel(input, ctx) {
  const issue = findIssue(input.issue_identifier, ctx.issues);
  if (!issue) return { error: `Issue ${input.issue_identifier} not found in active issues.` };

  // Find existing label (case-insensitive) or create a new one
  let label = ctx.labels.find(
    (l) => l.name.toLowerCase() === input.label_name.toLowerCase()
  );
  if (!label) {
    label = await createLabel(ctx.apiKey, ctx.teamId, input.label_name);
  }

  // Check if already applied
  const currentLabelIds = issue.labels.nodes.map((l) => l.id);
  if (currentLabelIds.includes(label.id)) {
    return {
      success: true,
      message: `${issue.identifier} already has label "${label.name}"`,
    };
  }

  // Append the new label (don't replace existing ones)
  const updated = await updateIssue(ctx.apiKey, issue.id, {
    labelIds: [...currentLabelIds, label.id],
  });
  return {
    success: true,
    issue: updated.identifier,
    labels: updated.labels.nodes.map((l) => l.name),
  };
}

async function handleCreateIssue(input, ctx) {
  const createInput = {
    teamId: ctx.teamId,
    title: input.title,
  };

  if (input.description) createInput.description = input.description;
  if (input.priority !== undefined) createInput.priority = input.priority;
  if (input.due_date) createInput.dueDate = input.due_date;

  // Match project by name (fuzzy — contains match)
  let projectId;
  if (input.project_name) {
    const project = ctx.projects.find((p) =>
      p.name.toLowerCase().includes(input.project_name.toLowerCase())
    );
    if (project) {
      projectId = project.id;
      createInput.projectId = projectId;
    }
  }

  // Match initial workflow state
  if (input.status) {
    const state = ctx.states.find(
      (s) => s.name.toLowerCase() === input.status.toLowerCase()
    );
    if (state) createInput.stateId = state.id;
  }

  const parentIssue = await createLinearIssue(ctx.apiKey, createInput);

  const result = {
    success: true,
    issue: parentIssue.identifier,
    title: parentIssue.title,
    url: parentIssue.url,
    due_date: parentIssue.dueDate || null,
  };

  // Create subtasks as child issues
  if (input.subtasks && input.subtasks.length > 0) {
    const subtaskResults = [];
    for (const sub of input.subtasks) {
      const subInput = {
        teamId: ctx.teamId,
        title: sub.title,
        parentId: parentIssue.id,
      };
      if (sub.description) subInput.description = sub.description;
      if (sub.priority !== undefined) subInput.priority = sub.priority;
      if (sub.due_date) subInput.dueDate = sub.due_date;
      if (projectId) subInput.projectId = projectId;

      const subIssue = await createLinearIssue(ctx.apiKey, subInput);
      subtaskResults.push({
        issue: subIssue.identifier,
        title: subIssue.title,
        due_date: subIssue.dueDate || null,
      });
    }
    result.subtasks = subtaskResults;
  }

  return result;
}

async function handleCreateProject(input, ctx) {
  const project = await createLinearProject(
    ctx.apiKey,
    input.name,
    [ctx.teamId],
    input.description
  );
  return { success: true, project: project.name, id: project.id };
}

async function handleAssignIssue(input, ctx) {
  const issue = findIssue(input.issue_identifier, ctx.issues);
  if (!issue) return { error: `Issue ${input.issue_identifier} not found in active issues.` };

  // Fuzzy match member name
  const nameLower = input.assignee_name.toLowerCase();
  const member = ctx.members.find(
    (m) =>
      m.name?.toLowerCase().includes(nameLower) ||
      m.displayName?.toLowerCase().includes(nameLower)
  );
  if (!member)
    return {
      error: `Team member "${input.assignee_name}" not found. Available: ${ctx.members.map((m) => m.name).join(", ")}`,
    };

  const updated = await updateIssue(ctx.apiKey, issue.id, { assigneeId: member.id });
  return {
    success: true,
    issue: updated.identifier,
    title: updated.title,
    assignee: updated.assignee?.name,
  };
}

async function handleUpdateDueDate(input, ctx) {
  const issue = findIssue(input.issue_identifier, ctx.issues);
  if (!issue) return { error: `Issue ${input.issue_identifier} not found in active issues.` };

  // Allow clearing the due date by passing null/empty
  const dueDate = input.due_date && input.due_date.trim() !== "" ? input.due_date : null;

  const updated = await updateIssue(ctx.apiKey, issue.id, { dueDate });
  return {
    success: true,
    issue: updated.identifier,
    title: updated.title,
    due_date: updated.dueDate || "cleared",
  };
}
