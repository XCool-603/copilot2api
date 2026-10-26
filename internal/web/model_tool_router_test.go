package web

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseModelToolDecisionAutoAndParallel(t *testing.T) {
	calls, ok := parseModelToolDecision(`{"calls":[{"name":"get_weather","arguments":{"city":"Beijing"}},{"name":"get_time","arguments":{"city":"Beijing"}}]}`, testTools(), "auto")
	if !ok || len(calls) != 2 {
		t.Fatalf("calls=%v ok=%v", calls, ok)
	}
}

func TestParseModelToolDecisionNoCall(t *testing.T) {
	calls, ok := parseModelToolDecision(`{"calls":[]}`, testTools(), "auto")
	if !ok || len(calls) != 0 {
		t.Fatalf("calls=%v ok=%v", calls, ok)
	}
}

func TestModelToolRouterPromptMarksCompletedResults(t *testing.T) {
	p := modelToolRouterPrompt(`assistant tool_calls: [...]
tool[call_x]: 2026-07-18`, testTools(), "auto")
	if !strings.Contains(p, "Completed evidence must not be repeated") || !strings.Contains(p, "tool[call_x]: 2026-07-18") || !strings.Contains(p, "unfinished work remains") {
		t.Fatalf("missing multi-turn evidence constraint: %s", p)
	}
}

func TestParseModelToolDecisionRejectsBadSchema(t *testing.T) {
	calls, ok := parseModelToolDecision("```json\n{\"calls\":[{\"name\":\"get_weather\",\"arguments\":{\"city\":2}}]}\n```", testTools(), "auto")
	if !ok || len(calls) != 0 {
		t.Fatalf("calls=%v ok=%v", calls, ok)
	}
}

func TestParseModelToolDecisionMultilineCodeAndTrailingComments(t *testing.T) {
	tools := []map[string]any{
		{
			"type": "function",
			"function": map[string]any{
				"name": "write_to_file",
				"parameters": map[string]any{
					"type":     "object",
					"required": []any{"path", "content"},
					"properties": map[string]any{
						"path":    map[string]any{"type": "string"},
						"content": map[string]any{"type": "string"},
					},
				},
			},
		},
	}

	// Model outputs literal newlines inside content string, and trailing comments with parentheses
	raw := `Here is the file modification:
CALL_TOOL: write_to_file({
  "path": "cmd/main.go",
  "content": "package main

func main() {
	println(\"hello world\")
}
"
})
(Note: This replaces the main entry point.)`

	calls, ok := parseModelToolDecision(raw, tools, "auto")
	if !ok || len(calls) != 1 {
		t.Fatalf("expected 1 call, got ok=%v len=%d", ok, len(calls))
	}
	if calls[0].Name != "write_to_file" {
		t.Fatalf("expected write_to_file, got %s", calls[0].Name)
	}
	var args map[string]any
	if err := json.Unmarshal(calls[0].Arguments, &args); err != nil {
		t.Fatalf("invalid json arguments: %v", err)
	}
	content, _ := args["content"].(string)
	if !strings.Contains(content, "package main") || !strings.Contains(content, `println("hello world")`) {
		t.Fatalf("content was not properly preserved: %q", content)
	}
}

func TestParseModelToolDecisionNestedFences(t *testing.T) {
	tools := []map[string]any{
		{
			"type": "function",
			"function": map[string]any{
				"name": "write_to_file",
				"parameters": map[string]any{
					"type":     "object",
					"required": []any{"path", "content"},
					"properties": map[string]any{
						"path":    map[string]any{"type": "string"},
						"content": map[string]any{"type": "string"},
					},
				},
			},
		},
	}

	// Model outputs fenced code block containing backticks
	raw := "```write_to_file\n{\n  \"path\": \"README.md\",\n  \"content\": \"```bash\\ngo build\\n```\"\n}\n```"
	calls, ok := parseModelToolDecision(raw, tools, "auto")
	if !ok || len(calls) != 1 {
		t.Fatalf("expected 1 call, got ok=%v len=%d", ok, len(calls))
	}
	if calls[0].Name != "write_to_file" {
		t.Fatalf("expected write_to_file, got %s", calls[0].Name)
	}
}

func TestPromptPreservesLargeToolResults(t *testing.T) {
	largeCode := strings.Repeat("// A line of code in a large project source file\n", 1200) // ~58KB
	msgs := []oaiMsg{
		{Role: "user", Content: "Please review this file"},
		{Role: "tool", ToolCallID: "call_read_1", Content: largeCode},
	}
	prompt, _ := flattenPromptMessages(msgs, nil)
	if strings.Contains(prompt, "truncated") {
		t.Fatalf("large code file (~58KB) was unexpectedly truncated in prompt!")
	}
	if !strings.Contains(prompt, "[tool result id=call_read_1]") {
		t.Fatalf("missing tool result header in prompt")
	}
}
