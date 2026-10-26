package web

import (
	"encoding/json"
	"fmt"
	"strings"
)

// cleanLenientJSON sanitizes model-generated JSON before parsing:
// 1. Escapes literal newlines, carriage returns, tabs, and control characters inside string literals.
// 2. Removes trailing commas before '}' or ']'.
// 3. Handles escaped quotes and backslashes properly.
func cleanLenientJSON(raw string) string {
	var b strings.Builder
	b.Grow(len(raw) + 32)
	inString := false
	n := len(raw)
	for i := 0; i < n; i++ {
		c := raw[i]
		if inString {
			if c == '\\' {
				b.WriteByte(c)
				if i+1 < n {
					i++
					b.WriteByte(raw[i])
				}
				continue
			}
			if c == '"' {
				inString = false
				b.WriteByte(c)
				continue
			}
			switch c {
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				if i+1 < n && raw[i+1] == '\n' {
					continue
				}
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				if c < 0x20 {
					b.WriteString(fmt.Sprintf(`\u%04x`, c))
				} else {
					b.WriteByte(c)
				}
			}
		} else {
			if c == '"' {
				inString = true
				b.WriteByte(c)
				continue
			}
			// Trailing comma removal: if comma is followed only by whitespace and '}' or ']'
			if c == ',' {
				j := i + 1
				for j < n && (raw[j] == ' ' || raw[j] == '\t' || raw[j] == '\r' || raw[j] == '\n') {
					j++
				}
				if j < n && (raw[j] == '}' || raw[j] == ']') {
					continue
				}
			}
			b.WriteByte(c)
		}
	}
	return b.String()
}

func lenientUnmarshal(data []byte, v any) error {
	if err := json.Unmarshal(data, v); err == nil {
		return nil
	}
	cleaned := cleanLenientJSON(string(data))
	return json.Unmarshal([]byte(cleaned), v)
}

// extractJSONObject extracts the balanced JSON object '{ ... }' starting from the first '{' in s.
func extractJSONObject(s string) (string, bool) {
	start := strings.Index(s, "{")
	if start < 0 {
		return "", false
	}
	depth := 0
	inString := false
	n := len(s)
	for i := start; i < n; i++ {
		c := s[i]
		if inString {
			if c == '\\' {
				i++
				continue
			}
			if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			continue
		}
		if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 {
				return s[start : i+1], true
			}
		}
	}
	return "", false
}

// extractJSONValue extracts the first balanced JSON object '{ ... }' or array '[ ... ]' in s.
func extractJSONValue(s string) (string, bool) {
	startObj := strings.Index(s, "{")
	startArr := strings.Index(s, "[")
	if startObj < 0 && startArr < 0 {
		return "", false
	}
	start := startObj
	openChar := byte('{')
	closeChar := byte('}')
	if startObj < 0 || (startArr >= 0 && startArr < startObj) {
		start = startArr
		openChar = '['
		closeChar = ']'
	}
	depth := 0
	inString := false
	n := len(s)
	for i := start; i < n; i++ {
		c := s[i]
		if inString {
			if c == '\\' {
				i++
				continue
			}
			if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			continue
		}
		if c == openChar {
			depth++
		} else if c == closeChar {
			depth--
			if depth == 0 {
				return s[start : i+1], true
			}
		}
	}
	return "", false
}

