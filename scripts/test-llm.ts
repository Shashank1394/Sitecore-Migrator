import dotenv from "dotenv";
import { OpenRouterProvider } from "../src/llm/OpenRouterProvider.js";

dotenv.config();

async function main(): Promise<void> {
  const provider = OpenRouterProvider.fromEnvironment();
  const response = await provider.chat({
    system: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Reply with exactly: OpenRouter connection successful",
      },
    ],
  });

  console.log("OpenRouter model:", response.model);
  console.log("OpenRouter response:", response.content);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "LLM connection test failed.");
  process.exitCode = 1;
});
