#!/bin/bash
# Patches @strands-agents/sdk to use 'strands.telemetry.tracer' as the OTel scope name.
# Required because the JS SDK uses OTEL_SERVICE_NAME as scope, but AgentCore evaluations
# only support 'strands.telemetry.tracer' as a recognized scope name.
# See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/understanding-input-spans.html

UTILS_FILE="node_modules/@strands-agents/sdk/dist/src/telemetry/utils.js"

if [ -f "$UTILS_FILE" ]; then
  node -e "
    const fs = require('fs');
    const f = '$UTILS_FILE';
    let code = fs.readFileSync(f, 'utf8');
    code = code.replace(
      /return globalThis\.process\?\.env\?\.OTEL_SERVICE_NAME \|\| DEFAULT_SERVICE_NAME;/,
      \"return 'strands.telemetry.tracer';\"
    );
    fs.writeFileSync(f, code);
  "
  echo "Patched strands SDK scope name to 'strands.telemetry.tracer'"
fi
