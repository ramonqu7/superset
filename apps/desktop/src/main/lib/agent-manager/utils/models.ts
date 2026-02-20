const AVAILABLE_MODELS = [
	{
		id: "anthropic/claude-haiku-4-5",
		name: "claude-haiku-4-5",
		provider: "Anthropic",
	},
	{
		id: "anthropic/claude-sonnet-4-5",
		name: "claude-sonnet-4-5",
		provider: "Anthropic",
	},
	{
		id: "anthropic/claude-opus-4-6",
		name: "claude-opus-4-6",
		provider: "Anthropic",
	},
	{ id: "openai/gpt-5.2-codex", name: "gpt-5.2-codex", provider: "Codex" },
	{
		id: "google/gemini-2.5-pro",
		name: "gemini-2.5-pro",
		provider: "Google",
	},
	{
		id: "google/gemini-2.5-flash",
		name: "gemini-2.5-flash",
		provider: "Google",
	},
] as const;

export function getAvailableModels() {
	return [...AVAILABLE_MODELS];
}
