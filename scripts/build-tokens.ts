// Writes dashboard/public/tokens.css from dashboard/design/tokens.json (`make tokens`).
import { writeFileSync } from "node:fs";
import { TOKENS_CSS, loadTokens, renderCss } from "../dashboard/tokens";

writeFileSync(TOKENS_CSS, renderCss(loadTokens()));
console.log("dashboard/public/tokens.css written");
