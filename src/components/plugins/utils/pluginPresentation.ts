const DRAWER_PLUGIN_NAMES = new Set(['session-manager']);

export function shouldOpenPluginInDrawer(pluginName: string): boolean {
  return DRAWER_PLUGIN_NAMES.has(pluginName);
}
