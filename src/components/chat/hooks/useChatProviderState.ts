import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { AGENT_PERMISSION_SETTINGS_CHANGED_EVENT } from '../../../constants/appEvents';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type {
  ProjectSession,
  LLMProvider,
  Project,
  ProviderModelOption,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
} from '../../../types/app';
import {
  DEFAULT_EFFORT_VALUE,
  FALLBACK_PROVIDER_EFFORT_VALUES,
  toProviderEffortOptions,
} from '../constants/providerEffort';

const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'default',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  gemini: 'gemini-3.1-pro-preview',
  opencode: 'anthropic/claude-sonnet-4-5',
};

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'gemini', 'opencode'];

/**
 * Fallback permission-mode matrix used only until the backend capability
 * matrix (`GET /api/providers/capabilities`) has loaded. The backend is the
 * source of truth; this mirror exists so the composer renders sensibly on
 * first paint and when the capabilities request fails.
 */
const FALLBACK_PERMISSION_MODES: Record<LLMProvider, PermissionMode[]> = {
  claude: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
  cursor: ['default', 'bypassPermissions'],
  codex: ['default', 'acceptEdits', 'bypassPermissions'],
  gemini: ['default', 'auto_edit', 'yolo', 'plan'],
  opencode: ['default'],
};

const PROVIDER_PERMISSION_SETTINGS_KEYS: Partial<Record<LLMProvider, string>> = {
  codex: 'codex-settings',
  gemini: 'gemini-settings',
};

function readStoredPermissionMode(storageKey: string): PermissionMode | null {
  try {
    const rawValue = localStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as { permissionMode?: unknown };
    return typeof parsedValue.permissionMode === 'string'
      ? parsedValue.permissionMode as PermissionMode
      : null;
  } catch {
    return null;
  }
}

function resolveProviderSettingsPermissionMode(
  targetProvider: LLMProvider,
  validModes: PermissionMode[],
): PermissionMode | null {
  const storageKey = PROVIDER_PERMISSION_SETTINGS_KEYS[targetProvider];
  if (!storageKey) {
    return null;
  }

  const storedMode = readStoredPermissionMode(storageKey);
  return storedMode && validModes.includes(storedMode) ? storedMode : 'default';
}

type ProviderCapabilities = {
  provider: LLMProvider;
  permissionModes: string[];
  defaultPermissionMode: string;
  supportsImages: boolean;
  supportsAbort: boolean;
  supportsPermissionRequests: boolean;
  supportsTokenUsage: boolean;
  supportsEffort?: boolean;
};

type ProviderCapabilitiesApiResponse = {
  success?: boolean;
  data?: {
    providers?: ProviderCapabilities[];
  };
};

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
  selectedProject: Project | null;
  isActive?: boolean;
}

type ProviderModelsApiResponse = {
  success?: boolean;
  data?: {
    models?: ProviderModelsDefinition;
    cache?: ProviderModelsCacheInfo;
  };
};

type ChangeActiveModelApiResponse = {
  success?: boolean;
  data?: {
    provider?: LLMProvider;
    sessionId?: string;
    supported?: boolean;
    changed?: boolean;
    model?: string | null;
  };
};

