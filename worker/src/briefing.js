// ─── Daily Briefing (cron-triggered, sent via Telegram) ──────────

import { fetchActiveIssues } from "./linear.js";
import { sendMessage } from "./telegram.js";

const CACHE_KEY = "briefing_cache";
const STALE_DAYS_THRESHOLD = 3;

/**
 * Generate + send the daily briefing. Called by the scheduled handler.
 * Uses KV-based caching — same logic as the original script:
 *   - Hash issues to detect changes
 *   - If unchanged, reuse cached briefing (skip Anthropic)
 *   - After 3+ unchanged days, send "SNAP OUT OF IT, LOCK IN!"
 */
export async function handleDailyBriefing(env) {
  const teamKey = env.LINEAR_TEAM_KEY || "YAK";
  const today = new Date().toISOString().split("T")[0];

  console.log(`[Briefing] Running for ${today}...`);

  // ─── Fetch issues ───────────────────────────────────────────
  let issues;
  try {
    issues = await fetchActiveIssues(env.LINEAR_API_KEY, teamKey);
  } catch (err) {
    console.error("[Briefing] Failed to fetch Linear issues:", err.message);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      env.TELEGRAM_CHAT_ID,
      `Briefing failed — couldn't reach Linear: ${err.message}`
    );
    return;
  }

  if (issues.length === 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      env.TELEGRAM_CHAT_ID,
      "No active issues in Linear. Either you're crushing it or something is wrong."
    );
    return;
  }

  // ─── Cache check ────────────────────────────────────────────
  const currentHash = await hashIssues(issues);
  let cache;
  try {
    cache = await env.KV.get(CACHE_KEY, "json");
  } catch {
    cache = null;
  }

  if (cache && cache.hash === currentHash) {
    const unchangedDays = (cache.unchangedDays || 0) + 1;
    console.log(`[Briefing] Tasks unchanged for ${unchangedDays} day(s). Skipping Anthropic.`);

    let briefing;
    if (unchangedDays >= STALE_DAYS_THRESHOLD) {
      briefing = "SNAP OUT OF IT, LOCK IN!";
      console.log(`[Briefing] Stale for ${unchangedDays} days — wake-up call.`);
    } else {
      briefing = cache.briefing;
    }

    await env.KV.put(
      CACHE_KEY,
      JSON.stringify({
        hash: currentHash,
        briefing: cache.briefing, // always keep the real briefing text
        unchangedDays,
        lastRun: today,
      })
    );

    await sendMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, briefing);
    return;
  }

  // ─── Generate fresh briefing ────────────────────────────────
  console.log("[Briefing] Tasks changed (or first run). Calling Anthropic...");
  const briefing = await generateBriefing(issues, env);

  await env.KV.put(
    CACHE_KEY,
    JSON.stringify({
      hash: currentHash,
      briefing,
      unchangedDays: 0,
      lastRun: today,
    })
  );

  await sendMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, briefing);
  console.log("[Briefing] Sent.");
}

// ─── Briefing Generation ──────────────────────────────────────────

async function generateBriefing(issues, env) {
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
        `- ${i.identifier}: "${i.title}" | Project: ${i.project?.name || "No Project"} | Status: ${i.state?.name || "Unknown"} | Priority: ${i.priorityLabel} | Assignee: ${i.assignee?.name || "Unassigned"} | Due: ${i.dueDate || "No due date"} | Labels: ${i.labels?.nodes?.map((l) => l.name).join(", ") || "none"} | Desc: ${(i.description || "").substring(0, 200)}`
    )
    .join("\n");

  const prompt = `You are a sharp, no-nonsense executive assistant for Zach Ellis who runs Yak Dev, a software development agency. Today is ${dayName}, ${dateStr}.

Here are all active issues from Linear:

${issuesSummary}

Generate a concise daily briefing for Zach. The format should be:

1. TOP PRIORITY — What must get done today. If something is overdue or due today, call it out hard.
2. THIS WEEK — What needs progress this week, organized by project.
3. BLOCKED / WAITING — Anything that's stuck and needs Zach to unblock it.
4. LOW PRIORITY — Things that exist but aren't urgent. Just a quick reminder they're there.

Keep it punchy and actionable. No fluff. Use plain text (this goes to Telegram, no markdown). Use line breaks and simple dashes for structure. Keep the whole thing under 1500 characters so it's readable on a phone screen.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-opus-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// ─── Hashing (Web Crypto — no Node crypto module in Workers) ─────

async function hashIssues(issues) {
  const normalized = issues
    .map((i) => ({
      id: i.identifier,
      status: i.state?.name,
      priority: i.priority,
      assignee: i.assignee?.name,
      project: i.project?.name,
      labels: (i.labels?.nodes?.map((l) => l.name) || []).sort(),
      dueDate: i.dueDate,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const data = new TextEncoder().encode(JSON.stringify(normalized));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
