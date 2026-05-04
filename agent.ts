/**
 * 🤖 My Custom Coding Agent
 *
 * A coding agent built on pi's SDK with:
 * - Custom tools (weather, timestamp)
 * - Colored terminal output
 * - Tab autocomplete
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
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;

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
  console.log(bold(cyan("\n🤖  CodeBot — Custom Coding Agent\n")));
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

  // Custom system prompt
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    systemPromptOverride: () => `You are CodeBot, a helpful and concise coding assistant.

You have access to standard coding tools (read, bash, edit, write) plus:
- weather: get weather for any city
- timestamp: get current date/time

Be concise and direct. Focus on helping the user code effectively.`,
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

  // ── Spinner ───────────────────────────────────────────────────────
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;

  const startSpinner = (label = "Thinking") => {
    stopSpinner();
    spinnerFrame = 0;
    process.stdout.write(dim(`\n${spinnerFrames[0]} ${label}...`));
    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
      process.stdout.write(`\r${dim(`${spinnerFrames[spinnerFrame]} ${label}...`)}`);
    }, 80);
  };

  const stopSpinner = () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write("\r\x1b[K");
    }
  };

  let firstTextReceived = false;

  // ── Event Handling ──────────────────────────────────────────────
  session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        firstTextReceived = false;
        startSpinner("Thinking");
        break;

      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          if (!firstTextReceived) {
            stopSpinner();
            firstTextReceived = true;
          }
          process.stdout.write(event.assistantMessageEvent.delta);
        }
        break;

      case "tool_execution_start": {
        stopSpinner();
        const args = event.args ?? {};
        let detail = "";
        if (event.toolName === "bash" && args.command) {
          detail = dim(` $ ${args.command}`);
        } else if (event.toolName === "read" && args.path) {
          detail = dim(` ${args.path}`);
        } else if (event.toolName === "edit" && args.path) {
          detail = dim(` ${args.path}`);
        } else if (event.toolName === "write" && args.path) {
          detail = dim(` ${args.path}`);
        } else if (Object.keys(args).length > 0) {
          detail = dim(` ${JSON.stringify(args)}`);
        }
        process.stdout.write(yellow(`\n⚓ [${event.toolName}]`) + detail + " ");
        break;
      }

      case "tool_execution_end":
        if (event.isError) {
          process.stdout.write(red("✗ error\n"));
        } else {
          process.stdout.write(green("✓ done\n"));
        }
        startSpinner("Thinking");
        break;

      case "agent_end":
        stopSpinner();
        process.stdout.write("\n");
        break;
    }
  });

  // ── Slash Commands ────────────────────────────────────────────
  const slashCommands: { name: string; description: string; handler: () => void | Promise<void> }[] = [
    { name: "/help", description: "Show this help", handler: () => {
      console.log(cyan("\n🤖  CodeBot — Commands"));
      console.log(dim("─".repeat(40)));
      for (const cmd of slashCommands) {
        console.log(`  ${green(cmd.name.padEnd(14))} ${dim(cmd.description)}`);
      }
      console.log(dim("\n  Tab to autocomplete commands & tool names"));
    }},
    { name: "/tools", description: "List available tools", handler: () => {
      console.log(cyan("\n⚓ Available Tools:"));
      for (const tool of session.agent.state.tools) {
        console.log(`  ${yellow(tool.name.padEnd(14))} ${dim(tool.description ?? "")}`);
      }
    }},
    { name: "/model", description: "Show current model", handler: () => {
      const m = session.agent.state.model;
      console.log(cyan(`\n🤖 Model: ${(m as any)?.name ?? m?.id ?? "unknown"} (${m?.provider})`));
    }},
    { name: "/models", description: "List and switch models", handler: async () => {
      console.log(cyan("\n🤖 Available Models:"));
      console.log(dim("─".repeat(50)));
      const currentModel = session.agent.state.model;
      for (let i = 0; i < available.length; i++) {
        const m = available[i];
        const label = `${(m as any).name ?? m.id}`;
        const isCurrent = m.id === currentModel?.id && m.provider === currentModel?.provider;
        const prefix = isCurrent ? green("▸ ") : "  ";
        const suffix = isCurrent ? green(" (current)") : "";
        console.log(`${prefix}${yellow(String(i + 1).padStart(2))}. ${label.padEnd(30)} ${dim(m.provider)}${suffix}`);
      }
      console.log(dim(`\nType /switch <number> to change model`));
    }},
    { name: "/switch", description: "Switch model (e.g. /switch 3)", handler: () => {
      // Handled separately since it takes an argument
    }},
    { name: "/clear", description: "Clear the screen", handler: () => {
      console.clear();
    }},
    { name: "/exit", description: "Quit", handler: () => {
      console.log(cyan("\nGoodbye! 👋\n"));
      session.dispose();
      rl.close();
    }},
  ];

  const slashNames = slashCommands.map((c) => c.name);

  // ── Autocomplete ──────────────────────────────────────────────
  const toolNames = session.agent.state.tools.map((t) => t.name);
  const plainCommands = ["exit", "quit", "help", "tools"];
  const allCompletions = [...plainCommands, ...slashNames, ...toolNames];

  const completer = (line: string): [string[], string] => {
    const words = line.split(/\s+/);
    const current = words[words.length - 1].toLowerCase();
    if (!current) return [[], line];

    // Typing "/" — show all slash commands
    if (current === "/") return [slashNames, current];

    // Typing "/..." — filter slash commands
    if (current.startsWith("/")) {
      const hits = slashNames.filter((c) => c.startsWith(current));
      return [hits.length ? hits : slashNames, current];
    }

    const hits = allCompletions.filter((c) => c.toLowerCase().startsWith(current));
    return [hits.length ? hits : allCompletions, current];
  };

  // ── REPL Loop ─────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  const ask = () => {
    rl.question(blue("\n> "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return ask();
      // Handle slash commands
      if (trimmed.startsWith("/switch ")) {
        const num = parseInt(trimmed.slice(8).trim(), 10);
        if (isNaN(num) || num < 1 || num > available.length) {
          console.log(red(`\nInvalid model number. Use 1-${available.length}. See /models`));
        } else {
          const newModel = available[num - 1];
          try {
            await session.setModel(newModel as any);
            console.log(green(`\n✓ Switched to: ${(newModel as any).name ?? newModel.id} (${newModel.provider})`));
          } catch (err: any) {
            console.error(red(`\n❌ Failed to switch model: ${err.message}`));
          }
        }
        return ask();
      }

      const cmd = slashCommands.find((c) => c.name === trimmed);
      if (cmd) {
        await cmd.handler();
        if (trimmed === "/exit") return;
        return ask();
      }

      // Legacy plain commands
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(cyan("\nGoodbye! 👋\n"));
        session.dispose();
        rl.close();
        return;
      }
      if (trimmed === "help") { slashCommands.find((c) => c.name === "/help")!.handler(); return ask(); }
      if (trimmed === "tools") { slashCommands.find((c) => c.name === "/tools")!.handler(); return ask(); }

      // Show hint if unknown slash command
      if (trimmed.startsWith("/")) {
        console.log(red(`\nUnknown command: ${trimmed}`));
        console.log(dim("Type /help to see available commands"));
        return ask();
      }

      try {
        process.stdout.write(cyan("\n🤖 CodeBot > "));
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