export function useChatProviderState({ selectedSession, selectedProject: _selectedProject, isActive = true }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [permissionSettingsVersion, setPermissionSettingsVersion] = useState(0);
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(() => {
    return selectedSession?.__provider || (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
  });
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || FALLBACK_DEFAULT_MODEL.cursor;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || FALLBACK_DEFAULT_MODEL.claude;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || FALLBACK_DEFAULT_MODEL.codex;
  });
  const [providerEfforts, setProviderEfforts] = useState<Partial<Record<LLMProvider, string>>>(() => {
    return PROVIDERS.reduce<Partial<Record<LLMProvider, string>>>((acc, targetProvider) => {
      acc[targetProvider] = localStorage.getItem(`${targetProvider}-effort`) || DEFAULT_EFFORT_VALUE;
      return acc;
    }, {});
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem('gemini-model') || FALLBACK_DEFAULT_MODEL.gemini;
  });
  const [opencodeModel, setOpenCodeModel] = useState<string>(() => {
    return localStorage.getItem('opencode-model') || FALLBACK_DEFAULT_MODEL.opencode;
  });

  /**
   * Backend-owned capability matrix keyed by provider. Drives the permission
   * mode picker (and is the extension point for future per-provider UI
   * differences) so the frontend stays free of hardcoded provider branching.
   * Null until `/api/providers/capabilities` resolves; the static fallback
   * map covers that window.
   */
  const [providerCapabilities, setProviderCapabilities] = useState<
    Partial<Record<LLMProvider, ProviderCapabilities>> | null
  >(null);

  const [providerModelCatalog, setProviderModelCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsDefinition>>
  >({});
  const [providerModelCacheCatalog, setProviderModelCacheCatalog] = useState<
    Partial<Record<LLMProvider, ProviderModelsCacheInfo>>
  >({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);
  const [providerModelsRefreshing, setProviderModelsRefreshing] = useState(false);

  const providerModelsRequestIdRef = useRef(0);

  const setStoredProviderModel = useCallback((targetProvider: LLMProvider, model: string) => {
    if (targetProvider === 'claude') {
      setClaudeModel(model);
      localStorage.setItem('claude-model', model);
      return;
    }

    if (targetProvider === 'cursor') {
      setCursorModel(model);
      localStorage.setItem('cursor-model', model);
      return;
    }

    if (targetProvider === 'codex') {
      setCodexModel(model);
      localStorage.setItem('codex-model', model);
      return;
    }

    if (targetProvider === 'gemini') {
      setGeminiModel(model);
      localStorage.setItem('gemini-model', model);
      return;
    }

    setOpenCodeModel(model);
    localStorage.setItem('opencode-model', model);
  }, []);

  const setStoredProviderEffort = useCallback((targetProvider: LLMProvider, effort: string) => {
    setProviderEfforts((previous) => (
      previous[targetProvider] === effort
        ? previous
        : { ...previous, [targetProvider]: effort }
    ));
    localStorage.setItem(`${targetProvider}-effort`, effort);
  }, []);

  const loadProviderModels = useCallback(async (options: { bypassCache?: boolean } = {}) => {
    const requestId = providerModelsRequestIdRef.current + 1;
    providerModelsRequestIdRef.current = requestId;
    const isHardRefresh = options.bypassCache === true;

    if (isHardRefresh) {
      setProviderModelsRefreshing(true);
    } else {
      setProviderModelsLoading(true);
    }

    try {
      const results = await Promise.all(
        PROVIDERS.map(async (p) => {
          const params = new URLSearchParams();
          if (options.bypassCache) {
            params.set('bypassCache', 'true');
          }

          const queryString = params.toString();
          const response = await authenticatedFetch(`/api/providers/${p}/models${queryString ? `?${queryString}` : ''}`);
          const body = (await response.json()) as ProviderModelsApiResponse;
          if (!body.success || !body.data?.models || !body.data?.cache) {
            return null;
          }

          return body.data;
        }),
      );

      if (providerModelsRequestIdRef.current !== requestId) {
        return;
      }

      const nextCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {};
      const nextCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>> = {};

      PROVIDERS.forEach((p, i) => {
        const entry = results[i];
        if (!entry) {
          return;
        }

        nextCatalog[p] = entry.models;
        nextCacheCatalog[p] = entry.cache;
      });

      setProviderModelCatalog(nextCatalog);
      setProviderModelCacheCatalog(nextCacheCatalog);
    } catch (error) {
      console.error('Error loading provider models:', error);
    } finally {
      if (providerModelsRequestIdRef.current === requestId) {
        setProviderModelsLoading(false);
        setProviderModelsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      try {
        const response = await authenticatedFetch('/api/providers/capabilities');
        const body = (await response.json()) as ProviderCapabilitiesApiResponse;
        if (cancelled || !body.success || !Array.isArray(body.data?.providers)) {
          return;
        }

        const byProvider: Partial<Record<LLMProvider, ProviderCapabilities>> = {};
        for (const capabilities of body.data.providers) {
          byProvider[capabilities.provider] = capabilities;
        }
        setProviderCapabilities(byProvider);
      } catch (error) {
        console.error('Error loading provider capabilities:', error);
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  const getPermissionModesForProvider = useCallback((targetProvider: LLMProvider): PermissionMode[] => {
    const capabilityModes = providerCapabilities?.[targetProvider]?.permissionModes;
    if (capabilityModes && capabilityModes.length > 0) {
      return capabilityModes as PermissionMode[];
    }
    return FALLBACK_PERMISSION_MODES[targetProvider] ?? ['default'];
  }, [providerCapabilities]);

  useEffect(() => {
    const handlePermissionSettingsChanged = (event: Event) => {
      if (event instanceof StorageEvent) {
        const key = event.key ?? '';
        if (
          key !== 'codex-settings'
          && key !== 'gemini-settings'
          && !key.startsWith('permissionMode-')
        ) {
          return;
        }
      }

      setPermissionSettingsVersion((version) => version + 1);
    };

    window.addEventListener(AGENT_PERMISSION_SETTINGS_CHANGED_EVENT, handlePermissionSettingsChanged);
    window.addEventListener('storage', handlePermissionSettingsChanged);

    return () => {
      window.removeEventListener(AGENT_PERMISSION_SETTINGS_CHANGED_EVENT, handlePermissionSettingsChanged);
      window.removeEventListener('storage', handlePermissionSettingsChanged);
    };
  }, []);

  const getDefaultPermissionModeForProvider = useCallback((targetProvider: LLMProvider): PermissionMode => {
    const modes = getPermissionModesForProvider(targetProvider);
    const settingsMode = resolveProviderSettingsPermissionMode(targetProvider, modes);
    if (settingsMode) {
      return settingsMode;
    }

    const capabilityDefault = providerCapabilities?.[targetProvider]?.defaultPermissionMode as PermissionMode | undefined;
    if (capabilityDefault && modes.includes(capabilityDefault)) {
      return capabilityDefault;
    }
    return modes[0] ?? 'default';
  }, [getPermissionModesForProvider, providerCapabilities]);

  const getSupportsEffortForProvider = useCallback((targetProvider: LLMProvider): boolean => {
    const capabilitySupport = providerCapabilities?.[targetProvider]?.supportsEffort;
    if (typeof capabilitySupport === 'boolean') {
      return capabilitySupport;
    }
    return Boolean(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider]?.length);
  }, [providerCapabilities]);

  const pickStoredOrCurrent = (
    storageKey: string,
    current: string,
    def: ProviderModelsDefinition,
  ): string => {
    const stored = localStorage.getItem(storageKey);
    if (stored && def.OPTIONS.some((o) => o.value === stored)) {
      return stored;
    }
    if (current && def.OPTIONS.some((o) => o.value === current)) {
      return current;
    }
    return def.DEFAULT;
  };

  const getModelOption = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): ProviderModelOption | null => {
    const definition = providerModelCatalog[targetProvider];
    if (!definition) {
      return null;
    }

    return definition.OPTIONS.find((option) => option.value === model) ?? null;
  }, [providerModelCatalog]);

  const getEffortOptionsForModel = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): NonNullable<ProviderModelOption['effort']>['values'] => {
    if (!getSupportsEffortForProvider(targetProvider)) {
      return [];
    }

    const option = getModelOption(targetProvider, model);
    if (option) {
      return option.effort?.values ?? [];
    }

    return toProviderEffortOptions(FALLBACK_PROVIDER_EFFORT_VALUES[targetProvider] ?? []);
  }, [getModelOption, getSupportsEffortForProvider]);

  const getAllowedEffortValues = useCallback((
    targetProvider: LLMProvider,
    model: string,
  ): string[] => (
    getEffortOptionsForModel(targetProvider, model).map((value) => value.value)
  ), [getEffortOptionsForModel]);

  const reconcileStoredEffort = useCallback((
    targetProvider: LLMProvider,
    model: string,
    currentEffort: string,
  ): string => {
    const allowedValues = getAllowedEffortValues(targetProvider, model);
    if (allowedValues.length === 0) {
      return DEFAULT_EFFORT_VALUE;
    }

    if (currentEffort === DEFAULT_EFFORT_VALUE || !currentEffort) {
      return DEFAULT_EFFORT_VALUE;
    }

    if (allowedValues.includes(currentEffort)) {
      return currentEffort;
    }

    return DEFAULT_EFFORT_VALUE;
  }, [getAllowedEffortValues]);

  const providerModels = useMemo<Record<LLMProvider, string>>(() => ({
    claude: claudeModel,
    cursor: cursorModel,
    codex: codexModel,
    gemini: geminiModel,
    opencode: opencodeModel,
  }), [claudeModel, cursorModel, codexModel, geminiModel, opencodeModel]);

  useEffect(() => {
    const claude = providerModelCatalog.claude;
    if (claude) {
      const next = pickStoredOrCurrent('claude-model', claudeModel, claude);
      if (next !== claudeModel) {
        setClaudeModel(next);
      }
      if (localStorage.getItem('claude-model') !== next) {
        localStorage.setItem('claude-model', next);
      }
    }
  }, [providerModelCatalog.claude, claudeModel]);

  useEffect(() => {
    const cursor = providerModelCatalog.cursor;
    if (cursor) {
      const next = pickStoredOrCurrent('cursor-model', cursorModel, cursor);
      if (next !== cursorModel) {
        setCursorModel(next);
      }
      if (localStorage.getItem('cursor-model') !== next) {
        localStorage.setItem('cursor-model', next);
      }
    }
  }, [providerModelCatalog.cursor, cursorModel]);

  useEffect(() => {
    const codex = providerModelCatalog.codex;
    if (codex) {
      const next = pickStoredOrCurrent('codex-model', codexModel, codex);
      if (next !== codexModel) {
        setCodexModel(next);
      }
      if (localStorage.getItem('codex-model') !== next) {
        localStorage.setItem('codex-model', next);
      }
    }
  }, [providerModelCatalog.codex, codexModel]);

  useEffect(() => {
    const gemini = providerModelCatalog.gemini;
    if (gemini) {
      const next = pickStoredOrCurrent('gemini-model', geminiModel, gemini);
      if (next !== geminiModel) {
        setGeminiModel(next);
      }
      if (localStorage.getItem('gemini-model') !== next) {
        localStorage.setItem('gemini-model', next);
      }
    }
  }, [providerModelCatalog.gemini, geminiModel]);

  useEffect(() => {
    const opencode = providerModelCatalog.opencode;
    if (opencode) {
      const next = pickStoredOrCurrent('opencode-model', opencodeModel, opencode);
      if (next !== opencodeModel) {
        setOpenCodeModel(next);
      }
      if (localStorage.getItem('opencode-model') !== next) {
        localStorage.setItem('opencode-model', next);
      }
    }
  }, [providerModelCatalog.opencode, opencodeModel]);

  useEffect(() => {
    const nextEfforts: Partial<Record<LLMProvider, string>> = {};
    let hasUpdates = false;

    for (const targetProvider of PROVIDERS) {
      const currentEffort = providerEfforts[targetProvider] ?? DEFAULT_EFFORT_VALUE;
      const nextEffort = reconcileStoredEffort(targetProvider, providerModels[targetProvider], currentEffort);
      if (nextEffort === currentEffort) {
        continue;
      }

      nextEfforts[targetProvider] = nextEffort;
      localStorage.setItem(`${targetProvider}-effort`, nextEffort);
      hasUpdates = true;
    }

    if (hasUpdates) {
      setProviderEfforts((previous) => ({ ...previous, ...nextEfforts }));
    }
  }, [providerEfforts, providerModels, reconcileStoredEffort]);

  useEffect(() => {
    const validModes = getPermissionModesForProvider(provider);
    const savedMode = selectedSession?.id
      ? localStorage.getItem(`permissionMode-${selectedSession.id}`) as PermissionMode | null
      : null;

    setPermissionMode(
      savedMode && validModes.includes(savedMode)
        ? savedMode
        : getDefaultPermissionModeForProvider(provider),
    );
  }, [
    selectedSession?.id,
    provider,
    getDefaultPermissionModeForProvider,
    getPermissionModesForProvider,
    permissionSettingsVersion,
  ]);

  useEffect(() => {
    if (!selectedSession?.__provider) {
      return;
    }

    if (selectedSession.__provider !== provider) {
      setProvider(selectedSession.__provider);
    }

    if (isActive) {
      localStorage.setItem('selected-provider', selectedSession.__provider);
    }
  }, [isActive, provider, selectedSession?.__provider]);

  // Permission prompts belong to a session, not to the transient provider
  // selection that is synchronized after navigation.
  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  useEffect(() => {
    if (provider !== 'cursor') {
      return;
    }

    authenticatedFetch('/api/cursor/config')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success || !data.config?.model?.modelId) {
          return;
        }

        const modelId = data.config.model.modelId as string;
        if (!localStorage.getItem('cursor-model')) {
          setCursorModel(modelId);
        }
      })
      .catch((error) => {
        console.error('Error loading Cursor config:', error);
      });
  }, [provider]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id, getPermissionModesForProvider]);

  const resolvePermissionModeForProvider = useCallback((
    targetProvider: LLMProvider,
    requestedMode: PermissionMode | string,
  ): PermissionMode => {
    const validModes = getPermissionModesForProvider(targetProvider);
    return validModes.includes(requestedMode as PermissionMode)
      ? requestedMode as PermissionMode
      : getDefaultPermissionModeForProvider(targetProvider);
  }, [getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  const selectProviderModel = useCallback(async (
    targetProvider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      setStoredProviderModel(targetProvider, model);
      return {
        scope: 'default' as const,
        changed: false,
        model,
      };
    }

    const response = await authenticatedFetch(
      `/api/providers/${targetProvider}/sessions/${encodeURIComponent(normalizedSessionId)}/active-model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
      },
    );

    const body = (await response.json()) as ChangeActiveModelApiResponse;
    if (!response.ok || !body.success || !body.data?.supported) {
      throw new Error('Unable to change the active model for this session.');
    }

    return {
      scope: 'session' as const,
      changed: body.data.changed === true,
      model: body.data.model || model,
    };
  }, [setStoredProviderModel]);

  const currentProviderEffortOptions = useMemo(() => {
    return getEffortOptionsForModel(provider, providerModels[provider]);
  }, [getEffortOptionsForModel, provider, providerModels]);
  const currentProviderEffort = useMemo(() => {
    return reconcileStoredEffort(
      provider,
      providerModels[provider],
      providerEfforts[provider] ?? DEFAULT_EFFORT_VALUE,
    );
  }, [provider, providerEfforts, providerModels, reconcileStoredEffort]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    geminiModel,
    setGeminiModel,
    opencodeModel,
    setOpenCodeModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels: () => loadProviderModels({ bypassCache: true }),
    selectProviderModel,
    setStoredProviderEffort,
    resolvePermissionModeForProvider,
  };
}
