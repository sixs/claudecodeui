import { X } from 'lucide-react';

import { Tooltip } from '../../../../shared/view/ui';
import { usePlugins } from '../../../../contexts/PluginsContext';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import PluginIcon from '../../../plugins/view/PluginIcon';
import { shouldOpenPluginInDrawer } from '../../../plugins/utils/pluginPresentation';
import type { LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';

export type OpenSessionItem = {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  provider?: LLMProvider;
  __provider?: LLMProvider;
  projectDisplayName?: string;
  __projectId?: string;
};

type OpenSessionsBarProps = {
  sessions: OpenSessionItem[];
  activeSessionId: string | null;
  processingSessions: SessionActivityMap;
  drawerPluginName: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onOpenPluginDrawer: (pluginName: string) => void;
};

function getSessionTitle(session: OpenSessionItem): string {
  if (session.__provider === 'cursor') {
    return session.name || 'Untitled Session';
  }

  return session.summary || session.title || session.name || 'New Session';
}

function getSessionProvider(session: OpenSessionItem): LLMProvider | undefined {
  return session.__provider || session.provider;
}

export default function OpenSessionsBar({
  sessions,
  activeSessionId,
  processingSessions,
  drawerPluginName,
  onSelect,
  onClose,
  onOpenPluginDrawer,
}: OpenSessionsBarProps) {
  const { plugins } = usePlugins();
  const drawerPlugins = plugins.filter((plugin) => plugin.enabled && shouldOpenPluginInDrawer(plugin.name));

  if (sessions.length === 0 && drawerPlugins.length === 0) {
    return null;
  }

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border/70 bg-muted/20 px-2">
      <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isProcessing = processingSessions.has(session.id);
          const title = getSessionTitle(session);

          return (
            <div
              key={session.id}
              title={title}
              className={[
                'group flex h-8 min-w-[160px] max-w-[260px] shrink-0 items-center gap-2 rounded-md border px-2 text-left transition-colors',
                isActive
                  ? 'border-primary/50 bg-background text-foreground shadow-sm'
                  : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-background/80 hover:text-foreground',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <SessionProviderLogo provider={getSessionProvider(session)} className="h-4 w-4" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium leading-tight">{title}</span>
                  {session.projectDisplayName && (
                    <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                      {session.projectDisplayName}
                    </span>
                  )}
                </span>
              </button>

              {isProcessing && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}

              <button
                type="button"
                aria-label={`Close ${title}`}
                onClick={() => onClose(session.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {drawerPlugins.length > 0 && (
        <div className="ml-2 flex shrink-0 items-center gap-1 border-l border-border/60 pl-2">
          {drawerPlugins.map((plugin) => {
            const isActive = drawerPluginName === plugin.name;

            return (
              <Tooltip key={plugin.name} content={plugin.displayName} position="bottom">
                <button
                  type="button"
                  aria-label={plugin.displayName}
                  onClick={() => onOpenPluginDrawer(plugin.name)}
                  className={[
                    'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-primary/50 bg-background text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-background/80 hover:text-foreground',
                  ].join(' ')}
                >
                  <PluginIcon
                    pluginName={plugin.name}
                    iconFile={plugin.icon}
                    className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                  />
                  <span className="hidden sm:inline">{plugin.displayName}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
