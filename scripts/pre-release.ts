import { execSync } from "node:child_process";
import { createClient } from "@hey-api/openapi-ts";

/**
 * Execute a shell command with output inherited to stdout/stderr
 */
function exec(command: string): void {
  execSync(command, { stdio: "inherit" });
}

async function main() {
  const version = process.env.CRAFT_NEW_VERSION;
  if (!version) {
    console.error("Error: CRAFT_NEW_VERSION environment variable is required");
    process.exit(1);
  }

  console.log(`Setting version to ${version}`);

  // Update package.json via npm (handles formatting consistently)
  exec(`npm --no-git-tag-version version ${version}`);

  // Generate the API client source from the OpenAPI spec.
  // The actual build (src -> dist) happens in the Build workflow,
  // not here, since dist/ is gitignored and won't be committed.
  await createClient({
    input: "./openapi-derefed.json",
    output: "src",
  });
}

main();
