import { X } from 'lucide-react';

import { usePlugins } from '../../../contexts/PluginsContext';
import type { Project, ProjectSession } from '../../../types/app';

import PluginIcon from './PluginIcon';
import PluginTabContent from './PluginTabContent';

type PluginDrawerProps = {
  pluginName: string | null;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onClose: () => void;
};

export default function PluginDrawer({
  pluginName,
  selectedProject,
  selectedSession,
  onClose,
}: PluginDrawerProps) {
  const { plugins } = usePlugins();
  const plugin = pluginName ? plugins.find((item) => item.name === pluginName) : null;

  if (!pluginName || !plugin) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="Close plugin drawer"
        className="absolute inset-0 bg-black/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[42rem] flex-col border-l border-border bg-background shadow-2xl sm:w-[min(88vw,42rem)]">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <PluginIcon
              pluginName={plugin.name}
              iconFile={plugin.icon}
              className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{plugin.displayName}</div>
              <div className="text-[11px] text-muted-foreground">Plugin panel</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close plugin drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PluginTabContent
            pluginName={pluginName}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
          />
        </div>
      </aside>
    </div>
  );
}
