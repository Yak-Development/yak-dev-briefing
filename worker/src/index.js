// ─── YakDev Agent — Cloudflare Worker Entry Point ─────────────────
//
// Handles two things:
//   1. Telegram webhook (POST /webhook) — two-way agent conversation
//   2. Cron trigger (scheduled)        — daily briefing via Telegram
//
// ───────────────────────────────────────────────────────────────────

import { parseUpdate, sendMessage, sendTyping } from "./telegram.js";
import { runAgent } from "./agent.js";
import { handleDailyBriefing } from "./briefing.js";
import {
  fetchActiveIssues,
  fetchWorkflowStates,
  fetchLabels,
  fetchTeamId,
  fetchProjects,
  fetchMembers,
} from "./linear.js";

export default {
  // ─── HTTP handler (Telegram webhook) ────────────────────────
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);

    // Telegram webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Verify secret token (set when registering the webhook)
      if (env.WEBHOOK_SECRET) {
        const token = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (token !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const body = await request.json();
      const update = parseUpdate(body);

      if (!update) return new Response("OK");

      // Security: only respond to the configured chat
      if (update.chatId !== env.TELEGRAM_CHAT_ID) {
        console.log(`Ignoring message from unknown chat: ${update.chatId}`);
        return new Response("OK");
      }

      // Return 200 immediately, process in background
      // (Telegram retries if we don't respond within ~60s)
      execCtx.waitUntil(processMessage(update, env));

      return new Response("OK");
    }

    // Setup helper: hitting the root shows a quick status page
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        "YakDev Agent is running.\n\nSet your Telegram webhook to: POST " +
          url.origin +
          "/webhook",
        { status: 200, headers: { "Content-Type": "text/plain" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },

  // ─── Cron handler (daily briefing) ──────────────────────────
  async scheduled(event, env, execCtx) {
    execCtx.waitUntil(handleDailyBriefing(env));
  },
};

// ─── Message Processing ───────────────────────────────────────────

async function processMessage(update, env) {
  try {
    // Handle commands
    if (update.text.startsWith("/")) {
      await handleCommand(update, env);
      return;
    }

    // Show typing indicator while we work
    await sendTyping(env.TELEGRAM_BOT_TOKEN, update.chatId);

    // Fetch all Linear context in parallel
    const teamKey = env.LINEAR_TEAM_KEY || "YAK";
    const [issues, states, labels, teamId, projects, members] =
      await Promise.all([
        fetchActiveIssues(env.LINEAR_API_KEY, teamKey),
        fetchWorkflowStates(env.LINEAR_API_KEY, teamKey),
        fetchLabels(env.LINEAR_API_KEY),
        fetchTeamId(env.LINEAR_API_KEY, teamKey),
        fetchProjects(env.LINEAR_API_KEY),
        fetchMembers(env.LINEAR_API_KEY, teamKey),
      ]);

    const ctx = {
      apiKey: env.LINEAR_API_KEY,
      teamKey,
      teamId,
      issues,
      states,
      labels,
      projects,
      members,
    };

    // Run the Claude agent
    const response = await runAgent(update.text, env, ctx);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, update.chatId, response);
  } catch (err) {
    console.error("Error processing message:", err);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      update.chatId,
      `Something broke: ${err.message}\n\nTry again or check the Worker logs.`
    );
  }
}

// ─── Bot Commands ─────────────────────────────────────────────────

async function handleCommand(update, env) {
  const cmd = update.text.split(" ")[0].toLowerCase();

  switch (cmd) {
    case "/start":
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        update.chatId,
        `YakDev Agent is live.\n\nYour chat ID: ${update.chatId}\n\nJust text me like normal:\n- "Finished the auth flow, YAK-42 is done"\n- "Block YAK-15, waiting on client assets"\n- "Create a new task: set up staging environment"\n- "What's on my plate?"\n\nI'll handle the Linear updates for you.`
      );
      break;

    case "/briefing":
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        update.chatId,
        "Generating your briefing..."
      );
      await handleDailyBriefing(env);
      break;

    case "/clear":
      await env.KV.delete("conversation_history");
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        update.chatId,
        "Conversation history cleared. Fresh start."
      );
      break;

    case "/help":
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        update.chatId,
        [
          "COMMANDS:",
          "/briefing — Get your daily briefing now",
          "/clear — Reset conversation history",
          "/help — This message",
          "",
          "Or just text me naturally:",
          '- "Mark YAK-42 as done"',
          '- "Add a blocked label to YAK-15"',
          '- "Create a task: fix login bug, high priority"',
          '- "Assign YAK-20 to Zach"',
          '- "Create a new project called Client Portal"',
          '- "What should I work on today?"',
        ].join("\n")
      );
      break;

    default:
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        update.chatId,
        `Unknown command: ${cmd}\n\nTry /help for available commands, or just text me naturally.`
      );
  }
}
