package web

import (
	"encoding/json"
	"fmt"
	"strings"
)

func modelToolRouterPrompt(prompt string, tools []map[string]any, choice any) string {
	defs, _ := json.Marshal(tools)
	mode := normalizedToolChoiceMode(choice)
	rules := `- If a tool is needed (such as reading, modifying, creating, or writing files, or executing commands), you MUST respond with:
CALL_TOOL: tool_name({"arg1":"value1"})
- You have full access to workspace tools. Whenever asked to read, inspect, modify, write, or create files, ALWAYS call the corresponding tool (e.g. read_file, write_to_file, edit_file). Never claim you cannot read or edit files.
- If no tool is needed (pure conceptual chat/question), respond with: NO_TOOL_NEEDED
- Only use tools from the available list above
- Validate all arguments against the tool's schema
- Do not invent tools that are not in the list`
	// Multi-turn: completed tool evidence (tool[...], tool_calls:) was already
	// acted upon, so re-invoking those tools would duplicate work.
	if strings.Contains(prompt, "tool_calls:") || strings.Contains(prompt, "tool[call_") {
		rules += `
- Completed evidence must not be repeated: tool_calls/tool[call_x] rows are prior results already delivered to the user, never re-invoke them
- Only start a new tool call when fresh unfinished work remains on the current request`
	}
	return fmt.Sprintf(`You are a tool selection assistant. Based on the user request, decide which tool to call next.

Available tools: %s

MODE: %s

Rules:
%s

User request and evidence:
%s`, defs, mode, rules, prompt)
}

func parseModelToolDecision(text string, tools []map[string]any, choice any) ([]detectedToolCall, bool) {
	text = strings.TrimSpace(text)
	// 1. Try fenced tool blocks first if fences present
	if strings.Contains(text, "```") {
		if calls := fencedToolCalls(text, tools, choice); len(calls) > 0 {
			return calls, true
		}
	}
	// 2. Try CALL_TOOL: anywhere in the text
	upper := strings.ToUpper(text)
	if idx := strings.Index(upper, "CALL_TOOL:"); idx >= 0 {
		rest := strings.TrimSpace(text[idx+len("CALL_TOOL:"):])
		start := strings.Index(rest, "(")
		end := strings.LastIndex(rest, ")")
		if start > 0 && end > start {
			name := strings.TrimSpace(rest[:start])
			argsStr := rest[start+1 : end]
			var args map[string]any
			if json.Unmarshal([]byte(argsStr), &args) == nil && toolChoiceAllows(choice, name) {
				fn := toolFunction(name, tools)
				if fn != nil && schemaValid(args, fn) == nil {
					b, _ := json.Marshal(args)
					return []detectedToolCall{{ID: callID(name, string(b), 0), Type: toolType(name, tools), Name: name, Arguments: b}}, true
				}
			}
		}
	}
	if strings.Contains(upper, "NO_TOOL_NEEDED") {
		return nil, true
	}
	// 3. Try JSON formats ({"calls": [...]} or {"name": "...", "arguments": {...}})
	clean := text
	if i := strings.Index(clean, "```"); i >= 0 {
		clean = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(clean[i+3:], "```"), "json"))
	}
	start, end := strings.Index(clean, "{"), strings.LastIndex(clean, "}")
	if start >= 0 && end > start {
		rawJSON := clean[start : end+1]
		var probe map[string]json.RawMessage
		if json.Unmarshal([]byte(rawJSON), &probe) == nil {
			if _, ok := probe["calls"]; ok {
				var envelope struct {
					Calls []struct {
						Name      string         `json:"name"`
						Arguments map[string]any `json:"arguments"`
					} `json:"calls"`
				}
				if json.Unmarshal([]byte(rawJSON), &envelope) == nil {
					out := make([]detectedToolCall, 0, len(envelope.Calls))
					for i, c := range envelope.Calls {
						fn := toolFunction(c.Name, tools)
						if fn == nil || c.Arguments == nil || !toolChoiceAllows(choice, c.Name) || schemaValid(c.Arguments, fn) != nil {
							continue
						}
						b, _ := json.Marshal(c.Arguments)
						out = append(out, detectedToolCall{ID: callID(c.Name, string(b), i), Type: toolType(c.Name, tools), Name: c.Name, Arguments: b})
					}
					return out, true
				}
			}
			// Single tool call object: {"name": "write_to_file", "arguments": {...}}
			if n, ok := probe["name"]; ok {
				var nameStr string
				_ = json.Unmarshal(n, &nameStr)
				if nameStr != "" && toolChoiceAllows(choice, nameStr) {
					fn := toolFunction(nameStr, tools)
					var args map[string]any
					if a, hasA := probe["arguments"]; hasA {
						_ = json.Unmarshal(a, &args)
					} else if p, hasP := probe["parameters"]; hasP {
						_ = json.Unmarshal(p, &args)
					}
					if fn != nil && (args == nil || schemaValid(args, fn) == nil) {
						b, _ := json.Marshal(args)
						return []detectedToolCall{{ID: callID(nameStr, string(b), 0), Type: toolType(nameStr, tools), Name: nameStr, Arguments: b}}, true
					}
				}
			}
		}
	}
	return nil, false
}
