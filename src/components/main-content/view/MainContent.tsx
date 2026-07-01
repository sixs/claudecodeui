import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import PluginTabContent from '../../plugins/view/PluginTabContent';
import PluginDrawer from '../../plugins/view/PluginDrawer';
import { shouldOpenPluginInDrawer } from '../../plugins/utils/pluginPresentation';
import { BrowserUsePanel } from '../../browser-use';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { authenticatedFetch } from '../../../utils/api';
import { useSessionStore } from '../../../stores/useSessionStore';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import { TaskMasterPanel } from '../../task-master';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import OpenSessionsBar, { type OpenSessionItem } from './subcomponents/OpenSessionsBar';
import ErrorBoundary from './ErrorBoundary';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
};

type SessionWorkspaceContext = {
  project: Project;
  session: ProjectSession;
};

const OPEN_SESSIONS_STORAGE_KEY = 'cloudcli.openSessions.v1';
const MAX_OPEN_SESSIONS = 12;
const KEEP_ALIVE_PANE_CLASS = 'absolute inset-0 h-full w-full overflow-hidden';

function readStoredOpenSessions(): OpenSessionItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(OPEN_SESSIONS_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter((session): session is OpenSessionItem => {
      return Boolean(session && typeof session === 'object' && typeof session.id === 'string');
    });
  } catch {
    return [];
  }
}

function toOpenSessionItem(selectedSession: MainContentProps['selectedSession'], selectedProject: Project): OpenSessionItem | null {
  if (!selectedSession) {
    return null;
  }

  return {
    id: selectedSession.id,
    title: typeof selectedSession.title === 'string' ? selectedSession.title : undefined,
    summary: typeof selectedSession.summary === 'string' ? selectedSession.summary : undefined,
    name: typeof selectedSession.name === 'string' ? selectedSession.name : undefined,
    provider: selectedSession.provider,
    __provider: selectedSession.__provider,
    __projectId: selectedSession.__projectId || selectedProject.projectId,
    projectDisplayName: selectedProject.displayName,
  };
}

