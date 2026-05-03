/**
 * 🤖 My Custom Coding Agent
 *
 * A fun coding agent built on pi's SDK with:
 * - A custom personality (pirate-themed!)
 * - A custom "weather" tool
 * - Colored terminal output
 * - Session persistence
 */

import { Type } from "@sinclair/typebox";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import * as readline from "readline";

// ── Colors for terminal output ──────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ── Custom Tool: Weather ────────────────────────────────────────────
const weatherTool = defineTool({
  name: "weather",
  label: "Weather",
  description: "Get the current weather for a city. Use this when the user asks about weather.",
  parameters: Type.Object({
    city: Type.String({ description: "City name" }),
  }),
  execute: async (_toolCallId, params) => {
    // Fake weather data for fun
    const conditions = ["☀️ Sunny", "🌧️ Rainy", "⛅ Partly Cloudy", "🌩️ Thunderstorms", "❄️ Snowy", "🌤️ Clear"];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = Math.floor(Math.random() * 35) + 5;
    const result = `Weather in ${params.city}: ${condition}, ${temp}°C`;
    return {
      content: [{ type: "text", text: result }],
      details: {},
    };
  },
});

// ── Custom Tool: Timestamp ──────────────────────────────────────────
const timestampTool = defineTool({
  name: "timestamp",
  label: "Timestamp",
  description: "Get the current date and time",
  parameters: Type.Object({}),
  execute: async () => ({
    content: [{ type: "text", text: `Current time: ${new Date().toISOString()}` }],
    details: {},
  }),
});

// ── Setup ───────────────────────────────────────────────────────────
async function main() {
  console.log(bold(cyan("\n🏴‍☠️  Captain Code — Your Pirate Coding Agent\n")));
  console.log(dim("Built on pi SDK • Type 'exit' or 'quit' to leave\n"));

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  // Pick a model (try sonnet first, fall back to whatever is available)
  const available = await modelRegistry.getAvailable();
  if (available.length === 0) {
    console.error(red("❌ No models available! Set an API key first:"));
    console.error(dim("   export ANTHROPIC_API_KEY=sk-..."));
    console.error(dim("   export OPENAI_API_KEY=sk-..."));
    process.exit(1);
  }

  // Prefer sonnet, fall back to first available
  const preferredModel =
    available.find((m) => m.id.includes("sonnet")) ??
    available[0];

  console.log(green(`✓ Model: ${(preferredModel as any).name ?? preferredModel.id} (${preferredModel.provider})`));
  console.log(green(`✓ Tools: read, bash, edit, write + weather, timestamp`));
  console.log(dim("─".repeat(55)) + "\n");

  // Custom system prompt with pirate personality
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => `You are Captain Code, a pirate-themed coding assistant! 🏴‍☠️

You speak with occasional pirate flair (but stay helpful and clear).
Sprinkle in nautical terms like "Ahoy!", "Aye!", "Arrr", "matey", "sailing through the code", etc.
But don't overdo it — you're a professional pirate who gets things done.

You have access to standard coding tools (read, bash, edit, write) plus:
- weather: get weather for any city (for fun)
- timestamp: get current date/time

Be concise. Help the user code. Have fun! 🦜`,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    model: preferredModel,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    resourceLoader: loader,
    customTools: [weatherTool, timestampTool],
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    }),
  });

  // ── Event Handling ──────────────────────────────────────────────
  session.subscribe((event) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
        break;

      case "tool_execution_start":
        process.stdout.write(yellow(`\n⚓ [${event.toolName}] `));
        break;

      case "tool_execution_end":
        if (event.isError) {
          process.stdout.write(red("✗ error\n"));
        } else {
          process.stdout.write(green("✓ done\n"));
        }
        break;

      case "agent_end":
        process.stdout.write("\n");
        break;
    }
  });

  // ── REPL Loop ─────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question(magenta("\n🦜 You > "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return ask();
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(cyan("\n🏴‍☠️  Fair winds, matey! Until next time! ⚓\n"));
        session.dispose();
        rl.close();
        return;
      }

      try {
        process.stdout.write(cyan("\n🏴‍☠️  Captain Code > "));
        await session.prompt(trimmed);
      } catch (err: any) {
        console.error(red(`\n❌ Error: ${err.message}`));
      }
      ask();
    });
  };

  rl.on("close", () => {
    session.dispose();
    process.exit(0);
  });

  ask();
}

main().catch((err) => {
  console.error(red(`Fatal: ${err.message}`));
  process.exit(1);
});
