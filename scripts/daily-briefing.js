import { LinearClient } from "@linear/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "fs";

// ─── Config ───────────────────────────────────────────────────────
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TEAM_KEY = process.env.LINEAR_TEAM_KEY || "YAK"; // Your Linear team key

if (!LINEAR_API_KEY || !ANTHROPIC_API_KEY) {
  console.error("Missing LINEAR_API_KEY or ANTHROPIC_API_KEY");
  process.exit(1);
}

// ─── Fetch Active Linear Issues ───────────────────────────────────
async function fetchLinearIssues() {
  console.log(`Initializing Linear client (team: ${TEAM_KEY})...`);
  console.log(`API key present: ${!!LINEAR_API_KEY} (length: ${LINEAR_API_KEY.length})`);

  const linear = new LinearClient({ apiKey: LINEAR_API_KEY });

  // Quick connectivity check — fetch the authenticated user
  try {
    const viewer = await linear.viewer;
    console.log(`Connected to Linear as: ${viewer.name} (${viewer.email})`);
  } catch (err) {
    console.error("Failed to authenticate with Linear:", err.message);
    throw err;
  }

  // Fetch issues for the team, no fancy filters — we'll filter in code
  console.log(`Fetching issues for team "${TEAM_KEY}"...`);
  let issues;
  try {
    issues = await linear.issues({
      first: 100,
      filter: {
        team: { key: { eq: TEAM_KEY } },
      },
    });
    console.log(`Linear returned ${issues.nodes.length} total issues (before filtering).`);
  } catch (err) {
    console.error("Failed to fetch issues from Linear:", err.message);
    throw err;
  }

  const enrichedIssues = [];

  let skipped = 0;
  for (const issue of issues.nodes) {
    const state = await issue.state;
    const stateName = state?.name || "Unknown";
    const stateType = state?.type || "unknown";

    // Skip completed and canceled issues
    if (stateType === "completed" || stateType === "canceled") {
      skipped++;
      continue;
    }

    const project = await issue.project;
    const assignee = await issue.assignee;
    const labels = await issue.labels();

    enrichedIssues.push({
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description?.substring(0, 200) || "",
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      dueDate: issue.dueDate,
      status: stateName,
      project: project?.name || "No Project",
      assignee: assignee?.name || "Unassigned",
      labels: labels.nodes.map((l) => l.name),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    });
  }

  console.log(`Enriched ${enrichedIssues.length} active issues (skipped ${skipped} completed/canceled).`);
  return enrichedIssues;
}

// ─── Generate Briefing via Claude ─────────────────────────────────
async function generateBriefing(issues) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const issuesSummary = issues
    .map(
      (i) =>
        `- ${i.identifier}: "${i.title}" | Project: ${i.project} | Status: ${i.status} | Priority: ${i.priorityLabel} | Assignee: ${i.assignee} | Due: ${i.dueDate || "No due date"} | Labels: ${i.labels.join(", ") || "none"} | Desc: ${i.description}`
    )
    .join("\n");

  const prompt = `You are a sharp, no-nonsense executive assistant for Zach Ellis who runs Yak Dev, a software development agency. Today is ${dayName}, ${dateStr}.

Here are all active issues from Linear:

${issuesSummary}

Generate a concise daily briefing for Zach. The format should be:

1. **TOP PRIORITY** — What must get done today. If something is overdue or due today, call it out hard.
2. **THIS WEEK** — What needs progress this week, organized by project.
3. **BLOCKED / WAITING** — Anything that's stuck and needs Zach to unblock it.
4. **LOW PRIORITY** — Things that exist but aren't urgent. Just a quick reminder they're there.

Keep it punchy and actionable. No fluff. Use plain text (this will be sent via iMessage so no markdown). Use line breaks and simple dashes for structure. Keep the whole thing under 1500 characters so it's readable on a phone screen.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].text;
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching Linear issues...");
  const issues = await fetchLinearIssues();
  console.log(`Found ${issues.length} active issues.`);

  if (issues.length === 0) {
    const briefing = "No active issues in Linear. Either you're crushing it or something is wrong.";
    writeFileSync("briefing/latest.txt", briefing);
    console.log("No issues found. Briefing saved.");
    return;
  }

  console.log("Generating briefing via Claude...");
  const briefing = await generateBriefing(issues);

  // Save to file (committed to repo for Shortcut to fetch)
  writeFileSync("briefing/latest.txt", briefing);

  // Also save a timestamped version for history
  const timestamp = new Date().toISOString().split("T")[0];
  writeFileSync(`briefing/archive/${timestamp}.txt`, briefing);

  console.log("Briefing generated and saved:");
  console.log(briefing);
}

main().catch((err) => {
  console.error("Failed to generate briefing:", err);
  process.exit(1);
});
