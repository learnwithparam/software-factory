import type { AgentPreset } from "../types";
import { claudePreset } from "./claude";
import { codexPreset } from "./codex";

export const PRESETS: Record<string, AgentPreset> = {
  claude: claudePreset,
  codex: codexPreset,
};
