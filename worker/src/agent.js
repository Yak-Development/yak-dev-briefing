// ─── Claude Agent with Tool Use ───────────────────────────────────

import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const HISTORY_KEY = "conversation_history";
const MAX_HISTORY_PAIRS = 20; // keep last 20 exchanges (40 messages)

// ─── Public API ───────────────────────────────────────────────────

/**
 * Process a user message through Claude with Linear tools.
 * Returns the final text response to send back to the user.
 *
 * @param {string}  userMessage - The raw text from Telegram
 * @param {object}  env         - Worker env (secrets, KV, vars)
 * @param {object}  ctx         - Linear context: { apiKey, teamId, teamKey, issues, states, labels, projects, members }
 */
export async function runAgent(userMessage, env, ctx) {
  const history = await getHistory(env);
  const system = buildSystemPrompt(ctx);

  // Build message array: history + new user message
  const messages = [...history, { role: "user", content: userMessage }];

  // First Claude call
  let response = await callClaude(env, system, messages);

  // Tool-use loop — keep going until Claude gives a final text response
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (response.stop_reason === "tool_use" && iterations < MAX_ITERATIONS) {
    iterations++;

    // Collect all tool calls from this response
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`Tool call: ${block.name}(${JSON.stringify(block.input)})`);
        const result = await executeTool(block.name, block.input, ctx);
        console.log(`Tool result: ${JSON.stringify(result)}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Feed results back to Claude
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await callClaude(env, system, messages);
  }

  // Extract final text
  const assistantText = response.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n") || "Done — but I couldn't generate a response. Something might be off.";

  // Persist only the human-readable parts of the conversation (not tool guts)
  await saveHistory(env, history, userMessage, assistantText);

  return assistantText;
}

// ─── System Prompt ────────────────────────────────────────────────

function buildSystemPrompt(ctx) {
  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const issueList = ctx.issues.length
    ? ctx.issues
        .map(
          (i) =>
            `${i.identifier}: "${i.title}" | Status: ${i.state?.name || "?"} | Priority: ${i.priorityLabel || "None"} | Project: ${i.project?.name || "None"} | Assignee: ${i.assignee?.name || "Unassigned"} | Due: ${i.dueDate || "None"} | Labels: ${i.labels?.nodes?.map((l) => l.name).join(", ") || "none"}`
        )
        .join("\n")
    : "(No active issues)";

  const stateNames = ctx.states.map((s) => `${s.name} (${s.type})`).join(", ");

  return `You are Zach Ellis's sharp, no-nonsense task management agent for Yak Dev, a software development agency. Today is ${dayName}, ${dateStr}.

CURRENT ACTIVE ISSUES (team ${ctx.teamKey}):
${issueList}

AVAILABLE WORKFLOW STATES: ${stateNames}

YOUR JOB:
- Process Zach's messages about task updates, completions, new work, blockers, etc.
- Use your tools to make changes in Linear — update statuses, add comments, create issues, label things, assign work, create projects.
- You CAN make multiple tool calls in one turn if the message asks for multiple things.
- Match task references loosely. If Zach says "the auth thing", match it to whichever issue has "auth" in the title. If ambiguous, ask.
- Keep responses SHORT — this is a text conversation on a phone. Confirm what you did in 1-3 lines max.
- Use plain text only, no markdown formatting.
- If Zach is just chatting or asking a question (not requesting a task change), just respond conversationally. You don't have to use tools every time.`;
}

// ─── Claude API ───────────────────────────────────────────────────

async function callClaude(env, system, messages) {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-opus-4-6",
      max_tokens: 1024,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }

  return await res.json();
}

// ─── Conversation History (KV) ────────────────────────────────────

async function getHistory(env) {
  try {
    const stored = await env.KV.get(HISTORY_KEY, "json");
    return stored || [];
  } catch {
    return [];
  }
}

async function saveHistory(env, existing, userMsg, assistantMsg) {
  const updated = [
    ...existing,
    { role: "user", content: userMsg },
    { role: "assistant", content: assistantMsg },
  ];
  // Trim to last N pairs
  const trimmed = updated.slice(-(MAX_HISTORY_PAIRS * 2));
  await env.KV.put(HISTORY_KEY, JSON.stringify(trimmed));
}
