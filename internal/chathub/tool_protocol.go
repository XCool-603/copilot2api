package chathub

import (
	"encoding/json"
	"fmt"
	"strings"
)

// toolProtocolPrompt follows the community-compatible M365 convention:
// definitions are wrapped in <tools>, and calls are emitted as a fenced block
// whose info string is the exact tool name.
func toolProtocolPrompt(text string, tools []Tool, choice any, hasPlugins bool) string {
	if len(tools) == 0 || strings.EqualFold(fmt.Sprint(choice), "none") {
		return text
	}
	var defs []string
	for _, t := range tools {
		var f struct {
			Name, Description string
			Parameters        json.RawMessage `json:"parameters"`
		}
		if json.Unmarshal(t.Function, &f) != nil || f.Name == "" {
			continue
		}
		params := strings.TrimSpace(string(f.Parameters))
		if params == "" || params == "null" {
			params = "{}"
		}
		defs = append(defs, fmt.Sprintf("%s — %s\n```%s\n%s\n```", f.Name, f.Description, f.Name, params))
	}
	if len(defs) == 0 {
		return text
	}
	return fmt.Sprintf("You have direct access to real, executable tools in the user's workspace. You can and MUST use them to read files, write or edit files, execute commands, and inspect directories as needed by the user request.\n\n<tools>\n%s\n</tools>\n\nCRITICAL INSTRUCTIONS FOR TOOL CALLING:\n1. You HAVE FULL CAPABILITY to read and edit files through the provided tools. NEVER claim or reply that you cannot read, access, or modify local files.\n2. Whenever a request involves reading, inspecting, modifying, writing, or deleting files, you MUST invoke the corresponding tool.\n3. To invoke a tool, emit a fenced code block where the language identifier is the EXACT tool name (e.g. ```read_file, ```write_to_file, ```edit_file, or ```bash), and the body is a valid JSON object matching the tool parameters.\nExample:\n```read_file\n{\"path\": \"main.go\"}\n```\nOr:\n```write_to_file\n{\"path\": \"main.go\", \"content\": \"...\"}\n```\n4. Emit the tool block directly so the execution environment can run it and return the results to you.\n\nUser request:\n%s", strings.Join(defs, "\n\n"), text)
}
