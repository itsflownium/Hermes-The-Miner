import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import type { ModelInfo, ProviderInfo } from './types.js';

const HERMES_HOME = join(homedir(), '.hermes');
const CONFIG_PATH = join(HERMES_HOME, 'config.yaml');
const ENV_PATH = join(HERMES_HOME, '.env');
const AUTH_PATH = join(HERMES_HOME, 'auth.json');

// Known provider display names (for prettier output)
const KNOWN_PROVIDER_NAMES: Record<string, string> = {
  nous: 'Nous Portal',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  gemini: 'Google Gemini',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  xai: 'xAI / Grok',
  copilot: 'GitHub Copilot',
  'copilot-acp': 'GitHub Copilot ACP',
  huggingface: 'Hugging Face',
  hf: 'Hugging Face',
  'kimi-coding': 'Kimi / Moonshot',
  'kimi-coding-cn': 'Kimi / Moonshot CN',
  kimi: 'Kimi / Moonshot',
  moonshot: 'Kimi / Moonshot',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  dashscope: 'Alibaba DashScope',
  qwen: 'Alibaba DashScope',
  xiaomi: 'Xiaomi MiMo',
  glm: 'Z.AI / GLM',
  zai: 'Z.AI / GLM',
  mistral: 'Mistral AI',
  mistralai: 'Mistral AI',
  groq: 'Groq',
  cerebras: 'Cerebras',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  perplexity: 'Perplexity',
  cohere: 'Cohere',
  ai21: 'AI21 Labs',
  azure: 'Azure OpenAI',
  bedrock: 'AWS Bedrock',
  vertex: 'Google Vertex',
  ollama: 'Ollama',
  'ollama-cloud': 'Ollama Cloud',
  vllm: 'vLLM',
  lmstudio: 'LM Studio',
  local: 'Local Model',
  kilocode: 'Kilo Code',
  arcee: 'Arcee',
  nvidia: 'NVIDIA',
  firecrawl: 'Firecrawl',
};

// Env var patterns that indicate a provider API key
const ENV_PROVIDER_PATTERNS: [RegExp, (match: RegExpMatchArray) => string][] = [
  // Direct API key patterns (match Hermes CLI provider names)
  [/^OPENROUTER_API_KEY$/, () => 'openrouter'],
  [/^ANTHROPIC_API_KEY$/, () => 'anthropic'],
  [/^OPENAI_API_KEY$/, () => 'openai'],
  [/^(GOOGLE|GEMINI)_API_KEY$/, () => 'gemini'],
  [/^DEEPSEEK_API_KEY$/, () => 'deepseek'],
  [/^XAI_API_KEY$/, () => 'xai'],
  [/^COPILOT_(GITHUB_)?TOKEN$/, () => 'copilot'],
  [/^(HF_TOKEN|HUGGINGFACE_TOKEN)$/, () => 'huggingface'],
  [/^KIMI_API_KEY$/, () => 'kimi-coding'],
  [/^MINIMAX_API_KEY$/, () => 'minimax'],
  [/^(DASHSCOPE|QWEN)_API_KEY$/, () => 'dashscope'],
  [/^XIAOMI_API_KEY$/, () => 'xiaomi'],
  [/^(GLM|ZAI)_API_KEY$/, () => 'glm'],
  [/^MISTRAL_API_KEY$/, () => 'mistral'],
  [/^(GROQ_API_KEY|GROQ_TOKEN)$/, () => 'groq'],
  [/^CEREBRAS_API_KEY$/, () => 'cerebras'],
  [/^(TOGETHER_API_KEY|TOGETHER_AI_KEY)$/, () => 'together'],
  [/^FIREWORKS_API_KEY$/, () => 'fireworks'],
  [/^PERPLEXITY_API_KEY$/, () => 'perplexity'],
  [/^(COHERE_API_KEY|CO_API_KEY)$/, () => 'cohere'],
  [/^(AI21_API_KEY|AI21_TOKEN)$/, () => 'ai21'],
  [/^OLLAMA_HOST$/, () => 'ollama'],
  [/^VLLM_API_KEY$/, () => 'vllm'],
  [/^FIRECRAWL_API_KEY$/, () => 'firecrawl'],
  // Generic fallback
  [/^([A-Z_]+)_API_KEY$/, (m) => m[1].toLowerCase().replace(/_/g, '-')],
  [/^([A-Z_]+)_TOKEN$/, (m) => m[1].toLowerCase().replace(/_/g, '-')],
];