function upsertOpenSession(sessions: OpenSessionItem[], nextSession: OpenSessionItem): OpenSessionItem[] {
  const existingIndex = sessions.findIndex((session) => session.id === nextSession.id);
  if (existingIndex >= 0) {
    const updatedSessions = [...sessions];
    updatedSessions[existingIndex] = { ...updatedSessions[existingIndex], ...nextSession };
    return updatedSessions;
  }

  return [...sessions, nextSession].slice(-MAX_OPEN_SESSIONS);
}

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings() as TasksSettingsContextValue;
  const sharedSessionStore = useSessionStore();
  const chatStatusCheckSentAtRef = useRef(new Map<string, number>());
  const chatLastSeqRef = useRef(new Map<string, number>());
  const chatStreamTimerRef = useRef(new Map<string, number>());
  const chatAccumulatedStreamRef = useRef(new Map<string, string>());
  const chatStreamProviderRef = useRef(new Map<string, LLMProvider>());
  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  const [drawerPluginName, setDrawerPluginName] = useState<string | null>(null);
  const [openSessions, setOpenSessions] = useState<OpenSessionItem[]>(readStoredOpenSessions);
  const [sessionContexts, setSessionContexts] = useState<Record<string, SessionWorkspaceContext>>({});
  const [shellKeepAliveSessionIds, setShellKeepAliveSessionIds] = useState<string[]>([]);

  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);
  const shouldShowBrowserTab = browserUseEnabled;

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  useEffect(() => {
    // Identify projects by DB `projectId`; the TaskMaster context uses the
    // same identifier to key its internal maps.
    const selectedProjectId = selectedProject?.projectId;
    const currentProjectId = currentProject?.projectId;

    if (selectedProject && selectedProjectId !== currentProjectId) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject?.projectId, setCurrentProject]);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  const loadBrowserUseSettings = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/browser-use/settings');
      const data = await response.json();
      setBrowserUseEnabled(Boolean(response.ok && data?.success !== false && data?.data?.settings?.enabled));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseSettings();
    window.addEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
    return () => window.removeEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
  }, [loadBrowserUseSettings]);

  useEffect(() => {
    if (!shouldShowBrowserTab && activeTab === 'browser') {
      setActiveTab('chat');
    }
  }, [shouldShowBrowserTab, activeTab, setActiveTab]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const nextSession = toOpenSessionItem(selectedSession, selectedProject);
    if (!nextSession) {
      return;
    }

    setOpenSessions((currentSessions) => upsertOpenSession(currentSessions, nextSession));
  }, [selectedProject, selectedSession]);

  useEffect(() => {
    if (!selectedProject || !selectedSession) {
      return;
    }

    setSessionContexts((currentContexts) => ({
      ...currentContexts,
      [selectedSession.id]: {
        project: selectedProject,
        session: selectedSession,
      },
    }));
  }, [selectedProject, selectedSession]);

  useEffect(() => {
    if (activeTab !== 'shell' || !selectedSession) {
      return;
    }

    setShellKeepAliveSessionIds((currentSessionIds) => {
      if (currentSessionIds.includes(selectedSession.id)) {
        return currentSessionIds;
      }

      return [...currentSessionIds, selectedSession.id];
    });
  }, [activeTab, selectedSession]);

  useEffect(() => {
    const retainedSessionIds = new Set(openSessions.map((session) => session.id));
    if (selectedSession) {
      retainedSessionIds.add(selectedSession.id);
    }

    setSessionContexts((currentContexts) => {
      const nextContexts: Record<string, SessionWorkspaceContext> = {};
      let changed = false;

      for (const [sessionId, context] of Object.entries(currentContexts)) {
        if (retainedSessionIds.has(sessionId)) {
          nextContexts[sessionId] = context;
        } else {
          changed = true;
        }
      }

      return changed ? nextContexts : currentContexts;
    });

    setShellKeepAliveSessionIds((currentSessionIds) => {
      const nextSessionIds = currentSessionIds.filter((sessionId) => retainedSessionIds.has(sessionId));
      return nextSessionIds.length === currentSessionIds.length ? currentSessionIds : nextSessionIds;
    });
  }, [openSessions, selectedSession]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(openSessions));
    } catch {
      // Losing the recent open-session list should not affect active work.
    }
  }, [openSessions]);

  useEffect(() => {
    if (!activeTab.startsWith('plugin:')) {
      return;
    }

    const pluginName = activeTab.replace('plugin:', '');
    if (shouldOpenPluginInDrawer(pluginName)) {
      setDrawerPluginName(pluginName);
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      setActiveTab('files');
      handleFileOpen(filePath);
    },
    // Opens the editor side panel in place, keeping the current tab (e.g. chat).
    openFileInEditor: (filePath: string) => {
      resolvedFileOpen(filePath);
    },
  });

  const handleOpenSessionSelect = useCallback(
    (sessionId: string) => {
      if (sessionId === selectedSession?.id) {
        return;
      }

      onNavigateToSession(sessionId);
    },
    [onNavigateToSession, selectedSession?.id],
  );

  const handleOpenSessionClose = useCallback(
    (sessionId: string) => {
      const sessionIndex = openSessions.findIndex((session) => session.id === sessionId);
      if (sessionIndex === -1) {
        return;
      }

      const nextSessions = openSessions.filter((session) => session.id !== sessionId);
      setOpenSessions(nextSessions);

      if (sessionId !== selectedSession?.id || nextSessions.length === 0) {
        return;
      }

      const fallbackSession = nextSessions[Math.min(sessionIndex, nextSessions.length - 1)];
      if (fallbackSession) {
        onNavigateToSession(fallbackSession.id);
      }
    },
    [onNavigateToSession, openSessions, selectedSession?.id],
  );

  const workspaceContexts = useMemo(() => {
    const contextsBySessionId = new Map<string, SessionWorkspaceContext>(Object.entries(sessionContexts));
    if (selectedProject && selectedSession) {
      contextsBySessionId.set(selectedSession.id, {
        project: selectedProject,
        session: selectedSession,
      });
    }

    const orderedSessionIds = new Set(openSessions.map((session) => session.id));
    if (selectedSession) {
      orderedSessionIds.add(selectedSession.id);
    }

    return Array.from(orderedSessionIds)
      .map((sessionId) => contextsBySessionId.get(sessionId))
      .filter((context): context is SessionWorkspaceContext => Boolean(context));
  }, [openSessions, selectedProject, selectedSession, sessionContexts]);

  const shellWorkspaceContexts = useMemo(() => {
    const shellSessionIds = new Set(shellKeepAliveSessionIds);
    if (activeTab === 'shell' && selectedSession) {
      shellSessionIds.add(selectedSession.id);
    }

    return workspaceContexts.filter((context) => shellSessionIds.has(context.session.id));
  }, [activeTab, selectedSession, shellKeepAliveSessionIds, workspaceContexts]);

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col">
      <OpenSessionsBar
        sessions={openSessions}
        activeSessionId={selectedSession?.id ?? null}
        processingSessions={processingSessions}
        drawerPluginName={drawerPluginName}
        onSelect={handleOpenSessionSelect}
        onClose={handleOpenSessionClose}
        onOpenPluginDrawer={setDrawerPluginName}
      />

      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        shouldShowTasksTab={shouldShowTasksTab}
        shouldShowBrowserTab={shouldShowBrowserTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`relative min-h-0 min-w-[200px] overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}
        >
          <div className={`${KEEP_ALIVE_PANE_CLASS} ${activeTab === 'chat' ? '' : 'invisible pointer-events-none'}`}>
            {workspaceContexts.map((context) => {
              const isCurrentSession = context.session.id === selectedSession?.id;

              return (
                <div
                  key={`chat-${context.session.id}`}
                  className={`${KEEP_ALIVE_PANE_CLASS} ${isCurrentSession ? '' : 'invisible pointer-events-none'}`}
                >
                  <ErrorBoundary showDetails>
                    <ChatInterface
                      selectedProject={context.project}
                      selectedSession={context.session}
                      isActive={isCurrentSession}
                      sessionStore={sharedSessionStore}
                      statusCheckSentAtRef={chatStatusCheckSentAtRef}
                      lastSeqRef={chatLastSeqRef}
                      streamTimerRef={chatStreamTimerRef}
                      accumulatedStreamRef={chatAccumulatedStreamRef}
                      streamProviderRef={chatStreamProviderRef}
                      ws={ws}
                      sendMessage={sendMessage}
                      onFileOpen={handleFileOpen}
                      onInputFocusChange={isCurrentSession ? onInputFocusChange : undefined}
                      onSessionProcessing={onSessionProcessing}
                      onSessionIdle={onSessionIdle}
                      processingSessions={processingSessions}
                      onNavigateToSession={onNavigateToSession}
                      onSessionEstablished={onSessionEstablished}
                      onShowSettings={onShowSettings}
                      showRawParameters={showRawParameters}
                      showThinking={showThinking}
                      sendByCtrlEnter={sendByCtrlEnter}
                      externalMessageUpdate={isCurrentSession ? externalMessageUpdate : 0}
                      newSessionTrigger={isCurrentSession ? newSessionTrigger : 0}
                      onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
                    />
                  </ErrorBoundary>
                </div>
              );
            })}

            {!selectedSession && (
              <div className={KEEP_ALIVE_PANE_CLASS}>
                <ErrorBoundary showDetails>
                  <ChatInterface
                    selectedProject={selectedProject}
                    selectedSession={null}
                    isActive
                    sessionStore={sharedSessionStore}
                    statusCheckSentAtRef={chatStatusCheckSentAtRef}
                    lastSeqRef={chatLastSeqRef}
                    streamTimerRef={chatStreamTimerRef}
                    accumulatedStreamRef={chatAccumulatedStreamRef}
                    streamProviderRef={chatStreamProviderRef}
                    ws={ws}
                    sendMessage={sendMessage}
                    onFileOpen={handleFileOpen}
                    onInputFocusChange={onInputFocusChange}
                    onSessionProcessing={onSessionProcessing}
                    onSessionIdle={onSessionIdle}
                    processingSessions={processingSessions}
                    onNavigateToSession={onNavigateToSession}
                    onSessionEstablished={onSessionEstablished}
                    onShowSettings={onShowSettings}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    sendByCtrlEnter={sendByCtrlEnter}
                    externalMessageUpdate={externalMessageUpdate}
                    newSessionTrigger={newSessionTrigger}
                    onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>

          <div className={`${KEEP_ALIVE_PANE_CLASS} ${activeTab === 'files' ? '' : 'invisible pointer-events-none'}`}>
            {activeTab === 'files' && (
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
            )}
          </div>

          <div className={`${KEEP_ALIVE_PANE_CLASS} ${activeTab === 'shell' ? '' : 'invisible pointer-events-none'}`}>
            {shellWorkspaceContexts.map((context) => {
              const isCurrentSession = context.session.id === selectedSession?.id;

              return (
                <div
                  key={`shell-${context.session.id}`}
                  className={`${KEEP_ALIVE_PANE_CLASS} ${isCurrentSession ? '' : 'invisible pointer-events-none'}`}
                >
                  <StandaloneShell
                    project={context.project}
                    session={context.session}
                    showHeader={false}
                    isActive={activeTab === 'shell' && isCurrentSession}
                  />
                </div>
              );
            })}

            {activeTab === 'shell' && !selectedSession && (
              <div className={KEEP_ALIVE_PANE_CLASS}>
                <StandaloneShell
                  project={selectedProject}
                  session={null}
                  showHeader={false}
                  isActive
                />
              </div>
            )}
          </div>

          <div className={`${KEEP_ALIVE_PANE_CLASS} ${activeTab === 'git' ? '' : 'invisible pointer-events-none'}`}>
            {activeTab === 'git' && (
              <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
            )}
          </div>

          {shouldShowTasksTab && (
            <div className={`${KEEP_ALIVE_PANE_CLASS} ${activeTab === 'tasks' ? '' : 'invisible pointer-events-none'}`}>
              <TaskMasterPanel isVisible={activeTab === 'tasks'} />
            </div>
          )}

          {shouldShowBrowserTab && (
            <div className={`${KEEP_ALIVE_PANE_CLASS} ${activeTab === 'browser' ? '' : 'invisible pointer-events-none'}`}>
              {activeTab === 'browser' && (
                <BrowserUsePanel isVisible={activeTab === 'browser'} onShowSettings={onShowSettings} />
              )}
            </div>
          )}

          {activeTab.startsWith('plugin:') && !shouldOpenPluginInDrawer(activeTab.replace('plugin:', '')) && (
            <div className={KEEP_ALIVE_PANE_CLASS}>
              <PluginTabContent
                pluginName={activeTab.replace('plugin:', '')}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
              />
            </div>
          )}
        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={activeTab === 'files'}
        />
      </div>

      <PluginDrawer
        pluginName={drawerPluginName}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        onClose={() => setDrawerPluginName(null)}
      />

      <QuickSettingsPanel />
    </div>
  );
}

export default React.memo(MainContent);
