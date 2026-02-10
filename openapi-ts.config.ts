import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: "./openapi-derefed.json",
  output: "src", 
});