// Bundled model lists for known providers
const PROVIDER_MODELS: Record<string, { id: string; name: string }[]> = {
  nous: [
    { id: 'hermes-3', name: 'Hermes 3' },
    { id: 'hermes-4', name: 'Hermes 4' },
    { id: 'hermes-3-405b', name: 'Hermes 3 405B' },
    { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
    { id: 'moonshotai/kimi-k1.6', name: 'Kimi K1.6' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
    { id: 'kimi/kimi-k2-6', name: 'Kimi K2.6' },
    { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
    { id: 'mistralai/mistral-large', name: 'Mistral Large' },
    { id: 'x-ai/grok-2', name: 'Grok 2' },
  ],
  'kimi-coding': [
    { id: 'kimi-k2-6', name: 'Kimi K2.6' },
    { id: 'kimi-k1-6', name: 'Kimi K1.6' },
    { id: 'kimi-k2-5', name: 'Kimi K2.5' },
    { id: 'kimi-k1-5', name: 'Kimi K1.5' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'o3-mini', name: 'o3-mini' },
    { id: 'o1', name: 'o1' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1' },
  ],
  xai: [
    { id: 'grok-2', name: 'Grok 2' },
    { id: 'grok-3', name: 'Grok 3' },
  ],
  groq: [
    { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Mistral Large' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium' },
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'codestral-latest', name: 'Codestral' },
  ],
  together: [
    { id: 'meta-llama/Llama-3-70b-chat-hf', name: 'Llama 3 70B' },
    { id: 'meta-llama/Llama-3-8b-chat-hf', name: 'Llama 3 8B' },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B' },
    { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B' },
  ],
  ollama: [
    { id: 'llama3.1', name: 'Llama 3.1' },
    { id: 'llama3.1:70b', name: 'Llama 3.1 70B' },
    { id: 'mistral', name: 'Mistral' },
    { id: 'qwen2.5', name: 'Qwen 2.5' },
    { id: 'codellama', name: 'Code Llama' },
    { id: 'phi3', name: 'Phi 3' },
    { id: 'gemma2', name: 'Gemma 2' },
    { id: 'hermes3', name: 'Hermes 3' },
  ],
};

function cleanProviderName(providerId: string): string {
  // Check known names first
  if (KNOWN_PROVIDER_NAMES[providerId]) return KNOWN_PROVIDER_NAMES[providerId];
  // Clean up: "hugging-face" → "Hugging Face", "my-provider" → "My Provider"
  return providerId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export class ModelReader {
  private envVars: Record<string, string> = {};
  private oauthProviders: Set<string> = new Set();
  private configCache: { model: string; provider: string } | null = null;
  private cacheTime = 0;
  private cacheTTL = 30000; // 30 seconds

  constructor() {
    this.loadEnvFile();
    this.loadAuthFile();
  }

  private loadAuthFile(): void {
    if (!existsSync(AUTH_PATH)) return;

    try {
      const content = readFileSync(AUTH_PATH, 'utf-8');
      const auth = JSON.parse(content);
      // Auth file structure: { providers: { nous: { ... }, ... } }
      const providers = auth.providers ?? auth;
      for (const provider of Object.keys(providers)) {
        if (providers[provider] && typeof providers[provider] === 'object') {
          this.oauthProviders.add(provider.toLowerCase());
        }
      }
      // Also detect from credential_pool: { credential_pool: { openrouter: [{...}], ... } }
      const pool = auth.credential_pool;
      if (pool && typeof pool === 'object') {
        for (const provider of Object.keys(pool)) {
          if (Array.isArray(pool[provider]) && pool[provider].length > 0) {
            this.oauthProviders.add(provider.toLowerCase());
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  private loadEnvFile(): void {
    if (!existsSync(ENV_PATH)) return;

    try {
      const content = readFileSync(ENV_PATH, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
        // Store even empty values so we can detect configured providers
        this.envVars[key] = value;
      }
    } catch {
      // Ignore parse errors
    }
  }

  private parseYamlValue(content: string, key: string): string {
    const parts = key.split('.');
    const lines = content.split('\n');
    let currentIndent = -1;
    let inSection = parts.length === 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.search(/\S/);

      if (parts.length > 1 && !inSection) {
        if (trimmed === `${parts[0]}:` || trimmed.startsWith(`${parts[0]}:`)) {
          currentIndent = indent;
          inSection = true;
          continue;
        }
      }

      if (inSection) {
        if (parts.length > 1 && indent <= currentIndent && !trimmed.startsWith(`${parts[0]}:`)) {
          inSection = false;
          continue;
        }

        const targetKey = parts[parts.length - 1];
        const regex = new RegExp(`^${targetKey}\\s*:\\s*(.+)$`);
        const match = trimmed.match(regex);
        if (match) {
          return match[1].trim().replace(/^["']|["']$/g, '');
        }
      }
    }
    return '';
  }

  getCurrentModel(): ModelInfo {
    const now = Date.now();
    if (this.configCache && now - this.cacheTime < this.cacheTTL) {
      return this.buildModelInfo(this.configCache.model, this.configCache.provider);
    }

    let model = 'unknown';
    let provider = 'unknown';

    if (existsSync(CONFIG_PATH)) {
      try {
        const content = readFileSync(CONFIG_PATH, 'utf-8');
        model = this.parseYamlValue(content, 'model.default') || 'unknown';
        provider = this.parseYamlValue(content, 'model.provider') || 'unknown';
      } catch {
        // Ignore
      }
    }

    this.configCache = { model, provider };
    this.cacheTime = now;

    return this.buildModelInfo(model, provider);
  }

  private buildModelInfo(model: string, provider: string): ModelInfo {
    const models = PROVIDER_MODELS[provider] ?? [];
    const modelInfo = models.find(m => m.id === model);
    const providerName = cleanProviderName(provider);

    return {
      model,
      provider,
      display: modelInfo
        ? `${modelInfo.name} via ${providerName}`
        : `${model} via ${providerName}`,
      available: this.isProviderAvailable(provider),
    };
  }

  getProviders(): ProviderInfo[] {
    const detected = new Map<string, boolean>();

    // 1. Detect from .env — any API key or token
    for (const envKey of Object.keys(this.envVars)) {
      for (const [pattern, getId] of ENV_PROVIDER_PATTERNS) {
        const match = envKey.match(pattern);
        if (match) {
          const id = getId(match);
          // Skip generic fallbacks for known keys
          if (id && !detected.has(id)) {
            detected.set(id, true);
          }
          break; // first match wins
        }
      }
    }

    // 2. Detect from auth.json — OAuth providers
    for (const provider of this.oauthProviders) {
      detected.set(provider, true);
    }

    // 3. Add currently configured provider from config.yaml
    try {
      const current = this.getCurrentModel();
      if (current.provider && current.provider !== 'unknown') {
        detected.set(current.provider, true);
      }
    } catch { /* ignore */ }

    // 4. Check config.yaml for custom endpoint
    let hasCustomEndpoint = false;
    if (existsSync(CONFIG_PATH)) {
      try {
        const content = readFileSync(CONFIG_PATH, 'utf-8');
        const baseUrl = this.parseYamlValue(content, 'model.base_url');
        if (baseUrl) {
          hasCustomEndpoint = true;
          // If base_url points to a known service, mark that provider
          if (baseUrl.includes('ollama') || baseUrl.includes('11434')) {
            detected.set('ollama', true);
          } else if (baseUrl.includes('vllm')) {
            detected.set('vllm', true);
          }
        }
      } catch { /* ignore */ }
    }

    // 4. Build provider list
    const providers: ProviderInfo[] = [];
    for (const [id, available] of detected) {
      providers.push({
        id,
        name: cleanProviderName(id),
        available,
      });
    }

    // Add custom endpoint if present and not already covered
    if (hasCustomEndpoint && !detected.has('custom')) {
      providers.push({ id: 'custom', name: 'Custom Endpoint', available: true });
    }

    // Sort: available first, then alphabetical
    providers.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return providers;
  }

  getProviderModels(providerId: string): { id: string; name: string }[] {
    return PROVIDER_MODELS[providerId] ?? [];
  }

  async setModel(providerId: string, modelId: string): Promise<boolean> {
    try {
      execSync(`hermes config set model.default "${modelId}"`, { stdio: 'pipe' });
      execSync(`hermes config set model.provider "${providerId}"`, { stdio: 'pipe' });
      this.configCache = null;
      this.cacheTime = 0;
      return true;
    } catch {
      return false;
    }
  }

  private isProviderAvailable(providerId: string): boolean {
    // Check OAuth
    if (this.oauthProviders.has(providerId)) return true;
    // Check .env for matching keys
    for (const envKey of Object.keys(this.envVars)) {
      for (const [pattern, getId] of ENV_PROVIDER_PATTERNS) {
        const match = envKey.match(pattern);
        if (match && getId(match) === providerId) return true;
      }
    }
    // Also consider available if it's the currently configured provider in Hermes
    const current = this.getCurrentModel();
    if (current.provider === providerId) return true;
    return false;
  }
}
