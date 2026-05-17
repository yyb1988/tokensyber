import * as vscode from 'vscode';
import { initInterceptor, disposeInterceptor } from './interceptor';
import { startServer, stopServer, broadcastTokenConsumed, getTotalTokens, onTokenBroadcast } from './ws-server';

let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('tokensyber');
  const port = config.get<number>('port', 3001);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(flame) TokenSyber';
  statusBarItem.tooltip = 'TokenSyber — 算力燃料泵';
  statusBarItem.command = 'tokensyber.showStats';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('tokensyber.showStats', () => {
      const total = getTotalTokens();
      vscode.window.showInformationMessage(
        `TokenSyber: ${formatCount(total)} tokens tracked | Port: ${port}`
      );
    })
  );

  // Start WebSocket server
  try {
    await startServer(port);
    updateStatusBar('connected');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`TokenSyber: ${msg}`);
    updateStatusBar('error');
    return;
  }

  // Wire interceptor → WebSocket broadcast
  initInterceptor((tokens: number) => {
    broadcastTokenConsumed(tokens);
  }, port);

  onTokenBroadcast((data) => {
    updateStatusBar('active', data.totalTokens);
  });

  // Watch for port config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tokensyber.port')) {
        vscode.window.showInformationMessage(
          'TokenSyber: Port changed. Please reload VS Code to apply.'
        );
      }
    })
  );
}

export async function deactivate() {
  disposeInterceptor();
  await stopServer();
}

function updateStatusBar(state: 'connected' | 'active' | 'error', total?: number) {
  if (state === 'active' && total !== undefined) {
    statusBarItem.text = `$(flame) ${formatCount(total)}`;
    statusBarItem.tooltip = `TokenSyber — ${formatCount(total)} tokens tracked`;
  } else if (state === 'connected') {
    statusBarItem.text = '$(flame) TokenSyber';
    statusBarItem.tooltip = 'TokenSyber — 算力燃料泵已连接';
  } else {
    statusBarItem.text = '$(flame) TokenSyber (!)';
    statusBarItem.tooltip = 'TokenSyber — 连接失败';
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
