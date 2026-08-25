// Config dedicada dos testes: SEM os plugins do Electron (vite.config.ts os aplica
// e eles reescrevem builtins como fs/path no ambiente de teste, travando a coleta).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
