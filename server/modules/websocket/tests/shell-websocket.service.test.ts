import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';

import { buildShellCommand } from '../services/shell-websocket.service.js';

const dependencies = {
  resolveProviderSessionId(sessionId: string): string {
    return `native-${sessionId}`;
  },
  stripAnsiSequences(content: string): string {
    return content;
  },
  normalizeDetectedUrl(url: string): string | null {
    return url;
  },
  extractUrlsFromText(): string[] {
    return [];
  },
  shouldAutoOpenUrlFromOutput(): boolean {
    return false;
  },
};

test('Codex shell command keeps local Codex config when no permission mode is set', () => {
  assert.equal(
    buildShellCommand({ type: 'init', provider: 'codex' }, dependencies),
    'codex',
  );
});

test('Codex shell command applies bypass permissions for new sessions', () => {
  assert.equal(
    buildShellCommand({ type: 'init', provider: 'codex', permissionMode: 'bypassPermissions' }, dependencies),
    'codex --dangerously-bypass-approvals-and-sandbox',
  );
});

test('Codex shell command applies bypass permissions when resuming sessions', () => {
  const expected = os.platform() === 'win32'
    ? 'codex --dangerously-bypass-approvals-and-sandbox resume native-app-session; if ($LASTEXITCODE -ne 0) { codex --dangerously-bypass-approvals-and-sandbox }'
    : 'codex --dangerously-bypass-approvals-and-sandbox resume native-app-session || codex --dangerously-bypass-approvals-and-sandbox';

  assert.equal(
    buildShellCommand({
      type: 'init',
      provider: 'codex',
      hasSession: true,
      sessionId: 'app-session',
      permissionMode: 'bypassPermissions',
    }, dependencies),
    expected,
  );
});

test('Codex shell command maps acceptEdits to workspace auto approval', () => {
  assert.equal(
    buildShellCommand({ type: 'init', provider: 'codex', permissionMode: 'acceptEdits' }, dependencies),
    'codex --sandbox workspace-write --ask-for-approval never',
  );
});

test('Claude shell command applies saved tool permissions', () => {
  assert.equal(
    buildShellCommand({
      type: 'init',
      provider: 'claude',
      toolsSettings: {
        skipPermissions: true,
        allowedTools: ['Bash(git log:*)', 'Edit'],
        disallowedTools: ['Bash(rm:*)'],
      },
    }, dependencies),
    "claude --permission-mode bypassPermissions --allowed-tools 'Bash(git log:*),Edit' --disallowed-tools 'Bash(rm:*)'",
  );
});

test('Claude shell command lets an explicit session mode override skip permissions', () => {
  assert.equal(
    buildShellCommand({
      type: 'init',
      provider: 'claude',
      permissionMode: 'plan',
      toolsSettings: {
        skipPermissions: true,
      },
    }, dependencies),
    'claude --permission-mode plan',
  );
});

test('Claude shell command keeps permissions when resume fallback starts a new session', () => {
  const expected = os.platform() === 'win32'
    ? 'claude --permission-mode bypassPermissions --resume native-app-session; if ($LASTEXITCODE -ne 0) { claude --permission-mode bypassPermissions }'
    : 'claude --permission-mode bypassPermissions --resume native-app-session || claude --permission-mode bypassPermissions';

  assert.equal(
    buildShellCommand({
      type: 'init',
      provider: 'claude',
      hasSession: true,
      sessionId: 'app-session',
      toolsSettings: {
        skipPermissions: true,
      },
    }, dependencies),
    expected,
  );
});

test('Cursor shell command maps bypass permissions to -f', () => {
  assert.equal(
    buildShellCommand({ type: 'init', provider: 'cursor', permissionMode: 'bypassPermissions' }, dependencies),
    'cursor-agent -f',
  );
});

test('Cursor shell command applies saved skip permissions when resuming', () => {
  assert.equal(
    buildShellCommand({
      type: 'init',
      provider: 'cursor',
      hasSession: true,
      sessionId: 'app-session',
      toolsSettings: {
        skipPermissions: true,
      },
    }, dependencies),
    'cursor-agent --resume=native-app-session -f',
  );
});

test('Gemini shell command applies native approval modes', () => {
  assert.equal(
    buildShellCommand({ type: 'init', provider: 'gemini', permissionMode: 'auto_edit' }, dependencies),
    'gemini --approval-mode auto_edit',
  );

  assert.equal(
    buildShellCommand({ type: 'init', provider: 'gemini', permissionMode: 'yolo' }, dependencies),
    'gemini --yolo',
  );
});

test('Gemini shell command maps legacy aliases to native modes', () => {
  assert.equal(
    buildShellCommand({ type: 'init', provider: 'gemini', permissionMode: 'acceptEdits' }, dependencies),
    'gemini --approval-mode auto_edit',
  );

  assert.equal(
    buildShellCommand({ type: 'init', provider: 'gemini', permissionMode: 'bypassPermissions' }, dependencies),
    'gemini --yolo',
  );
});

test('Gemini shell command leaves login commands unchanged', () => {
  assert.equal(
    buildShellCommand({
      type: 'init',
      provider: 'gemini',
      initialCommand: 'gemini auth login',
      permissionMode: 'yolo',
    }, dependencies),
    'gemini auth login',
  );
});
