package web

import (
	"encoding/json"
	"regexp"
	"strings"
)

var fencedToolCall = regexp.MustCompile("(?s)```([A-Za-z0-9_-]+)\\s*\\n(.*?)\\n```")

// declaredShell returns the shell-ish tool name the client actually
// declared (bash/sh/shell/powershell/cmd), or "" if none. Forcing an
// undeclared bash call on clients that don't support it (issue #12) makes
// them error out and loop, so conversion only happens for declared tools.
func declaredShell(allowed map[string]bool) string {
	for _, n := range []string{"bash", "sh", "shell", "powershell", "cmd"} {
		if allowed[n] {
			return n
		}
	}
	return ""
}

func fencedToolCalls(text string, tools []map[string]any, choice any) []detectedToolCall {
	allowed := allowedToolNames(tools)
	shell := declaredShell(allowed)
	var out []detectedToolCall
	for _, m := range fencedToolCall.FindAllStringSubmatch(text, -1) {
		name := m[1]
		args := strings.TrimSpace(m[2])
		var v any
		if err := lenientUnmarshal([]byte(args), &v); err != nil {
			pos := strings.Index(text, args)
			if pos >= 0 {
				if fullObj, ok := extractJSONObject(text[pos:]); ok {
					_ = lenientUnmarshal([]byte(fullObj), &v)
				}
			}
		}
		// Auto-convert bash/shell code blocks to tool calls, but only when
		// the client declared the tool.
		if name == "bash" || name == "sh" || name == "shell" || name == "powershell" || name == "cmd" {
			converted := name
			if !allowed[name] {
				if shell == "" {
					continue
				}
				converted = shell
			}
			if m, ok := v.(map[string]any); ok {
				if cmd, hasCmd := m["command"]; hasCmd && cmd != "" {
					cmdBytes, _ := json.Marshal(map[string]any{"command": cmd, "timeout": m["timeout"], "workdir": m["workdir"]})
					out = append(out, detectedToolCall{ID: callID(converted, string(cmdBytes), len(out)), Type: "function", Name: converted, Arguments: cmdBytes})
					continue
				}
			}
			if v == nil {
				cmdBytes, _ := json.Marshal(map[string]any{"command": args})
				out = append(out, detectedToolCall{ID: callID(converted, string(cmdBytes), len(out)), Type: "function", Name: converted, Arguments: cmdBytes})
				continue
			}
			continue
		}
		// Support models emitting ```json {"name": "read_file", "arguments": {...}} or ```tool_call
		if name == "json" || name == "tool_call" || name == "tool_calls" {
			if m, ok := v.(map[string]any); ok {
				toolName, _ := m["name"].(string)
				if toolName == "" {
					toolName, _ = m["tool"].(string)
				}
				if toolName == "" {
					toolName, _ = m["function"].(string)
				}
				if toolName != "" && allowed[toolName] && toolChoiceAllows(choice, toolName) {
					var argBytes []byte
					if argsVal, hasArgs := m["arguments"]; hasArgs {
						if argStr, isStr := argsVal.(string); isStr {
							var parsedArgs any
							if lenientUnmarshal([]byte(argStr), &parsedArgs) == nil {
								argBytes, _ = json.Marshal(parsedArgs)
							} else {
								argBytes = []byte(argStr)
							}
						} else {
							argBytes, _ = json.Marshal(argsVal)
						}
					} else if paramsVal, hasParams := m["parameters"]; hasParams {
						argBytes, _ = json.Marshal(paramsVal)
					} else {
						argBytes, _ = json.Marshal(m)
					}
					out = append(out, detectedToolCall{ID: callID(toolName, string(argBytes), len(out)), Type: toolType(toolName, tools), Name: toolName, Arguments: argBytes})
					continue
				}
			}
			if arr, ok := v.([]any); ok {
				matched := false
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						toolName, _ := m["name"].(string)
						if toolName != "" && allowed[toolName] && toolChoiceAllows(choice, toolName) {
							var argBytes []byte
							if argsVal, hasArgs := m["arguments"]; hasArgs {
								if argStr, isStr := argsVal.(string); isStr {
									var parsedArgs any
							if lenientUnmarshal([]byte(argStr), &parsedArgs) == nil {
								argBytes, _ = json.Marshal(parsedArgs)
							} else {
								argBytes = []byte(argStr)
							}
								} else {
									argBytes, _ = json.Marshal(argsVal)
								}
							} else {
								argBytes, _ = json.Marshal(m)
							}
							out = append(out, detectedToolCall{ID: callID(toolName, string(argBytes), len(out)), Type: toolType(toolName, tools), Name: toolName, Arguments: argBytes})
							matched = true
						}
					}
				}
				if matched {
					continue
				}
			}
		}
		if !allowed[name] || !toolChoiceAllows(choice, name) {
			continue
		}
		if v == nil {
			continue
		}
		b, _ := json.Marshal(v)
		out = append(out, detectedToolCall{ID: callID(name, string(b), len(out)), Type: toolType(name, tools), Name: name, Arguments: b})
	}
	// Also check for plain JSON objects with a "command" field (not in fenced blocks)
	if len(out) == 0 && shell != "" {
		for i := 0; i < len(text); i++ {
			if text[i] != '{' {
				continue
			}
			end := strings.Index(text[i:], "\n")
			if end < 0 {
				end = len(text) - i
			}
			line := text[i : i+end]
			braceEnd := strings.LastIndex(line, "}")
			if braceEnd < 0 {
				continue
			}
			if !strings.Contains(line[:braceEnd+1], `"command"`) {
				continue
			}
			var obj map[string]any
			if lenientUnmarshal([]byte(line[:braceEnd+1]), &obj) != nil {
				continue
			}
			if cmd, hasCmd := obj["command"]; hasCmd && cmd != "" {
				cmdBytes, _ := json.Marshal(map[string]any{"command": cmd, "timeout": obj["timeout"], "workdir": obj["workdir"]})
				out = append(out, detectedToolCall{ID: callID(shell, string(cmdBytes), len(out)), Type: "function", Name: shell, Arguments: cmdBytes})
				break
			}
		}
	}
	return out
}
