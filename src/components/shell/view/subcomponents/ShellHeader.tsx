import { RotateCcw, X } from 'lucide-react';

type ShellHeaderProps = {
  isConnected: boolean;
  isInitialized: boolean;
  isRestarting: boolean;
  hasSession: boolean;
  onDisconnect: () => void;
  onRestart: () => void;
  statusNewSessionText: string;
  statusInitializingText: string;
  statusRestartingText: string;
  disconnectLabel: string;
  disconnectTitle: string;
  restartLabel: string;
  restartTitle: string;
  disableRestart: boolean;
};

export default function ShellHeader({
  isConnected,
  isInitialized,
  isRestarting,
  hasSession,
  onDisconnect,
  onRestart,
  statusNewSessionText,
  statusInitializingText,
  statusRestartingText,
  disconnectLabel,
  disconnectTitle,
  restartLabel,
  restartTitle,
  disableRestart,
}: ShellHeaderProps) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-600/50 bg-gray-900/55 px-2 py-1.5 text-xs shadow-lg opacity-75 backdrop-blur-md transition-opacity hover:opacity-100 focus-within:opacity-100">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className={`h-2 w-2 shrink-0 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />

          {!hasSession && <span className="whitespace-nowrap text-gray-300">{statusNewSessionText}</span>}

          {!isInitialized && <span className="whitespace-nowrap text-yellow-300">{statusInitializingText}</span>}

          {isRestarting && <span className="whitespace-nowrap text-blue-300">{statusRestartingText}</span>}
        </div>

        <div className="flex items-center gap-1.5">
          {isConnected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-red-600/85 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400/70 focus:ring-offset-2 focus:ring-offset-gray-900"
              title={disconnectTitle}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{disconnectLabel}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            disabled={disableRestart}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-gray-500/60 bg-gray-800/70 px-2.5 text-[11px] font-medium text-gray-100 transition-colors hover:border-blue-400/70 hover:bg-blue-600/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400/70 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-gray-500 disabled:opacity-60"
            title={restartTitle}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{restartLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