func modelToolRouterPrompt(prompt string, tools []map[string]any, choice any) string {
	defs, _ := json.Marshal(tools)
	mode := normalizedToolChoiceMode(choice)
	rules := `- If a tool is needed (such as reading, inspecting, modifying, creating, or writing files, or executing commands), you MUST respond with:
CALL_TOOL: tool_name({"arg1":"value1"})
- You have full access to workspace tools. Whenever asked to read, inspect, modify, write, or create files, ALWAYS call the corresponding tool (e.g. read_file, write_to_file, edit_file, replace_in_file). Never claim you cannot read or edit files.
- When generating arguments for modifying or writing code files, provide the exact and complete arguments required by the schema. Output valid JSON in the arguments.
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

	upper := strings.ToUpper(text)

	// 2. Try CALL_TOOL: anywhere in the text
	if strings.Contains(upper, "CALL_TOOL:") {
		var collected []detectedToolCall
		rem := text
		for {
			u := strings.ToUpper(rem)
			idx := strings.Index(u, "CALL_TOOL:")
			if idx < 0 {
				break
			}
			after := strings.TrimSpace(rem[idx+len("CALL_TOOL:"):])
			start := strings.Index(after, "(")
			if start <= 0 {
				rem = after
				continue
			}
			name := strings.TrimSpace(after[:start])
			jsonStr, ok := extractJSONObject(after[start:])
			if !ok {
				end := strings.Index(after[start:], ")")
				if end > 1 {
					jsonStr = after[start+1 : start+end]
					ok = true
				}
			}
			if ok && toolChoiceAllows(choice, name) {
				var args map[string]any
				if lenientUnmarshal([]byte(jsonStr), &args) == nil {
					fn := toolFunction(name, tools)
					if fn != nil && schemaValid(args, fn) == nil {
						b, _ := json.Marshal(args)
						collected = append(collected, detectedToolCall{
							ID:        callID(name, string(b), len(collected)),
							Type:      toolType(name, tools),
							Name:      name,
							Arguments: b,
						})
					}
				}
			}
			if ok && len(jsonStr) > 0 {
				pos := strings.Index(after, jsonStr)
				if pos >= 0 && pos+len(jsonStr) < len(after) {
					rem = after[pos+len(jsonStr):]
				} else {
					break
				}
			} else if endParen := strings.Index(after, ")"); endParen >= 0 {
				rem = after[endParen+1:]
			} else {
				break
			}
		}
		if len(collected) > 0 {
			return collected, true
		}
		// If CALL_TOOL was present but produced no valid calls (e.g. bad schema), return false to trigger repair
		return nil, false
	}

	if strings.Contains(upper, "NO_TOOL_NEEDED") {
		return nil, true
	}

	// 3. Try JSON formats ({"calls": [...]} or {"name": "...", "arguments": {...}} or [{...}])
	clean := text
	if i := strings.Index(clean, "```"); i >= 0 {
		clean = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(clean[i+3:], "```"), "json"))
	}

	if rawJSON, ok := extractJSONValue(clean); ok {
		var probe map[string]json.RawMessage
		if lenientUnmarshal([]byte(rawJSON), &probe) == nil {
			if _, ok := probe["calls"]; ok {
				var envelope struct {
					Calls []struct {
						Name      string         `json:"name"`
						Arguments map[string]any `json:"arguments"`
					} `json:"calls"`
				}
				if lenientUnmarshal([]byte(rawJSON), &envelope) == nil {
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
						_ = lenientUnmarshal(a, &args)
					} else if p, hasP := probe["parameters"]; hasP {
						_ = lenientUnmarshal(p, &args)
					}
					if fn != nil && (args == nil || schemaValid(args, fn) == nil) {
						b, _ := json.Marshal(args)
						return []detectedToolCall{{ID: callID(nameStr, string(b), 0), Type: toolType(nameStr, tools), Name: nameStr, Arguments: b}}, true
					}
				}
			}
		}

		// Try array of tool calls: [{"name": "...", "arguments": {...}}]
		var arr []map[string]any
		if lenientUnmarshal([]byte(rawJSON), &arr) == nil && len(arr) > 0 {
			var out []detectedToolCall
			for i, item := range arr {
				name, _ := item["name"].(string)
				if name == "" {
					name, _ = item["tool"].(string)
				}
				if name == "" {
					name, _ = item["function"].(string)
				}
				if name != "" && toolChoiceAllows(choice, name) {
					fn := toolFunction(name, tools)
					var args map[string]any
					if a, ok := item["arguments"].(map[string]any); ok {
						args = a
					} else if p, ok := item["parameters"].(map[string]any); ok {
						args = p
					}
					if fn != nil && (args == nil || schemaValid(args, fn) == nil) {
						b, _ := json.Marshal(args)
						out = append(out, detectedToolCall{ID: callID(name, string(b), i), Type: toolType(name, tools), Name: name, Arguments: b})
					}
				}
			}
			if len(out) > 0 {
				return out, true
			}
		}
	}

	return nil, false
}
