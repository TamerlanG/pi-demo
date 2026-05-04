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
import * as fs from "fs";
import * as path from "path";

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
  let promptStartTime = 0;
  let turnCount = 0;
  let toolCallCount = 0;
  let lastResponse = "";
  let currentResponse = "";
  let lastPrompt = "";

  // ── Event Handling ──────────────────────────────────────────────
  session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        firstTextReceived = false;
        promptStartTime = Date.now();
        turnCount = 0;
        toolCallCount = 0;
        currentResponse = "";
        startSpinner("Thinking");
        break;

      case "turn_start":
        turnCount++;
        break;

      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          if (!firstTextReceived) {
            stopSpinner();
            firstTextReceived = true;
          }
          const delta = event.assistantMessageEvent.delta;
          currentResponse += delta;
          process.stdout.write(delta);
        }
        break;

      case "tool_execution_start": {
        stopSpinner();
        toolCallCount++;
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

      case "agent_end": {
        stopSpinner();
        lastResponse = currentResponse;
        const elapsed = ((Date.now() - promptStartTime) / 1000).toFixed(1);
        const stats = [`${elapsed}s`];
        if (turnCount > 1) stats.push(`${turnCount} turns`);
        if (toolCallCount > 0) stats.push(`${toolCallCount} tool call${toolCallCount > 1 ? "s" : ""}`);
        process.stdout.write("\n" + dim(`  ⏱ ${stats.join(" · ")}`) + "\n");
        break;
      }
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
    { name: "/thinking", description: "Cycle thinking level", handler: () => {
      const newLevel = session.cycleThinkingLevel();
      if (newLevel) {
        console.log(green(`\n✓ Thinking level: ${newLevel}`));
      } else {
        console.log(dim(`\nThinking level: ${session.thinkingLevel}`));
      }
    }},
    { name: "/stats", description: "Show session statistics", handler: () => {
      const msgs = session.messages;
      const userMsgs = msgs.filter((m) => m.role === "user").length;
      const assistantMsgs = msgs.filter((m) => m.role === "assistant").length;
      const m = session.agent.state.model;
      console.log(cyan("\n📊 Session Stats"));
      console.log(dim("─".repeat(40)));
      console.log(`  ${dim("Model:")}       ${(m as any)?.name ?? m?.id} (${m?.provider})`);
      console.log(`  ${dim("Thinking:")}    ${session.thinkingLevel}`);
      console.log(`  ${dim("Messages:")}    ${msgs.length} total (${userMsgs} user, ${assistantMsgs} assistant)`);
      console.log(`  ${dim("Streaming:")}   ${session.isStreaming ? yellow("yes") : "no"}`);
    }},
    { name: "/copy", description: "Copy last response to clipboard", handler: async () => {
      if (!lastResponse) {
        console.log(dim("\nNo response to copy yet."));
        return;
      }
      try {
        const { execSync } = await import("child_process");
        execSync("pbcopy", { input: lastResponse });
        console.log(green("\n✓ Last response copied to clipboard"));
      } catch {
        console.log(red("\n❌ Failed to copy (pbcopy not available)"));
      }
    }},
    { name: "/export", description: "Export conversation to file", handler: () => {
      const msgs = session.messages;
      if (msgs.length === 0) {
        console.log(dim("\nNo messages to export."));
        return;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `codebot-${timestamp}.md`;
      let content = `# CodeBot Conversation\n\nExported: ${new Date().toLocaleString()}\n\n---\n\n`;
      for (const msg of msgs) {
        if (msg.role === "user") {
          const text = msg.content?.map((c: any) => c.type === "text" ? c.text : "").join("") ?? "";
          if (text) content += `## 💬 User\n\n${text}\n\n---\n\n`;
        } else if (msg.role === "assistant") {
          const text = msg.content?.map((c: any) => c.type === "text" ? c.text : "").join("") ?? "";
          if (text) content += `## 🤖 CodeBot\n\n${text}\n\n---\n\n`;
        }
      }
      fs.writeFileSync(filename, content);
      console.log(green(`\n✓ Exported to ${filename}`));
    }},
    { name: "/compact", description: "Compact conversation history", handler: async () => {
      startSpinner("Compacting");
      try {
        const result = await session.compact();
        stopSpinner();
        console.log(green("\n✓ Conversation compacted"));
      } catch (err: any) {
        stopSpinner();
        console.error(red(`\n❌ Compaction failed: ${err.message}`));
      }
    }},
    { name: "/retry", description: "Retry last prompt", handler: async () => {
      if (!lastPrompt) {
        console.log(dim("\nNo previous prompt to retry."));
        return;
      }
      console.log(dim(`\nRetrying: ${lastPrompt}`));
      try {
        process.stdout.write(cyan("\n🤖 CodeBot > "));
        await session.prompt(lastPrompt);
      } catch (err: any) {
        console.error(red(`\n❌ Error: ${err.message}`));
      }
    }},
    { name: "/switch", description: "Switch model (e.g. /switch 3)", handler: () => {
      // Handled separately since it takes an argument
    }},
    { name: "/clear", description: "Clear the screen", handler: () => {
      console.clear();
    }},
    { name: "/abort", description: "Abort current operation", handler: async () => {
      if (session.isStreaming) {
        await session.abort();
        stopSpinner();
        console.log(yellow("\n⚠ Aborted."));
      } else {
        console.log(dim("\nNothing to abort."));
      }
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
      // Handle slash commands with arguments
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

      // Send prompt to agent
      lastPrompt = trimmed;
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
